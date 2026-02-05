/**
 * @fileoverview Right-Sizing Service
 *
 * Provides VM right-sizing analysis by comparing actual resource usage
 * against current VM sizes. Handles large subscriptions (300+ VMs)
 * efficiently with batched, multi-threaded queries over 30-day analysis window.
 *
 * Uses Azure Advisor thresholds for consistent recommendations:
 * - Underutilized: CPU max < 5% OR (CPU max < 20% AND CPU avg < 10%)
 * - Overutilized: CPU P95 > 85% OR Memory P95 > 85%
 *
 * @version v11-microservices
 */

const DEFAULT_TIME_RANGE_DAYS = 30;
const MAX_VMS_PER_BATCH = 50;
const MAX_CONCURRENT_QUERIES = 3;
const QUERY_TIMEOUT_MS = 120000; // 2 minutes per batch

/**
 * Azure Advisor-aligned thresholds for right-sizing recommendations.
 */
const THRESHOLDS = {
    underutilized: {
        cpu: {
            max: 5,      // CPU max < 5% = definitely underutilized
            maxAlt: 20,  // OR CPU max < 20% AND
            avgAlt: 10   // CPU avg < 10%
        },
        memory: {
            max: 20,
            avg: 10
        }
    },
    overutilized: {
        cpu: {
            p95: 85,    // CPU P95 > 85%
            max: 95     // OR sustained at 95%
        },
        memory: {
            p95: 85,
            max: 95
        }
    },
    minimumSamples: {
        days30: 2000,  // Minimum samples for reliable 30-day analysis
        acceptable: 500 // At least some coverage
    }
};

/**
 * VM size downgrade recommendations mapping.
 */
const SIZE_DOWNGRADES = {
    'Standard_D4s_v3': 'Standard_D2s_v3',
    'Standard_D8s_v3': 'Standard_D4s_v3',
    'Standard_D16s_v3': 'Standard_D8s_v3',
    'Standard_D32s_v3': 'Standard_D16s_v3',
    'Standard_D4s_v4': 'Standard_D2s_v4',
    'Standard_D8s_v4': 'Standard_D4s_v4',
    'Standard_D16s_v4': 'Standard_D8s_v4',
    'Standard_D32s_v4': 'Standard_D16s_v4',
    'Standard_D4s_v5': 'Standard_D2s_v5',
    'Standard_D8s_v5': 'Standard_D4s_v5',
    'Standard_D16s_v5': 'Standard_D8s_v5',
    'Standard_D32s_v5': 'Standard_D16s_v5',
    'Standard_E4s_v3': 'Standard_E2s_v3',
    'Standard_E8s_v3': 'Standard_E4s_v3',
    'Standard_E16s_v3': 'Standard_E8s_v3',
    'Standard_E4s_v4': 'Standard_E2s_v4',
    'Standard_E8s_v4': 'Standard_E4s_v4',
    'Standard_E16s_v4': 'Standard_E8s_v4',
    'Standard_E4s_v5': 'Standard_E2s_v5',
    'Standard_E8s_v5': 'Standard_E4s_v5',
    'Standard_E16s_v5': 'Standard_E8s_v5',
    'Standard_F4s_v2': 'Standard_F2s_v2',
    'Standard_F8s_v2': 'Standard_F4s_v2',
    'Standard_F16s_v2': 'Standard_F8s_v2',
    'Standard_B2s': 'Standard_B1s',
    'Standard_B2ms': 'Standard_B1ms',
    'Standard_B4ms': 'Standard_B2ms',
    'Standard_B8ms': 'Standard_B4ms'
};

/**
 * VM size upgrade recommendations mapping.
 */
