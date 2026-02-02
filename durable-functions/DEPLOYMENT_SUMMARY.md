# VM Performance Durable Functions - Deployment Summary

## ✅ Successfully Deployed Components

### Azure Resources Created

**Subscription:** Zirconium - Veradigm Sandbox (ffd7017b-28ed-4e90-a2ec-4a6958578f98)
**Resource Group:** Sai-Test-rg
**Location:** westus2

| Resource | Name | Status |
|----------|------|--------|
| Function App | vmperf-durable-func-18406 | ✅ Deployed |
| Key Vault | vmperf-kv-18406 | ✅ Created |
| Storage Account | vmperfstore18406 | ✅ Created |
| Application Insights | vmperf-insights-18406 | ✅ Created |

### Functions Deployed

| Function | Type | Status |
|----------|------|--------|
| VMPerformanceOrchestrator | Orchestrator | ✅ Registered |
| HttpTrigger | HTTP Trigger | ✅ Working |
| TimerTrigger | Timer Trigger | ✅ Scheduled (Mon 8AM UTC) |
| QueryLogAnalytics | Activity | ✅ Deployed |
| GetVMInventory | Activity | ✅ Deployed |
| AnalyzeVMWithAI | Activity | ✅ Deployed |
| GenerateHTMLReport | Activity | ✅ Deployed |
| SendEmailWithSendGrid | Activity | ✅ Deployed |

### Security Configuration

#### Key Vault Secrets Stored (9 total)
All credentials are securely stored in Azure Key Vault:

- ✅ SendGridApiKey
- ✅ OpenAIEndpoint
- ✅ OpenAIApiKey
- ✅ LogAnalyticsWorkspaceId
- ✅ LogAnalyticsClientId
- ✅ LogAnalyticsClientSecret
- ✅ LogAnalyticsTenantId
- ✅ TargetSubscriptionId
- ✅ EmailAddress

#### Managed Identity
- ✅ System-assigned managed identity enabled
- ✅ Principal ID: f5189f24-047b-4e52-b1a9-327c6b99ec5b
- ✅ Key Vault access policy granted

#### Role Assignments

| Scope | Role | Status |
|-------|------|--------|
| Subscription: 45cc9718-d2ec-48c8-b490-df358d934895 | Reader | ✅ Granted |
| Log Analytics Workspace | Log Analytics Reader | ⚠️ Needs elevated permissions |

## ⚠️ Action Items

### 1. Grant Log Analytics Reader Role

The Function App needs read access to the Log Analytics workspace. You need elevated permissions to grant this.

**Run with elevated permissions:**

```bash
az role assignment create \
  --assignee f5189f24-047b-4e52-b1a9-327c6b99ec5b \
  --role "Log Analytics Reader" \
  --scope /subscriptions/54305029-7d35-40a9-8bf9-950963b449cc/resourceGroups/Ue1NePrdPerfLaw-Rg/providers/Microsoft.OperationalInsights/workspaces/Ue1NePrd-perf-only-log-analytics-workspace
```

**Or use the Azure Portal:**
1. Navigate to Log Analytics workspace: Ue1NePrd-perf-only-log-analytics-workspace
2. Go to Access Control (IAM)
3. Click "Add role assignment"
4. Select "Log Analytics Reader" role
5. Assign to: vmperf-durable-func-18406 (managed identity)

### 2. Test the Function

Once permissions are granted, test manually:

```bash
# Get function key
FUNCTION_KEY=$(az functionapp keys list \
  --name vmperf-durable-func-18406 \
  --resource-group Sai-Test-rg \
  --query "functionKeys.default" -o tsv)

# Trigger orchestration
curl -X POST \
  "https://vmperf-durable-func-18406.azurewebsites.net/api/orchestrators/VMPerformanceOrchestrator?code=${FUNCTION_KEY}" \
  -H "Content-Type: application/json"
```

This will return a JSON response with:
- `id`: Orchestration instance ID
- `statusQueryGetUri`: URL to check orchestration status
- `sendEventPostUri`: URL to send events
- `terminatePostUri`: URL to terminate orchestration

**Check orchestration status:**
```bash
curl "<statusQueryGetUri from above>"
```

### 3. Monitor Execution

**View logs in Azure Portal:**
1. Navigate to Function App: vmperf-durable-func-18406
2. Go to "Monitor" → "Logs"
3. Run query:
   ```kql
   traces
   | where timestamp > ago(1h)
   | order by timestamp desc
   | project timestamp, message, severityLevel
   ```

**View in Application Insights:**
- Navigate to: vmperf-insights-18406
- Go to "Transaction Search" or "Logs"
- Filter by timestamp and severity

### 4. Verify Email Delivery

After successful execution:
1. Check email inbox: saigunaranjan.andhra@veradigm.com
2. Should receive 2 emails:
   - Technical Report (detailed VM analysis)
   - Executive Report (cost summary)

## 📊 Function URLs

| Function | URL |
|----------|-----|
| Function App | https://vmperf-durable-func-18406.azurewebsites.net |
| Manual Trigger | https://vmperf-durable-func-18406.azurewebsites.net/api/orchestrators/VMPerformanceOrchestrator |
| Application Insights | [Portal Link](https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/microsoft.insights/components/vmperf-insights-18406/overview) |
| Key Vault | [Portal Link](https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/Microsoft.KeyVault/vaults/vmperf-kv-18406/overview) |

