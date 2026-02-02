# Testing VM Performance Durable Functions

## Current Status

✅ **Deployed Components:**
- Function App: `vmperf-durable-func-18406`
- All activity functions deployed
- Service principal authentication configured
- Key Vault integration complete

⚠️ **Known Issues:**
- HTTP trigger route may not be properly registered
- Need to verify function URLs after deployment

## Service Principal Authentication

✅ **Already Configured:**

The function uses service principal authentication for Log Analytics:
- **Client ID:** `3bd63128-d818-4e90-91c9-b4ed3550acd3`
- **Client Secret:** Stored in Key Vault (`LogAnalyticsClientSecret`)
- **Tenant ID:** `21d8e422-7fd3-4634-8c8a-01dfde9a5502`

The `QueryLogAnalytics` activity:
1. Retrieves client ID and secret from Key Vault (via Function App settings)
2. Requests OAuth2 token from Azure AD
3. Uses token to query Log Analytics API at `https://api.loganalytics.io`

**No managed identity role assignment needed** - using service principal instead!

## Testing Steps

### Step 1: Find the Correct Function URL

```bash
# List all functions
az functionapp function list \
  --name vmperf-durable-func-18406 \
  --resource-group Sai-Test-rg \
  --query "[].{Name:name, TriggerType:config.bindings[0].type}" \
  -o table

# Get function app host keys
az functionapp keys list \
  --name vmperf-durable-func-18406 \
  --resource-group Sai-Test-rg
```

### Step 2: Test via Azure Portal

1. Navigate to https://portal.azure.com
2. Go to Function App: `vmperf-durable-func-18406`
3. Click on "Functions" in left menu
4. Find "HttpTrigger" or "TimerTrigger"
5. Click "Test/Run"
6. Click "Run" to trigger manually

### Step 3: Test via Azure CLI

```bash
# Invoke the function directly
az functionapp function invoke \
  --name vmperf-durable-func-18406 \
  --resource-group Sai-Test-rg \
  --function-name HttpTrigger
```

### Step 4: Monitor Execution

**View Live Logs:**
```bash
# Stream live logs
az webapp log tail \
  --name vmperf-durable-func-18406 \
  --resource-group Sai-Test-rg
```

**Check Application Insights:**
1. Navigate to Application Insights: `vmperf-insights-18406`
2. Go to "Transaction search" or "Logs"
3. Run this query:

```kql
traces
| where timestamp > ago(30m)
| where message contains "VMPerformance" or message contains "orchestration"
| order by timestamp desc
| project timestamp, severityLevel, message
```

**Check for errors:**
```kql
exceptions
| where timestamp > ago(30m)
| order by timestamp desc
| project timestamp, type, outerMessage, innermostMessage
```

### Step 5: Check Orchestration Status

If you successfully trigger the orchestration, you'll get a response like:

```json
{
  "id": "abc123...",
  "statusQueryGetUri": "https://...",
  "sendEventPostUri": "https://...",
  "terminatePostUri": "https://..."
}
```

Query the status:
```bash
curl "<statusQueryGetUri>" | jq .
```

Expected states:
- `"Running"` - Currently executing
- `"Completed"` - Finished successfully
- `"Failed"` - Error occurred

## Expected Workflow

When successfully triggered:

1. ✅ **Query Log Analytics** (using service principal)
   - Gets last 7 days of VM performance metrics
   - Filters by target subscription: `45cc9718-d2ec-48c8-b490-df358d934895`

2. ✅ **Get VM Inventory** (parallel)
   - Queries Azure Compute API for each VM
   - Gets OS type, SKU, vCPUs, memory, max IOPS

3. ✅ **Analyze with AI** (batches of 20)
   - GPT-5 analyzes each VM
   - Determines utilization status
   - Recommends actions

4. ✅ **Generate Reports** (technical + executive)
   - Creates professional HTML reports

5. ✅ **Send Emails** (via SendGrid)
   - Both emails sent to: `saigunaranjan.andhra@veradigm.com`

**Expected duration:** 3-5 minutes for ~20-50 VMs

## Troubleshooting

### Error: "Unable to get access token"

**Problem:** Service principal auth failing

**Check:**
1. Verify client ID and secret in Key Vault:
   ```bash
   az keyvault secret show --vault-name vmperf-kv-18406 --name LogAnalyticsClientId
   az keyvault secret show --vault-name vmperf-kv-18406 --name LogAnalyticsClientSecret
   ```

2. Verify Function App can access Key Vault:
   ```bash
   az keyvault show --name vmperf-kv-18406 \
     --query "properties.accessPolicies[?objectId=='f5189f24-047b-4e52-b1a9-327c6b99ec5b']"
   ```

