/**
 * @fileoverview Investigate VM Tool
 *
 * Retrieves detailed analysis for a specific VM, including
 * comprehensive metrics, AI analysis, and recommendations.
 * Supports both cached analysis results and live KQL queries.
 *
 * @version v9-dynamic-queries
 */

/**
 * Create the investigate VM tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createInvestigateVMTool(orchestrationClient) {
    /**
     * Get detailed investigation for a specific VM.
     * First tries cached analysis, then falls back to live KQL query.
     *
     * @param {Object} args - Tool arguments
     * @param {string} args.vm_name - VM name to investigate
     * @param {Object} context - Context with subscription/tenant info
     * @returns {Promise<Object>} Detailed VM analysis
     */
    return async function investigateVM({ vm_name }, context = {}) {
        try {
            console.log(`Investigating VM: ${vm_name}`);
            if (context.subscriptionId) {
                console.log(`  Subscription context: ${context.subscriptionName || context.subscriptionId}`);
            }

            // First try to get VM from cached analysis
            let vm = await orchestrationClient.getVMDetails(vm_name);
            let dataSource = 'cached_analysis';

            // If not found in cache, try live KQL query
            if (!vm) {
                console.log(`  VM not in cache, querying live metrics...`);
                vm = await queryLiveVMMetrics(orchestrationClient, vm_name, context);
                dataSource = 'live_query';
            }

            if (!vm) {
                return {
                    success: false,
                    error: `VM "${vm_name}" not found.`,
                    suggestion: 'Check the VM name spelling. The VM may not exist or may not be sending metrics to Log Analytics.'
                };
            }

            // Build comprehensive investigation report
            const investigation = {
                success: true,
                vmName: vm.vmName,
                dataSource: dataSource === 'live_query' ? 'Live metrics (30-day query)' : 'Cached analysis',
                investigation: {
                    // Basic Info
                    basicInfo: {
                        resourceGroup: vm.resourceGroup,
                        location: vm.location,
                        subscriptionId: vm.subscriptionId,
                        tenantName: vm.tenantName || 'Default'
                    },

                    // Current Configuration
                    currentConfiguration: {
                        vmSize: vm.vmSize,
                        vCPUs: vm.vCPUs || 'Unknown',
                        memoryGB: vm.memoryGB || 'Unknown'
                    },

                    // Performance Metrics (30-day summary)
                    performanceMetrics: {
                        cpu: {
                            average: `${vm.CPU_Avg?.toFixed(2) || 'N/A'}%`,
                            maximum: `${vm.CPU_Max?.toFixed(2) || 'N/A'}%`,
                            assessment: getCPUAssessment(vm.CPU_Avg, vm.CPU_Max)
                        },
                        memory: {
                            average: `${vm.Memory_Avg?.toFixed(2) || 'N/A'}%`,
                            maximum: `${vm.Memory_Max?.toFixed(2) || 'N/A'}%`,
                            assessment: getMemoryAssessment(vm.Memory_Avg, vm.Memory_Max)
                        },
                        diskIOPS: vm.DiskIOPS_Avg ? {
                            average: Math.round(vm.DiskIOPS_Avg),
                            maximum: Math.round(vm.DiskIOPS_Max)
                        } : null
                    },

                    // AI Analysis Result
                    analysis: {
                        status: vm.analysis?.status || 'UNKNOWN',
                        action: vm.analysis?.action || 'REVIEW',
                        confidence: vm.analysis?.confidence || 'Medium',
                        recommendation: vm.analysis?.recommendation || 'No specific recommendation available',
                        reasoning: vm.analysis?.reason || vm.analysis?.reasoning || 'Analysis reasoning not available'
                    },

                    // Thresholds Reference (Azure Advisor)
                    thresholdsUsed: {
                        underutilized: {
                            cpu: 'Max < 5% OR (Max < 20% AND Avg < 10%)',
                            memory: 'Max < 20% AND Avg < 10%'
                        },
                        overutilized: {
                            cpu: 'Max > 90% sustained',
                            memory: 'Max > 90% sustained'
                        }
                    }
                }
            };

            return investigation;
        } catch (error) {
            console.error('Failed to investigate VM:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'Unable to retrieve VM details. The VM may not exist in the latest analysis.'
            };
        }
    };
}

