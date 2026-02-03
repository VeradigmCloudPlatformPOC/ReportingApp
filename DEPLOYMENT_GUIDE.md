# Deployment Guide - VM Performance Monitoring Solution

## Current Deployment (Production)

| Resource | Name | Details |
|----------|------|---------|
| **Subscription** | Zirconium - Veradigm Sandbox | `ffd7017b-28ed-4e90-a2ec-4a6958578f98` |
| **Resource Group** | Sai-Test-rg | West US 2 |
| **Container Registry** | ca0bf4270c7eacr | `ca0bf4270c7eacr.azurecr.io` |
| **Orchestrator App** | vmperf-orchestrator | `https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io` |
| **Slack Bot App** | vmperf-slack-bot | `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io` |
| **Key Vault** | vmperf-kv-18406 | Stores all secrets |
| **Storage Account** | saitestrg88fe | Tables: runs, tenants; Containers: reports, analysis-results |

### Quick Deployment Commands

```bash
# Set subscription
az account set --subscription "ffd7017b-28ed-4e90-a2ec-4a6958578f98"

# Build and deploy orchestrator
cd container-app
az acr build --registry ca0bf4270c7eacr --image vmperf-orchestrator:latest .

# Build and deploy slack-bot
cd ../slack-bot
az acr build --registry ca0bf4270c7eacr --image vmperf-slack-bot:latest .

# IMPORTANT: Force new revision with unique suffix to ensure new code is deployed
# Using --revision-suffix ensures a new revision is created and activated
TIMESTAMP=$(date +%Y%m%d-%H%M)

az containerapp update --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-orchestrator:latest \
  --revision-suffix "v-$TIMESTAMP"

az containerapp update --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-slack-bot:latest \
  --revision-suffix "v-$TIMESTAMP"

# Verify health
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health
```

### Cleanup Old Revisions

Container Apps can accumulate old revisions over time. Clean them up periodically:

```bash
# List all revisions for orchestrator
az containerapp revision list --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" -o table

# List all revisions for slack-bot
az containerapp revision list --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --query "[].{name:name, active:properties.active, created:properties.createdTime}" -o table

# Deactivate old revisions (replace <revision-name> with actual name)
# Note: You cannot delete revisions, only deactivate them
az containerapp revision deactivate --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --revision <revision-name>

# Bulk deactivate all inactive revisions for orchestrator
for rev in $(az containerapp revision list --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --query "[?properties.active==\`false\`].name" -o tsv); do
  echo "Deactivating $rev..."
  az containerapp revision deactivate --name vmperf-orchestrator --resource-group Sai-Test-rg --revision "$rev" 2>/dev/null || true
done

# Bulk deactivate all inactive revisions for slack-bot
for rev in $(az containerapp revision list --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --query "[?properties.active==\`false\`].name" -o tsv); do
  echo "Deactivating $rev..."
  az containerapp revision deactivate --name vmperf-slack-bot --resource-group Sai-Test-rg --revision "$rev" 2>/dev/null || true
done

# Set max inactive revisions to limit accumulation (default is 100)
az containerapp update --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --max-inactive-revisions 5

az containerapp update --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --max-inactive-revisions 5
```

### Verify Active Revision

Always verify the correct revision is running after deployment:

```bash
# Check which revision is currently active
az containerapp show --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --query "properties.latestRevisionName" -o tsv

az containerapp show --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --query "properties.latestRevisionName" -o tsv

# Check revision creation time to confirm it's the new deployment
az containerapp revision show --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --revision $(az containerapp show --name vmperf-orchestrator --resource-group Sai-Test-rg --query "properties.latestRevisionName" -o tsv) \
  --query "properties.createdTime" -o tsv
```

---

## Release Management & Rollback

### Git Tagging Strategy

We use annotated git tags to mark stable releases. This enables quick rollback if a new deployment causes issues.

**Tag Naming Convention**: `v<major>-<descriptor>` or `v<major>-fix<number>`
- `v10-fixes` - Major feature release with fixes
- `v10-fix2` - Incremental bug fix
- `v10-fix3` - Another incremental bug fix

