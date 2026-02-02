const { app } = require('@azure/functions');
const axios = require('axios');

/**
 * Activity: Query Log Analytics for VM Performance Metrics
 */
app.activity('QueryLogAnalytics', {
    handler: async (input, context) => {
        const workspaceId = process.env.LOG_ANALYTICS_WORKSPACE_ID;
        const clientId = process.env.LOG_ANALYTICS_CLIENT_ID;
        const clientSecret = process.env.LOG_ANALYTICS_CLIENT_SECRET;
        const tenantId = process.env.LOG_ANALYTICS_TENANT_ID;
        const targetSubscription = process.env.TARGET_SUBSCRIPTION_ID;

        context.log(`Querying Log Analytics for VMs in subscription: ${targetSubscription}`);

        try {
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

            // KQL Query for VM metrics
            const query = `
                let startDate = ago(7d);
                let endDate = now();
                let targetSubscription = "${targetSubscription}";

                let cpuMetrics = Perf
                | where TimeGenerated between (startDate .. endDate)
                | where ObjectName == "Processor" and CounterName == "% Processor Time"
                | where InstanceName == "_Total"
                | where _ResourceId contains targetSubscription
                | summarize
                    CPU_Max = max(CounterValue),
                    CPU_Avg = avg(CounterValue),
                    CPU_P95 = percentile(CounterValue, 95)
                    by Computer, _ResourceId;

                let memoryMetrics = Perf
                | where TimeGenerated between (startDate .. endDate)
                | where ObjectName == "Memory" and CounterName == "% Committed Bytes In Use"
                | where _ResourceId contains targetSubscription
                | summarize
                    Memory_Max = max(CounterValue),
                    Memory_Avg = avg(CounterValue),
                    Memory_P95 = percentile(CounterValue, 95)
                    by Computer, _ResourceId;

                let diskMetrics = Perf
                | where TimeGenerated between (startDate .. endDate)
                | where ObjectName == "LogicalDisk"
                | where CounterName in ("Disk Reads/sec", "Disk Writes/sec")
                | where InstanceName != "_Total"
                | where _ResourceId contains targetSubscription
                | summarize TotalIOPS = sum(CounterValue)
                    by Computer, _ResourceId, TimeGenerated
                | summarize
                    DiskIOPS_Max = max(TotalIOPS),
                    DiskIOPS_Avg = avg(TotalIOPS),
                    DiskIOPS_P95 = percentile(TotalIOPS, 95)
                    by Computer, _ResourceId;

                cpuMetrics
                | join kind=inner (memoryMetrics) on Computer, _ResourceId
                | join kind=inner (diskMetrics) on Computer, _ResourceId
                | extend ResourceGroup = tostring(split(_ResourceId, "/")[4])
                | extend SubscriptionId = tostring(split(_ResourceId, "/")[2])
                | project
                    VMName = Computer,
                    ResourceId = _ResourceId,
                    ResourceGroup,
                    SubscriptionId,
                    CPU_Max = round(CPU_Max, 2),
                    CPU_Avg = round(CPU_Avg, 2),
                    CPU_P95 = round(CPU_P95, 2),
                    Memory_Max = round(Memory_Max, 2),
                    Memory_Avg = round(Memory_Avg, 2),
                    Memory_P95 = round(Memory_P95, 2),
                    DiskIOPS_Max = round(DiskIOPS_Max, 2),
                    DiskIOPS_Avg = round(DiskIOPS_Avg, 2),
                    DiskIOPS_P95 = round(DiskIOPS_P95, 2)
                | where SubscriptionId == targetSubscription
                | order by VMName asc
            `;

            // Execute query
            const queryResponse = await axios.post(
                `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
                { query },
                {
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            const tables = queryResponse.data.tables;
            if (!tables || tables.length === 0) {
                context.log.warn('No data returned from Log Analytics query');
                return [];
            }

            const columns = tables[0].columns.map(col => col.name);
            const rows = tables[0].rows;

            // Convert rows to objects
            const vms = rows.map(row => {
                const vm = {};
                columns.forEach((col, index) => {
                    vm[col] = row[index];
                });
                return vm;
            });

            context.log(`Found ${vms.length} VMs with performance data`);
            return vms;

        } catch (error) {
            context.log.error('Error querying Log Analytics:', error.message);
            if (error.response) {
                context.log.error('Response data:', JSON.stringify(error.response.data));
            }
            throw error;
        }
    }
});
