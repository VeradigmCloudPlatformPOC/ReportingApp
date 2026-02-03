/**
 * @fileoverview Query Inventory Tool
 *
 * Queries VM inventory from Azure Resource Graph with optional filters.
 * Returns current VM configuration. Can include enhanced details like
 * network info, disk sizes, and creation dates.
 *
 * @version v9-dynamic-queries
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
     * @param {string} [args.subscription_id] - Filter by subscription ID
     * @param {boolean} [args.include_details] - Include full details (network, disks, creation date)
     * @param {Object} context - Context with subscription info from user's selection
     * @returns {Promise<Object>} Inventory results
     */
    return async function queryInventory({ tenant_name, location, tag_key, tag_value, size_pattern, subscription_id, include_details = false }, context = {}) {
        try {
            // Build filters object
            const filters = {};

            // Use subscription from context if not explicitly provided
            const effectiveSubscriptionId = subscription_id || context.subscriptionId;
            if (effectiveSubscriptionId) {
                filters.subscriptionId = effectiveSubscriptionId;
                console.log(`Using subscription context: ${context.subscriptionName || effectiveSubscriptionId}`);
            }

            if (tenant_name) filters.tenantName = tenant_name;
            if (location) filters.location = location;
            if (size_pattern) filters.sizePattern = size_pattern;

            // Include network details when full details are requested
            if (include_details) {
                filters.includeNetwork = true;
                console.log('Including full VM details (network, disks, etc.)');
            }

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
            const maxResults = include_details ? 10 : 20; // Fewer results when showing full details
            const limitedVMs = inventory.slice(0, maxResults).map(vm => {
                // Basic details always included
                const vmDetails = {
                    name: vm.vmName || vm.name,
                    resourceGroup: vm.resourceGroup,
                    size: vm.vmSize,
                    location: vm.location,
                    tenant: vm.tenantName || 'Default',
                    powerState: vm.powerState || 'unknown'
                };

                // Enhanced details when requested
                if (include_details) {
                    // OS Info
                    vmDetails.osInfo = {
                        type: vm.osType,
                        sku: vm.osSku,
                        publisher: vm.osPublisher,
                        full: vm.osFullName || `${vm.osType} ${vm.osSku}`
                    };

                    // Disk Info
                    vmDetails.disks = {
                        osDisk: vm.osDisk || { sizeGB: 'Unknown' },
                        dataDisks: vm.dataDisks || [],
                        dataDiskCount: vm.dataDiskCount || 0,
                        totalDiskGB: vm.totalDiskGB || 'Unknown'
                    };

                    // Network Info
                    vmDetails.network = {
                        privateIP: vm.privateIP || 'Not available',
                        privateIPs: vm.privateIPs || [],
                        vnet: vm.vnet || 'Not available',
                        subnet: vm.subnet || 'Not available'
                    };

                    // Timestamps
                    vmDetails.created = vm.timeCreated || 'Unknown';
                } else {
                    // Minimal tags for basic view
                    vmDetails.tags = vm.tags ? Object.keys(vm.tags).slice(0, 3).map(k => `${k}=${vm.tags[k]}`).join(', ') : 'none';
                }

                return vmDetails;
            });

            return {
                success: true,
                totalCount: inventory.length,
                showing: limitedVMs.length,
                detailLevel: include_details ? 'full' : 'basic',
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
                hint: inventory.length > maxResults ? `Showing ${maxResults} of ${inventory.length} VMs. Add more filters to narrow results.` : null
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