### Creating a Release Tag

After testing a deployment and confirming it's stable, create an annotated tag:

```bash
# Create annotated tag with release notes
git tag -a v10-fix3 -m "Release v10-fix3 - Temperature parameter fix

Changes:
- Removed temperature parameter from Azure OpenAI API calls
- Newer Azure OpenAI models (o1 series) only support default temperature (1)
- Fixed BadRequestError: 400 Unsupported value: temperature does not support 0.3

Deployed:
- vmperf-orchestrator:v10-fixes (2.0 CPU / 4.0 Gi)
- vmperf-slack-bot:v10-fix3 (1.0 CPU / 2.0 Gi)
"

# Push tag to remote repository
git push origin v10-fix3
```

### Listing Available Tags

```bash
# List all tags with dates
git tag -l --format='%(refname:short) - %(creatordate:short) - %(subject)'

# Show details of a specific tag
git show v10-fix3

# List tags matching a pattern
git tag -l "v10*"
```

### Rollback Procedures

#### Option 1: Checkout Tag and Redeploy (Recommended)

When a new deployment causes issues, rollback to a known stable tag:

```bash
# 1. Checkout the stable tag
git checkout v10-fix3

# 2. Rebuild and deploy containers from this code
cd container-app
az acr build --registry ca0bf4270c7eacr --image vmperf-orchestrator:v10-fix3 .

cd ../slack-bot
az acr build --registry ca0bf4270c7eacr --image vmperf-slack-bot:v10-fix3 .

# 3. Update container apps to use the tagged images
TIMESTAMP=$(date +%Y%m%d-%H%M)

az containerapp update --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-orchestrator:v10-fix3 \
  --revision-suffix "rollback-$TIMESTAMP"

az containerapp update --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-slack-bot:v10-fix3 \
  --revision-suffix "rollback-$TIMESTAMP"

# 4. Verify health
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health

# 5. Return to main branch for future development
git checkout main
```

#### Option 2: Create Hotfix Branch from Tag

If you need to make a small fix on top of a stable release:

```bash
# Create a branch from the stable tag
git checkout -b hotfix/v10-fix4 v10-fix3

# Make your fixes...
# Then commit and tag the hotfix
git commit -am "Hotfix: description of fix"
git tag -a v10-fix4 -m "Hotfix release v10-fix4"
git push origin hotfix/v10-fix4 --tags
```

#### Option 3: Reset Main to Tag (Emergency Only)

**Warning**: This rewrites history. Only use if you need to completely abandon commits after a tag.

```bash
# Reset main branch to the stable tag
git checkout main
git reset --hard v10-fix3
git push --force-with-lease origin main
```

### Current Release Tags

| Tag | Date | Status | Description |
|-----|------|--------|-------------|
| `v10-fix3` | 2026-02-03 | ✅ Stable | Temperature parameter fix |
| `v10-fix2` | 2026-02-03 | ✅ Stable | max_completion_tokens fix |
| `v10-fixes` | 2026-02-02 | ✅ Stable | Agent verbosity, export CSV, VM name matching |
| `v9-dynamic-queries` | 2026-01-28 | ✅ Stable | Dynamic query system |

### Best Practices

1. **Always tag stable releases** before deploying new changes
2. **Use annotated tags** (`-a` flag) with descriptive messages
3. **Test thoroughly** before tagging - tags should represent tested, working code
4. **Document changes** in both the tag message and CHANGELOG.md
5. **Keep images tagged** in ACR matching git tags for easy rollback
6. **Never delete tags** that have been pushed to production

---

## Prerequisites

### 1. Azure Resources
- Azure Subscription with appropriate permissions (Contributor or Owner)
- Azure Container Apps Environment
- Azure Container Registry (ACR)
- Azure Log Analytics Workspace (per tenant)
- Azure Key Vault for secrets
- Azure OpenAI Service with GPT-4 deployment
- SendGrid account for email delivery
- Slack workspace with bot app

### 2. Local Tools
- Azure CLI (v2.50.0 or later)
- Docker (for building container images)
- Bash shell (for running deployment script)
- Text editor for updating parameters

