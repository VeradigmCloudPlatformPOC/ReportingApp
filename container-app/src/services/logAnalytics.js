/**
 * @fileoverview Log Analytics Query Service
 *
 * This module handles querying Azure Log Analytics for VM performance metrics.
 * It implements parallel batch processing with throttling protection to efficiently
 * handle up to 2000 VMs.
 *
 * Key Features:
 * - Parallel KQL query execution (3 batches concurrently)
 * - Exponential backoff retry logic for rate limit handling
 * - 30-day performance data aggregation
 * - Microsoft Azure Advisor aligned metrics collection
 *
 * Performance Metrics Collected:
 * - CPU: % Processor Time (Avg, Max)
 * - Memory: % Committed Bytes In Use, % Used Memory (Avg, Max)
 * - Disk: Disk Bytes/sec, Disk Transfers/sec (Avg, Max)
 *
 * @version v6-parallel
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');

/**
 * Sleep helper with optional jitter for throttling protection.
 * Jitter helps prevent thundering herd problem when multiple
 * requests are retried simultaneously.
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
 * Query Log Analytics for VM Performance Metrics
 *
 * This is the main entry point for collecting VM performance data from Azure
 * Log Analytics. It uses a two-step process:
 *
 * Step 1: Get list of VMs in the target subscription
 * Step 2: Query metrics for VMs in parallel batches
 *
 * Parallel Processing Strategy:
 * - VMs are grouped into batches of 30
 * - 3 batches are processed in parallel (90 VMs concurrently)
 * - 2-second delay between parallel groups to avoid rate limits
 *
 * @param {Object} secrets - Azure credentials and configuration
 * @param {string} secrets.LogAnalyticsWorkspaceId - Log Analytics workspace ID
 * @param {string} secrets.LogAnalyticsClientId - Service principal client ID
 * @param {string} secrets.LogAnalyticsClientSecret - Service principal secret
 * @param {string} secrets.LogAnalyticsTenantId - Azure AD tenant ID
 * @param {string} secrets.TargetSubscriptionId - Default subscription (fallback)
 * @param {Object} options - Optional parameters
 * @param {string} options.subscriptionId - Override subscription ID (from user selection)
 * @param {string} options.workspaceId - Override Log Analytics workspace ID (from tenant config)
 * @param {string} options.tenantId - Override Azure AD tenant ID for OAuth (from tenant config)
 * @returns {Promise<Array>} Array of VM metrics objects
 */
