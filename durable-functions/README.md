# VM Performance Monitoring - Azure Durable Functions

Scalable solution for monitoring VM performance across Azure subscriptions with AI-powered recommendations.

## Architecture

```
Timer Trigger (Weekly: Monday 8 AM UTC)
    ↓
Orchestrator Function
    ↓
├── Query Log Analytics Activity
├── Fan-out: Get VM Inventory (parallel)
│   └── Azure Compute API calls
├── Fan-out: Analyze VMs with AI (batches of 20)
│   └── Azure OpenAI GPT-5 analysis
├── Generate HTML Reports (technical + executive)
└── Send Emails via SendGrid (parallel)
```

## Features

- **Parallel Processing**: Analyze 100+ VMs in 3-5 minutes
- **VM Inventory Details**: OS type, SKU, vCPUs, memory, max IOPS
- **AI-Powered Analysis**: GPT-5 recommendations with cost impact
- **Dual Reports**: Technical (DevOps) and Executive (Leadership)
- **Scalable**: Handles 1000+ VMs with batching
- **Reliable**: Automatic retry, checkpointing, error handling
- **Cost Efficient**: ~$0.50-1 per run for 100 VMs

## Prerequisites

- Azure subscription
- Node.js 18+
- Azure CLI
- Azure Functions Core Tools v4
- Service Principal with permissions:
  - Log Analytics Reader on Log Analytics Workspace
  - Reader on subscriptions with VMs to monitor
  - Compute Reader for VM inventory
- SendGrid API key
- Azure OpenAI deployment (GPT-5)

## Local Development

### 1. Install Dependencies

```bash
cd durable-functions
npm install
```

### 2. Configure Local Settings

Update `local.settings.json` with your credentials:

```json
{
  "IsEncrypted": false,
  "Values": {
    "AzureWebJobsStorage": "UseDevelopmentStorage=true",
    "FUNCTIONS_WORKER_RUNTIME": "node",
    "AZURE_SUBSCRIPTION_ID": "your-subscription-id",
    "AZURE_TENANT_ID": "your-tenant-id",
    "AZURE_CLIENT_ID": "your-client-id",
    "AZURE_CLIENT_SECRET": "your-client-secret",
    "LOG_ANALYTICS_WORKSPACE_ID": "your-workspace-id",
    "OPENAI_ENDPOINT": "https://your-openai.cognitiveservices.azure.com/openai/deployments/gpt-5/chat/completions?api-version=2025-01-01-preview",
    "OPENAI_API_KEY": "your-openai-key",
    "SENDGRID_API_KEY": "your-sendgrid-key",
    "SENDGRID_FROM_EMAIL": "noreply@yourdomain.com",
    "TECHNICAL_EMAIL_TO": "devops@yourdomain.com",
    "EXECUTIVE_EMAIL_TO": "leadership@yourdomain.com"
  }
}
```

### 3. Start Azurite (Local Storage Emulator)

```bash
# Install Azurite globally if not already installed
npm install -g azurite

# Start Azurite
azurite --silent
```

### 4. Run Functions Locally

```bash
func start
```

### 5. Test Locally

Trigger the orchestration manually:

```bash
curl -X POST http://localhost:7071/api/orchestrators/VMPerformanceOrchestrator
```

Check orchestration status:

```bash
curl http://localhost:7071/runtime/webhooks/durabletask/instances/{instanceId}
```

## Deployment to Azure

### Option 1: Automated Deployment Script

```bash
cd durable-functions
chmod +x deploy.sh
./deploy.sh
```

The script will:
1. Create/verify resource group
2. Create storage account for Durable Functions
3. Create Application Insights
4. Create Function App
5. Configure all settings
6. Enable managed identity
7. Deploy function code

### Option 2: Manual Deployment

#### 1. Create Resources