const SIZE_UPGRADES = {
    'Standard_D2s_v3': 'Standard_D4s_v3',
    'Standard_D4s_v3': 'Standard_D8s_v3',
    'Standard_D8s_v3': 'Standard_D16s_v3',
    'Standard_D16s_v3': 'Standard_D32s_v3',
    'Standard_D2s_v4': 'Standard_D4s_v4',
    'Standard_D4s_v4': 'Standard_D8s_v4',
    'Standard_D8s_v4': 'Standard_D16s_v4',
    'Standard_D16s_v4': 'Standard_D32s_v4',
    'Standard_D2s_v5': 'Standard_D4s_v5',
    'Standard_D4s_v5': 'Standard_D8s_v5',
    'Standard_D8s_v5': 'Standard_D16s_v5',
    'Standard_D16s_v5': 'Standard_D32s_v5',
    'Standard_E2s_v3': 'Standard_E4s_v3',
    'Standard_E4s_v3': 'Standard_E8s_v3',
    'Standard_E8s_v3': 'Standard_E16s_v3',
    'Standard_E2s_v4': 'Standard_E4s_v4',
    'Standard_E4s_v4': 'Standard_E8s_v4',
    'Standard_E8s_v4': 'Standard_E16s_v4',
    'Standard_E2s_v5': 'Standard_E4s_v5',
    'Standard_E4s_v5': 'Standard_E8s_v5',
    'Standard_E8s_v5': 'Standard_E16s_v5',
    'Standard_F2s_v2': 'Standard_F4s_v2',
    'Standard_F4s_v2': 'Standard_F8s_v2',
    'Standard_F8s_v2': 'Standard_F16s_v2',
    'Standard_B1s': 'Standard_B2s',
    'Standard_B1ms': 'Standard_B2ms',
    'Standard_B2ms': 'Standard_B4ms',
    'Standard_B4ms': 'Standard_B8ms'
};

/**
 * Approximate monthly costs by VM size (USD, Pay-As-You-Go, East US).
 * Used for savings estimation.
 */
const ESTIMATED_MONTHLY_COSTS = {
    'Standard_B1s': 7.59,
    'Standard_B1ms': 15.18,
    'Standard_B2s': 30.37,
    'Standard_B2ms': 60.74,
    'Standard_B4ms': 121.47,
    'Standard_B8ms': 242.94,
    'Standard_D2s_v3': 70.08,
    'Standard_D4s_v3': 140.16,
    'Standard_D8s_v3': 280.32,
    'Standard_D16s_v3': 560.64,
    'Standard_D32s_v3': 1121.28,
    'Standard_D2s_v4': 70.08,
    'Standard_D4s_v4': 140.16,
    'Standard_D8s_v4': 280.32,
    'Standard_D16s_v4': 560.64,
    'Standard_D32s_v4': 1121.28,
    'Standard_D2s_v5': 70.08,
    'Standard_D4s_v5': 140.16,
    'Standard_D8s_v5': 280.32,
    'Standard_D16s_v5': 560.64,
    'Standard_D32s_v5': 1121.28,
    'Standard_E2s_v3': 91.98,
    'Standard_E4s_v3': 183.96,
    'Standard_E8s_v3': 367.92,
    'Standard_E16s_v3': 735.84,
    'Standard_E2s_v4': 91.98,
    'Standard_E4s_v4': 183.96,
    'Standard_E8s_v4': 367.92,
    'Standard_E16s_v4': 735.84,
    'Standard_E2s_v5': 91.98,
    'Standard_E4s_v5': 183.96,
    'Standard_E8s_v5': 367.92,
    'Standard_E16s_v5': 735.84,
    'Standard_F2s_v2': 61.32,
    'Standard_F4s_v2': 122.64,
    'Standard_F8s_v2': 245.28,
    'Standard_F16s_v2': 490.56
};

/**
 * Generate KQL query for a batch of VMs.
 * Pre-aggregates data to minimize response size.
 *
 * @param {string[]} vmNames - List of VM names to query
 * @param {number} timeRangeDays - Analysis period in days
 * @returns {string} KQL query
 */
function generateBatchMetricsQuery(vmNames, timeRangeDays = 30) {
    // Escape VM names for KQL
    const vmList = vmNames.map(name => `"${name.replace(/"/g, '\\"')}"`).join(', ');

    return `
let vmList = dynamic([${vmList}]);
let timeRange = ${timeRangeDays}d;

// CPU Metrics (pre-aggregated)
let cpuMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    | where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
    | where Computer in (vmList) or tolower(Computer) in (vmList)
    | summarize
        CPU_Avg = round(avg(CounterValue), 2),
        CPU_Max = round(max(CounterValue), 2),
        CPU_P95 = round(percentile(CounterValue, 95), 2),
        CPU_SampleCount = count()
        by Computer;

// Memory Metrics (pre-aggregated)
let memMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    | where ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")
    | where Computer in (vmList) or tolower(Computer) in (vmList)
    | summarize
        Memory_Avg = round(avg(CounterValue), 2),
        Memory_Max = round(max(CounterValue), 2),
        Memory_P95 = round(percentile(CounterValue, 95), 2),
        Memory_SampleCount = count()
        by Computer;

// Join CPU and Memory
cpuMetrics
| join kind=leftouter (memMetrics) on Computer
| project
    Computer,
    CPU_Avg,
    CPU_Max,
    CPU_P95,
    CPU_SampleCount,
    Memory_Avg = coalesce(Memory_Avg, 0.0),
    Memory_Max = coalesce(Memory_Max, 0.0),
    Memory_P95 = coalesce(Memory_P95, 0.0),
    Memory_SampleCount = coalesce(Memory_SampleCount, 0)
| order by Computer asc
`;
}

