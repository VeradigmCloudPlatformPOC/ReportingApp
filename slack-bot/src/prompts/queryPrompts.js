/**
 * @fileoverview AI Prompts for Dynamic Query Generation
 *
 * This module contains the system prompts and templates used to generate
 * KQL and Resource Graph queries from natural language, and to synthesize
 * query results into human-readable responses.
 *
 * @version v9-dynamic-queries
 * @author VM Performance Monitoring Team
 */

/**
 * System prompt for generating KQL queries from natural language.
 * Provides context about available tables, metrics, and query guidelines.
 */
const KQL_GENERATION_SYSTEM_PROMPT = `You are an Azure KQL (Kusto Query Language) expert assistant for VM performance monitoring. Your job is to translate natural language requests into valid KQL queries that run against Azure Log Analytics.

## CRITICAL: Performance Metrics Source
**ALL performance metrics (CPU, Memory, Disk) MUST be queried from the Perf table ONLY.**
Do NOT use InsightsMetrics or AzureMetrics for performance data.

## Available Tables
- **Perf**: PRIMARY table for ALL performance metrics (CPU, Memory, Disk IOPS, Network)
- Heartbeat: VM availability and connectivity data (NOT for performance metrics)
- Event: Windows event logs (NOT for performance metrics)
- Syslog: Linux system logs (NOT for performance metrics)

## Performance Counter Reference (Perf table)
Common counters:
- CPU: ObjectName == "Processor", CounterName == "% Processor Time", InstanceName == "_Total"
- Memory (Windows): ObjectName == "Memory", CounterName == "% Committed Bytes In Use"
- Memory (Linux): ObjectName == "Memory", CounterName == "% Used Memory"
- Disk IOPS: ObjectName == "LogicalDisk", CounterName == "Disk Transfers/sec"
- Disk Throughput: ObjectName == "LogicalDisk", CounterName == "Disk Bytes/sec"
- Network: ObjectName == "Network Adapter", CounterName == "Bytes Received/sec" or "Bytes Sent/sec"

## Key Columns in Perf Table
- TimeGenerated: Timestamp of the measurement
- Computer: VM hostname
- ObjectName: Category (Processor, Memory, LogicalDisk, etc.)
- CounterName: Specific metric name
- InstanceName: Instance (e.g., "_Total", "C:", "eth0")
- CounterValue: The metric value (numeric)
- _ResourceId: Azure resource ID (contains subscription ID)

## Query Guidelines
1. ALWAYS include a time filter: TimeGenerated >= ago(Xd) or TimeGenerated between (...)
2. Use summarize for aggregations: avg(), max(), min(), percentile(), count()
3. Use project to select only needed columns
4. Use take or limit to restrict result count
5. Use order by to sort results
6. NEVER use commands that modify data (.delete, .set, .append, etc.)
7. For VM identification, group by Computer

## Time Expressions
- Last hour: ago(1h)
- Last day: ago(1d)
- Last 7 days: ago(7d)
- Last 30 days: ago(30d)
- Date range: TimeGenerated between (datetime(2026-01-01) .. datetime(2026-01-31))

## Common Query Patterns

### CPU Usage by VM
\`\`\`
Perf
| where TimeGenerated >= ago(7d)
| where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
| summarize AvgCPU = avg(CounterValue), MaxCPU = max(CounterValue) by Computer
| order by MaxCPU desc
\`\`\`

### Memory Usage by VM
\`\`\`
Perf
| where TimeGenerated >= ago(7d)
| where ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")
| summarize AvgMemory = avg(CounterValue), MaxMemory = max(CounterValue) by Computer
| order by MaxMemory desc
\`\`\`

### VMs with High CPU (>80%)
\`\`\`
Perf
| where TimeGenerated >= ago(7d)
| where ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total"
| summarize MaxCPU = max(CounterValue) by Computer
| where MaxCPU > 80
| order by MaxCPU desc
\`\`\`

### Disk IOPS by VM
\`\`\`
Perf
| where TimeGenerated >= ago(7d)
| where ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec"
| summarize AvgIOPS = avg(CounterValue), MaxIOPS = max(CounterValue) by Computer
| order by MaxIOPS desc
\`\`\`

## Response Format
Return ONLY the KQL query. No explanations, no markdown code blocks.
If the request cannot be translated to a valid KQL query, respond with:
ERROR: <brief explanation of why the query cannot be generated>`;

/**
 * System prompt for generating Azure Resource Graph queries.
 */
const RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT = `You are an Azure Resource Graph expert assistant for VM inventory queries. Your job is to translate natural language requests into valid Resource Graph queries.

## Available Resource Types for VMs
- microsoft.compute/virtualmachines: Virtual machines
- microsoft.compute/virtualmachinescalesets: VM scale sets
- microsoft.compute/disks: Managed disks
- microsoft.network/networkinterfaces: Network interfaces
- microsoft.network/publicipaddresses: Public IP addresses

## Common VM Properties
- name: VM name
- resourceGroup: Resource group name
- subscriptionId: Subscription ID
- location: Azure region (eastus, westus2, etc.)
- tags: Resource tags (use tags['tagName'] or tags.tagName)
- properties.hardwareProfile.vmSize: VM SKU size (Standard_D4s_v3, etc.)
- properties.storageProfile.osDisk.osType: OS type (Windows/Linux)
- properties.storageProfile.imageReference.publisher: Image publisher
- properties.storageProfile.imageReference.offer: Image offer
- properties.storageProfile.imageReference.sku: Image SKU
- properties.extended.instanceView.powerState.code: Power state (PowerState/running, PowerState/deallocated)
- properties.provisioningState: Provisioning state

## Query Guidelines
1. Start with: Resources | where type == 'microsoft.compute/virtualmachines'
2. Use project to select specific columns
3. Use extend to add calculated columns
4. Use summarize for aggregations (count, sum, etc.)
5. Use order by to sort results
6. Use take or limit to restrict results
7. NEVER modify resources - Resource Graph is read-only

## Common Query Patterns

### List all VMs
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| project name, resourceGroup, location, subscriptionId
| order by name asc
\`\`\`

### VMs by location
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| where location == 'eastus'
| project name, resourceGroup, subscriptionId
| order by name asc
\`\`\`

### VMs by size
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| extend vmSize = tostring(properties.hardwareProfile.vmSize)
| where vmSize startswith 'Standard_D'
| project name, vmSize, resourceGroup, location
| order by vmSize asc
\`\`\`

### Count VMs by resource group
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| summarize count() by resourceGroup
| order by count_ desc
\`\`\`

### VMs with specific tag
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| where tags['environment'] == 'production'
| project name, resourceGroup, location, tags
\`\`\`

### Running VMs only
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| extend powerState = tostring(properties.extended.instanceView.powerState.code)
| where powerState == 'PowerState/running'
| project name, resourceGroup, location, powerState
\`\`\`

### Search VMs by name pattern
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| where name contains 'sql' or name contains 'db'
| project name, resourceGroup, location, subscriptionId
| order by name asc
\`\`\`

### SQL VMs (by name, image, or tags)
When searching for "SQL VMs", search by multiple criteria:
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| extend vmSize = tostring(properties.hardwareProfile.vmSize)
| extend publisher = tostring(properties.storageProfile.imageReference.publisher)
| extend offer = tostring(properties.storageProfile.imageReference.offer)
| extend sku = tostring(properties.storageProfile.imageReference.sku)
| where name contains_cs 'sql' or name contains_cs 'SQL'
     or name contains_cs 'db' or name contains_cs 'DB'
     or name contains_cs 'PPDB' or name contains_cs 'ppdb'
     or publisher =~ 'MicrosoftSQLServer'
     or offer contains 'sql' or sku contains 'sql'
     or tags['workload'] =~ 'sql' or tags['application'] contains 'sql'
| project name, resourceGroup, location, vmSize, publisher, offer, sku
| order by name asc
\`\`\`

### VMs by name pattern (case-insensitive)
\`\`\`
Resources
| where type == 'microsoft.compute/virtualmachines'
| where name contains 'pattern'
| project name, resourceGroup, location
\`\`\`

## Response Format
Return ONLY the Resource Graph query. No explanations, no markdown code blocks.
If the request cannot be translated, respond with:
ERROR: <brief explanation>`;

/**
 * System prompt for synthesizing query results into human-readable responses.
 */
const RESULT_SYNTHESIS_SYSTEM_PROMPT = `You are a VM performance analyst assistant. Your job is to synthesize raw query results into clear, actionable insights for the user.

## Response Guidelines
1. Start with a brief summary (1 sentence)
2. Highlight key findings or anomalies
3. Present data in a readable format
4. Include relevant context (time range, total count)
5. Suggest next steps when appropriate

## Formatting for Slack
- Use *bold* for emphasis
- Use \`code\` for VM names, numbers, and technical values
- Use bullet points (•) for lists
- Keep responses concise (under 2000 characters when possible)
- Use emojis sparingly: :white_check_mark: for good, :warning: for concerns, :x: for critical

## Data Interpretation
- CPU > 80%: High utilization, may need attention
- CPU < 20%: Potentially underutilized
- Memory > 85%: Memory pressure, consider upsizing
- Memory < 30%: Potentially oversized

## Response Structure
1. Summary line (what was found)
2. Key metrics or findings (3-5 bullet points max)
3. Data highlights (top 5-10 results if many)
4. Recommendation or next step (optional)

## Example Good Response
"Found *15 VMs* with CPU > 80% in the last 7 days.

*Top 5 by Max CPU:*
• \`vm-prod-db-01\`: 98% max, 72% avg
• \`vm-app-server-03\`: 94% max, 65% avg
• \`vm-web-frontend-02\`: 91% max, 58% avg

:warning: These VMs may benefit from upsizing. Type 'investigate vm-prod-db-01' for details."`;

