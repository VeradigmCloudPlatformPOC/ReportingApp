/**
 * @fileoverview Log Analytics Query Service - Short-Term
 *
 * This service handles KQL queries for periods ≤10 days with synchronous responses.
 * It enforces a maximum query duration of 10 days and provides optimized query execution.
 *
 * Constraints:
 * - Maximum time range: 10 days
 * - Query timeout: 60 seconds
 * - Maximum results: 1000 rows
 *
 * @version v11-microservices
 */

const axios = require('axios');
const { getLogAnalyticsToken, getTenantConfig } = require('../shared/multiTenantAuth');

// Service limits
const MAX_DAYS = 10;
const QUERY_TIMEOUT_MS = 60000;  // 60 seconds
const MAX_RESULTS = 1000;

/**
 * Sleep helper with optional jitter.
 */
function sleep(ms, addJitter = false) {
    const jitter = addJitter ? Math.random() * 1000 : 0;
    return new Promise(resolve => setTimeout(resolve, ms + jitter));
}

/**
 * Execute a KQL query against Log Analytics.
 *
 * @param {string} query - KQL query string
 * @param {Object} options - Query options
 * @param {string} options.tenantId - Tenant ID or name
 * @param {string} options.workspaceId - Override workspace ID
 * @param {string} options.subscriptionId - Target subscription ID
 * @param {number} options.maxResults - Max results (default: 1000)
 * @param {number} options.timeoutMs - Query timeout (default: 60000)
 * @returns {Promise<Object>} Query results
 */
