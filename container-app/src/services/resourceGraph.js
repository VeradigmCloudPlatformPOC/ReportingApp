/**
 * @fileoverview Azure Resource Graph Query Service
 *
 * This module handles querying Azure Resource Graph for VM inventory.
 * Resource Graph enables cross-subscription queries with powerful filtering.
 *
 * Features:
 * - Cross-subscription VM inventory queries
 * - Filter by tags, location, resource group, VM size
 * - Aggregate queries (count by RG, location, size)
 * - Multi-tenant support via credential injection
 *
 * Resource Graph Query Language:
 * - Uses Kusto Query Language (KQL) syntax
 * - Queries against ARM resource metadata (not performance data)
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { ClientSecretCredential } = require('@azure/identity');

/**
 * Get credential for a tenant using injected credentials.
 *
 * @param {Object} tenantConfig - Tenant configuration with credentials
 * @returns {ClientSecretCredential} Azure credential object
 */
function getCredentialForTenant(tenantConfig) {
    if (!tenantConfig.credentials?.clientId || !tenantConfig.credentials?.clientSecret) {
        throw new Error(`Missing credentials for tenant ${tenantConfig.tenantName}. Ensure clientId and clientSecret are provided.`);
    }

    return new ClientSecretCredential(
        tenantConfig.tenantId,
        tenantConfig.credentials.clientId,
        tenantConfig.credentials.clientSecret
    );
}

/**
 * Query VMs using Azure Resource Graph.
 *
 * Returns VM inventory with properties from ARM (size, OS, location, tags).
 *
 * @param {Object} tenantConfig - Tenant configuration with subscriptionIds
 * @param {Object} tenantConfig.tenantId - Azure AD tenant ID for OAuth
 * @param {Object} tenantConfig.credentials - Optional credentials object {clientId, clientSecret}
 * @param {Object} filters - Optional filters to apply
 * @param {string} filters.subscriptionId - Filter by specific subscription ID
 * @param {string} filters.resourceGroup - Filter by resource group name
 * @param {Object} filters.tag - Filter by tag {key, value}
 * @param {string} filters.location - Filter by Azure region
 * @param {string} filters.sizePattern - Filter by VM size pattern (e.g., "Standard_D*")
 * @param {string} filters.powerState - Filter by power state (running, deallocated)
 * @param {number} filters.limit - Maximum results to return
 * @returns {Promise<Array>} Array of VM inventory records
 */
