/**
 * @fileoverview Metrics Collector Service
 *
 * Collects VM performance metrics via batched KQL queries.
 * Optimized for large subscriptions (300+ VMs) with:
 * - Batched queries (50 VMs per batch)
 * - Concurrent execution (max 3 parallel queries)
 * - Pre-aggregation for efficiency
 *
 * @version v11-microservices
 */

const axios = require('axios');
const { getLogAnalyticsToken, getTenantConfig, initializeAuth } = require('../shared/multiTenantAuth');
const {
    escapeKqlString,
    escapeVmName,
    validateTimeRange
} = require('../shared/securityUtils');

// Auth initialization flag
let authInitialized = false;

const MAX_VMS_PER_BATCH = 50;
const MAX_CONCURRENT_QUERIES = 3;
const QUERY_TIMEOUT_MS = 180000; // 3 minutes per batch

// Service URLs (must be configured via environment variables)
const RESOURCE_GRAPH_SERVICE_URL = process.env.RESOURCE_GRAPH_SERVICE_URL;

/**
 * Collect VM inventory and performance metrics.
 *
 * @param {Object} options - Collection options
 * @param {string} options.subscriptionId - Target subscription
 * @param {string} options.tenantId - Tenant ID
 * @param {number} options.timeRangeDays - Analysis period (default: 30)
 * @param {string} options.workspaceId - Log Analytics workspace ID
 * @param {string} options.resourceGraphServiceUrl - App 1 URL
 * @param {number} options.maxVMs - Maximum VMs to analyze (for quick mode)
 * @param {Function} options.progressCallback - Optional progress callback
 * @returns {Promise<Object>} Inventory and metrics
 */