```bash
RESOURCE_GROUP="vmperf-monitoring-rg"
LOCATION="eastus2"
STORAGE_ACCOUNT="vmperfdurablestorage"
FUNCTION_APP="vmperf-durable-functions"

# Create resource group
az group create --name $RESOURCE_GROUP --location $LOCATION

# Create storage account
az storage account create \
  --name $STORAGE_ACCOUNT \
  --resource-group $RESOURCE_GROUP \
  --location $LOCATION \
  --sku Standard_LRS

# Create Function App
az functionapp create \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --storage-account $STORAGE_ACCOUNT \
  --consumption-plan-location $LOCATION \
  --runtime node \
  --runtime-version 18 \
  --functions-version 4 \
  --os-type Linux
```

#### 2. Configure Settings

```bash
az functionapp config appsettings set \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --settings \
  "AZURE_SUBSCRIPTION_ID=your-value" \
  "AZURE_TENANT_ID=your-value" \
  "AZURE_CLIENT_ID=your-value" \
  "AZURE_CLIENT_SECRET=your-value" \
  "LOG_ANALYTICS_WORKSPACE_ID=your-value" \
  "OPENAI_ENDPOINT=your-value" \
  "OPENAI_API_KEY=your-value" \
  "SENDGRID_API_KEY=your-value" \
  "SENDGRID_FROM_EMAIL=your-value" \
  "TECHNICAL_EMAIL_TO=your-value" \
  "EXECUTIVE_EMAIL_TO=your-value"
```

#### 3. Deploy Code

```bash
cd durable-functions
npm install --production
func azure functionapp publish $FUNCTION_APP
```

#### 4. Grant Permissions

```bash
# Get Function App managed identity
PRINCIPAL_ID=$(az functionapp identity show \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query principalId -o tsv)

# Grant Log Analytics Reader role
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Log Analytics Reader" \
  --scope /subscriptions/{subscription-id}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}

# Grant Reader role on target subscriptions
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Reader" \
  --scope /subscriptions/{subscription-id}
```

## Testing

### Manual Trigger

Trigger the orchestration via HTTP:

```bash
# Get function key
FUNCTION_KEY=$(az functionapp keys list \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query functionKeys.default -o tsv)

# Trigger orchestration
curl -X POST "https://${FUNCTION_APP}.azurewebsites.net/api/orchestrators/VMPerformanceOrchestrator?code=${FUNCTION_KEY}"
```

### Check Orchestration Status

The trigger returns a status query URL. Use it to check progress:

```json
{
  "id": "abc123...",
  "statusQueryGetUri": "https://...",
  "sendEventPostUri": "https://...",
  "terminatePostUri": "https://...",
  "purgeHistoryDeleteUri": "https://..."
}
```

```bash
curl "https://${FUNCTION_APP}.azurewebsites.net/runtime/webhooks/durabletask/instances/{instanceId}?code=${FUNCTION_KEY}"
```

### View Logs

```bash
# Stream logs
func azure functionapp logstream $FUNCTION_APP

# Or view in Application Insights
az monitor app-insights component show \
  --app vmperf-durable-insights \
  --resource-group $RESOURCE_GROUP
```

## Configuration

### VM Analysis Thresholds

Defined in `activities/AnalyzeVMWithAI.js`:

- **UNDERUTILIZED**: CPU P95 < 20%, Memory P95 < 30% → DOWNSIZE
- **OVERUTILIZED**: CPU P95 > 80%, Memory P95 > 85% → UPSIZE
- **OPTIMAL**: CPU P95 40-70%, Memory P95 50-75% → MAINTAIN

### Batch Size

Configured in `orchestrators/VMPerformanceOrchestrator.js`:

```javascript
const batchSize = 20; // Process 20 VMs concurrently
```

Adjust based on:
- OpenAI rate limits (default: 60 requests/min)
- Function App plan limits
- Cost considerations

### Schedule

Configured in `triggers/function.json`:

```json
{
  "schedule": "0 0 8 * * MON"
}
```

Format: `{second} {minute} {hour} {day} {month} {day-of-week}`
- Current: Every Monday at 8:00 AM UTC
- Change to `0 0 9 * * *` for daily at 9 AM
- Change to `0 0 8 1 * *` for monthly on 1st at 8 AM

## Project Structure