/**
 * Get CPU assessment based on metrics.
 */
function getCPUAssessment(avg, max) {
    if (max === undefined || max === null) return 'Insufficient data';

    if (max < 5 || (max < 20 && avg < 10)) {
        return 'UNDERUTILIZED - CPU is significantly oversized for the workload';
    } else if (max > 90) {
        return 'OVERUTILIZED - CPU is consistently at capacity, may need more resources';
    } else if (max > 70 && avg > 40) {
        return 'WELL-UTILIZED - Good balance between capacity and usage';
    } else {
        return 'MODERATE - Some headroom available, typical for variable workloads';
    }
}

/**
 * Get memory assessment based on metrics.
 */
function getMemoryAssessment(avg, max) {
    if (max === undefined || max === null) return 'Insufficient data';

    if (max < 20 && avg < 10) {
        return 'UNDERUTILIZED - Memory allocation exceeds requirements';
    } else if (max > 90) {
        return 'OVERUTILIZED - Memory pressure detected, may need more RAM';
    } else if (max > 60) {
        return 'WELL-UTILIZED - Good memory utilization';
    } else {
        return 'MODERATE - Memory usage is within normal range';
    }
}

/**
 * Query live VM metrics from Log Analytics using dynamic KQL.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @param {string} vmName - VM name to query
 * @param {Object} context - Context with subscription/tenant info
 * @returns {Promise<Object|null>} VM metrics or null if not found
 */
