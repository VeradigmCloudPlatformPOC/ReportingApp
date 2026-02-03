/**
 * @fileoverview Query VMs by Status Tool
 *
 * Retrieves VMs filtered by their performance status from the latest analysis.
 * Status values: UNDERUTILIZED, OVERUTILIZED, OPTIMAL, NEEDS_REVIEW
 *
 * @version v8-agent
 */

/**
 * Create the query VMs by status tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createQueryVMsByStatusTool(orchestrationClient) {
    /**
     * Query VMs by performance status.
     *
     * @param {Object} args - Tool arguments
     * @param {string} args.status - Status to filter by
     * @param {number} [args.limit=10] - Maximum VMs to return
     * @param {Object} context - Context with subscription info
     * @returns {Promise<Object>} VMs matching the status
     */
    return async function queryVMsByStatus({ status, limit = 10 }, context = {}) {
        try {
            const normalizedStatus = status.toUpperCase();
            console.log(`Querying VMs with status: ${normalizedStatus}, limit: ${limit}`);
            if (context.subscriptionId) {
                console.log(`  Filtering by subscription: ${context.subscriptionName || context.subscriptionId}`);
            }

            // Pass subscriptionId for server-side filtering if context is set
            let vms = await orchestrationClient.getVMsByStatus(normalizedStatus, context.subscriptionId);
            console.log(`  Found ${vms?.length || 0} VMs with status ${normalizedStatus}`);

            // Double-check filter client-side as fallback (in case server doesn't filter)
            if (vms && context.subscriptionId) {
                const beforeCount = vms.length;
                vms = vms.filter(vm => vm.subscriptionId === context.subscriptionId);
                if (vms.length !== beforeCount) {
                    console.log(`  Client-side filtered to ${vms.length} VMs`);
                }
            }

            if (!vms || vms.length === 0) {
                return {
                    success: true,
                    count: 0,
                    vms: [],
                    message: `No VMs found with status: ${normalizedStatus}. This is good news if you were looking for problematic VMs!`
                };
            }

            // Limit results
            const limitedVMs = vms.slice(0, limit);

            // Format VMs for readable output
            const formattedVMs = limitedVMs.map((vm, index) => ({
                rank: index + 1,
                name: vm.vmName,
                resourceGroup: vm.resourceGroup,
                currentSize: vm.vmSize,
                location: vm.location,
                metrics: {
                    cpuAvg: `${vm.CPU_Avg?.toFixed(1) || 'N/A'}%`,
                    cpuMax: `${vm.CPU_Max?.toFixed(1) || 'N/A'}%`,
                    memoryAvg: `${vm.Memory_Avg?.toFixed(1) || 'N/A'}%`,
                    memoryMax: `${vm.Memory_Max?.toFixed(1) || 'N/A'}%`
                },
                recommendation: vm.analysis?.recommendation || 'No recommendation available',
                action: vm.analysis?.action || 'REVIEW'
            }));

            return {
                success: true,
                status: normalizedStatus,
                count: vms.length,
                showing: limitedVMs.length,
                vms: formattedVMs,
                summary: getSummaryForStatus(normalizedStatus, vms.length)
            };
        } catch (error) {
            console.error('Failed to query VMs by status:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'No recent analysis results found. Try running a performance report first.'
            };
        }
    };
}

/**
 * Get a helpful summary message based on status.
 */
function getSummaryForStatus(status, count) {
    switch (status) {
        case 'UNDERUTILIZED':
            return `Found ${count} underutilized VMs. These are candidates for downsizing to reduce costs.`;
        case 'OVERUTILIZED':
            return `Found ${count} overutilized VMs. These may need to be upsized to improve performance.`;
        case 'OPTIMAL':
            return `Found ${count} optimally-sized VMs. These are right-sized for their workload.`;
        case 'NEEDS_REVIEW':
            return `Found ${count} VMs that need manual review due to unusual patterns.`;
        default:
            return `Found ${count} VMs with status: ${status}`;
    }
}

module.exports = createQueryVMsByStatusTool;