### 3. Required Permissions
- Resource Group Contributor
- Container Apps Contributor
- Key Vault Secrets Officer
- Log Analytics Contributor (on each tenant workspace)
- Role Assignment Administrator (for managed identity)

## Pre-Deployment Steps

### 1. Configure Azure Monitor
Ensure VMs are sending performance metrics to Log Analytics workspace:

```bash
# Enable VM Insights on target VMs
az monitor log-analytics workspace show \
  --resource-group <rg-name> \
  --workspace-name <workspace-name>

# Get Workspace ID (needed for deployment)
WORKSPACE_ID=$(az monitor log-analytics workspace show \
  --resource-group <rg-name> \
  --workspace-name <workspace-name> \
  --query id -o tsv)
```

### 2. Set Up AI Foundry
1. Create Azure AI Foundry workspace
2. Deploy a model (GPT-4 or GPT-4-turbo recommended)
3. Get the endpoint URL and API key:

```bash
# Example endpoint format
https://<your-resource>.openai.azure.com/openai/deployments/<deployment-name>/chat/completions?api-version=2024-02-15-preview
```

### 3. Update Parameters File

Edit `deployment/parameters.json` and update:

```json
{
  "logAnalyticsWorkspaceId": {
    "value": "/subscriptions/{sub-id}/resourceGroups/{rg}/providers/Microsoft.OperationalInsights/workspaces/{workspace}"
  },
  "aiFoundryEndpoint": {
    "value": "https://{your-endpoint}.openai.azure.com/..."
  },
  "technicalEmailRecipients": {
    "value": "devops@company.com"
  },
  "executiveEmailRecipients": {
    "value": "leadership@company.com"
  }
}
```

For production, store the AI Foundry API key in Azure Key Vault:

```bash
# Create Key Vault
az keyvault create \
  --name vmperf-kv \
  --resource-group <rg-name> \
  --location eastus

# Store API key
az keyvault secret set \
  --vault-name vmperf-kv \
  --name ai-foundry-api-key \
  --value "<your-api-key>"
```

## Container App Deployment

### 1. Create Azure Container Registry

```bash
# Create ACR (or use existing: ca0bf4270c7eacr in Sai-Test-rg)
az acr create \
  --name ca0bf4270c7eacr \
  --resource-group Sai-Test-rg \
  --sku Basic \
  --admin-enabled true
```

### 2. Build and Push Container Images

```bash
# Set correct subscription first
az account set --subscription "ffd7017b-28ed-4e90-a2ec-4a6958578f98"

# Build orchestrator
cd container-app
az acr build \
  --registry ca0bf4270c7eacr \
  --image vmperf-orchestrator:latest .

# Build slack-bot
cd ../slack-bot
az acr build \
  --registry ca0bf4270c7eacr \
  --image vmperf-slack-bot:latest .
```

### 3. Create Key Vault and Secrets

```bash
# Create Key Vault
az keyvault create \
  --name vmperf-kv-<unique-suffix> \
  --resource-group <rg-name> \
  --location <location>

# Add required secrets
az keyvault secret set --vault-name vmperf-kv-<suffix> --name LogAnalyticsWorkspaceId --value "<workspace-id>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name LogAnalyticsClientId --value "<sp-client-id>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name LogAnalyticsClientSecret --value "<sp-secret>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name LogAnalyticsTenantId --value "<default-tenant-id>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name TargetSubscriptionId --value "<default-sub-id>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name OpenAIEndpoint --value "<openai-endpoint>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name OpenAIApiKey --value "<openai-key>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name SendGridApiKey --value "<sendgrid-key>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name EmailAddress --value "<default-email>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name StorageConnectionString --value "<storage-conn-string>"
az keyvault secret set --vault-name vmperf-kv-<suffix> --name Slack-BotToken --value "<slack-bot-token>"
```

### 4. Create Container Apps Environment

```bash
# Create environment
az containerapp env create \
  --name vmperf-env \
  --resource-group <rg-name> \
  --location <location>
```

### 5. Deploy Orchestrator Container App