3. Test service principal manually:
   ```bash
   CLIENT_ID="<YOUR_CLIENT_ID>"
   CLIENT_SECRET="<YOUR_CLIENT_SECRET>"
   TENANT_ID="<YOUR_TENANT_ID>"

   curl -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
     -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=https://api.loganalytics.io/.default" \
     -H "Content-Type: application/x-www-form-urlencoded"
   ```

### Error: "No data returned from Log Analytics"

**Problem:** Query returned no VMs

**Check:**
1. Verify VMs are sending metrics to Log Analytics workspace:
   ```kql
   Perf
   | where TimeGenerated > ago(7d)
   | where ObjectName == "Processor"
   | where _ResourceId contains "45cc9718-d2ec-48c8-b490-df358d934895"
   | summarize count() by Computer
   ```

2. Check if monitoring agent is installed on VMs

3. Verify correct subscription ID in environment variable

### Error: "Authorization failed" when getting VM inventory

**Problem:** Function App doesn't have Reader role on subscription

**Solution:**
```bash
az role assignment create \
  --assignee f5189f24-047b-4e52-b1a9-327c6b99ec5b \
  --role "Reader" \
  --scope /subscriptions/45cc9718-d2ec-48c8-b490-df358d934895
```

✅ **Already granted** - this was done during deployment

### Error: SendGrid email not delivered

**Check:**
1. Verify SendGrid API key in Key Vault
2. Check SendGrid dashboard for delivery status
3. Verify "from" email is verified in SendGrid
4. Check spam folder

### Error: OpenAI API call failed

**Common issues:**
- Temperature must be `1` (not 0.3)
- Use `max_completion_tokens` (not `max_tokens`)
- Verify deployment name is exactly `gpt-5`
- Check API key is valid

## Manual Query Test

Test Log Analytics query directly:

```bash
WORKSPACE_ID="<YOUR_WORKSPACE_ID>"
CLIENT_ID="<YOUR_CLIENT_ID>"
CLIENT_SECRET="<YOUR_CLIENT_SECRET>"
TENANT_ID="<YOUR_TENANT_ID>"

# Get token
TOKEN=$(curl -s -X POST "https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token" \
  -d "grant_type=client_credentials&client_id=${CLIENT_ID}&client_secret=${CLIENT_SECRET}&scope=https://api.loganalytics.io/.default" \
  -H "Content-Type: application/x-www-form-urlencoded" | jq -r .access_token)

# Query Log Analytics
curl -X POST "https://api.loganalytics.io/v1/workspaces/${WORKSPACE_ID}/query" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "Perf | where TimeGenerated > ago(1d) | where ObjectName == \"Processor\" | take 10"
  }' | jq .
```

## Success Indicators

✅ **Orchestration started:**
- Returns JSON with `id` and `statusQueryGetUri`
- Status query shows `"runtimeStatus": "Running"`

✅ **Log Analytics queried:**
- Logs show: "Found X VMs with performance data"
- No authentication errors

✅ **VM inventory retrieved:**
- Logs show: "Retrieved inventory for VM: ..."
- Shows OS type, SKU, vCPUs, memory

✅ **AI analysis complete:**
- Logs show: "Analyzed VM: ... Status: UNDERUTILIZED/OPTIMAL/OVERUTILIZED"
- Recommendations provided

✅ **Reports generated:**
- Logs show: "Generated technical report" and "Generated executive report"
- HTML content created

✅ **Emails sent:**
- Logs show: "Email sent successfully via SendGrid"
- Check inbox: `saigunaranjan.andhra@veradigm.com`

## Next Steps After Successful Test

1. ✅ Verify emails received
2. ✅ Review report content
3. ✅ Check cost in Azure Cost Management
4. ✅ Set up alerts in Application Insights
5. ✅ Document any issues or improvements
6. ⏰ Wait for scheduled run (Monday 8 AM UTC)

## Alternative: Test Locally

```bash
cd /Users/saigunaranjan/repo/ReportingApp/durable-functions

# Install Azurite
npm install -g azurite

# Start Azurite
azurite --silent &

# Start Functions locally
func start

# Trigger in another terminal
curl -X POST http://localhost:7071/api/orchestrators/VMPerformanceOrchestrator
```

## Resources

- Function App: https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/Microsoft.Web/sites/vmperf-durable-func-18406
- Application Insights: https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/microsoft.insights/components/vmperf-insights-18406
- Key Vault: https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/Microsoft.KeyVault/vaults/vmperf-kv-18406

---

**Last Updated:** January 23, 2026
**Status:** Service principal authentication configured, ready for testing