async function queryVMInventory(tenantConfig, filters = {}) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Build filter clauses
    const filterClauses = [];

    // Filter by subscription ID if provided
    if (filters.subscriptionId) {
        filterClauses.push(`| where subscriptionId == '${escapeKql(filters.subscriptionId)}'`);
    }

    if (filters.resourceGroup) {
        filterClauses.push(`| where resourceGroup =~ '${escapeKql(filters.resourceGroup)}'`);
    }

    if (filters.tag) {
        filterClauses.push(`| where tags['${escapeKql(filters.tag.key)}'] == '${escapeKql(filters.tag.value)}'`);
    }

    if (filters.location) {
        filterClauses.push(`| where location == '${escapeKql(filters.location)}'`);
    }

    if (filters.sizePattern) {
        // Support wildcard patterns like "Standard_D*"
        const pattern = filters.sizePattern.replace(/\*/g, '');
        filterClauses.push(`| where tostring(properties.hardwareProfile.vmSize) startswith '${escapeKql(pattern)}'`);
    }

    if (filters.powerState) {
        filterClauses.push(`| where tostring(properties.extended.instanceView.powerState.code) contains '${escapeKql(filters.powerState)}'`);
    }

    // Build the query with extended properties
    // Note: Network details require a separate query as they're in different resource types
    const query = `
        Resources
        | where type == 'microsoft.compute/virtualmachines'
        ${filterClauses.join('\n        ')}
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend osType = tostring(properties.storageProfile.osDisk.osType)
        | extend osSku = tostring(properties.storageProfile.imageReference.sku)
        | extend osPublisher = tostring(properties.storageProfile.imageReference.publisher)
        | extend osVersion = tostring(properties.storageProfile.imageReference.version)
        | extend powerState = tostring(properties.extended.instanceView.powerState.code)
        | extend provisioningState = tostring(properties.provisioningState)
        | extend timeCreated = tostring(properties.timeCreated)
        | extend osDiskSizeGB = toint(properties.storageProfile.osDisk.diskSizeGB)
        | extend osDiskName = tostring(properties.storageProfile.osDisk.name)
        | extend dataDisks = properties.storageProfile.dataDisks
        | extend dataDiskCount = array_length(properties.storageProfile.dataDisks)
        | extend networkInterfaces = properties.networkProfile.networkInterfaces
        | project
            id,
            name,
            resourceGroup,
            subscriptionId,
            location,
            vmSize,
            osType,
            osSku,
            osPublisher,
            osVersion,
            powerState,
            provisioningState,
            timeCreated,
            osDiskSizeGB,
            osDiskName,
            dataDisks,
            dataDiskCount,
            networkInterfaces,
            tags
        | order by name asc
        ${filters.limit ? `| take ${filters.limit}` : ''}
    `;

    console.log(`  Querying Resource Graph for ${tenantConfig.tenantName}...`);
    if (filters.subscriptionId) {
        console.log(`  Filtering by subscriptionId: ${filters.subscriptionId}`);
    }

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    // Transform results to consistent format with enhanced details
    const vms = (result.data || []).map(vm => {
        // Calculate total data disk size
        const dataDisks = vm.dataDisks || [];
        const dataDiskTotalGB = dataDisks.reduce((sum, disk) => sum + (disk.diskSizeGB || 0), 0);

        // Extract network interface IDs for later lookup
        const nicIds = (vm.networkInterfaces || []).map(nic => nic.id);

        return {
            tenantId: tenantConfig.tenantId,
            tenantName: tenantConfig.tenantName,
            subscriptionId: vm.subscriptionId,
            resourceGroup: vm.resourceGroup,
            vmName: vm.name,
            vmId: vm.id,
            vmSize: vm.vmSize,
            location: vm.location,
            // OS Info
            osType: vm.osType,
            osSku: vm.osSku,
            osPublisher: vm.osPublisher,
            osVersion: vm.osVersion,
            osFullName: vm.osPublisher ? `${vm.osPublisher} ${vm.osSku}` : vm.osSku,
            // Power State
            powerState: vm.powerState?.replace('PowerState/', '') || 'unknown',
            provisioningState: vm.provisioningState,
            // Timestamps
            timeCreated: vm.timeCreated,
            // Disk Info
            osDisk: {
                name: vm.osDiskName,
                sizeGB: vm.osDiskSizeGB
            },
            dataDisks: dataDisks.map(disk => ({
                name: disk.name,
                sizeGB: disk.diskSizeGB,
                lun: disk.lun
            })),
            dataDiskCount: vm.dataDiskCount || 0,
            dataDiskTotalGB: dataDiskTotalGB,
            totalDiskGB: (vm.osDiskSizeGB || 0) + dataDiskTotalGB,
            // Network Info (IDs only - full details require separate query)
            networkInterfaceIds: nicIds,
            // Tags
            tags: vm.tags || {}
        };
    });

    console.log(`  Found ${vms.length} VMs in ${tenantConfig.tenantName}`);
    return vms;
}

/**
 * Query network interface details for VMs.
 * Returns Private IPs, VNET, and Subnet information.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {Array<string>} nicIds - Optional: specific NIC IDs to query
 * @returns {Promise<Object>} Map of NIC ID to network details
 */