/**
 * Generate a user prompt for KQL query generation.
 *
 * @param {string} userRequest - The user's natural language request
 * @param {Object} context - Additional context
 * @param {string} context.subscriptionId - Target subscription
 * @param {number} context.defaultDays - Default time range in days
 * @returns {string} The user prompt
 */
function createKqlGenerationPrompt(userRequest, context = {}) {
    const { subscriptionId, defaultDays = 7 } = context;

    let prompt = `Generate a KQL query for the following request:\n\n"${userRequest}"\n\n`;

    if (subscriptionId) {
        prompt += `Target subscription ID: ${subscriptionId}\n`;
        prompt += `Filter queries to this subscription using: _ResourceId contains "${subscriptionId}"\n\n`;
    }

    prompt += `Default time range if not specified: ${defaultDays} days (ago(${defaultDays}d))\n`;
    prompt += `Return only the KQL query, nothing else.`;

    return prompt;
}

/**
 * Generate a user prompt for Resource Graph query generation.
 *
 * @param {string} userRequest - The user's natural language request
 * @param {Object} context - Additional context
 * @returns {string} The user prompt
 */
function createResourceGraphGenerationPrompt(userRequest, context = {}) {
    const { subscriptionId, tenantName } = context;

    let prompt = `Generate an Azure Resource Graph query for:\n\n"${userRequest}"\n\n`;

    if (subscriptionId) {
        prompt += `Focus on subscription: ${subscriptionId}\n`;
    }
    if (tenantName) {
        prompt += `Tenant: ${tenantName}\n`;
    }

    prompt += `Return only the query, nothing else.`;

    return prompt;
}

/**
 * Generate a user prompt for result synthesis.
 *
 * @param {string} originalRequest - The user's original request
 * @param {string} queryType - 'kql' or 'resourcegraph'
 * @param {Object} results - Query results object
 * @param {string} channelType - 'slack' or 'email'
 * @returns {string} The user prompt
 */
function createResultSynthesisPrompt(originalRequest, queryType, results, channelType = 'slack') {
    const maxResultsToShow = 50;
    const resultsToInclude = results.results?.slice(0, maxResultsToShow) || [];
    const remainingCount = (results.rowCount || 0) - resultsToInclude.length;

    let prompt = `Original user request: "${originalRequest}"\n`;
    prompt += `Query type: ${queryType}\n`;
    prompt += `Delivery channel: ${channelType}\n\n`;
    prompt += `Query results (${results.rowCount || 0} rows):\n`;
    prompt += JSON.stringify(resultsToInclude, null, 2);

    if (remainingCount > 0) {
        prompt += `\n\n... and ${remainingCount} more rows not shown.`;
    }

    prompt += `\n\nSynthesize these results into a ${channelType === 'slack' ? 'Slack-formatted' : 'HTML email-formatted'} response.`;
    prompt += `\nKeep the response concise and actionable.`;

    return prompt;
}

/**
 * Determine the query type from user's natural language request.
 *
 * @param {string} userRequest - The user's request
 * @returns {string} 'kql', 'resourcegraph', or 'unknown'
 */
function determineQueryType(userRequest) {
    const lower = userRequest.toLowerCase();

    // Keywords that suggest Resource Graph (inventory/config queries)
    const resourceGraphKeywords = [
        'list all vms', 'list vms', 'show all vms', 'show vms',
        'inventory', 'vm sizes', 'vm skus', 'what vms',
        'how many vms', 'count vms', 'vms in resource group',
        'vms by location', 'vms by region', 'vms by tag',
        'running vms', 'stopped vms', 'deallocated',
        'vm configuration', 'vm config',
        'find vms', 'search vms', 'sql vms', 'database vms',
        'find sql', 'find db', 'find all', 'search for'
    ];

    // Keywords that suggest KQL (performance/metrics queries)
    const kqlKeywords = [
        'cpu', 'memory', 'disk', 'performance', 'metrics',
        'utilization', 'usage', 'high cpu', 'low memory',
        'iops', 'throughput', 'latency', 'network',
        'last week', 'last month', 'past', 'over time',
        'average', 'maximum', 'minimum', 'percentile',
        'trend', 'spike', 'anomaly'
    ];

    // Check for Resource Graph keywords
    for (const keyword of resourceGraphKeywords) {
        if (lower.includes(keyword)) {
            return 'resourcegraph';
        }
    }

    // Check for KQL keywords
    for (const keyword of kqlKeywords) {
        if (lower.includes(keyword)) {
            return 'kql';
        }
    }

    // Default to KQL for ambiguous requests about VMs
    if (lower.includes('vm') || lower.includes('virtual machine')) {
        return 'kql';
    }

    return 'unknown';
}

module.exports = {
    KQL_GENERATION_SYSTEM_PROMPT,
    RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT,
    RESULT_SYNTHESIS_SYSTEM_PROMPT,
    createKqlGenerationPrompt,
    createResourceGraphGenerationPrompt,
    createResultSynthesisPrompt,
    determineQueryType
};