async function executeKqlQuery(query, options = {}) {
    const startTime = Date.now();

    // Get tenant configuration
    const tenantConfig = getTenantConfig(options.tenantId);
    if (!tenantConfig) {
        throw new Error(`Tenant not found: ${options.tenantId}`);
    }

    const workspaceId = options.workspaceId || tenantConfig.workspaceId;
    if (!workspaceId) {
        throw new Error('No workspace ID configured for this tenant');
    }

    const maxResults = Math.min(options.maxResults || MAX_RESULTS, MAX_RESULTS);
    const timeoutMs = Math.min(options.timeoutMs || QUERY_TIMEOUT_MS, QUERY_TIMEOUT_MS);

    // Get access token
    const accessToken = await getLogAnalyticsToken(tenantConfig);

    // Apply result limit if not present
    let finalQuery = query;
    const queryLower = query.toLowerCase();
    if (!queryLower.includes('| take ') && !queryLower.includes('| limit ')) {
        finalQuery = `${query}\n| take ${maxResults}`;
    }

    try {
        const response = await axios.post(
            `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
            { query: finalQuery },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: timeoutMs
            }
        );

        const results = parseQueryResults(response.data);
        const columns = response.data.tables?.[0]?.columns?.map(c => c.name) || [];

        return {
            success: true,
            query: finalQuery,
            rowCount: results.length,
            columns,
            results: results.slice(0, maxResults),
            truncated: results.length >= maxResults,
            executionTimeMs: Date.now() - startTime,
            tenantId: tenantConfig.tenantId,
            workspaceId
        };

    } catch (error) {
        console.error('[LogAnalytics] Query execution error:', error.message);

        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return {
                success: false,
                error: 'QUERY_TIMEOUT',
                message: `Query timed out after ${timeoutMs}ms`,
                executionTimeMs: Date.now() - startTime
            };
        }

        if (error.response?.status === 400) {
            return {
                success: false,
                error: 'QUERY_SYNTAX_ERROR',
                message: 'Query syntax error: ' + (error.response.data?.error?.message || 'Unknown'),
                details: error.response.data?.error,
                executionTimeMs: Date.now() - startTime
            };
        }

        if (error.response?.status === 429) {
            return {
                success: false,
                error: 'RATE_LIMIT',
                message: 'Query rate limit exceeded. Please try again later.',
                executionTimeMs: Date.now() - startTime
            };
        }

        return {
            success: false,
            error: 'QUERY_EXECUTION_FAILED',
            message: error.message,
            executionTimeMs: Date.now() - startTime
        };
    }
}

/**
 * Query VM metrics for a specific period (≤10 days).
 *
 * @param {Object} options - Query options
 * @param {string} options.vmName - VM name to query
 * @param {number} options.days - Number of days (max 10)
 * @param {string} options.tenantId - Tenant ID
 * @param {string} options.subscriptionId - Subscription ID
 * @returns {Promise<Object>} VM metrics
 */
async function queryVMMetrics(options = {}) {
    const { vmName, days = 7, tenantId, subscriptionId } = options;

    // Enforce 10-day limit
    const queryDays = Math.min(days, MAX_DAYS);

    if (!vmName) {
        throw new Error('VM name is required');
    }

    // Escape VM name for KQL
    const escapedVmName = vmName.replace(/'/g, "''").replace(/"/g, '\\"');

    // Build subscription filter if provided (use 'has' for indexed term lookup - more efficient than 'contains')
    const subscriptionFilter = subscriptionId
        ? `| where _ResourceId has "${subscriptionId}"`
        : '';

    const query = `
        let vmName = "${escapedVmName}";
        let timeRange = ${queryDays}d;

        // CPU Metrics - time filter first for efficiency
        let cpuMetrics = Perf
            | where TimeGenerated >= ago(timeRange)
            ${subscriptionFilter}
            | where ObjectName == "Processor" and CounterName == "% Processor Time"
            | where Computer has vmName
            | summarize
                CPU_Avg = round(avg(CounterValue), 2),
                CPU_Max = round(max(CounterValue), 2),
                CPU_P95 = round(percentile(CounterValue, 95), 2),
                CPU_SampleCount = count()
                by Computer
            | top 1 by CPU_SampleCount desc;

        // Memory Metrics
        let memMetrics = Perf
            | where TimeGenerated >= ago(timeRange)
            ${subscriptionFilter}
            | where ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")
            | where Computer has vmName
            | summarize
                Memory_Avg = round(avg(CounterValue), 2),
                Memory_Max = round(max(CounterValue), 2),
                Memory_P95 = round(percentile(CounterValue, 95), 2),
                Memory_SampleCount = count()
                by Computer
            | top 1 by Memory_SampleCount desc;

        // Disk Metrics
        let diskMetrics = Perf
            | where TimeGenerated >= ago(timeRange)
            ${subscriptionFilter}
            | where ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec"
            | where Computer has vmName
            | summarize
                Disk_IOPS_Avg = round(avg(CounterValue), 2),
                Disk_IOPS_Max = round(max(CounterValue), 2),
                Disk_SampleCount = count()
                by Computer
            | top 1 by Disk_SampleCount desc;

        // Combine all metrics
        cpuMetrics
        | join kind=leftouter (memMetrics) on Computer
        | join kind=leftouter (diskMetrics) on Computer
        | project
            Computer,
            CPU_Avg,
            CPU_Max,
            CPU_P95,
            CPU_SampleCount,
            Memory_Avg,
            Memory_Max,
            Memory_P95,
            Memory_SampleCount,
            Disk_IOPS_Avg,
            Disk_IOPS_Max,
            Disk_SampleCount
    `;

    return executeKqlQuery(query, { tenantId, subscriptionId });
}

/**
 * Query VMs with high resource usage.
 *
 * @param {Object} options - Query options
 * @param {string} options.metric - 'cpu' or 'memory'
 * @param {number} options.threshold - Usage threshold percentage
 * @param {number} options.days - Number of days (max 10)
 * @param {string} options.tenantId - Tenant ID
 * @param {string} options.subscriptionId - Subscription ID
 * @returns {Promise<Object>} VMs exceeding threshold
 */
async function queryHighUsageVMs(options = {}) {
    const { metric = 'cpu', threshold = 80, days = 7, tenantId, subscriptionId } = options;

    // Enforce 10-day limit
    const queryDays = Math.min(days, MAX_DAYS);

    let counterName, objectName;
    if (metric.toLowerCase() === 'cpu') {
        objectName = 'Processor';
        counterName = '% Processor Time';
    } else if (metric.toLowerCase() === 'memory') {
        objectName = 'Memory';
        counterName = '% Committed Bytes In Use", "% Used Memory';
    } else {
        throw new Error('Invalid metric. Use "cpu" or "memory".');
    }

    // Build subscription filter if provided (use 'has' for indexed term lookup - more efficient than 'contains')
    const subscriptionFilter = subscriptionId
        ? `| where _ResourceId has "${subscriptionId}"`
        : '';

    const query = `
        Perf
        | where TimeGenerated >= ago(${queryDays}d)
        ${subscriptionFilter}
        | where ObjectName == "${objectName}"
        | where CounterName in ("${counterName}")
        | summarize
            AvgValue = round(avg(CounterValue), 2),
            MaxValue = round(max(CounterValue), 2),
            P95Value = round(percentile(CounterValue, 95), 2),
            SampleCount = count()
            by Computer
        | where MaxValue >= ${threshold}
        | order by MaxValue desc
        | take 50
    `;

    return executeKqlQuery(query, { tenantId, subscriptionId });
}

/**
 * Get recent heartbeat data for VMs.
 *
 * @param {Object} options - Query options
 * @param {number} options.hours - Hours to look back (max 240 = 10 days)
 * @param {string} options.tenantId - Tenant ID
 * @param {string} options.subscriptionId - Subscription ID for filtering
 * @returns {Promise<Object>} Heartbeat data
 */
async function queryHeartbeat(options = {}) {
    const { hours = 24, tenantId, subscriptionId } = options;

    // Convert hours to days and enforce 10-day limit
    const queryHours = Math.min(hours, MAX_DAYS * 24);

    // Build subscription filter if provided (use 'has' for indexed term lookup - more efficient than 'contains')
    const subscriptionFilter = subscriptionId
        ? `| where _ResourceId has "${subscriptionId}"`
        : '';

    const query = `
        Heartbeat
        | where TimeGenerated >= ago(${queryHours}h)
        ${subscriptionFilter}
        | summarize
            LastHeartbeat = max(TimeGenerated),
            HeartbeatCount = count(),
            OSType = take_any(OSType),
            ComputerEnvironment = take_any(ComputerEnvironment)
            by Computer
        | extend
            MinutesSinceLastHeartbeat = datetime_diff('minute', now(), LastHeartbeat),
            Status = case(
                datetime_diff('minute', now(), LastHeartbeat) <= 5, "Online",
                datetime_diff('minute', now(), LastHeartbeat) <= 15, "Warning",
                "Offline"
            )
        | order by MinutesSinceLastHeartbeat asc
        | take 100
    `;

    return executeKqlQuery(query, { tenantId, subscriptionId });
}

/**
 * Parse Log Analytics query results into array of objects.
 */
function parseQueryResults(data) {
    const tables = data.tables;
    if (!tables || tables.length === 0) {
        return [];
    }

    const columns = tables[0].columns.map(col => col.name);
    const rows = tables[0].rows || [];

    return rows.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
            obj[col] = row[index];
        });
        return obj;
    });
}

/**
 * Validate that a query's time range does not exceed 10 days.
 *
 * @param {string} query - KQL query
 * @returns {Object} Validation result
 */
function validateTimeRange(query) {
    // Extract ago() expressions
    const agoPattern = /ago\s*\(\s*(\d+)\s*([dh])\s*\)/gi;
    let match;
    let maxDays = 0;

    while ((match = agoPattern.exec(query)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        let days = unit === 'd' ? value : value / 24;
        maxDays = Math.max(maxDays, days);
    }

    // Check for between expressions
    const betweenPattern = /between\s*\(\s*ago\s*\(\s*(\d+)\s*([dh])\s*\)/gi;
    while ((match = betweenPattern.exec(query)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        let days = unit === 'd' ? value : value / 24;
        maxDays = Math.max(maxDays, days);
    }

    const isValid = maxDays <= MAX_DAYS;

    return {
        valid: isValid,
        maxDays,
        limit: MAX_DAYS,
        message: isValid
            ? null
            : `Query time range (${maxDays.toFixed(1)} days) exceeds maximum of ${MAX_DAYS} days. Use the long-term service for queries >10 days.`
    };
}

module.exports = {
    executeKqlQuery,
    queryVMMetrics,
    queryHighUsageVMs,
    queryHeartbeat,
    parseQueryResults,
    validateTimeRange,
    MAX_DAYS,
    QUERY_TIMEOUT_MS,
    MAX_RESULTS
};
