/**
 * @fileoverview Resource Graph Query Service
 *
 * Provides Azure Resource Graph queries for VM inventory, network details,
 * and aggregations. Uses multi-tenant authentication and 24-hour blob caching.
 *
 * @version v11-microservices
 */

const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const axios = require('axios');
const { getTenantCredential, getTenantConfig, getAllTenants, getArmToken } = require('../shared/multiTenantAuth');
const { withCache, invalidateCacheByPrefix } = require('./cacheService');

// Cache for VM sizes by location (to avoid repeated API calls)
const vmSizeCache = new Map();
const VM_SIZE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Query VM inventory with optional filters.
 *
 * @param {Object} options - Query options
 * @param {string} options.tenantId - Tenant ID or name
 * @param {string} options.subscriptionId - Filter by subscription
 * @param {string} options.location - Filter by location
 * @param {string} options.powerState - Filter by power state
 * @param {string} options.vmSize - Filter by VM size
 * @param {Object} options.tags - Filter by tags
 * @param {boolean} options.skipCache - Skip cache lookup
 * @returns {Promise<Object>} VM inventory with cache metadata
 */
async function queryVMInventory(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        location: options.location || 'all',
        powerState: options.powerState || 'all',
        vmSize: options.vmSize || 'all'
    };

    if (options.skipCache) {
        const data = await executeVMInventoryQuery(tenantConfig, options);
        return { data, cacheHit: false };
    }

    return withCache('inventory', cacheParams, () =>
        executeVMInventoryQuery(tenantConfig, options)
    );
}

/**
 * Execute the actual VM inventory query.
 */
async function executeVMInventoryQuery(tenantConfig, options) {
    const credential = await getTenantCredential(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Build KQL query with filters
    let query = `
        Resources
        | where type == "microsoft.compute/virtualmachines"
    `;

    // Apply filters
    if (options.subscriptionId) {
        query += `| where subscriptionId == "${options.subscriptionId}"`;
    }
    if (options.location) {
        query += `| where location == "${options.location.toLowerCase()}"`;
    }
    if (options.vmSize) {
        query += `| where properties.hardwareProfile.vmSize == "${options.vmSize}"`;
    }
    if (options.powerState) {
        const stateFilter = options.powerState.toLowerCase();
        if (stateFilter === 'running') {
            query += `| where properties.extended.instanceView.powerState.displayStatus == "VM running"`;
        } else if (stateFilter === 'stopped' || stateFilter === 'deallocated') {
            query += `| where properties.extended.instanceView.powerState.displayStatus contains "deallocated" or properties.extended.instanceView.powerState.displayStatus contains "stopped"`;
        }
    }
    if (options.tags && Object.keys(options.tags).length > 0) {
        for (const [key, value] of Object.entries(options.tags)) {
            query += `| where tags["${key}"] == "${value}"`;
        }
    }

    // Project useful fields
    query += `
        | extend vmName = name
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend osType = tostring(properties.storageProfile.osDisk.osType)
        | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
        | extend privateIP = tostring(properties.networkProfile.networkInterfaces[0].properties.privateIPAddress)
        | extend resourceGroup = resourceGroup
        | project vmName, vmSize, location, osType, powerState, privateIP, resourceGroup, subscriptionId, id, tags
        | order by vmName asc
    `;

    // Determine subscriptions to query
    const subscriptions = options.subscriptionId
        ? [options.subscriptionId]
        : tenantConfig.subscriptionIds;

    const result = await client.resources({
        subscriptions,
        query
    });

    const vms = result.data || [];

    console.log(`[ResourceGraph] Queried ${vms.length} VMs from tenant ${tenantConfig.name || tenantConfig.tenantId}`);

    return {
        vms,
        rowCount: vms.length,
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.name
    };
}

/**
 * Query VM inventory with network details (IPs, NSGs, etc.)
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} VM inventory with network details
 */
async function queryVMInventoryWithNetwork(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        type: 'network'
    };

    if (options.skipCache) {
        const data = await executeNetworkQuery(tenantConfig, options);
        return { data, cacheHit: false };
    }

    return withCache('inventory-network', cacheParams, () =>
        executeNetworkQuery(tenantConfig, options)
    );
}

/**
 * Execute VM + Network details query.
 */