async function queryLogAnalytics(secrets, options = {}) {
    // Use workspace from options if provided (per-tenant), otherwise fall back to Key Vault default
    const workspaceId = options.workspaceId || secrets.LogAnalyticsWorkspaceId;
    const clientId = secrets.LogAnalyticsClientId;
    const clientSecret = secrets.LogAnalyticsClientSecret;
    // Use tenant-specific Azure AD tenant ID for OAuth if provided
    const tenantId = options.tenantId || secrets.LogAnalyticsTenantId;
    // Use subscription from options if provided, otherwise fall back to Key Vault default
    const targetSubscription = options.subscriptionId || secrets.TargetSubscriptionId;

    console.log(`  Querying Log Analytics for VMs in subscription: ${targetSubscription}`);
    console.log(`  Using workspace: ${workspaceId}`);
    console.log(`  Authenticating to tenant: ${tenantId}`);

    // Get OAuth token
    const tokenResponse = await axios.post(
        `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
        new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://api.loganalytics.io/.default'
        }),
        {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        }
    );

    const accessToken = tokenResponse.data.access_token;

    // Step 1: Get list of VMs in the subscription (quick query)
    console.log(`  Step 1: Getting list of VMs...`);
    const vmListQuery = `
        Perf
        | where TimeGenerated >= ago(30d)
        | where _ResourceId contains "${targetSubscription}"
        | where ObjectName == "Processor" and CounterName == "% Processor Time"
        | distinct Computer, _ResourceId
        | extend ResourceGroup = tostring(split(_ResourceId, "/")[4])
        | extend SubscriptionId = tostring(split(_ResourceId, "/")[2])
        | where SubscriptionId == "${targetSubscription}"
        | project VMName = Computer, ResourceId = _ResourceId, ResourceGroup, SubscriptionId
    `;

    const vmListResponse = await executeQuery(workspaceId, accessToken, vmListQuery);
    const vmList = parseQueryResults(vmListResponse);

    if (vmList.length === 0) {
        console.log('  No VMs found in subscription');
        return [];
    }

    console.log(`  Found ${vmList.length} VMs in subscription`);

    // =========================================================================
    // STEP 2: Batch VMs for Parallel Processing
    // =========================================================================
    // Configuration tuned for Azure Log Analytics rate limits:
    // - VM_BATCH_SIZE=30: Max VMs per KQL query (prevents query timeout)
    // - PARALLEL_BATCHES=3: Concurrent queries (3x throughput vs sequential)
    // - DELAY=2000ms: Prevents hitting rate limits between parallel groups
    //
    // Example with 180 VMs:
    //   Batches: [30, 30, 30, 30, 30, 30] = 6 batches
    //   Parallel groups: [[30,30,30], [30,30,30]] = 2 groups
    //   Total time: ~6 seconds (vs ~18 seconds sequential)
    // =========================================================================
    const VM_BATCH_SIZE = 30;       // VMs per KQL query
    const PARALLEL_BATCHES = 3;     // Concurrent queries per group
    const DELAY_BETWEEN_PARALLEL_GROUPS_MS = 2000; // Delay between groups (+ jitter)

    // Split VM list into batches
    const vmBatches = [];
    for (let i = 0; i < vmList.length; i += VM_BATCH_SIZE) {
        vmBatches.push(vmList.slice(i, i + VM_BATCH_SIZE));
    }

    console.log(`  Step 2: Querying metrics in ${vmBatches.length} VM batches (${VM_BATCH_SIZE} VMs per batch, ${PARALLEL_BATCHES} parallel)`);
    console.log(`  Analysis period: Last 30 days`);

    const allMetrics = [];

    /**
     * Process a single batch of VMs with retry logic.
     * Implements exponential backoff for rate limit handling (429 errors).
     *
     * Retry Strategy:
     * - Attempt 1: Immediate
     * - Attempt 2: Wait 10s (5s * 2^1)
     * - Attempt 3: Wait 20s (5s * 2^2)
     * - Max wait: 60s (capped)
     *
     * @param {Array} batch - Array of VM objects to process
     * @param {number} batchIndex - Current batch index (0-based)
     * @param {number} totalBatches - Total number of batches
     * @returns {Promise<Array>} Array of VM metrics for this batch
     */
    async function processBatch(batch, batchIndex, totalBatches) {
        const vmNames = batch.map(vm => vm.VMName);
        console.log(`    Querying batch ${batchIndex + 1}/${totalBatches} (${batch.length} VMs)...`);

        let metrics = null;
        let lastError = null;
        const maxRetries = 3;

        // Retry loop with exponential backoff
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                metrics = await queryVMMetrics(workspaceId, accessToken, vmNames, targetSubscription);
                break; // Success - exit retry loop
            } catch (error) {
                lastError = error;
                // Handle rate limiting (429) or connection timeout
                if (error.response?.status === 429 || error.code === 'ECONNABORTED') {
                    // Exponential backoff: 10s, 20s, 40s (max 60s)
                    const retryDelay = Math.min(Math.pow(2, attempt) * 5000, 60000);
                    console.log(`      Batch ${batchIndex + 1}: Rate limited, retry ${attempt}/${maxRetries} after ${retryDelay/1000}s...`);
                    await sleep(retryDelay, true); // Add jitter to prevent thundering herd
                } else if (attempt < maxRetries) {
                    // Other errors - retry with fixed 5s delay
                    console.log(`      Batch ${batchIndex + 1}: Error, retrying after 5s: ${error.message}`);
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
            console.log(`      Batch ${batchIndex + 1}: Found metrics for ${metrics.length} VMs`);
            return results;
        } else {
            console.error(`      Batch ${batchIndex + 1}: Error after ${maxRetries} retries: ${lastError?.message}`);
            return [];
        }
    }

    // =========================================================================
    // PARALLEL GROUP PROCESSING
    // =========================================================================
    // Process batches in groups of PARALLEL_BATCHES (3) concurrently.
    // This provides 3x throughput while staying within API rate limits.
    //
    // Flow:
    // 1. Take 3 batches from the queue
    // 2. Execute all 3 in parallel using Promise.all()
    // 3. Wait 2 seconds before starting next group
    // 4. Repeat until all batches are processed
    // =========================================================================
    for (let i = 0; i < vmBatches.length; i += PARALLEL_BATCHES) {
        const parallelGroup = vmBatches.slice(i, i + PARALLEL_BATCHES);
        const groupNum = Math.floor(i / PARALLEL_BATCHES) + 1;
        const totalGroups = Math.ceil(vmBatches.length / PARALLEL_BATCHES);
        console.log(`    Processing parallel group ${groupNum}/${totalGroups} (${parallelGroup.length} batches)...`);

        // Execute all batches in this group concurrently
        // Promise.all() waits for all promises to resolve
        const promises = parallelGroup.map((batch, idx) =>
            processBatch(batch, i + idx, vmBatches.length)
        );
        const results = await Promise.all(promises);

        // Aggregate results from all parallel batches
        for (const batchResults of results) {
            allMetrics.push(...batchResults);
        }

        // Rate limit protection: delay between parallel groups
        // Prevents overwhelming the Log Analytics API
        if (i + PARALLEL_BATCHES < vmBatches.length) {
            console.log(`      Waiting ${DELAY_BETWEEN_PARALLEL_GROUPS_MS/1000}s before next parallel group...`);
            await sleep(DELAY_BETWEEN_PARALLEL_GROUPS_MS, true);
        }
    }

    console.log(`  Total VMs with metrics: ${allMetrics.length}`);

    // Sort by VM name
    allMetrics.sort((a, b) => a.VMName.localeCompare(b.VMName));

    return allMetrics;
}

/**
 * Query metrics for a batch of VMs using optimized single-scan KQL query.
 *
 * This query is designed to:
 * 1. Scan the Perf table only once for all metrics
 * 2. Use avgif/maxif for conditional aggregation (efficient)
 * 3. Support both Windows and Linux counter names
 * 4. Filter by subscription ID for optimized query performance
 *
 * Metrics Collected (30-day aggregation):
 * - CPU: % Processor Time (Avg, Max) - from _Total instance
 * - Memory: % Committed Bytes In Use, % Used Memory (Avg, Max)
 * - Disk: Disk Bytes/sec, Disk Transfers/sec (Avg, Max) - from _Total instance
 *
 * @param {string} workspaceId - Log Analytics workspace ID
 * @param {string} accessToken - OAuth2 bearer token
 * @param {Array<string>} vmNames - Array of VM computer names to query
 * @param {string} subscriptionId - Target subscription ID for filtering
 * @returns {Promise<Array>} Array of metric objects with Computer as key
 */
async function queryVMMetrics(workspaceId, accessToken, vmNames, subscriptionId) {
    // Escape single quotes in VM names to prevent KQL injection
    const vmListStr = vmNames.map(name => name.replace(/'/g, "''")).join("','");

    // KQL Query - Single-scan with conditional aggregation
    // Uses avgif/maxif for efficient multi-metric collection
    // Subscription filter applied early for optimized query performance
    const query = `
        Perf
        | where TimeGenerated >= ago(30d)
        | where _ResourceId contains "${subscriptionId}"
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
 * Execute a KQL query against Azure Log Analytics API.
 *
 * @param {string} workspaceId - Log Analytics workspace ID (GUID)
 * @param {string} accessToken - OAuth2 bearer token for authentication
 * @param {string} query - KQL query string to execute
 * @returns {Promise<Object>} Raw API response containing tables and rows
 * @throws {Error} On network error, authentication failure, or query error
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
            timeout: 300000 // 5 minute timeout for large queries
        }
    );
    return response.data;
}

/**
 * Parse Log Analytics query results from tabular format to array of objects.
 *
 * Log Analytics returns data in a tabular format:
 * {
 *   tables: [{
 *     columns: [{name: "Computer"}, {name: "AvgCPU"}, ...],
 *     rows: [["vm1", 45.2], ["vm2", 23.1], ...]
 *   }]
 * }
 *
 * This function converts it to:
 * [
 *   { Computer: "vm1", AvgCPU: 45.2, ... },
 *   { Computer: "vm2", AvgCPU: 23.1, ... }
 * ]
 *
 * @param {Object} data - Raw Log Analytics API response
 * @returns {Array<Object>} Array of objects with column names as keys
 */
function parseQueryResults(data) {
    const tables = data.tables;
    if (!tables || tables.length === 0) {
        return [];
    }

    // Extract column names from the first table
    const columns = tables[0].columns.map(col => col.name);
    const rows = tables[0].rows;

    // Transform each row into an object with column names as keys
    return rows.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
            obj[col] = row[index];
        });
        return obj;
    });
}

module.exports = { queryLogAnalytics };