/**
 * Analyze metrics for a single VM and determine right-sizing recommendation.
 *
 * @param {Object} metrics - VM metrics from KQL
 * @param {Object} vmInfo - VM info from Resource Graph
 * @returns {Object} Analysis result with recommendation
 */
function analyzeVMMetrics(metrics, vmInfo) {
    const result = {
        vmName: vmInfo.vmName || metrics.Computer,
        resourceGroup: vmInfo.resourceGroup,
        location: vmInfo.location,
        currentSize: vmInfo.vmSize,
        metrics: {
            cpuAvg: metrics.CPU_Avg,
            cpuMax: metrics.CPU_Max,
            cpuP95: metrics.CPU_P95,
            cpuSamples: metrics.CPU_SampleCount,
            memoryAvg: metrics.Memory_Avg,
            memoryMax: metrics.Memory_Max,
            memoryP95: metrics.Memory_P95,
            memorySamples: metrics.Memory_SampleCount
        },
        status: 'RIGHT_SIZED',
        action: 'NONE',
        recommendedSize: null,
        reason: null,
        estimatedMonthlySavings: 0
    };

    // Check for insufficient data
    const totalSamples = (metrics.CPU_SampleCount || 0) + (metrics.Memory_SampleCount || 0);
    if (totalSamples < THRESHOLDS.minimumSamples.acceptable) {
        result.status = 'INSUFFICIENT_DATA';
        result.action = 'REVIEW';
        result.reason = `Only ${totalSamples} samples collected - need at least ${THRESHOLDS.minimumSamples.acceptable} for reliable analysis`;
        return result;
    }

    // Check for underutilization
    const isUnderutilizedCPU =
        metrics.CPU_Max < THRESHOLDS.underutilized.cpu.max ||
        (metrics.CPU_Max < THRESHOLDS.underutilized.cpu.maxAlt &&
         metrics.CPU_Avg < THRESHOLDS.underutilized.cpu.avgAlt);

    const isUnderutilizedMemory =
        metrics.Memory_Max < THRESHOLDS.underutilized.memory.max &&
        metrics.Memory_Avg < THRESHOLDS.underutilized.memory.avg;

    if (isUnderutilizedCPU && isUnderutilizedMemory) {
        result.status = 'UNDERUTILIZED';
        result.action = 'DOWNSIZE';
        result.recommendedSize = SIZE_DOWNGRADES[vmInfo.vmSize] || null;
        result.reason = `CPU max ${metrics.CPU_Max}%, avg ${metrics.CPU_Avg}%; Memory max ${metrics.Memory_Max}%, avg ${metrics.Memory_Avg}%`;

        if (result.recommendedSize) {
            const currentCost = ESTIMATED_MONTHLY_COSTS[vmInfo.vmSize] || 0;
            const newCost = ESTIMATED_MONTHLY_COSTS[result.recommendedSize] || 0;
            result.estimatedMonthlySavings = Math.max(0, currentCost - newCost);
        }
        return result;
    }

    // Check for overutilization
    const isOverutilizedCPU =
        metrics.CPU_P95 > THRESHOLDS.overutilized.cpu.p95 ||
        metrics.CPU_Max > THRESHOLDS.overutilized.cpu.max;

    const isOverutilizedMemory =
        metrics.Memory_P95 > THRESHOLDS.overutilized.memory.p95 ||
        metrics.Memory_Max > THRESHOLDS.overutilized.memory.max;

    if (isOverutilizedCPU || isOverutilizedMemory) {
        result.status = 'OVERUTILIZED';
        result.action = 'UPSIZE';
        result.recommendedSize = SIZE_UPGRADES[vmInfo.vmSize] || null;

        const reasons = [];
        if (isOverutilizedCPU) {
            reasons.push(`CPU P95 ${metrics.CPU_P95}%, max ${metrics.CPU_Max}%`);
        }
        if (isOverutilizedMemory) {
            reasons.push(`Memory P95 ${metrics.Memory_P95}%, max ${metrics.Memory_Max}%`);
        }
        result.reason = reasons.join('; ');
        return result;
    }

    // VM is right-sized
    result.reason = `CPU avg ${metrics.CPU_Avg}%, max ${metrics.CPU_Max}%; Memory avg ${metrics.Memory_Avg}%, max ${metrics.Memory_Max}%`;
    return result;
}