```bash
az containerapp create \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --environment vmperf-env \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-orchestrator:latest \
  --registry-server ca0bf4270c7eacr.azurecr.io \
  --registry-username ca0bf4270c7eacr \
  --registry-password <acr-password> \
  --target-port 8080 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 1.0 \
  --memory 2Gi \
  --env-vars KEY_VAULT_URL=https://vmperf-kv-18406.vault.azure.net

# Enable managed identity
az containerapp identity assign \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --system-assigned

# Grant Key Vault access
ORCHESTRATOR_IDENTITY=$(az containerapp show --name vmperf-orchestrator --resource-group Sai-Test-rg --query identity.principalId -o tsv)
az keyvault set-policy \
  --name vmperf-kv-18406 \
  --object-id $ORCHESTRATOR_IDENTITY \
  --secret-permissions get list
```

### 6. Deploy Slack Bot Container App

```bash
# Get orchestrator URL (current: vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io)
ORCHESTRATOR_URL=$(az containerapp show --name vmperf-orchestrator --resource-group Sai-Test-rg --query properties.configuration.ingress.fqdn -o tsv)

az containerapp create \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --environment vmperf-env \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-slack-bot:latest \
  --registry-server ca0bf4270c7eacr.azurecr.io \
  --registry-username ca0bf4270c7eacr \
  --registry-password <acr-password> \
  --target-port 3978 \
  --ingress external \
  --min-replicas 1 \
  --max-replicas 1 \
  --cpu 0.5 \
  --memory 1Gi \
  --env-vars KEY_VAULT_URL=https://vmperf-kv-18406.vault.azure.net ORCHESTRATOR_URL=https://$ORCHESTRATOR_URL

# Enable managed identity
az containerapp identity assign \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --system-assigned

# Grant Key Vault access
SLACKBOT_IDENTITY=$(az containerapp show --name vmperf-slack-bot --resource-group Sai-Test-rg --query identity.principalId -o tsv)
az keyvault set-policy \
  --name vmperf-kv-18406 \
  --object-id $SLACKBOT_IDENTITY \
  --secret-permissions get list
```

### 7. Configure Multi-Tenant Storage

Initialize Azure Table Storage with tenant configurations:

```bash
# Create storage tables (run once)
az storage table create --name runs --account-name <storage-account>
az storage table create --name tenants --account-name <storage-account>

# Add tenant configurations
# Example: VEHR tenant
az storage entity insert \
  --table-name tenants \
  --account-name <storage-account> \
  --entity \
    PartitionKey=config \
    RowKey=7e0ad0b6-cd3e-477a-865e-150be7298935 \
    tenantName="VEHR / Amby" \
    subscriptionIds='["00795996-9aef-4113-b543-3466dca3809c"]' \
    logAnalyticsWorkspaces='["77ceef74-c36a-4ed0-b47d-fdd205d5cf4c"]' \
    enabled=true
```

---

## Legacy Deployment (Logic Apps)

### Option 1: Using Deployment Script (Recommended)

```bash
cd deployment

# Set environment variables (optional)
export RESOURCE_GROUP="vmperf-monitoring-rg"
export LOCATION="eastus"

# Make script executable
chmod +x deploy.sh

# Run deployment
./deploy.sh
```

### Option 2: Manual Deployment

```bash
# Login to Azure
az login

# Create resource group
az group create \
  --name vmperf-monitoring-rg \
  --location eastus

# Deploy template
az deployment group create \
  --name vmperf-deployment \
  --resource-group vmperf-monitoring-rg \
  --template-file main.bicep \
  --parameters parameters.json
```

## Post-Deployment Configuration

### 1. Configure API Connections

#### Office 365 Connection
```bash
# Get connection name
OFFICE365_CONNECTION=$(az resource list \
  --resource-group vmperf-monitoring-rg \
  --resource-type Microsoft.Web/connections \
  --query "[?contains(name, 'office365')].name" -o tsv)

# Open in portal for authentication
echo "https://portal.azure.com/#resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/vmperf-monitoring-rg/providers/Microsoft.Web/connections/$OFFICE365_CONNECTION"
```