async function executeNetworkQuery(tenantConfig, options) {
    const credential = await getTenantCredential(tenantConfig);
    const client = new ResourceGraphClient(credential);

    const query = `
        Resources
        | where type == "microsoft.compute/virtualmachines"
        ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
        | extend vmName = name
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend nicIds = properties.networkProfile.networkInterfaces
        | mv-expand nicId = nicIds
        | extend nicResourceId = tostring(nicId.id)
        | join kind=leftouter (
            Resources
            | where type == "microsoft.network/networkinterfaces"
            | extend nicId = id
            | extend privateIP = tostring(properties.ipConfigurations[0].properties.privateIPAddress)
            | extend publicIPId = tostring(properties.ipConfigurations[0].properties.publicIPAddress.id)
            | extend subnetId = tostring(properties.ipConfigurations[0].properties.subnet.id)
            | extend nsgId = tostring(properties.networkSecurityGroup.id)
            | project nicId, privateIP, publicIPId, subnetId, nsgId
        ) on $left.nicResourceId == $right.nicId
        | summarize
            privateIPs = make_list(privateIP),
            publicIPIds = make_list(publicIPId),
            subnetIds = make_list(subnetId),
            nsgIds = make_list(nsgId)
            by vmName, vmSize, location, resourceGroup, subscriptionId, id
        | extend primaryPrivateIP = tostring(privateIPs[0])
        | project vmName, vmSize, location, resourceGroup, subscriptionId, primaryPrivateIP, privateIPs, publicIPIds, subnetIds, nsgIds, id
        | order by vmName asc
    `;

    const subscriptions = options.subscriptionId
        ? [options.subscriptionId]
        : tenantConfig.subscriptionIds;

    const result = await client.resources({
        subscriptions,
        query
    });

    return {
        vms: result.data || [],
        rowCount: result.totalRecords || result.data?.length || 0,
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.name
    };
}

/**
 * Get single VM details by name or ID.
 *
 * @param {string} vmIdentifier - VM name or resource ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} VM details
 */
async function getVMDetails(vmIdentifier, options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const credential = await getTenantCredential(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Determine if identifier is resource ID or name
    const isResourceId = vmIdentifier.startsWith('/subscriptions/');

    let query;
    if (isResourceId) {
        query = `
            Resources
            | where type == "microsoft.compute/virtualmachines"
            | where id == "${vmIdentifier}"
        `;
    } else {
        query = `
            Resources
            | where type == "microsoft.compute/virtualmachines"
            | where name =~ "${vmIdentifier}"
        `;
    }

    query += `
        | extend vmName = name
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend osType = tostring(properties.storageProfile.osDisk.osType)
        | extend osDiskSize = toint(properties.storageProfile.osDisk.diskSizeGB)
        | extend dataDisks = array_length(properties.storageProfile.dataDisks)
        | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
        | extend privateIP = tostring(properties.networkProfile.networkInterfaces[0].properties.privateIPAddress)
        | project vmName, vmSize, location, osType, osDiskSize, dataDisks, powerState, privateIP, resourceGroup, subscriptionId, id, tags, properties
    `;

    const result = await client.resources({
        subscriptions: tenantConfig.subscriptionIds,
        query
    });

    const vm = result.data?.[0];
    if (!vm) {
        return { found: false, vmIdentifier };
    }

    return {
        found: true,
        vm,
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.name
    };
}

/**
 * Get aggregated summary by resource group.
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Summary by resource group
 */
async function aggregateByResourceGroup(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        type: 'by-rg'
    };

    return withCache('summary', cacheParams, async () => {
        const credential = await getTenantCredential(tenantConfig);
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | where type == "microsoft.compute/virtualmachines"
            ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
            | summarize vmCount = count(), vmSizes = make_set(properties.hardwareProfile.vmSize) by resourceGroup, subscriptionId
            | order by vmCount desc
        `;

        const subscriptions = options.subscriptionId
            ? [options.subscriptionId]
            : tenantConfig.subscriptionIds;

        const result = await client.resources({
            subscriptions,
            query
        });

        return {
            summary: result.data || [],
            totalGroups: result.data?.length || 0,
            tenantId: tenantConfig.tenantId,
            tenantName: tenantConfig.name
        };
    });
}

/**
 * Get aggregated summary by location.
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Summary by location
 */
async function aggregateByLocation(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        type: 'by-location'
    };

    return withCache('summary', cacheParams, async () => {
        const credential = await getTenantCredential(tenantConfig);
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | where type == "microsoft.compute/virtualmachines"
            ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
            | summarize vmCount = count() by location
            | order by vmCount desc
        `;

        const subscriptions = options.subscriptionId
            ? [options.subscriptionId]
            : tenantConfig.subscriptionIds;

        const result = await client.resources({
            subscriptions,
            query
        });

        return {
            summary: result.data || [],
            totalLocations: result.data?.length || 0,
            tenantId: tenantConfig.tenantId,
            tenantName: tenantConfig.name
        };
    });
}