async function collectMetrics(options) {
    const {
        subscriptionId,
        tenantId,
        timeRangeDays = 30,
        workspaceId,
        resourceGraphServiceUrl,
        maxVMs,
        progressCallback
    } = options;

    console.log(`[MetricsCollector] Collecting data for subscription ${subscriptionId}`);
    console.log(`  Time range: ${timeRangeDays} days`);
    console.log(`  Workspace: ${workspaceId || 'not specified'}`);

    try {
        // Step 1: Get VM inventory from App 1 (Resource Graph Service)
        const serviceUrl = resourceGraphServiceUrl || RESOURCE_GRAPH_SERVICE_URL;
        console.log(`[MetricsCollector] Fetching VM inventory from ${serviceUrl}...`);

        if (progressCallback) {
            progressCallback({ phase: 'inventory', message: 'Fetching VM inventory...' });
        }

        const inventory = await getVMInventory(subscriptionId, tenantId, serviceUrl);

        if (!inventory || inventory.length === 0) {
            return {
                success: false,
                error: 'No VMs found in subscription'
            };
        }

        console.log(`[MetricsCollector] Found ${inventory.length} VMs`);

        // Limit if maxVMs specified
        const vmsToAnalyze = maxVMs ? inventory.slice(0, maxVMs) : inventory;

        // Step 2: Collect performance metrics via batched KQL
        if (progressCallback) {
            progressCallback({
                phase: 'metrics',
                message: `Collecting ${timeRangeDays}-day metrics for ${vmsToAnalyze.length} VMs...`,
                totalVMs: vmsToAnalyze.length
            });
        }

        const metrics = await collectBatchedMetrics(
            vmsToAnalyze,
            timeRangeDays,
            workspaceId,
            progressCallback,
            tenantId,
            subscriptionId
        );

        return {
            success: true,
            inventory: vmsToAnalyze,
            metrics,
            vmCount: vmsToAnalyze.length,
            metricsCount: metrics.size,
            timeRangeDays
        };

    } catch (error) {
        console.error('[MetricsCollector] Error:', error.message);
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get VM inventory from Resource Graph Service (App 1).
 */
async function getVMInventory(subscriptionId, tenantId, serviceUrl) {
    try {
        const url = serviceUrl || RESOURCE_GRAPH_SERVICE_URL;
        const response = await axios.post(
            `${url}/api/resources/vms`,
            {
                subscriptionId,
                tenantId,
                includeMetrics: false
            },
            { timeout: 60000 }
        );

        if (response.data.success && response.data.vms) {
            return response.data.vms;
        }

        // Fallback: try legacy format
        return response.data.vms || response.data || [];

    } catch (error) {
        console.error('[MetricsCollector] Failed to get inventory:', error.message);
        throw new Error(`Failed to get VM inventory: ${error.message}`);
    }
}

/**
 * Collect performance metrics via batched KQL queries.
 *
 * @param {Array} vms - VMs to collect metrics for
 * @param {number} timeRangeDays - Time range in days
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {Function} progressCallback - Optional progress callback
 * @param {string} tenantId - Optional tenant ID for auth
 * @param {string} subscriptionId - Optional subscription ID for filtering
 * @returns {Promise<Map>} Map of VM name -> metrics
 */
async function collectBatchedMetrics(vms, timeRangeDays, workspaceId, progressCallback = null, tenantId = null, subscriptionId = null) {
    if (!workspaceId) {
        console.warn('[MetricsCollector] No Log Analytics workspace configured');
        return new Map();
    }

    // Get tenant config for service principal auth
    const tenantConfig = getTenantConfig(tenantId);
    if (!tenantConfig) {
        console.error('[MetricsCollector] No tenant configuration found');
        return new Map();
    }

    // Get access token using service principal
    let accessToken;
    try {
        accessToken = await getLogAnalyticsToken(tenantConfig);
    } catch (error) {
        console.error('[MetricsCollector] Failed to get access token:', error.message);
        return new Map();
    }

    // Create batches
    const batches = [];
    for (let i = 0; i < vms.length; i += MAX_VMS_PER_BATCH) {
        batches.push({
            index: batches.length,
            vms: vms.slice(i, i + MAX_VMS_PER_BATCH)
        });
    }

    console.log(`[MetricsCollector] Processing ${batches.length} batches (${vms.length} VMs)...`);

    // Execute batches with concurrency limit
    const metricsMap = new Map();
    const executing = new Set();
    let completedBatches = 0;

    for (const batch of batches) {
        const promise = executeBatchQuery(accessToken, workspaceId, batch.vms, timeRangeDays, subscriptionId)
            .then(results => {
                for (const row of results) {
                    const vmName = row.Computer?.toLowerCase();
                    if (vmName) {
                        metricsMap.set(vmName, row);
                    }
                }
                completedBatches++;
                if (progressCallback) {
                    progressCallback({
                        phase: 'metrics',
                        message: `Processed batch ${completedBatches}/${batches.length}`,
                        completedBatches,
                        totalBatches: batches.length,
                        vmsProcessed: Math.min(completedBatches * MAX_VMS_PER_BATCH, vms.length)
                    });
                }
                executing.delete(promise);
            })
            .catch(error => {
                console.error(`[MetricsCollector] Batch ${batch.index} failed:`, error.message);
                completedBatches++;
                executing.delete(promise);
            });

        executing.add(promise);

        if (executing.size >= MAX_CONCURRENT_QUERIES) {
            await Promise.race(executing);
        }
    }

    await Promise.all(executing);

    console.log(`[MetricsCollector] Collected metrics for ${metricsMap.size} VMs`);
    return metricsMap;
}

/**
 * Execute a single batch KQL query using REST API with service principal auth.
 *
 * @param {string} accessToken - OAuth2 access token
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {Array} vmBatch - Batch of VMs to query
 * @param {number} timeRangeDays - Time range in days
 * @param {string} subscriptionId - Optional subscription ID for filtering
 * @returns {Promise<Array>} Query results
 */
async function executeBatchQuery(accessToken, workspaceId, vmBatch, timeRangeDays, subscriptionId = null) {
    // Securely escape all VM names to prevent KQL injection
    const vmNames = vmBatch.map(vm => vm.vmName || vm.name);
    const escapedNames = vmNames.map(name => {
        try {
            return `"${escapeKqlString(name)}"`;
        } catch (e) {
            console.warn(`[MetricsCollector] Skipping invalid VM name: ${name}`);
            return null;
        }
    }).filter(Boolean);

    if (escapedNames.length === 0) {
        return [];
    }

    // Validate time range
    const validatedDays = validateTimeRange(timeRangeDays, 90);

    // Build subscription filter if provided (use 'has' for indexed term lookup - more efficient than 'contains')
    const subscriptionFilter = subscriptionId
        ? `| where _ResourceId has "${escapeKqlString(subscriptionId)}"`
        : '';

    const query = `
let vmList = dynamic([${escapedNames.join(', ')}]);
let timeRange = ${validatedDays}d;

let cpuMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    ${subscriptionFilter}
    | where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
    | where Computer has_any (vmList)
    | summarize
        CPU_Avg = round(avg(CounterValue), 2),
        CPU_Max = round(max(CounterValue), 2),
        CPU_P95 = round(percentile(CounterValue, 95), 2),
        CPU_SampleCount = count()
        by Computer;

let memMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    ${subscriptionFilter}
    | where ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")
    | where Computer has_any (vmList)
    | summarize
        Memory_Avg = round(avg(CounterValue), 2),
        Memory_Max = round(max(CounterValue), 2),
        Memory_P95 = round(percentile(CounterValue, 95), 2),
        Memory_SampleCount = count()
        by Computer;

cpuMetrics
| join kind=leftouter (memMetrics) on Computer
| project
    Computer,
    CPU_Avg,
    CPU_Max,
    CPU_P95,
    CPU_SampleCount,
    Memory_Avg = coalesce(Memory_Avg, 0.0),
    Memory_Max = coalesce(Memory_Max, 0.0),
    Memory_P95 = coalesce(Memory_P95, 0.0),
    Memory_SampleCount = coalesce(Memory_SampleCount, 0)
`;

    try {
        console.log(`[MetricsCollector] Executing query against workspace ${workspaceId}...`);
        const response = await axios.post(
            `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
            { query },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: QUERY_TIMEOUT_MS
            }
        );

        if (response.data?.tables?.[0]) {
            const results = parseRestApiResults(response.data);
            console.log(`[MetricsCollector] Query returned ${results.length} rows`);
            return results;
        }

        console.log('[MetricsCollector] Query returned empty tables');
        return [];

    } catch (error) {
        console.error('[MetricsCollector] Query failed:', error.message);
        if (error.response) {
            console.error('[MetricsCollector] Response status:', error.response.status);
            console.error('[MetricsCollector] Response data:', JSON.stringify(error.response.data).slice(0, 500));
        }
        return [];
    }
}

/**
 * Get metrics for a single VM using REST API with service principal auth.
 *
 * @param {string} vmName - VM name to query
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {number} timeRangeDays - Time range in days
 * @param {string} tenantId - Optional tenant ID for auth
 * @param {string} subscriptionId - Optional subscription ID for filtering
 * @returns {Promise<Object>} VM metrics
 */
async function getVMMetrics(vmName, workspaceId, timeRangeDays = 30, tenantId = null, subscriptionId = null) {
    if (!workspaceId) {
        throw new Error('Log Analytics workspace ID is required');
    }

    // Get tenant config for service principal auth
    const tenantConfig = getTenantConfig(tenantId);
    if (!tenantConfig) {
        throw new Error('No tenant configuration found');
    }

    // Get access token
    const accessToken = await getLogAnalyticsToken(tenantConfig);

    // Securely escape VM name to prevent KQL injection
    const escapedVmName = escapeVmName(vmName);
    const validatedDays = validateTimeRange(timeRangeDays, 90);

    // Build subscription filter if provided (use 'has' for indexed term lookup - more efficient than 'contains')
    const subscriptionFilter = subscriptionId
        ? `| where _ResourceId has "${escapeKqlString(subscriptionId)}"`
        : '';

    const query = `
let vmName = "${escapedVmName}";
let timeRange = ${validatedDays}d;

let cpuMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    ${subscriptionFilter}
    | where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
    | where Computer has vmName
    | summarize
        CPU_Avg = round(avg(CounterValue), 2),
        CPU_Max = round(max(CounterValue), 2),
        CPU_P95 = round(percentile(CounterValue, 95), 2),
        CPU_Min = round(min(CounterValue), 2),
        CPU_SampleCount = count(),
        FirstSeen = min(TimeGenerated),
        LastSeen = max(TimeGenerated)
        by Computer
    | top 1 by CPU_SampleCount desc;

let memMetrics = Perf
    | where TimeGenerated >= ago(timeRange)
    ${subscriptionFilter}
    | where ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")
    | where Computer has vmName
    | summarize
        Memory_Avg = round(avg(CounterValue), 2),
        Memory_Max = round(max(CounterValue), 2),
        Memory_P95 = round(percentile(CounterValue, 95), 2),
        Memory_Min = round(min(CounterValue), 2),
        Memory_SampleCount = count()
        by Computer
    | top 1 by Memory_SampleCount desc;

cpuMetrics
| join kind=leftouter (memMetrics) on Computer
| project
    Computer,
    CPU_Avg, CPU_Max, CPU_P95, CPU_Min, CPU_SampleCount,
    Memory_Avg = coalesce(Memory_Avg, 0.0),
    Memory_Max = coalesce(Memory_Max, 0.0),
    Memory_P95 = coalesce(Memory_P95, 0.0),
    Memory_Min = coalesce(Memory_Min, 0.0),
    Memory_SampleCount = coalesce(Memory_SampleCount, 0),
    FirstSeen, LastSeen
`;

    const response = await axios.post(
        `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
        { query },
        {
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Content-Type': 'application/json'
            },
            timeout: 120000
        }
    );

    if (response.data?.tables?.[0]?.rows?.length > 0) {
        const results = parseRestApiResults(response.data);
        return results[0] || null;
    }

    return null;
}

/**
 * Parse REST API KQL query results into objects.
 * Handles the Log Analytics REST API response format.
 *
 * @param {Object} data - REST API response data
 * @returns {Array} Array of result objects
 */
function parseRestApiResults(data) {
    const tables = data.tables;
    if (!tables || tables.length === 0) {
        return [];
    }

    const table = tables[0];
    const columns = table.columns.map(col => col.name);
    const rows = table.rows || [];

    return rows.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
            obj[col] = row[index];
        });
        return obj;
    });
}

/**
 * Parse KQL query results into objects (legacy format).
 */
function parseQueryResults(table) {
    const columns = table.columns.map(c => c.name);
    return table.rows.map(row => {
        const obj = {};
        columns.forEach((col, i) => {
            obj[col] = row[i];
        });
        return obj;
    });
}

/**
 * Convert metrics Map to array for JSON serialization.
 */
function metricsMapToArray(metricsMap) {
    const result = [];
    for (const [vmName, metrics] of metricsMap) {
        result.push({
            vmName,
            ...metrics
        });
    }
    return result;
}

module.exports = {
    collectMetrics,
    getVMInventory,
    collectBatchedMetrics,
    getVMMetrics,
    metricsMapToArray,
    MAX_VMS_PER_BATCH,
    MAX_CONCURRENT_QUERIES
};
