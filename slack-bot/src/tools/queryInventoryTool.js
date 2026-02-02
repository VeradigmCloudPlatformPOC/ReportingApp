/**
 * @fileoverview Query Inventory Tool
 *
 * Queries VM inventory from Azure Resource Graph with optional filters.
 * Returns current VM configuration without performance metrics.
 *
 * @version v8-agent
 */

/**
 * Create the query inventory tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createQueryInventoryTool(orchestrationClient) {
    /**
     * Query VM inventory with filters.
     *
     * @param {Object} args - Tool arguments
     * @param {string} [args.tenant_name] - Filter by tenant
     * @param {string} [args.location] - Filter by Azure region
     * @param {string} [args.tag_key] - Filter by tag key
     * @param {string} [args.tag_value] - Filter by tag value
     * @param {string} [args.size_pattern] - Filter by VM size pattern
     * @returns {Promise<Object>} Inventory results
     */
    return async function queryInventory({ tenant_name, location, tag_key, tag_value, size_pattern }) {
        try {
            // Build filters object
            const filters = {};

            if (tenant_name) filters.tenantName = tenant_name;
            if (location) filters.location = location;
            if (size_pattern) filters.sizePattern = size_pattern;

            if (tag_key && tag_value) {
                filters.tagKey = tag_key;
                filters.tagValue = tag_value;
            }

            console.log('Querying inventory with filters:', filters);

            const inventory = await orchestrationClient.getInventory(filters);

            if (!inventory || inventory.length === 0) {
                return {
                    success: true,
                    count: 0,
                    vms: [],
                    message: 'No VMs found matching the specified filters.',
                    filtersApplied: filters
                };
            }

            // Group by tenant for summary
            const tenantGroups = {};
            inventory.forEach(vm => {
                const tenant = vm.tenantName || 'Default';
                if (!tenantGroups[tenant]) {
                    tenantGroups[tenant] = [];
                }
                tenantGroups[tenant].push(vm);
            });

            // Group by location for summary
            const locationCounts = {};
            inventory.forEach(vm => {
                const loc = vm.location || 'unknown';
                locationCounts[loc] = (locationCounts[loc] || 0) + 1;
            });

            // Limit detailed results for readability
            const limitedVMs = inventory.slice(0, 20).map(vm => ({
                name: vm.vmName || vm.name,
                resourceGroup: vm.resourceGroup,
                size: vm.vmSize,
                location: vm.location,
                tenant: vm.tenantName || 'Default',
                powerState: vm.powerState || 'unknown',
                tags: vm.tags ? Object.keys(vm.tags).slice(0, 3).map(k => `${k}=${vm.tags[k]}`).join(', ') : 'none'
            }));

            return {
                success: true,
                totalCount: inventory.length,
                showing: limitedVMs.length,
                filtersApplied: Object.keys(filters).length > 0 ? filters : 'none',
                summary: {
                    byTenant: Object.entries(tenantGroups).map(([name, vms]) => ({
                        tenant: name,
                        count: vms.length
                    })),
                    byLocation: Object.entries(locationCounts).map(([loc, count]) => ({
                        location: loc,
                        count
                    }))
                },
                vms: limitedVMs,
                hint: inventory.length > 20 ? `Showing 20 of ${inventory.length} VMs. Add more filters to narrow results.` : null
            };
        } catch (error) {
            console.error('Failed to query inventory:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'Inventory query failed. Tenant configurations may not be set up.'
            };
        }
    };
}

module.exports = createQueryInventoryTool;