/**
 * Execute async functions with concurrency limit.
 *
 * @param {Array} items - Items to process
 * @param {Function} asyncFn - Async function to apply to each item
 * @param {number} limit - Max concurrent executions
 * @returns {Promise<Array>} Results
 */
async function executeWithConcurrencyLimit(items, asyncFn, limit) {
    const results = [];
    const executing = new Set();

    for (const item of items) {
        const promise = asyncFn(item).then(result => {
            executing.delete(promise);
            return result;
        }).catch(error => {
            executing.delete(promise);
            return { error: error.message, item };
        });

        executing.add(promise);
        results.push(promise);

        if (executing.size >= limit) {
            await Promise.race(executing);
        }
    }

    return Promise.all(results);
}

/**
 * Create query batches from VM inventory.
 *
 * @param {Object[]} vms - VM inventory
 * @param {number} maxPerBatch - Max VMs per batch
 * @returns {Object[]} Batches
 */
function createQueryBatches(vms, maxPerBatch) {
    const batches = [];

    // Group by resource group for better cache locality
    const byResourceGroup = {};
    for (const vm of vms) {
        const rg = vm.resourceGroup || 'unknown';
        if (!byResourceGroup[rg]) {
            byResourceGroup[rg] = [];
        }
        byResourceGroup[rg].push(vm);
    }

    // Create batches
    for (const [resourceGroup, rgVms] of Object.entries(byResourceGroup)) {
        for (let i = 0; i < rgVms.length; i += maxPerBatch) {
            batches.push({
                resourceGroup,
                vms: rgVms.slice(i, i + maxPerBatch),
                batchIndex: batches.length
            });
        }
    }

    return batches;
}

/**
 * Analyze right-sizing for a subscription.
 *
 * @param {Object[]} vmInventory - VM inventory from Resource Graph
 * @param {Function} executeKql - Function to execute KQL queries
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Analysis results
 */