1. Navigate to the URL above
2. Click "Edit API connection"
3. Click "Authorize"
4. Sign in with Office 365 account
5. Click "Save"

#### Azure Monitor Logs Connection
Repeat the same process for the Azure Monitor Logs connection.

### 2. Update Logic App Workflow

The Bicep template creates a minimal Logic App. Update it with the full workflow:

```bash
# Get Logic App name
LOGIC_APP_NAME=$(az deployment group show \
  --name vmperf-deployment \
  --resource-group vmperf-monitoring-rg \
  --query "properties.outputs.logicAppName.value" -o tsv)

# Update with full definition
az logic workflow update \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --definition @logic-app-definition.json
```

### 3. Configure VM Monitoring

Ensure all target VMs have the following agents installed:
- **Azure Monitor Agent** (recommended) or Log Analytics Agent
- Performance counters configured

Enable monitoring:

```bash
# For each VM or at scale using Policy
az vm extension set \
  --resource-group <vm-rg> \
  --vm-name <vm-name> \
  --name AzureMonitorWindowsAgent \
  --publisher Microsoft.Azure.Monitor \
  --enable-auto-upgrade true
```

### 4. Test the Solution

#### Manual Test Run

```bash
# Trigger Logic App manually
az logic workflow run trigger \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --trigger-name Recurrence
```

#### Verify Execution

```bash
# Check run history
az logic workflow list-runs \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --query "value[0].{Status:status, StartTime:startTime, EndTime:endTime}" -o table
```

#### Test KQL Query

Run the query from `src/queries/vm-metrics-query.kql` in Log Analytics:

```bash
# Get Log Analytics Workspace ID
WORKSPACE_ID="<your-workspace-id>"

# Query via CLI
az monitor log-analytics query \
  --workspace $WORKSPACE_ID \
  --analytics-query @../src/queries/vm-metrics-query.kql \
  --timespan P7D
```

## Container App Verification

### Health Checks

```bash
# Check orchestrator health (current deployment)
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health

# Check slack-bot health
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health

# Or dynamically get URLs
ORCHESTRATOR_URL=$(az containerapp show --name vmperf-orchestrator --resource-group Sai-Test-rg --query properties.configuration.ingress.fqdn -o tsv)
curl https://$ORCHESTRATOR_URL/health

SLACKBOT_URL=$(az containerapp show --name vmperf-slack-bot --resource-group Sai-Test-rg --query properties.configuration.ingress.fqdn -o tsv)
curl https://$SLACKBOT_URL/health
```

### Test Orchestration

```bash
# Trigger a test run
curl -X POST https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "subscriptionId": "<subscription-id>",
    "tenantId": "<tenant-id>",
    "requestedByEmail": "your-email@company.com"
  }'
```

### View Container Logs

```bash
# Orchestrator logs
az containerapp logs show \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --follow

# Slack bot logs
az containerapp logs show \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --follow
```

### Verification Checklist (Container Apps)

- [ ] Container Registry created with images pushed
- [ ] Key Vault created with all required secrets
- [ ] Container Apps Environment created
- [ ] vmperf-orchestrator deployed and healthy
- [ ] vmperf-slack-bot deployed and healthy
- [ ] Managed identities assigned to both apps
- [ ] Key Vault access policies configured
- [ ] Tenant configurations in Azure Table Storage
- [ ] Service Principal has access to all tenant workspaces
- [ ] Slack app configured with correct endpoint URL
- [ ] Test orchestration completes successfully

## Legacy Verification Checklist (Logic Apps)

- [ ] Resource group created successfully
- [ ] Logic App deployed and enabled
- [ ] Storage account created with reports container
- [ ] Office 365 connection authorized
- [ ] Azure Monitor Logs connection authorized
- [ ] Log Analytics workspace contains VM performance data
- [ ] AI Foundry endpoint accessible and responding
- [ ] Manual test run completes successfully
- [ ] Email reports delivered to recipients
- [ ] Reports archived in storage account

## Monitoring the Solution

### View Logic App Runs

```bash
# List recent runs
az logic workflow list-runs \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --query "value[].{Status:status, Start:startTime, Duration:duration}" -o table
```

