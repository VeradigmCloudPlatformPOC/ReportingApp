/**
 * @fileoverview Right-Sizing Analysis Service
 *
 * Analyzes VM metrics and classifies VMs based on Azure Advisor thresholds.
 */

const { THRESHOLDS, SIZE_DOWNGRADES, SIZE_UPGRADES, ESTIMATED_MONTHLY_COSTS } = require('../data/vmSizeMappings');

/**
 * Find metrics for a VM by name with flexible matching.
 * Handles FQDN vs short name matching.
 *
 * @param {string} vmName - VM name from inventory (usually short name)
 * @param {Map} metricsMap - Metrics map with various name formats
 * @returns {Object|null} Matching metrics or null
 */
function findMetricsForVM(vmName, metricsMap) {
    if (!vmName) return null;

    const vmNameLower = vmName.toLowerCase();

    // 1. Try exact match (case-insensitive)
    if (metricsMap.has(vmNameLower)) {
        return metricsMap.get(vmNameLower);
    }

    // 2. Search through all metrics keys for partial matches
    for (const [key, metrics] of metricsMap) {
        const keyLower = key.toLowerCase();

        // Check if the metrics key starts with the VM name (FQDN format)
        // e.g., "vmname.domain.local" starts with "vmname"
        if (keyLower.startsWith(vmNameLower + '.')) {
            return metrics;
        }

        // Check if the VM name starts with the metrics key's short name
        // e.g., inventory "VMName" matches metrics "vmname.domain.local" (extract "vmname")
        const shortKey = keyLower.split('.')[0];
        if (vmNameLower === shortKey) {
            return metrics;
        }

        // Check if the short name from metrics matches the VM name (case-insensitive)
        if (shortKey === vmNameLower) {
            return metrics;
        }
    }

    return null;
}

/**
 * Analyze right-sizing for VMs.
 *
 * @param {Object[]} inventory - VM inventory from Resource Graph
 * @param {Map} metricsMap - Performance metrics by VM name
 * @param {Object} options - Analysis options
 * @returns {Object} Analysis results with recommendations
 */
function analyzeRightSizing(inventory, metricsMap, options = {}) {
    const { timeRangeDays = 30 } = options;

    const underutilized = [];
    const overutilized = [];
    const rightSized = [];
    const insufficientData = [];
    let totalSavings = 0;
    let totalAdditionalCost = 0;

    for (const vm of inventory) {
        const vmName = vm.vmName || vm.name;
        const metrics = findMetricsForVM(vmName, metricsMap);

        if (!metrics) {
            insufficientData.push({
                vmName,
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
                totalAdditionalCost += analysis.estimatedAdditionalCost || 0;
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
    overutilized.sort((a, b) => (b.metrics?.cpuP95 || 0) - (a.metrics?.cpuP95 || 0));

    // Generate recommendations
    const recommendations = [
        ...underutilized.slice(0, 15).map(vm => ({
            vmName: vm.vmName,
            resourceGroup: vm.resourceGroup,
            currentSize: vm.currentSize,
            recommendedSize: vm.recommendedSize,
            action: 'DOWNSIZE',
            priority: vm.estimatedMonthlySavings > 100 ? 'HIGH' : 'MEDIUM',
            reason: vm.reason,
            estimatedSavings: vm.estimatedMonthlySavings,
            metrics: vm.metrics
        })),
        ...overutilized.slice(0, 10).map(vm => ({
            vmName: vm.vmName,
            resourceGroup: vm.resourceGroup,
            currentSize: vm.currentSize,
            recommendedSize: vm.recommendedSize,
            action: 'UPSIZE',
            priority: (vm.metrics?.cpuP95 > 95 || vm.metrics?.memoryP95 > 95) ? 'HIGH' : 'MEDIUM',
            reason: vm.reason,
            estimatedSavings: 0,
            metrics: vm.metrics
        }))
    ];

    // Calculate net impact: savings from downsizing minus cost of upsizing
    const netMonthlySavings = totalSavings - totalAdditionalCost;

    return {
        analyzedAt: new Date().toISOString(),
        timeRangeDays,
        summary: {
            totalVMs: inventory.length,
            analyzed: underutilized.length + overutilized.length + rightSized.length,
            underutilized: underutilized.length,
            overutilized: overutilized.length,
            rightSized: rightSized.length,
            insufficientData: insufficientData.length,
            estimatedMonthlySavings: Math.round(totalSavings),
            estimatedAdditionalCost: Math.round(totalAdditionalCost),
            netMonthlyImpact: Math.round(netMonthlySavings)
        },
        recommendations,
        details: {
            underutilized,
            overutilized,
            rightSized,
            insufficientData
        }
    };
}

/**
 * Analyze metrics for a single VM.
 */
function analyzeVMMetrics(metrics, vmInfo) {
    const vmName = vmInfo.vmName || vmInfo.name;
    const vmSize = vmInfo.vmSize || vmInfo.size;

    const result = {
        vmName,
        resourceGroup: vmInfo.resourceGroup,
        location: vmInfo.location,
        currentSize: vmSize,
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
        result.reason = `Only ${totalSamples} samples - need ${THRESHOLDS.minimumSamples.acceptable}+ for reliable analysis`;
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
        result.recommendedSize = SIZE_DOWNGRADES[vmSize] || null;
        result.reason = `CPU max ${metrics.CPU_Max}%, avg ${metrics.CPU_Avg}%; Memory max ${metrics.Memory_Max}%, avg ${metrics.Memory_Avg}%`;

        if (result.recommendedSize) {
            const currentCost = ESTIMATED_MONTHLY_COSTS[vmSize] || 0;
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
        result.recommendedSize = SIZE_UPGRADES[vmSize] || null;

        const reasons = [];
        if (isOverutilizedCPU) {
            reasons.push(`CPU P95 ${metrics.CPU_P95}%, max ${metrics.CPU_Max}%`);
        }
        if (isOverutilizedMemory) {
            reasons.push(`Memory P95 ${metrics.Memory_P95}%, max ${metrics.Memory_Max}%`);
        }
        result.reason = reasons.join('; ');

        // Calculate additional cost for upsizing
        if (result.recommendedSize) {
            const currentCost = ESTIMATED_MONTHLY_COSTS[vmSize] || 0;
            const newCost = ESTIMATED_MONTHLY_COSTS[result.recommendedSize] || 0;
            result.estimatedAdditionalCost = Math.max(0, newCost - currentCost);
        }
        return result;
    }

    // VM is right-sized
    result.reason = `CPU avg ${metrics.CPU_Avg}%, max ${metrics.CPU_Max}%; Memory avg ${metrics.Memory_Avg}%, max ${metrics.Memory_Max}%`;
    return result;
}

module.exports = {
    analyzeRightSizing,
    analyzeVMMetrics
};
