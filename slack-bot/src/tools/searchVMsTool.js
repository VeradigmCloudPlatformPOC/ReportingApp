/**
 * @fileoverview Search VMs Tool
 *
 * Searches for VMs by name pattern from the latest analysis.
 * Supports partial, case-insensitive matching.
 *
 * @version v8-agent
 */

/**
 * Create the search VMs tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createSearchVMsTool(orchestrationClient) {
    /**
     * Search for VMs by name pattern.
     *
     * @param {Object} args - Tool arguments
     * @param {string} args.pattern - Search pattern
     * @returns {Promise<Object>} Matching VMs
     */
    return async function searchVMs({ pattern }) {
        try {
            console.log(`Searching VMs with pattern: ${pattern}`);

            const vms = await orchestrationClient.searchVMs(pattern);

            if (!vms || vms.length === 0) {
                return {
                    success: true,
                    count: 0,
                    vms: [],
                    message: `No VMs found matching "${pattern}". Try a different search term or check the spelling.`
                };
            }

            // Limit to 15 results for readability
            const limitedVMs = vms.slice(0, 15);

            // Format VMs for readable output
            const formattedVMs = limitedVMs.map(vm => ({
                name: vm.vmName,
                resourceGroup: vm.resourceGroup,
                size: vm.vmSize,
                location: vm.location,
                status: vm.analysis?.status || 'UNKNOWN',
                action: vm.analysis?.action || 'REVIEW',
                metrics: {
                    cpuAvg: `${vm.CPU_Avg?.toFixed(1) || 'N/A'}%`,
                    memoryAvg: `${vm.Memory_Avg?.toFixed(1) || 'N/A'}%`
                }
            }));

            // Group by status for summary
            const statusCounts = {};
            vms.forEach(vm => {
                const status = vm.analysis?.status || 'UNKNOWN';
                statusCounts[status] = (statusCounts[status] || 0) + 1;
            });

            return {
                success: true,
                pattern,
                totalMatches: vms.length,
                showing: limitedVMs.length,
                vms: formattedVMs,
                statusBreakdown: statusCounts,
                hint: vms.length > 15 ? `Showing 15 of ${vms.length} matches. Use more specific pattern to narrow results.` : null
            };
        } catch (error) {
            console.error('Failed to search VMs:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'No recent analysis results found. Try running a performance report first.'
            };
        }
    };
}

module.exports = createSearchVMsTool;