/**
 * Get aggregated summary by VM size.
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Summary by VM size
 */
async function aggregateBySize(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        type: 'by-size'
    };

    return withCache('summary', cacheParams, async () => {
        const credential = await getTenantCredential(tenantConfig);
        const client = new ResourceGraphClient(credential);

        const query = `
            Resources
            | where type == "microsoft.compute/virtualmachines"
            ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
            | extend vmSize = tostring(properties.hardwareProfile.vmSize)
            | summarize vmCount = count() by vmSize
            | order by vmCount desc
        `;

        const subscriptions = options.subscriptionId
            ? [options.subscriptionId]
            : tenantConfig.subscriptionIds;

        const result = await client.resources({
            subscriptions,
            query
        });

        return {
            summary: result.data || [],
            totalSizes: result.data?.length || 0,
            tenantId: tenantConfig.tenantId,
            tenantName: tenantConfig.name
        };
    });
}

/**
 * Get cross-tenant summary.
 *
 * @returns {Promise<Object>} Summary across all tenants
 */
async function getCrossTenantSummary() {
    const tenants = getAllTenants();
    const summaries = [];

    for (const tenant of tenants) {
        try {
            const tenantConfig = getTenantConfig(tenant.tenantId);
            const credential = await getTenantCredential(tenantConfig);
            const client = new ResourceGraphClient(credential);

            const query = `
                Resources
                | where type == "microsoft.compute/virtualmachines"
                | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
                | summarize
                    total = count(),
                    running = countif(powerState == "VM running"),
                    stopped = countif(powerState contains "deallocated" or powerState contains "stopped")
            `;

            const result = await client.resources({
                subscriptions: tenantConfig.subscriptionIds,
                query
            });

            const data = result.data?.[0] || { total: 0, running: 0, stopped: 0 };

            summaries.push({
                tenantId: tenant.tenantId,
                tenantName: tenant.name,
                subscriptionCount: tenant.subscriptionIds?.length || 0,
                vmCount: data.total,
                running: data.running,
                stopped: data.stopped
            });
        } catch (error) {
            console.error(`[ResourceGraph] Failed to get summary for tenant ${tenant.name}:`, error.message);
            summaries.push({
                tenantId: tenant.tenantId,
                tenantName: tenant.name,
                error: error.message
            });
        }
    }

    const totals = summaries.reduce((acc, s) => ({
        totalVMs: acc.totalVMs + (s.vmCount || 0),
        totalRunning: acc.totalRunning + (s.running || 0),
        totalStopped: acc.totalStopped + (s.stopped || 0),
        totalSubscriptions: acc.totalSubscriptions + (s.subscriptionCount || 0)
    }), { totalVMs: 0, totalRunning: 0, totalStopped: 0, totalSubscriptions: 0 });

    return {
        tenants: summaries,
        totals,
        queriedAt: new Date().toISOString()
    };
}

/**
 * Search VMs by name pattern.
 *
 * @param {string} pattern - Search pattern (supports wildcards)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Matching VMs
 */