async function queryNetworkDetails(tenantConfig, nicIds = []) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Build filter for specific NICs if provided
    const nicFilter = nicIds.length > 0
        ? `| where id in~ (${nicIds.map(id => `'${escapeKql(id)}'`).join(', ')})`
        : '';

    const query = `
        Resources
        | where type == 'microsoft.network/networkinterfaces'
        ${nicFilter}
        | extend ipConfigs = properties.ipConfigurations
        | mv-expand ipConfig = ipConfigs
        | extend privateIP = tostring(ipConfig.properties.privateIPAddress)
        | extend privateIPAllocation = tostring(ipConfig.properties.privateIPAllocationMethod)
        | extend subnetId = tostring(ipConfig.properties.subnet.id)
        | extend publicIPId = tostring(ipConfig.properties.publicIPAddress.id)
        | extend vmId = tostring(properties.virtualMachine.id)
        | project
            nicId = id,
            nicName = name,
            vmId,
            privateIP,
            privateIPAllocation,
            subnetId,
            publicIPId
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    // Transform into a map keyed by vmId for easy lookup
    const networkDetailsByVm = {};

    for (const nic of (result.data || [])) {
        const vmId = nic.vmId?.toLowerCase();
        if (!vmId) continue;

        // Parse subnet ID to get VNET and Subnet names
        // Format: /subscriptions/.../resourceGroups/.../providers/Microsoft.Network/virtualNetworks/{vnet}/subnets/{subnet}
        let vnetName = null;
        let subnetName = null;

        if (nic.subnetId) {
            const subnetMatch = nic.subnetId.match(/virtualNetworks\/([^/]+)\/subnets\/([^/]+)/i);
            if (subnetMatch) {
                vnetName = subnetMatch[1];
                subnetName = subnetMatch[2];
            }
        }

        if (!networkDetailsByVm[vmId]) {
            networkDetailsByVm[vmId] = {
                primaryPrivateIP: nic.privateIP,
                privateIPs: [],
                vnet: vnetName,
                subnet: subnetName,
                nics: []
            };
        }

        networkDetailsByVm[vmId].privateIPs.push(nic.privateIP);
        networkDetailsByVm[vmId].nics.push({
            nicId: nic.nicId,
            nicName: nic.nicName,
            privateIP: nic.privateIP,
            privateIPAllocation: nic.privateIPAllocation,
            vnet: vnetName,
            subnet: subnetName,
            hasPublicIP: !!nic.publicIPId
        });
    }

    return networkDetailsByVm;
}

/**
 * Query VM inventory with full network details.
 * Combines VM data with network interface information.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {Object} filters - Optional filters
 * @returns {Promise<Array>} VMs with full details including network
 */
async function queryVMInventoryWithNetwork(tenantConfig, filters = {}) {
    // Get basic VM inventory
    const vms = await queryVMInventory(tenantConfig, filters);

    // Get all NIC IDs from VMs
    const allNicIds = [];
    for (const vm of vms) {
        if (vm.networkInterfaceIds) {
            allNicIds.push(...vm.networkInterfaceIds);
        }
    }

    // Query network details if there are NICs
    let networkDetails = {};
    if (allNicIds.length > 0) {
        networkDetails = await queryNetworkDetails(tenantConfig, allNicIds);
    }

    // Enrich VMs with network details
    for (const vm of vms) {
        const vmIdLower = vm.vmId?.toLowerCase();
        const netInfo = networkDetails[vmIdLower];

        if (netInfo) {
            vm.privateIP = netInfo.primaryPrivateIP;
            vm.privateIPs = netInfo.privateIPs;
            vm.vnet = netInfo.vnet;
            vm.subnet = netInfo.subnet;
            vm.networkDetails = netInfo.nics;
        } else {
            vm.privateIP = null;
            vm.privateIPs = [];
            vm.vnet = null;
            vm.subnet = null;
            vm.networkDetails = [];
        }
    }

    return vms;
}

/**
 * Query VMs filtered by tag.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} tagKey - Tag key to filter by
 * @param {string} tagValue - Tag value to match
 * @returns {Promise<Array>} Matching VMs
 */
async function queryVMsByTag(tenantConfig, tagKey, tagValue) {
    return queryVMInventory(tenantConfig, { tag: { key: tagKey, value: tagValue } });
}

/**
 * Query VMs filtered by location.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} location - Azure region (e.g., "eastus")
 * @returns {Promise<Array>} Matching VMs
 */
async function queryVMsByLocation(tenantConfig, location) {
    return queryVMInventory(tenantConfig, { location });
}

/**
 * Query VMs filtered by size pattern.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} sizePattern - Size pattern (e.g., "Standard_D" for all D-series)
 * @returns {Promise<Array>} Matching VMs
 */
async function queryVMsBySize(tenantConfig, sizePattern) {
    return queryVMInventory(tenantConfig, { sizePattern });
}

/**
 * Get aggregate count of VMs by resource group.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of {resourceGroup, count}
 */
async function aggregateByResourceGroup(tenantConfig) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    const query = `
        Resources
        | where type == 'microsoft.compute/virtualmachines'
        | summarize count() by resourceGroup
        | order by count_ desc
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    return (result.data || []).map(row => ({
        resourceGroup: row.resourceGroup,
        count: row.count_
    }));
}

/**
 * Get aggregate count of VMs by location.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of {location, count}
 */
async function aggregateByLocation(tenantConfig) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    const query = `
        Resources
        | where type == 'microsoft.compute/virtualmachines'
        | summarize count() by location
        | order by count_ desc
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    return (result.data || []).map(row => ({
        location: row.location,
        count: row.count_
    }));
}

/**
 * Get aggregate count of VMs by size.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<Array>} Array of {vmSize, count}
 */
async function aggregateBySize(tenantConfig) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    const query = `
        Resources
        | where type == 'microsoft.compute/virtualmachines'
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | summarize count() by vmSize
        | order by count_ desc
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    return (result.data || []).map(row => ({
        vmSize: row.vmSize,
        count: row.count_
    }));
}

/**
 * Get details for a specific VM by resource ID.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} vmId - Full resource ID of the VM
 * @returns {Promise<Object|null>} VM details or null if not found
 */
