# Quick Start Guide

Get your VM Performance Monitoring solution running in 30 minutes.

## Prerequisites Checklist

Before starting, ensure you have:

- [ ] Azure subscription with Contributor access
- [ ] Azure CLI installed ([Download](https://docs.microsoft.com/cli/azure/install-azure-cli))
- [ ] Log Analytics workspace with VM data
- [ ] Azure AI Foundry workspace with deployed model
- [ ] Office 365 account for emails

## Step-by-Step Setup

### 1. Clone or Download the Repository

```bash
# If using git
git clone <repository-url>
cd ReportingApp

# Or download and extract the ZIP file
cd ReportingApp
```

### 2. Login to Azure

```bash
az login
az account set --subscription "<your-subscription-name-or-id>"
```

### 3. Get Required Resource IDs

```bash
# Get Log Analytics Workspace ID
az monitor log-analytics workspace show \
  --resource-group <your-rg> \
  --workspace-name <your-workspace> \
  --query id -o tsv

# Save this - you'll need it in the next step
```

### 4. Update Configuration

Edit `deployment/parameters.json`:

```bash
# Open the file in your editor
nano deployment/parameters.json

# Or use VS Code
code deployment/parameters.json
```

Update these values:
- `logAnalyticsWorkspaceId`: Paste the ID from step 3
- `aiFoundryEndpoint`: Your AI Foundry endpoint URL
- `technicalEmailRecipients`: Your email address
- `executiveEmailRecipients`: Your email address

### 5. Deploy the Solution

```bash
cd deployment

# Make the script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

When prompted:
- Confirm resource group creation: `y`
- Wait for deployment (5-10 minutes)

### 6. Configure API Connections

After deployment completes:

```bash
# Get the Logic App resource URL (printed at the end of deployment)
# Open it in your browser
```

In Azure Portal:
1. Navigate to your Logic App
2. Go to "API connections" in the left menu
3. For each connection (Office 365, Azure Monitor Logs):
   - Click the connection
   - Click "Edit API connection"
   - Click "Authorize"
   - Sign in when prompted
   - Click "Save"

### 7. Test the Solution

```bash
# Trigger a manual run
az logic workflow run trigger \
  --resource-group vmperf-monitoring-rg \
  --name $(az deployment group show \
    --resource-group vmperf-monitoring-rg \
    --name <deployment-name> \
    --query "properties.outputs.logicAppName.value" -o tsv) \
  --trigger-name Recurrence
```

Check your email in 5-10 minutes!

## Verification

### Check Logic App Run Status

```bash
az logic workflow list-runs \
  --resource-group vmperf-monitoring-rg \
  --name <logic-app-name> \
  --query "value[0].{Status:status, StartTime:startTime}" -o table
```

### View Run Details in Portal

1. Go to Azure Portal
2. Navigate to Logic App
3. Click "Run history"
4. Click on the latest run
5. Inspect each step

### Verify Email Delivery

- Check your inbox for two emails:
  1. "Weekly VM Performance & Sizing Recommendations" (Technical)
  2. "Weekly VM Cost Optimization Summary" (Executive)

## Troubleshooting

### ❌ No VMs in Report

**Cause**: No VM metrics in Log Analytics

**Fix**:
```bash
# Verify VMs are sending metrics
az monitor log-analytics query \
  --workspace <workspace-id> \
  --analytics-query "Perf | where TimeGenerated > ago(1h) | take 10" \
  --timespan P1D
```

If no results, install Azure Monitor Agent on VMs.

### ❌ Logic App Fails at "Query Log Analytics"

**Cause**: Connection not authorized

**Fix**: Go to Azure Portal → Logic App → API connections → Authorize each connection

### ❌ Logic App Fails at "Call AI Foundry"

**Cause**: Invalid endpoint or API key

**Fix**:
```bash
# Test AI Foundry endpoint
curl -X POST \
  "<your-ai-foundry-endpoint>" \
  -H "Content-Type: application/json" \
  -H "api-key: <your-api-key>" \
  -d '{"messages":[{"role":"user","content":"Hello"}],"max_tokens":10}'
```

Should return a valid JSON response.

### ❌ No Emails Received

**Cause**: Office 365 connection not authorized or wrong email addresses

**Fix**:
1. Check Office 365 connection authorization
2. Verify email addresses in parameters.json
3. Check spam/junk folder

## Next Steps

### Customize Your Reports

1. **Edit AI Prompts**:
   ```bash
   nano src/prompts/technical-analysis.txt
   nano src/prompts/executive-analysis.txt
   ```

2. **Customize Email Templates**:
   ```bash
   nano src/templates/email-technical.html
   nano src/templates/email-executive.html
   ```

3. **Update Logic App**: Deploy your changes

### Add More VMs

No additional configuration needed! The solution automatically discovers all VMs sending metrics to your Log Analytics workspace.

### Change Schedule

```bash
# Edit schedule in parameters.json
# Redeploy
./deploy.sh
```

### Monitor Costs

```bash
# View costs for the resource group
az consumption usage list \
  --start-date $(date -d '30 days ago' +%Y-%m-%d) \
  --end-date $(date +%Y-%m-%d) \
  --query "[?contains(instanceName,'vmperf')].{Name:instanceName,Cost:pretaxCost}" \
  -o table
```

## Common Customizations

### Change Report Schedule to Wednesday

Edit `deployment/parameters.json`:
```json
{
  "scheduleDayOfWeek": {
    "value": "Wednesday"
  }
}
```

Redeploy: `./deploy.sh`

### Add More Email Recipients

Edit `deployment/parameters.json`:
```json
{
  "technicalEmailRecipients": {
    "value": "devops@company.com,team2@company.com,person@company.com"
  }
}
```

Redeploy: `./deploy.sh`

### Filter to Specific Resource Groups

Edit `src/queries/vm-metrics-query.kql`:
```kql
// Add after vmDetails definition
| where ResourceGroup in ("prod-rg", "staging-rg")
```

Update Logic App with new query.

### Change Analysis Period from 7 to 14 Days

Edit `src/queries/vm-metrics-query.kql`:
```kql
// Change this line:
let startDate = ago(7d);

// To this:
let startDate = ago(14d);
```

Update Logic App with new query.

## Getting Help

### Documentation
- [Full Deployment Guide](DEPLOYMENT_GUIDE.md)
- [Configuration Guide](CONFIGURATION_GUIDE.md)
- [Architecture Documentation](ARCHITECTURE.md)

### Azure Resources
- [Logic Apps Documentation](https://docs.microsoft.com/azure/logic-apps/)
- [AI Foundry Documentation](https://aka.ms/aistudio/docs)
- [Log Analytics KQL Reference](https://docs.microsoft.com/azure/data-explorer/kusto/query/)

### Support
- Create an issue in the repository
- Contact your Azure administrator
- Azure Support (for Azure platform issues)

## Success Checklist

After completing this guide, you should have:

- [x] Deployed all Azure resources
- [x] Configured API connections
- [x] Received test emails with VM recommendations
- [x] Verified Logic App runs successfully
- [x] Scheduled weekly reports

## What's Next?

Now that your solution is running:

1. **Wait for next scheduled run** (Monday 8 AM UTC)
2. **Review recommendations** with your team
3. **Implement cost-saving changes** for underutilized VMs
4. **Monitor results** over 30-60-90 days
5. **Share success metrics** with leadership

## Cost Expectations

For a typical deployment with 50 VMs:

- **Setup cost**: $0 (ARM template deployment)
- **Monthly cost**: ~$40-60
  - Logic App: $10
  - AI Foundry: $25
  - Log Analytics: $10
  - Storage: $2

**ROI**: If you save even 1 VM ($70/month), the solution pays for itself!

---

🎉 **Congratulations!** Your VM Performance Monitoring solution is now operational.

You'll start receiving weekly insights to optimize your Azure infrastructure costs and performance.