async function analyzeRightSizing(vmInventory, executeKql, options = {}) {
    const startTime = Date.now();
    const timeRangeDays = options.timeRangeDays || DEFAULT_TIME_RANGE_DAYS;

    if (!vmInventory || vmInventory.length === 0) {
        return {
            success: true,
            summary: {
                totalVMs: 0,
                analyzed: 0,
                underutilized: 0,
                overutilized: 0,
                rightSized: 0,
                insufficientData: 0
            },
            recommendations: [],
            details: {
                underutilized: [],
                overutilized: [],
                rightSized: [],
                insufficientData: []
            },
            executionTimeMs: Date.now() - startTime
        };
    }

    console.log(`[RightSizing] Starting analysis for ${vmInventory.length} VMs over ${timeRangeDays} days`);

    // Create batches
    const batches = createQueryBatches(vmInventory, MAX_VMS_PER_BATCH);
    console.log(`[RightSizing] Created ${batches.length} batches`);

    // Build VM lookup map
    const vmLookup = new Map();
    for (const vm of vmInventory) {
        vmLookup.set(vm.vmName.toLowerCase(), vm);
        vmLookup.set(vm.vmName, vm);
    }

    // Execute batches with concurrency limit
    const batchResults = await executeWithConcurrencyLimit(
        batches,
        async (batch) => {
            const vmNames = batch.vms.map(vm => vm.vmName);
            const query = generateBatchMetricsQuery(vmNames, timeRangeDays);

            try {
                console.log(`[RightSizing] Executing batch ${batch.batchIndex + 1}/${batches.length} (${vmNames.length} VMs)`);
                const result = await executeKql(query, { timeoutMs: QUERY_TIMEOUT_MS });
                return {
                    batchIndex: batch.batchIndex,
                    success: result.success,
                    results: result.results || [],
                    vmNames
                };
            } catch (error) {
                console.error(`[RightSizing] Batch ${batch.batchIndex + 1} failed:`, error.message);
                return {
                    batchIndex: batch.batchIndex,
                    success: false,
                    error: error.message,
                    vmNames
                };
            }
        },
        MAX_CONCURRENT_QUERIES
    );

    // Aggregate results
    const metricsMap = new Map();
    const failedVMs = [];

    for (const batch of batchResults) {
        if (batch.success && batch.results) {
            for (const row of batch.results) {
                metricsMap.set(row.Computer?.toLowerCase(), row);
            }
        } else if (batch.error) {
            failedVMs.push(...batch.vmNames);
        }
    }

    // Analyze each VM
    const underutilized = [];
    const overutilized = [];
    const rightSized = [];
    const insufficientData = [];
    let totalSavings = 0;

    for (const vm of vmInventory) {
        const metrics = metricsMap.get(vm.vmName.toLowerCase()) ||
                       metricsMap.get(vm.vmName);

        if (!metrics) {
            insufficientData.push({
                vmName: vm.vmName,
                resourceGroup: vm.resourceGroup,
                location: vm.location,
                currentSize: vm.vmSize,
                status: 'NO_DATA',
                action: 'REVIEW',
                reason: 'No performance metrics found in Log Analytics'
            });
            continue;
        }

        const analysis = analyzeVMMetrics(metrics, vm);

        switch (analysis.status) {
            case 'UNDERUTILIZED':
                underutilized.push(analysis);
                totalSavings += analysis.estimatedMonthlySavings;
                break;
            case 'OVERUTILIZED':
                overutilized.push(analysis);
                break;
            case 'INSUFFICIENT_DATA':
                insufficientData.push(analysis);
                break;
            default:
                rightSized.push(analysis);
        }
    }

    // Sort by impact
    underutilized.sort((a, b) => b.estimatedMonthlySavings - a.estimatedMonthlySavings);
    overutilized.sort((a, b) => (b.metrics.cpuP95 || 0) - (a.metrics.cpuP95 || 0));

    // Generate recommendations
    const recommendations = [
        ...underutilized.slice(0, 10).map(vm => ({
            vmName: vm.vmName,
            currentSize: vm.currentSize,
            recommendedSize: vm.recommendedSize,
            action: 'DOWNSIZE',
            priority: vm.estimatedMonthlySavings > 100 ? 'HIGH' : 'MEDIUM',
            reason: vm.reason,
            estimatedSavings: vm.estimatedMonthlySavings
        })),
        ...overutilized.slice(0, 5).map(vm => ({
            vmName: vm.vmName,
            currentSize: vm.currentSize,
            recommendedSize: vm.recommendedSize,
            action: 'UPSIZE',
            priority: (vm.metrics.cpuP95 > 95 || vm.metrics.memoryP95 > 95) ? 'HIGH' : 'MEDIUM',
            reason: vm.reason,
            estimatedSavings: 0
        }))
    ];

    const result = {
        success: true,
        analyzedAt: new Date().toISOString(),
        timeRangeDays,
        summary: {
            totalVMs: vmInventory.length,
            analyzed: underutilized.length + overutilized.length + rightSized.length,
            underutilized: underutilized.length,
            overutilized: overutilized.length,
            rightSized: rightSized.length,
            insufficientData: insufficientData.length
        },
        estimatedMonthlySavings: Math.round(totalSavings),
        recommendations,
        details: {
            underutilized,
            overutilized,
            rightSized,
            insufficientData
        },
        executionTimeMs: Date.now() - startTime
    };

    console.log(`[RightSizing] Analysis complete: ${result.summary.analyzed} analyzed, ${result.summary.underutilized} underutilized, ${result.summary.overutilized} overutilized`);

    return result;
}

module.exports = {
    analyzeRightSizing,
    generateBatchMetricsQuery,
    analyzeVMMetrics,
    createQueryBatches,
    THRESHOLDS,
    SIZE_DOWNGRADES,
    SIZE_UPGRADES,
    ESTIMATED_MONTHLY_COSTS
};