```
durable-functions/
├── activities/
│   ├── QueryLogAnalytics.js       # Query Log Analytics for metrics
│   ├── GetVMInventory.js          # Get VM details from Azure
│   ├── AnalyzeVMWithAI.js         # AI-powered analysis
│   ├── GenerateHTMLReport.js      # Create HTML reports
│   └── SendEmailWithSendGrid.js   # Send emails
├── orchestrators/
│   └── VMPerformanceOrchestrator.js  # Main workflow coordinator
├── triggers/
│   ├── TimerTrigger.js            # Weekly scheduled trigger
│   ├── function.json              # Timer config
│   ├── HttpTrigger.js             # Manual HTTP trigger
│   └── http-function.json         # HTTP config
├── models/
│   └── VMMetrics.js               # Data models
├── host.json                      # Function App config
├── package.json                   # Dependencies
├── local.settings.json            # Local configuration
├── deploy.sh                      # Deployment script
└── README.md                      # This file
```

## Monitoring

### Application Insights Queries

**Orchestration duration:**
```kql
traces
| where message contains "Orchestration completed"
| extend duration = todouble(customDimensions.duration)
| summarize avg(duration), max(duration), min(duration) by bin(timestamp, 1d)
```

**VM analysis counts:**
```kql
traces
| where message contains "VMs analyzed"
| extend vmsAnalyzed = toint(customDimensions.vmsAnalyzed)
| summarize sum(vmsAnalyzed) by bin(timestamp, 1d)
```

**Errors:**
```kql
traces
| where severityLevel >= 3
| project timestamp, message, customDimensions
| order by timestamp desc
```

### Alerts

Configure alerts for:
- Orchestration failures
- Execution time > 15 minutes
- Cost anomalies

## Troubleshooting

### Common Issues

**1. "Resource not found" when querying Log Analytics**
- Verify service principal has "Log Analytics Reader" role
- Check workspace ID is correct
- Ensure workspace is in same tenant

**2. "Authorization failed" when getting VM details**
- Grant service principal "Reader" role on subscription
- Wait 5-10 minutes for role propagation

**3. OpenAI API errors**
- Verify API key and endpoint
- Check deployment name is "gpt-5"
- Ensure temperature is set to 1
- Use max_completion_tokens (not max_tokens)

**4. SendGrid email failures**
- Verify API key has "Mail Send" permissions
- Check "from" email is verified in SendGrid
- Review SendGrid activity log

**5. Durable Functions timeout**
- Check batch size (reduce if hitting limits)
- Review Application Insights for bottlenecks
- Consider scaling up Function App plan

### Debug Locally

Enable verbose logging:

```json
// host.json
{
  "logging": {
    "logLevel": {
      "default": "Debug",
      "DurableTask.Core": "Information"
    }
  }
}
```

## Performance

### Expected Execution Times

| VMs | Duration | Cost (Consumption Plan) |
|-----|----------|-------------------------|
| 20  | 1-2 min  | $0.10-0.20             |
| 50  | 2-3 min  | $0.30-0.50             |
| 100 | 3-5 min  | $0.50-1.00             |
| 500 | 8-12 min | $2.00-4.00             |

### Optimization Tips

1. **Increase batch size** if not hitting rate limits
2. **Cache VM inventory** if running multiple times per day
3. **Use Premium plan** for guaranteed performance
4. **Reduce OpenAI max_completion_tokens** if reports are too long

## Cost Breakdown

**Per 100 VMs (weekly run):**
- Azure Functions execution: ~$0.20
- Azure Functions storage: ~$0.05
- OpenAI API calls (100 analyses + 2 reports): ~$0.30
- SendGrid (2 emails): ~$0.00 (free tier)
- **Total: ~$0.55 per week** = $2.20/month

**Comparison to Logic Apps:**
- Logic Apps: ~$5-8 per run ($20-32/month)
- **Savings: 90% cheaper with Durable Functions**

## Security

- All credentials stored in Azure Key Vault (recommended) or Function App settings
- Managed identity for Azure resource access (recommended)
- Service principal as fallback
- HTTPS-only communication
- Network restrictions on Function App (optional)
- SendGrid API key with minimum permissions

## Support

For issues or questions:
1. Check Application Insights logs
2. Review this README troubleshooting section
3. Consult Azure Durable Functions documentation
4. Open an issue in the repository

## License

Internal use only - Veradigm