### Check Logs

```bash
# View diagnostic logs
az monitor diagnostic-settings list \
  --resource $(az logic workflow show \
    --resource-group vmperf-monitoring-rg \
    --name $LOGIC_APP_NAME \
    --query id -o tsv)
```

### Cost Monitoring

Approximate monthly costs:
- Logic App: $0-50 (depends on actions)
- AI Foundry: $10-100 (depends on model and usage)
- Storage: $1-5
- Log Analytics: $5-50 (depends on data ingestion)

**Total estimated: $16-205/month**

## Troubleshooting

### Container App Issues

#### Issue: 403 Forbidden from Log Analytics

**Cause**: OAuth authentication using wrong tenant ID

**Solution**:
1. Verify tenant configuration in Azure Table Storage
2. Ensure `tenantId` matches the Azure AD tenant for the target subscription
3. Check service principal has Reader access to the workspace

```bash
# Verify tenant config
az storage entity show \
  --table-name tenants \
  --account-name <storage> \
  --partition-key config \
  --row-key <tenant-id>

# Grant SP access to workspace
az role assignment create \
  --assignee <sp-client-id> \
  --role "Log Analytics Reader" \
  --scope "/subscriptions/<sub>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<workspace>"
```

#### Issue: Subscription Search Not Finding Results

**Cause**: Search term doesn't match normalized name

**Solution**: The search uses fuzzy matching. Try variations:
- "vehr management" → "VEHR-Management" ✓
- "vehr-management" → "VEHR-Management" ✓
- "vehrmanagement" → "VEHR-Management" ✓

#### Issue: Slack Progress Messages Not Appearing

**Cause**: Missing channel ID or Slack token

**Solution**:
1. Verify `Slack-BotToken` secret exists in Key Vault
2. Ensure bot is invited to the Slack channel
3. Check `channelId` is being passed in orchestration request

```bash
# Verify Slack token
az keyvault secret show \
  --vault-name vmperf-kv-<suffix> \
  --name Slack-BotToken
```

#### Issue: Container App Not Starting

**Cause**: Missing environment variables or identity issues

**Solution**:
```bash
# Check container logs
az containerapp logs show \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --tail 100

# Verify managed identity
az containerapp show \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --query identity
```

#### ✅ RESOLVED: Download Links Now Available via Slack Command

**Previous Issue**: Users couldn't retrieve report download links after the orchestration completed. Links only appeared in progress messages.

**Fix Implemented** (January 2026):
1. Added `/api/reports/latest/download` endpoint to orchestrator
2. Added `getReportDownloads()` method to `orchestrationClient.js`
3. Added "download" and "regenerate" command handlers in `vmPerfBot.js`

**Current Behavior**:
- Type "download" in Slack to get report download links
- Type "regenerate download" or "regenerate" to get fresh 1-hour links
- Links are valid for up to 7 days after report generation

**Verification**:
```bash
# Test download endpoint
curl -s "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/reports/latest/download" | jq .downloads
```

---

#### ✅ RESOLVED: "Show Summary" Now Shows Run Context VM Count

**Previous Issue**: When user selected a subscription and typed "Show summary", the bot displayed total inventory VMs instead of the VMs analyzed in that subscription's latest run.

**Fix Implemented** (January 2026):
1. Added `/api/runs/latest/summary` endpoint to orchestrator
2. Added `getRunSummary()` method to `orchestrationClient.js`
3. Updated `vmPerfBot.js` to use run summary when subscription context is set

**Current Behavior**:
- With subscription context: Shows analysis results from the latest run for that subscription
- Without subscription context: Shows cross-tenant inventory summary

**Verification**:
```bash
# Test run summary endpoint
curl "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/runs/latest/summary?subscriptionId=3c150c28-d2a0-4152-92b2-64774e9bcbe7" | jq .

# Compare with cross-tenant summary (inventory)
curl "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/summary" | jq .totalVMs
```

---

### v9 Feature: Dynamic AI-Generated Queries (February 2026)