async function queryLiveVMMetrics(orchestrationClient, vmName, context = {}) {
    try {
        // KQL query to get CPU and Memory metrics for a specific VM over 30 days
        // Uses flexible matching to handle FQDN and case differences:
        // - Resource Graph may return "Ue2DevPPDB03"
        // - Log Analytics may have "Ue2DevPPDB03.domain.com" or "UE2DEVPPDB03"
        const kqlQuery = `
            let vmNameLower = tolower("${vmName.replace(/"/g, '\\"')}");
            let timeRange = 30d;

            // CPU Metrics - use flexible name matching (case-insensitive, startswith for FQDN)
            let cpuMetrics = Perf
                | where TimeGenerated >= ago(timeRange)
                | where tolower(Computer) startswith vmNameLower
                     or tolower(Computer) == vmNameLower
                | where ObjectName == "Processor" and CounterName == "% Processor Time"
                | summarize
                    CPU_Avg = avg(CounterValue),
                    CPU_Max = max(CounterValue),
                    CPU_SampleCount = count(),
                    ComputerMatched = take_any(Computer)
                | top 1 by CPU_SampleCount desc
                | extend MetricType = "CPU";

            // Memory Metrics - use same flexible matching
            let memMetrics = Perf
                | where TimeGenerated >= ago(timeRange)
                | where tolower(Computer) startswith vmNameLower
                     or tolower(Computer) == vmNameLower
                | where ObjectName == "Memory" and CounterName == "% Used Memory"
                | summarize
                    Memory_Avg = avg(CounterValue),
                    Memory_Max = max(CounterValue),
                    Memory_SampleCount = count(),
                    ComputerMatched = take_any(Computer)
                | top 1 by Memory_SampleCount desc
                | extend MetricType = "Memory";

            // Combine metrics
            cpuMetrics | union memMetrics
        `;

        console.log(`  Executing live KQL query for VM: ${vmName}`);

        const result = await orchestrationClient.executeDynamicKql(kqlQuery, {
            subscriptionId: context.subscriptionId,
            tenantId: context.tenantId,
            maxResults: 10,
            timeoutMs: 60000,
            userId: context.userId,
            channel: context.channel
        });

        if (!result.success || !result.results || result.results.length === 0) {
            console.log(`  No metrics found for VM: ${vmName}`);
            return null;
        }

        // Parse the results to build VM object
        let cpuAvg = null, cpuMax = null, memAvg = null, memMax = null;
        let matchedComputerName = vmName; // Track actual matched name from Log Analytics

        for (const row of result.results) {
            if (row.MetricType === 'CPU') {
                cpuAvg = row.CPU_Avg;
                cpuMax = row.CPU_Max;
                if (row.ComputerMatched) matchedComputerName = row.ComputerMatched;
            } else if (row.MetricType === 'Memory') {
                memAvg = row.Memory_Avg;
                memMax = row.Memory_Max;
                if (row.ComputerMatched && !matchedComputerName) matchedComputerName = row.ComputerMatched;
            }
        }

        // Log if we found a different Computer name (helpful for debugging)
        if (matchedComputerName !== vmName) {
            console.log(`  Name match: "${vmName}" -> Log Analytics Computer: "${matchedComputerName}"`);
        }

        // If no metrics found, return null
        if (cpuAvg === null && memAvg === null) {
            return null;
        }

        // Build a VM-like object from live metrics
        const vm = {
            vmName: vmName,
            resourceGroup: 'Unknown (live query)',
            location: 'Unknown (live query)',
            subscriptionId: context.subscriptionId || 'Unknown',
            tenantName: context.tenantName || 'Default',
            vmSize: 'Query Resource Graph for size info',
            CPU_Avg: cpuAvg,
            CPU_Max: cpuMax,
            Memory_Avg: memAvg,
            Memory_Max: memMax,
            analysis: {
                status: determineStatus(cpuAvg, cpuMax, memAvg, memMax),
                action: 'REVIEW',
                confidence: 'Medium',
                recommendation: generateRecommendation(cpuAvg, cpuMax, memAvg, memMax),
                reasoning: 'Based on 30-day live metrics query'
            }
        };

        console.log(`  Live metrics retrieved for ${vmName}: CPU Avg=${cpuAvg?.toFixed(1)}%, Max=${cpuMax?.toFixed(1)}%`);
        return vm;

    } catch (error) {
        console.error(`  Failed to query live metrics: ${error.message}`);
        return null;
    }
}

/**
 * Determine VM status based on metrics (using Azure Advisor thresholds).
 */
function determineStatus(cpuAvg, cpuMax, memAvg, memMax) {
    // Check for underutilization
    const cpuUnderutilized = cpuMax < 5 || (cpuMax < 20 && cpuAvg < 10);
    const memUnderutilized = memMax < 20 && memAvg < 10;

    if (cpuUnderutilized && (memUnderutilized || memMax === null)) {
        return 'UNDERUTILIZED';
    }

    // Check for overutilization
    const cpuOverutilized = cpuMax > 90;
    const memOverutilized = memMax > 90;

    if (cpuOverutilized || memOverutilized) {
        return 'OVERUTILIZED';
    }

    // Check for optimal
    if (cpuMax > 40 && cpuMax < 80 && memMax > 30 && memMax < 80) {
        return 'OPTIMAL';
    }

    return 'NEEDS_REVIEW';
}

/**
 * Generate recommendation based on metrics.
 */
function generateRecommendation(cpuAvg, cpuMax, memAvg, memMax) {
    const status = determineStatus(cpuAvg, cpuMax, memAvg, memMax);

    switch (status) {
        case 'UNDERUTILIZED':
            return 'Consider downsizing this VM to a smaller SKU to reduce costs.';
        case 'OVERUTILIZED':
            return 'Consider upsizing this VM to a larger SKU for better performance.';
        case 'OPTIMAL':
            return 'VM is well-sized for its current workload.';
        default:
            return 'Review VM metrics and workload patterns before making sizing decisions.';
    }
}

module.exports = createInvestigateVMTool;
