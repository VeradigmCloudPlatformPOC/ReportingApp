/**
 * @fileoverview Investigate VM Tool
 *
 * Retrieves detailed analysis for a specific VM, including
 * comprehensive metrics, AI analysis, and recommendations.
 *
 * @version v8-agent
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
     *
     * @param {Object} args - Tool arguments
     * @param {string} args.vm_name - VM name to investigate
     * @returns {Promise<Object>} Detailed VM analysis
     */
    return async function investigateVM({ vm_name }) {
        try {
            console.log(`Investigating VM: ${vm_name}`);

            const vm = await orchestrationClient.getVMDetails(vm_name);

            if (!vm) {
                return {
                    success: false,
                    error: `VM "${vm_name}" not found in the latest analysis.`,
                    suggestion: 'Check the VM name spelling or run a new performance report to include this VM.'
                };
            }

            // Build comprehensive investigation report
            const investigation = {
                success: true,
                vmName: vm.vmName,
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

module.exports = createInvestigateVMTool;