The v9 release adds support for dynamic AI-generated queries. Users can ask natural language questions and the system will:
1. Determine query type (KQL for metrics, Resource Graph for inventory)
2. Generate appropriate query via Azure OpenAI
3. Validate query for security
4. Execute and return results

**Slack Commands**:
| Command | Description |
|---------|-------------|
| "Show VMs with high CPU" | Generates KQL query for CPU metrics |
| "List all VMs in eastus" | Generates Resource Graph query |
| "What VMs have memory > 80%" | Generates KQL query for memory |

**API Endpoints**:
```bash
# Execute dynamic KQL query
curl -X POST "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/query/dynamic-kql" \
  -H "Content-Type: application/json" \
  -d '{"query": "Perf | where CounterName == \"% Processor Time\" | take 10"}'

# Execute dynamic Resource Graph query
curl -X POST "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/query/dynamic-resourcegraph" \
  -H "Content-Type: application/json" \
  -d '{"query": "Resources | where type == \"microsoft.compute/virtualmachines\" | take 10"}'
```

**Security Validation**:
- Table whitelist: Only Perf, Heartbeat, AzureDiagnostics, InsightsMetrics, etc.
- Blocks dangerous operations: .delete, .set, .drop, .alter, union *, etc.
- Injection pattern detection
- Comment stripping
- Query length and result limits

**Auto-Detect Delivery**:
- ≤50 rows: Results displayed inline in Slack
- >50 rows: Results sent via email, summary in Slack

**Required Key Vault Secrets**:
- `OpenAIEndpoint` - Azure OpenAI endpoint URL
- `OpenAIApiKey` - Azure OpenAI API key
- `OpenAIDeploymentName` (optional) - Defaults to 'gpt-4'

**Verification**:
```bash
# Test dynamic KQL endpoint
curl -X POST "https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/query/dynamic-kql" \
  -H "Content-Type: application/json" \
  -d '{"query": "Perf | take 1"}' | jq .

# Check slack-bot health for OpenAI status
curl -s "https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health" | jq .
```

---

### Legacy Issues

### Issue: No VMs in Report

**Cause**: VMs not sending metrics to Log Analytics

**Solution**:
```bash
# Verify VM monitoring is enabled
az vm list --query "[].{Name:name, RG:resourceGroup}" -o table

# Check each VM for monitoring extension
az vm extension list \
  --resource-group <vm-rg> \
  --vm-name <vm-name> \
  --query "[?contains(name, 'Monitor')]" -o table
```

### Issue: Logic App Fails with Authentication Error

**Cause**: API connections not authorized

**Solution**: Re-authorize connections in Azure Portal

### Issue: AI Foundry Returns Errors

**Cause**: Invalid endpoint or API key

**Solution**:
```bash
# Test endpoint manually
curl -X POST \
  "<ai-foundry-endpoint>" \
  -H "Content-Type: application/json" \
  -H "api-key: <your-key>" \
  -d '{"messages":[{"role":"user","content":"test"}],"max_tokens":10}'
```

### Issue: Empty Email Reports

**Cause**: KQL query returns no results

**Solution**: Check date range and performance counter configuration in Log Analytics

## Maintenance

### Update AI Prompts

1. Edit prompts in `src/prompts/`
2. Update Logic App workflow to use new prompts
3. Test with manual run

### Modify Schedule

```bash
# Update recurrence schedule
az logic workflow update \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --set "definition.triggers.Recurrence.recurrence.schedule.weekDays=['Wednesday']"
```

### Update Email Recipients

```bash
# Update parameters
az logic workflow update \
  --resource-group vmperf-monitoring-rg \
  --name $LOGIC_APP_NAME \
  --set "definition.parameters.technicalEmailRecipients.defaultValue='new-email@company.com'"
```

## Cleanup

To remove all deployed resources:

```bash
# Delete resource group (removes all resources)
az group delete \
  --name vmperf-monitoring-rg \
  --yes \
  --no-wait
```

## Support

For issues or questions:
1. Check Azure Logic App run history for detailed error messages
2. Review Log Analytics workspace for data availability
3. Verify AI Foundry endpoint and quota
4. Contact your Azure administrator for permissions issues