async function getVMDetailsById(tenantConfig, vmId) {
    const credential = getCredentialForTenant(tenantConfig);
    const client = new ResourceGraphClient(credential);

    const query = `
        Resources
        | where id == '${escapeKql(vmId)}'
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend osType = tostring(properties.storageProfile.osDisk.osType)
        | extend osSku = tostring(properties.storageProfile.imageReference.sku)
        | extend powerState = tostring(properties.extended.instanceView.powerState.code)
        | extend provisioningState = tostring(properties.provisioningState)
        | extend networkInterfaces = properties.networkProfile.networkInterfaces
        | extend osDisk = properties.storageProfile.osDisk
        | extend dataDisks = properties.storageProfile.dataDisks
        | project
            id, name, resourceGroup, subscriptionId, location,
            vmSize, osType, osSku, powerState, provisioningState,
            tags, networkInterfaces, osDisk, dataDisks
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query: query
    });

    if (!result.data || result.data.length === 0) {
        return null;
    }

    const vm = result.data[0];
    return {
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.tenantName,
        subscriptionId: vm.subscriptionId,
        resourceGroup: vm.resourceGroup,
        vmName: vm.name,
        vmId: vm.id,
        vmSize: vm.vmSize,
        location: vm.location,
        osType: vm.osType,
        osSku: vm.osSku,
        powerState: vm.powerState?.replace('PowerState/', '') || 'unknown',
        provisioningState: vm.provisioningState,
        tags: vm.tags || {},
        networkInterfaces: vm.networkInterfaces || [],
        osDisk: vm.osDisk || {},
        dataDisks: vm.dataDisks || []
    };
}

/**
 * Query all VMs across multiple tenants.
 *
 * @param {Array} tenantConfigs - Array of tenant configurations
 * @param {Object} filters - Optional filters to apply
 * @returns {Promise<Array>} Combined VM inventory from all tenants
 */
async function queryAllTenantsInventory(tenantConfigs, filters = {}) {
    console.log(`Querying inventory across ${tenantConfigs.length} tenants...`);

    // Query all tenants in parallel
    const results = await Promise.all(
        tenantConfigs.map(tenant => queryVMInventory(tenant, filters))
    );

    // Flatten results
    const allVMs = results.flat();
    console.log(`Total VMs across all tenants: ${allVMs.length}`);

    return allVMs;
}

/**
 * Get summary statistics across all tenants.
 *
 * @param {Array} tenantConfigs - Array of tenant configurations
 * @returns {Promise<Object>} Summary with counts by tenant, location, size
 */
async function getCrosstenantSummary(tenantConfigs) {
    const allVMs = await queryAllTenantsInventory(tenantConfigs);

    // Group by tenant
    const byTenant = {};
    const byLocation = {};
    const bySize = {};
    const byPowerState = {};

    for (const vm of allVMs) {
        // By tenant
        byTenant[vm.tenantName] = (byTenant[vm.tenantName] || 0) + 1;

        // By location
        byLocation[vm.location] = (byLocation[vm.location] || 0) + 1;

        // By size family (extract family from size like "Standard_D4s_v3" -> "D-series v3")
        const sizeFamily = extractSizeFamily(vm.vmSize);
        bySize[sizeFamily] = (bySize[sizeFamily] || 0) + 1;

        // By power state
        byPowerState[vm.powerState] = (byPowerState[vm.powerState] || 0) + 1;
    }

    return {
        totalVMs: allVMs.length,
        tenantCount: tenantConfigs.length,
        byTenant: sortByValue(byTenant),
        byLocation: sortByValue(byLocation),
        bySize: sortByValue(bySize),
        byPowerState: sortByValue(byPowerState)
    };
}

/**
 * Escape string for use in KQL queries.
 *
 * @param {string} value - Value to escape
 * @returns {string} Escaped value
 */
function escapeKql(value) {
    if (!value) return '';
    return value.replace(/'/g, "''").replace(/\\/g, '\\\\');
}

/**
 * Extract VM size family from full size name.
 *
 * @param {string} vmSize - Full VM size (e.g., "Standard_D4s_v3")
 * @returns {string} Size family (e.g., "D-series v3")
 */
function extractSizeFamily(vmSize) {
    if (!vmSize) return 'Unknown';

    // Match patterns like Standard_D4s_v3, Standard_E8as_v4, Standard_B2ms
    const match = vmSize.match(/Standard_([A-Z]+)\d+[a-z]*s?_?(v\d+)?/i);
    if (match) {
        const family = match[1];
        const version = match[2] || '';
        return `${family}-series${version ? ' ' + version : ''}`;
    }

    return vmSize;
}

/**
 * Sort object by value descending.
 *
 * @param {Object} obj - Object with numeric values
 * @returns {Array} Array of {key, value} sorted by value desc
 */
function sortByValue(obj) {
    return Object.entries(obj)
        .map(([key, value]) => ({ key, value }))
        .sort((a, b) => b.value - a.value);
}

module.exports = {
    queryVMInventory,
    queryVMInventoryWithNetwork,
    queryNetworkDetails,
    queryVMsByTag,
    queryVMsByLocation,
    queryVMsBySize,
    aggregateByResourceGroup,
    aggregateByLocation,
    aggregateBySize,
    getVMDetailsById,
    queryAllTenantsInventory,
    getCrosstenantSummary
};