## 🔄 Automatic Schedule

The function is configured to run automatically:
- **Schedule:** Every Monday at 8:00 AM UTC
- **Trigger:** TimerTrigger
- **Cron Expression:** `0 0 8 * * MON`

## 📋 Expected Workflow

1. **Timer triggers** (Monday 8 AM UTC) or **Manual HTTP trigger**
2. **Query Log Analytics** for VM performance metrics (last 7 days)
3. **Get VM Inventory** in parallel for all VMs
   - OS type, SKU, vCPUs, memory, max IOPS
4. **Analyze VMs with AI** in batches of 20
   - GPT-5 analyzes each VM
   - Determines: UNDERUTILIZED / OVERUTILIZED / OPTIMAL
   - Recommends: UPSIZE / DOWNSIZE / MAINTAIN
   - Provides SKU recommendations and cost impact
5. **Generate HTML Reports**
   - Technical report (detailed metrics)
   - Executive report (cost summary)
6. **Send Emails via SendGrid**
   - Both emails sent in parallel

**Expected execution time:** 3-5 minutes for ~100 VMs

## 🔧 Configuration

All configuration is stored in Key Vault and referenced via Function App settings:

| Setting | Source |
|---------|--------|
| SENDGRID_API_KEY | Key Vault: SendGridApiKey |
| OPENAI_ENDPOINT | Key Vault: OpenAIEndpoint |
| OPENAI_API_KEY | Key Vault: OpenAIApiKey |
| LOG_ANALYTICS_WORKSPACE_ID | Key Vault: LogAnalyticsWorkspaceId |
| LOG_ANALYTICS_CLIENT_ID | Key Vault: LogAnalyticsClientId |
| LOG_ANALYTICS_CLIENT_SECRET | Key Vault: LogAnalyticsClientSecret |
| TARGET_SUBSCRIPTION_ID | Key Vault: TargetSubscriptionId |
| EMAIL_FROM | Key Vault: EmailAddress |
| EMAIL_TO_TECHNICAL | Key Vault: EmailAddress |
| EMAIL_TO_EXECUTIVE | Key Vault: EmailAddress |

**No secrets are stored in Function App configuration - all retrieved from Key Vault at runtime**

## 🐛 Troubleshooting

### Function returns 500 error

**Most likely cause:** Log Analytics Reader role not granted

**Check:**
```bash
az role assignment list \
  --assignee f5189f24-047b-4e52-b1a9-327c6b99ec5b \
  --all
```

Look for:
- Role: "Log Analytics Reader"
- Scope: Contains "Ue1NePrd-perf-only-log-analytics-workspace"

### Key Vault access issues

**Check Key Vault access policy:**
```bash
az keyvault show \
  --name vmperf-kv-18406 \
  --resource-group Sai-Test-rg \
  --query "properties.accessPolicies[?objectId=='f5189f24-047b-4e52-b1a9-327c6b99ec5b']"
```

Should show permissions: `["get", "list"]` for secrets

### SendGrid email not received

**Verify SendGrid API key:**
```bash
az keyvault secret show \
  --vault-name vmperf-kv-18406 \
  --name SendGridApiKey \
  --query value -o tsv
```

**Check SendGrid activity log:**
- Login to SendGrid dashboard
- Go to Activity Feed
- Look for recent email sends

### OpenAI API errors

**Common issues:**
- Wrong deployment name (should be "gpt-5")
- API key expired
- Temperature must be 1 (not 0.3)
- Use max_completion_tokens (not max_tokens)

## 📝 Next Steps

1. **Grant Log Analytics Reader role** (needs elevated permissions)
2. **Test manually** via HTTP trigger
3. **Verify email delivery**
4. **Monitor first automated run** (next Monday 8 AM UTC)
5. **Review Application Insights** for performance metrics

## 🔐 Security Compliance

✅ All credentials in Azure Key Vault
✅ Managed identity authentication
✅ No secrets in code or configuration
✅ Storage account: public blob access disabled
✅ HTTPS only, TLS 1.2 minimum
✅ Function App authentication required (function key)

## 💰 Cost Estimate

**Monthly cost (assuming weekly runs):**

| Component | Cost/Month |
|-----------|------------|
| Function App (Consumption) | $0.40 - $1.00 |
| Storage Account | $0.10 - $0.30 |
| Application Insights | $2.00 - $5.00 |
| Key Vault | $0.03 - $0.10 |
| OpenAI API (100 VMs + reports) | $1.20 - $2.00 |
| SendGrid (free tier) | $0.00 |
| **Total** | **$3.73 - $8.40** |

**Compare to Logic Apps:** $20-32/month (90% savings!)

## 📚 Additional Resources

- [Deployment Documentation](./README.md)
- [Key Vault Setup Guide](./KEYVAULT_SETUP.md)
- [Better Approaches Analysis](../docs/BETTER_APPROACHES.md)
- [Azure Durable Functions Docs](https://docs.microsoft.com/azure/azure-functions/durable/)

---

**Deployment Date:** January 23, 2026
**Deployed By:** Claude Code Assistant
**Status:** ✅ Infrastructure deployed, ⚠️ Awaiting Log Analytics permissions