async function searchVMs(pattern, options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const credential = await getTenantCredential(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Convert wildcard pattern to KQL contains/startswith
    let filter;
    if (pattern.includes('*')) {
        // Handle wildcard patterns
        if (pattern.startsWith('*') && pattern.endsWith('*')) {
            filter = `| where name contains "${pattern.replace(/\*/g, '')}"`;
        } else if (pattern.startsWith('*')) {
            filter = `| where name endswith "${pattern.replace('*', '')}"`;
        } else if (pattern.endsWith('*')) {
            filter = `| where name startswith "${pattern.replace('*', '')}"`;
        } else {
            filter = `| where name contains "${pattern.replace(/\*/g, '')}"`;
        }
    } else {
        // Exact or partial match
        filter = `| where name contains "${pattern}"`;
    }

    const query = `
        Resources
        | where type == "microsoft.compute/virtualmachines"
        ${filter}
        ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
        | extend vmName = name
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
        | project vmName, vmSize, location, powerState, resourceGroup, subscriptionId
        | order by vmName asc
        | take 100
    `;

    const subscriptions = options.subscriptionId
        ? [options.subscriptionId]
        : tenantConfig.subscriptionIds;

    const result = await client.resources({
        subscriptions,
        query
    });

    return {
        vms: result.data || [],
        rowCount: result.data?.length || 0,
        pattern,
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.name
    };
}

/**
 * Get subscription details from Azure Resource Graph.
 * Fetches actual subscription names from Azure.
 *
 * @returns {Promise<Object>} List of subscriptions with names
 */
async function getSubscriptionDetails() {
    const tenants = getAllTenants();
    const subscriptions = [];

    for (const tenant of tenants) {
        try {
            const tenantConfig = getTenantConfig(tenant.tenantId);
            if (!tenantConfig || !tenantConfig.subscriptionIds?.length) {
                continue;
            }

            const credential = await getTenantCredential(tenantConfig);
            const client = new ResourceGraphClient(credential);

            // Query subscription resources to get names
            const query = `
                resourcecontainers
                | where type == "microsoft.resources/subscriptions"
                | project subscriptionId, name = name, displayName = properties.displayName
            `;

            const result = await client.resources({
                subscriptions: tenantConfig.subscriptionIds,
                query
            });

            for (const sub of result.data || []) {
                subscriptions.push({
                    subscriptionId: sub.subscriptionId,
                    name: sub.displayName || sub.name || sub.subscriptionId,
                    tenantId: tenant.tenantId,
                    tenantName: tenant.name
                });
            }
        } catch (error) {
            console.error(`[ResourceGraph] Failed to get subs for tenant ${tenant.name}:`, error.message);
            // Fall back to subscription IDs without names
            for (const subId of tenant.subscriptionIds || []) {
                subscriptions.push({
                    subscriptionId: subId,
                    name: subId, // Use ID as name fallback
                    tenantId: tenant.tenantId,
                    tenantName: tenant.name
                });
            }
        }
    }

    return subscriptions;
}

/**
 * Force refresh cache for a specific query type.
 *
 * @param {string} queryType - Query type prefix to invalidate
 * @returns {Promise<number>} Number of cache entries invalidated
 */
async function refreshCache(queryType) {
    return invalidateCacheByPrefix(queryType);
}

/**
 * Get VM sizes for a location (with caching).
 *
 * @param {string} subscriptionId - Azure subscription ID
 * @param {string} location - Azure region
 * @param {string} armToken - ARM access token
 * @returns {Promise<Map<string, Object>>} Map of VM size name to size details
 */
async function getVMSizesForLocation(subscriptionId, location, armToken) {
    const cacheKey = `${subscriptionId}:${location}`;
    const cached = vmSizeCache.get(cacheKey);
    
    if (cached && Date.now() < cached.expiresAt) {
        return cached.sizes;
    }

    try {
        const response = await axios.get(
            `https://management.azure.com/subscriptions/${subscriptionId}/providers/Microsoft.Compute/locations/${location}/vmSizes?api-version=2024-03-01`,
            {
                headers: {
                    'Authorization': `Bearer ${armToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const sizes = new Map();
        for (const size of response.data.value || []) {
            sizes.set(size.name, {
                name: size.name,
                numberOfCores: size.numberOfCores,
                memoryInMB: size.memoryInMB,
                maxDataDiskCount: size.maxDataDiskCount,
                osDiskSizeInMB: size.osDiskSizeInMB,
                resourceDiskSizeInMB: size.resourceDiskSizeInMB
            });
        }

        // Cache the result
        vmSizeCache.set(cacheKey, {
            sizes,
            expiresAt: Date.now() + VM_SIZE_CACHE_TTL_MS
        });

        console.log(`[ResourceGraph] Cached ${sizes.size} VM sizes for ${location}`);
        return sizes;
    } catch (error) {
        console.error(`[ResourceGraph] Failed to get VM sizes for ${location}:`, error.message);
        return new Map();
    }
}

/**
 * Query SQL VMs based on OS image reference with accurate CPU core counts.
 * Identifies SQL VMs by checking publisher, offer, or SKU for SQL-related patterns.
 *
 * @param {Object} options - Query options
 * @param {string} options.tenantId - Tenant ID or name
 * @param {string} options.subscriptionId - Filter by subscription
 * @param {boolean} options.skipCache - Skip cache lookup
 * @returns {Promise<Object>} SQL VM inventory with CPU cores
 */
async function querySQLVMInventory(options = {}) {
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const cacheParams = {
        tenantId: tenantConfig.tenantId,
        subscriptionId: options.subscriptionId || 'all',
        type: 'sql-vms'
    };

    if (options.skipCache) {
        const data = await executeSQLVMQuery(tenantConfig, options);
        return { data, cacheHit: false };
    }

    return withCache('sql-inventory', cacheParams, () =>
        executeSQLVMQuery(tenantConfig, options)
    );
}

/**
 * Execute the SQL VM inventory query with CPU core enrichment.
 */
async function executeSQLVMQuery(tenantConfig, options) {
    const credential = await getTenantCredential(tenantConfig);
    const client = new ResourceGraphClient(credential);

    // Query to find SQL VMs based on OS image reference
    const query = `
        Resources
        | where type == "microsoft.compute/virtualmachines"
        ${options.subscriptionId ? `| where subscriptionId == "${options.subscriptionId}"` : ''}
        | extend imageReference = properties.storageProfile.imageReference
        | extend publisher = tostring(imageReference.publisher)
        | extend offer = tostring(imageReference.offer)
        | extend imageSku = tostring(imageReference.sku)
        | extend imageVersion = tostring(imageReference.version)
        | where publisher contains "MicrosoftSQLServer" 
            or offer contains "sql" 
            or imageSku contains "sql"
            or publisher contains "microsoftsqlserver"
        | extend vmName = name
        | extend vmSize = tostring(properties.hardwareProfile.vmSize)
        | extend osType = tostring(properties.storageProfile.osDisk.osType)
        | extend powerState = tostring(properties.extended.instanceView.powerState.displayStatus)
        | extend licenseType = tostring(properties.licenseType)
        | project 
            vmName, 
            vmSize, 
            location, 
            osType, 
            powerState, 
            publisher, 
            offer, 
            imageSku, 
            imageVersion,
            licenseType,
            resourceGroup, 
            subscriptionId, 
            id, 
            tags
        | order by vmName asc
    `;

    const subscriptions = options.subscriptionId
        ? [options.subscriptionId]
        : tenantConfig.subscriptionIds;

    const result = await client.resources({
        subscriptions,
        query
    });

    const sqlVMs = result.data || [];
    console.log(`[ResourceGraph] Found ${sqlVMs.length} SQL VMs from tenant ${tenantConfig.name || tenantConfig.tenantId}`);

    if (sqlVMs.length === 0) {
        return {
            sqlVMs: [],
            rowCount: 0,
            tenantId: tenantConfig.tenantId,
            tenantName: tenantConfig.name,
            totalCores: 0
        };
    }

    // Get ARM token for Compute API calls
    const armToken = await getArmToken(tenantConfig);

    // Group VMs by location and subscription to minimize API calls
    const vmsByLocationAndSub = new Map();
    for (const vm of sqlVMs) {
        const key = `${vm.subscriptionId}:${vm.location}`;
        if (!vmsByLocationAndSub.has(key)) {
            vmsByLocationAndSub.set(key, []);
        }
        vmsByLocationAndSub.get(key).push(vm);
    }

    // Fetch VM sizes for each unique location/subscription combination
    const vmSizesByLocation = new Map();
    for (const key of vmsByLocationAndSub.keys()) {
        const [subId, location] = key.split(':');
        const sizes = await getVMSizesForLocation(subId, location, armToken);
        vmSizesByLocation.set(key, sizes);
    }

    // Enrich VMs with CPU core counts
    let totalCores = 0;
    const enrichedVMs = sqlVMs.map(vm => {
        const key = `${vm.subscriptionId}:${vm.location}`;
        const sizes = vmSizesByLocation.get(key) || new Map();
        const sizeDetails = sizes.get(vm.vmSize);

        const cpuCores = sizeDetails?.numberOfCores || null;
        const memoryGB = sizeDetails ? Math.round(sizeDetails.memoryInMB / 1024) : null;

        if (cpuCores) {
            totalCores += cpuCores;
        }

        return {
            ...vm,
            cpuCores,
            memoryGB,
            maxDataDisks: sizeDetails?.maxDataDiskCount || null,
            sqlEdition: extractSQLEdition(vm.offer, vm.imageSku),
            sqlVersion: extractSQLVersion(vm.offer, vm.imageSku)
        };
    });

    return {
        sqlVMs: enrichedVMs,
        rowCount: enrichedVMs.length,
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.name,
        totalCores,
        summary: {
            byVersion: summarizeByField(enrichedVMs, 'sqlVersion'),
            byEdition: summarizeByField(enrichedVMs, 'sqlEdition'),
            byLocation: summarizeByField(enrichedVMs, 'location'),
            byPowerState: summarizeByField(enrichedVMs, 'powerState')
        }
    };
}

/**
 * Extract SQL Server edition from offer/SKU.
 */
function extractSQLEdition(offer, sku) {
    const combined = `${offer || ''} ${sku || ''}`.toLowerCase();
    
    if (combined.includes('enterprise')) return 'Enterprise';
    if (combined.includes('standard')) return 'Standard';
    if (combined.includes('web')) return 'Web';
    if (combined.includes('developer') || combined.includes('dev')) return 'Developer';
    if (combined.includes('express')) return 'Express';
    
    return 'Unknown';
}

/**
 * Extract SQL Server version from offer/SKU.
 */
function extractSQLVersion(offer, sku) {
    const combined = `${offer || ''} ${sku || ''}`;
    
    // Match SQL year patterns
    const yearMatch = combined.match(/sql\s*(\d{4})/i) || combined.match(/(\d{4})-/);
    if (yearMatch) {
        return `SQL Server ${yearMatch[1]}`;
    }
    
    return 'Unknown';
}

/**
 * Create summary counts by field.
 */
function summarizeByField(items, field) {
    const summary = {};
    for (const item of items) {
        const value = item[field] || 'Unknown';
        summary[value] = (summary[value] || 0) + 1;
    }
    return summary;
}

/**
 * Query SQL VMs across all configured tenants.
 *
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Cross-tenant SQL VM inventory
 */
async function queryCrossTenantSQLVMs(options = {}) {
    const tenants = getAllTenants();
    const results = [];
    let grandTotalCores = 0;
    let grandTotalVMs = 0;

    for (const tenant of tenants) {
        try {
            const result = await querySQLVMInventory({
                tenantId: tenant.tenantId,
                skipCache: options.skipCache
            });

            const data = result.data || result;
            grandTotalCores += data.totalCores || 0;
            grandTotalVMs += data.rowCount || 0;

            results.push({
                tenantId: tenant.tenantId,
                tenantName: tenant.name,
                sqlVMs: data.sqlVMs,
                rowCount: data.rowCount,
                totalCores: data.totalCores,
                summary: data.summary
            });
        } catch (error) {
            console.error(`[ResourceGraph] Failed to query SQL VMs for tenant ${tenant.name}:`, error.message);
            results.push({
                tenantId: tenant.tenantId,
                tenantName: tenant.name,
                error: error.message
            });
        }
    }

    return {
        tenants: results,
        grandTotals: {
            totalVMs: grandTotalVMs,
            totalCores: grandTotalCores,
            tenantCount: tenants.length
        },
        queriedAt: new Date().toISOString()
    };
}

module.exports = {
    queryVMInventory,
    queryVMInventoryWithNetwork,
    getVMDetails,
    aggregateByResourceGroup,
    aggregateByLocation,
    aggregateBySize,
    getCrossTenantSummary,
    searchVMs,
    getSubscriptionDetails,
    refreshCache,
    querySQLVMInventory,
    queryCrossTenantSQLVMs
};
