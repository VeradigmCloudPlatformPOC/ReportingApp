/**
 * @fileoverview Multi-Tenant Log Analytics Query Service
 *
 * This module extends the existing logAnalytics.js to support:
 * - Multiple Azure AD tenants
 * - Multiple Log Analytics workspaces per tenant
 * - Parallel queries across tenants and workspaces
 * - Result aggregation with tenant/workspace labeling
 *
 * Architecture:
 * - Each tenant has its own service principal credentials
 * - Each tenant can have multiple Log Analytics workspaces
 * - Queries run in parallel: tenants → workspaces → VM batches
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');
const { getLogAnalyticsToken, getTenantCredential } = require('./multiTenantAuth');

/**
 * Sleep helper with optional jitter for throttling protection.
 *
 * @param {number} ms - Base milliseconds to sleep
 * @param {boolean} addJitter - Whether to add random jitter (0-1000ms)
 * @returns {Promise} Resolves after the delay
 */
function sleep(ms, addJitter = false) {
    const jitter = addJitter ? Math.random() * 1000 : 0;
    return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

/**
 * Query a single Log Analytics workspace for VM performance metrics.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {Object} workspace - Workspace configuration
 * @param {string} workspace.workspaceId - Log Analytics workspace ID
 * @param {string} workspace.name - Friendly workspace name
 * @param {Array} workspace.subscriptions - Subscription IDs to filter (optional)
 * @param {Object} options - Query options
 * @param {number} options.days - Number of days to query (default: 30)
 * @returns {Promise<Array>} Array of VM metrics with workspace labels
 */
async function queryWorkspace(tenantConfig, workspace, options = {}) {
    const days = options.days || 30;
    const workspaceId = workspace.workspaceId;
    const workspaceName = workspace.name || workspaceId;

    console.log(`  Querying workspace: ${workspaceName} (${tenantConfig.tenantName})`);

    // Get token for this tenant
    const accessToken = await getLogAnalyticsToken(tenantConfig);

    // Build subscription filter if specified
    let subscriptionFilter = '';
    if (workspace.subscriptions && workspace.subscriptions.length > 0) {
        const subList = workspace.subscriptions.map(s => `"${s}"`).join(', ');
        subscriptionFilter = `| where _SubscriptionId in (${subList})`;
    }

    // Step 1: Get list of VMs in workspace
    const vmListQuery = `
        Perf
        | where TimeGenerated >= ago(${days}d)
        | where ObjectName == "Processor" and CounterName == "% Processor Time"
        ${subscriptionFilter}
        | distinct Computer, _ResourceId, _SubscriptionId
        | extend ResourceGroup = tostring(split(_ResourceId, "/")[4])
        | project VMName = Computer, ResourceId = _ResourceId, ResourceGroup, SubscriptionId = _SubscriptionId
    `;

    const vmListResponse = await executeQuery(workspaceId, accessToken, vmListQuery);
    const vmList = parseQueryResults(vmListResponse);

    if (vmList.length === 0) {
        console.log(`    No VMs found in workspace: ${workspaceName}`);
        return [];
    }

    console.log(`    Found ${vmList.length} VMs in workspace: ${workspaceName}`);

    // Step 2: Query metrics in batches
    const VM_BATCH_SIZE = 30;
    const PARALLEL_BATCHES = 3;
    const DELAY_BETWEEN_GROUPS_MS = 2000;

    const vmBatches = [];
    for (let i = 0; i < vmList.length; i += VM_BATCH_SIZE) {
        vmBatches.push(vmList.slice(i, i + VM_BATCH_SIZE));
    }

    const allMetrics = [];

    // Process batches in parallel groups
    for (let i = 0; i < vmBatches.length; i += PARALLEL_BATCHES) {
        const parallelGroup = vmBatches.slice(i, i + PARALLEL_BATCHES);

        const promises = parallelGroup.map((batch, idx) =>
            processBatch(workspaceId, accessToken, batch, i + idx, vmBatches.length, days)
        );

        const results = await Promise.all(promises);

        for (const batchResults of results) {
            // Add tenant and workspace labels to each result
            for (const vm of batchResults) {
                allMetrics.push({
                    ...vm,
                    tenantId: tenantConfig.tenantId,
                    tenantName: tenantConfig.tenantName,
                    workspaceId: workspaceId,
                    workspaceName: workspaceName
                });
            }
        }

        // Rate limit protection
        if (i + PARALLEL_BATCHES < vmBatches.length) {
            await sleep(DELAY_BETWEEN_GROUPS_MS, true);
        }
    }

    console.log(`    Completed workspace ${workspaceName}: ${allMetrics.length} VMs`);
    return allMetrics;
}

/**
 * Process a single batch of VMs with retry logic.
 *
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {string} accessToken - OAuth2 bearer token
 * @param {Array} batch - Array of VM objects to process
 * @param {number} batchIndex - Current batch index
 * @param {number} totalBatches - Total number of batches
 * @param {number} days - Number of days to query
 * @returns {Promise<Array>} Array of VM metrics for this batch
 */
async function processBatch(workspaceId, accessToken, batch, batchIndex, totalBatches, days) {
    const vmNames = batch.map(vm => vm.VMName);
    let metrics = null;
    let lastError = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            metrics = await queryVMMetrics(workspaceId, accessToken, vmNames, days);
            break;
        } catch (error) {
            lastError = error;
            if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
                const retryDelay = Math.min(Math.pow(2, attempt) * 5000, 60000);
                console.log(`      Batch ${batchIndex + 1}: Rate limited, retry ${attempt}/${maxRetries} after ${retryDelay / 1000}s...`);
                await sleep(retryDelay, true);
            } else if (attempt < maxRetries) {
                console.log(`      Batch ${batchIndex + 1}: Error, retrying: ${error.message}`);
                await sleep(5000, true);
            }
        }
    }

    if (metrics) {
        const results = [];
        for (const metric of metrics) {
            const vmInfo = batch.find(vm => vm.VMName === metric.Computer);
            if (vmInfo) {
                results.push({
                    VMName: metric.Computer,
                    ResourceId: vmInfo.ResourceId,
                    ResourceGroup: vmInfo.ResourceGroup,
                    SubscriptionId: vmInfo.SubscriptionId,
                    CPU_Max: Math.round((metric.MaxCPU || 0) * 100) / 100,
                    CPU_Avg: Math.round((metric.AvgCPU || 0) * 100) / 100,
                    CPU_P95: Math.round((metric.MaxCPU || 0) * 0.95 * 100) / 100,
                    Memory_Max: Math.round((metric.MaxMemory || metric.AvgMemoryUsage || 0) * 100) / 100,
                    Memory_Avg: Math.round((metric.AvgMemoryUsage || 0) * 100) / 100,
                    Memory_P95: Math.round((metric.MaxMemory || metric.AvgMemoryUsage || 0) * 0.95 * 100) / 100,
                    DiskBytesPerSec_Max: Math.round((metric.MaxDiskBytesPerSec || metric.AvgDiskBytesPerSec || 0) * 100) / 100,
                    DiskBytesPerSec_Avg: Math.round((metric.AvgDiskBytesPerSec || 0) * 100) / 100,
                    DiskIOPS_Max: Math.round((metric.MaxDiskTransfers || metric.AvgDiskTransfersPerSec || 0) * 100) / 100,
                    DiskIOPS_Avg: Math.round((metric.AvgDiskTransfersPerSec || 0) * 100) / 100
                });
            }
        }
        return results;
    } else {
        console.error(`      Batch ${batchIndex + 1}: Error after ${maxRetries} retries: ${lastError?.message}`);
        return [];
    }
}

/**
 * Query metrics for a batch of VMs using optimized single-scan KQL query.
 *
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {string} accessToken - OAuth2 bearer token
 * @param {Array<string>} vmNames - Array of VM computer names to query
 * @param {number} days - Number of days to query
 * @returns {Promise<Array>} Array of metric objects
 */
async function queryVMMetrics(workspaceId, accessToken, vmNames, days = 30) {
    const vmListStr = vmNames.map(name => name.replace(/'/g, "''")).join("','");

    const query = `
        Perf
        | where TimeGenerated >= ago(${days}d)
        | where Computer in ('${vmListStr}')
        | where ObjectName in ("Processor", "Memory", "LogicalDisk", "Logical Disk")
        | where (ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total")
            or (ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "Available MBytes", "% Used Memory", "% Available Memory", "Available MBytes Memory", "Used Memory MBytes"))
            or (ObjectName in ("LogicalDisk", "Logical Disk") and CounterName in ("Disk Bytes/sec", "Disk Transfers/sec") and InstanceName == "_Total")
        | summarize
            AvgCPU = avgif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
            MaxCPU = maxif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
            AvgMemoryUsage = avgif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
            MaxMemory = maxif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
            AvgAvailableMB = avgif(CounterValue, ObjectName == "Memory" and CounterName in ("Available MBytes", "Available MBytes Memory")),
            AvgDiskBytesPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Bytes/sec"),
            MaxDiskBytesPerSec = maxif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Bytes/sec"),
            AvgDiskTransfersPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec"),
            MaxDiskTransfers = maxif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec")
          by Computer
        | order by Computer asc
    `;

    const response = await executeQuery(workspaceId, accessToken, query);
    return parseQueryResults(response);
}

/**
 * Query all workspaces for a single tenant.
 *
 * Queries each workspace in parallel and aggregates results.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Combined VM metrics from all workspaces
 */
async function queryTenant(tenantConfig, options = {}) {
    const workspaces = tenantConfig.logAnalyticsWorkspaces || [];

    if (workspaces.length === 0) {
        console.log(`  No workspaces configured for tenant: ${tenantConfig.tenantName}`);
        return [];
    }

    console.log(`Querying tenant: ${tenantConfig.tenantName} (${workspaces.length} workspaces)`);

    // Query all workspaces in parallel
    const promises = workspaces.map(workspace =>
        queryWorkspace(tenantConfig, workspace, options)
    );

    const results = await Promise.all(promises);
    const allMetrics = results.flat();

    console.log(`Tenant ${tenantConfig.tenantName} complete: ${allMetrics.length} total VMs`);
    return allMetrics;
}

/**
 * Query all tenants and workspaces.
 *
 * This is the main entry point for multi-tenant queries.
 * Queries all configured tenants in parallel.
 *
 * @param {Array} tenantConfigs - Array of tenant configurations
 * @param {Object} options - Query options
 * @param {number} options.days - Number of days to query (default: 30)
 * @param {Function} options.onProgress - Progress callback (optional)
 * @returns {Promise<Object>} Results object with metrics and summary
 */
async function queryAllTenants(tenantConfigs, options = {}) {
    console.log(`\nQuerying ${tenantConfigs.length} tenants for VM performance metrics...`);
    console.log(`Analysis period: Last ${options.days || 30} days\n`);

    const startTime = Date.now();

    // Query all tenants in parallel
    const promises = tenantConfigs.map(tenant => queryTenant(tenant, options));
    const results = await Promise.all(promises);
    const allMetrics = results.flat();

    const duration = Date.now() - startTime;

    // Build summary
    const summary = buildQuerySummary(allMetrics, tenantConfigs, duration);

    console.log(`\nQuery complete: ${allMetrics.length} VMs across ${tenantConfigs.length} tenants in ${(duration / 1000).toFixed(1)}s`);

    return {
        metrics: allMetrics,
        summary: summary,
        duration: duration
    };
}

/**
 * Build query summary with aggregations.
 *
 * @param {Array} metrics - All VM metrics
 * @param {Array} tenantConfigs - Tenant configurations
 * @param {number} duration - Query duration in ms
 * @returns {Object} Summary object
 */
function buildQuerySummary(metrics, tenantConfigs, duration) {
    const byTenant = {};
    const byWorkspace = {};
    const bySubscription = {};

    for (const vm of metrics) {
        // By tenant
        byTenant[vm.tenantName] = (byTenant[vm.tenantName] || 0) + 1;

        // By workspace
        const wsKey = `${vm.tenantName}/${vm.workspaceName}`;
        byWorkspace[wsKey] = (byWorkspace[wsKey] || 0) + 1;

        // By subscription
        bySubscription[vm.SubscriptionId] = (bySubscription[vm.SubscriptionId] || 0) + 1;
    }

    return {
        totalVMs: metrics.length,
        tenantCount: tenantConfigs.length,
        workspaceCount: Object.keys(byWorkspace).length,
        subscriptionCount: Object.keys(bySubscription).length,
        byTenant: sortByValue(byTenant),
        byWorkspace: sortByValue(byWorkspace),
        bySubscription: sortByValue(bySubscription),
        queryDurationMs: duration
    };
}

/**
 * Execute a KQL query against Azure Log Analytics API.
 *
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {string} accessToken - OAuth2 bearer token
 * @param {string} query - KQL query string
 * @returns {Promise<Object>} Raw API response
 */
async function executeQuery(workspaceId, accessToken, query) {
    const response = await axios.post(
        `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
        { query },
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 300000
        }
    );
    return response.data;
}

/**
 * Parse Log Analytics query results from tabular format to array of objects.
 *
 * @param {Object} data - Raw Log Analytics API response
 * @returns {Array<Object>} Array of objects with column names as keys
 */
function parseQueryResults(data) {
    const tables = data.tables;
    if (!tables || tables.length === 0) {
        return [];
    }

    const columns = tables[0].columns.map(col => col.name);
    const rows = tables[0].rows;

    return rows.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
            obj[col] = row[index];
        });
        return obj;
    });
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

/**
 * Query a specific tenant by name or ID.
 *
 * @param {Array} tenantConfigs - All tenant configurations
 * @param {string} tenantIdentifier - Tenant name or ID to filter
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Results for the specific tenant
 */
async function queryTenantByName(tenantConfigs, tenantIdentifier, options = {}) {
    const tenant = tenantConfigs.find(t =>
        t.tenantName.toLowerCase() === tenantIdentifier.toLowerCase() ||
        t.tenantId === tenantIdentifier
    );

    if (!tenant) {
        throw new Error(`Tenant not found: ${tenantIdentifier}`);
    }

    const metrics = await queryTenant(tenant, options);

    return {
        metrics: metrics,
        summary: buildQuerySummary(metrics, [tenant], 0),
        tenant: {
            tenantId: tenant.tenantId,
            tenantName: tenant.tenantName
        }
    };
}

module.exports = {
    queryWorkspace,
    queryTenant,
    queryAllTenants,
    queryTenantByName,
    queryVMMetrics,
    executeQuery,
    parseQueryResults
};
