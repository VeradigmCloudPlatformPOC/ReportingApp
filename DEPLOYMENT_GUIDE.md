# Deployment Guide - VM Performance Monitoring Solution

## Current Production - v12 Microservices Architecture

**Clark** - Your CloudOps Agent for VM performance monitoring, right-sizing recommendations, and cost optimization.

### Azure Resources

| Resource | Name | Details |
|----------|------|---------|
| **Subscription** | Zirconium - Veradigm Sandbox | `ffd7017b-28ed-4e90-a2ec-4a6958578f98` |
| **Resource Group** | Sai-Test-rg | West US 2 |
| **Container Registry** | ca0bf4270c7eacr | `ca0bf4270c7eacr.azurecr.io` |
| **Key Vault** | vmperf-kv-18406 | Stores all secrets |
| **Storage Account** | vmperfstore18406 | Tables: runs, tenants; Containers: reports, analysis-results, batch-results |

### Microservices

| Service | Container App | Purpose |
|---------|--------------|---------|
| **Slack Bot (Clark)** | vmperf-slack-bot | User interface, AI agent, smart routing |
| **Resource Graph (App 1)** | vmperf-resource-graph | VM inventory, search, summary |
| **Short-Term LA (App 2)** | vmperf-la-short | KQL queries ≤10 days |
| **Long-Term LA (App 3)** | vmperf-la-long | 30-day metrics, batch processing |
| **Right-Sizing (App 4)** | vmperf-rightsizing | AI recommendations, email reports |
| **Legacy Orchestrator** | vmperf-orchestrator | Reports, email delivery |

### Service URLs

```
Slack Bot:       https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io
Resource Graph:  https://vmperf-resource-graph.calmsand-17418731.westus2.azurecontainerapps.io
Short-Term LA:   https://vmperf-la-short.calmsand-17418731.westus2.azurecontainerapps.io
Long-Term LA:    https://vmperf-la-long.calmsand-17418731.westus2.azurecontainerapps.io
Right-Sizing:    https://vmperf-rightsizing.calmsand-17418731.westus2.azurecontainerapps.io
Orchestrator:    https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io
```

---

## Quick Deployment Commands

### Set Azure Subscription
```bash
az account set --subscription "ffd7017b-28ed-4e90-a2ec-4a6958578f98"
```

### Build & Deploy Slack Bot
```bash
cd slack-bot
az acr build --registry ca0bf4270c7eacr --image vmperf-slack-bot:v12 .
az containerapp update --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-slack-bot:v12
```

### Build & Deploy All Microservices
```bash
# Resource Graph (App 1)
cd resource-graph-service
az acr build --registry ca0bf4270c7eacr --image vmperf-resource-graph:v12 .
az containerapp update --name vmperf-resource-graph --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-resource-graph:v12

# Short-Term LA (App 2)
cd ../loganalytics-short-service
az acr build --registry ca0bf4270c7eacr --image vmperf-la-short:v12 .
az containerapp update --name vmperf-la-short --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-la-short:v12

# Long-Term LA (App 3)
cd ../loganalytics-long-service
az acr build --registry ca0bf4270c7eacr --image vmperf-la-long:v12 .
az containerapp update --name vmperf-la-long --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-la-long:v12

# Right-Sizing (App 4)
cd ../rightsizing-service
az acr build --registry ca0bf4270c7eacr --image vmperf-rightsizing:v12 .
az containerapp update --name vmperf-rightsizing --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-rightsizing:v12

# Legacy Orchestrator
cd ../container-app
az acr build --registry ca0bf4270c7eacr --image vmperf-orchestrator:v12 .
az containerapp update --name vmperf-orchestrator --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-orchestrator:v12
```

### Health Check
```bash
echo "=== Health Check ==="
curl -s https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .version
curl -s https://vmperf-resource-graph.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .status
curl -s https://vmperf-la-short.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .status
curl -s https://vmperf-la-long.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .status
curl -s https://vmperf-rightsizing.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .status
curl -s https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health | jq .status
```

---

## Clark - The CloudOps Agent

### Features
- **Conversational Interface**: Natural language queries via Slack
- **VM Performance Reports**: 30-day analysis with AI-powered recommendations
- **Right-Sizing**: Identifies underutilized/overutilized VMs with cost savings
- **Multi-Tenant Support**: 107 subscriptions across 2 tenants
- **Email Reports**: Detailed reports delivered via SendGrid

### Slack Commands
| Command | Description |
|---------|-------------|
| `hello` / `hi` | Welcome message with tenant summary |
| `list subscriptions` | Full list of available subscriptions |
| `<subscription name>` | Set subscription context |
| `run a performance report` | Trigger 30-day VM analysis |
| `show underutilized VMs` | List VMs with low utilization |
| `show overutilized VMs` | List VMs with high utilization |
| `show summary` | Latest analysis summary |
| `investigate <vm-name>` | Detailed metrics for a specific VM |
| `clear` | Clear subscription context |

### Example Conversation
```
User: hello
Clark: Hey! I'm Clark, your CloudOps Agent.
       I have access to 107 subscriptions across 2 tenants:
       • VEHR / Amby: 2 subscriptions
       • Veradigm Production: 105 subscriptions
       Say "list subscriptions" to see the full list...

User: payerpath dev
Clark: Subscription selected: Praseodymium - Payerpath Dev
       Tenant: Veradigm Production
       You can now ask me anything!

User: run a performance report
Clark: On it! Let me run a performance analysis for Praseodymium - Payerpath Dev.
       ████░░░░░░ Initializing...
       (Analysis continues with progress updates)
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Slack (User Interface)                    │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              Slack Bot (Clark) - Smart Router                │
│  • AI Foundry Agent for natural language                     │
│  • Command interception for performance reports              │
│  • Subscription context management                           │
└───────┬─────────┬─────────┬─────────┬───────────────────────┘
        │         │         │         │
        ▼         ▼         ▼         ▼
┌───────────┐ ┌───────────┐ ┌───────────┐ ┌───────────┐
│  App 1    │ │  App 2    │ │  App 3    │ │  App 4    │
│ Resource  │ │ Short-Term│ │ Long-Term │ │ Right-    │
│  Graph    │ │    LA     │ │    LA     │ │  Sizing   │
│           │ │           │ │           │ │           │
│ • VM      │ │ • KQL     │ │ • 30-day  │ │ • AI      │
│   inventory│ │   queries │ │   metrics │ │   analysis│
│ • Search  │ │ • ≤10 days│ │ • Batch   │ │ • Email   │
│ • Summary │ │           │ │   process │ │   reports │
└───────────┘ └───────────┘ └───────────┘ └───────────┘
```

---

## Key Vault Secrets

Required secrets in `vmperf-kv-18406`:

| Secret Name | Purpose |
|-------------|---------|
| `OpenAIEndpoint` | Azure OpenAI endpoint URL |
| `OpenAIApiKey` | Azure OpenAI API key |
| `SendGridApiKey` | SendGrid email API key |
| `EmailAddress` | Default sender email |
| `StorageConnectionString` | Azure Storage connection |
| `Slack-BotToken` | Slack bot OAuth token |
| `Slack-SigningSecret` | Slack request verification |
| `AIFoundry-ConnectionString` | AI Foundry project connection |

---

## Managed Identity Setup

Each Container App uses system-assigned managed identity:

```bash
# Assign managed identity
az containerapp identity assign \
  --name <app-name> \
  --resource-group Sai-Test-rg \
  --system-assigned

# Get principal ID
PRINCIPAL_ID=$(az containerapp show --name <app-name> --resource-group Sai-Test-rg --query identity.principalId -o tsv)

# Grant Key Vault access
az keyvault set-policy \
  --name vmperf-kv-18406 \
  --object-id $PRINCIPAL_ID \
  --secret-permissions get list

# Grant Storage access (for App 3)
az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Storage Blob Data Contributor" \
  --scope "/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/Microsoft.Storage/storageAccounts/vmperfstore18406"

az role assignment create \
  --assignee $PRINCIPAL_ID \
  --role "Storage Queue Data Contributor" \
  --scope "/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/Sai-Test-rg/providers/Microsoft.Storage/storageAccounts/vmperfstore18406"
```

---

## Environment Variables

### Slack Bot
```bash
KEY_VAULT_URL=https://vmperf-kv-18406.vault.azure.net
ORCHESTRATOR_URL=https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io
RESOURCE_GRAPH_SERVICE_URL=https://vmperf-resource-graph.calmsand-17418731.westus2.azurecontainerapps.io
SHORT_TERM_LA_SERVICE_URL=https://vmperf-la-short.calmsand-17418731.westus2.azurecontainerapps.io
LONG_TERM_LA_SERVICE_URL=https://vmperf-la-long.calmsand-17418731.westus2.azurecontainerapps.io
```

### Microservices (App 1-4)
```bash
KEY_VAULT_URL=https://vmperf-kv-18406.vault.azure.net
AZURE_STORAGE_ACCOUNT_NAME=vmperfstore18406
USE_MANAGED_IDENTITY_STORAGE=true
```

---

## API Endpoints

### App 3: Long-Term LA (Batch Processing)
```bash
# Start reliable metrics collection
POST /api/metrics/collect/reliable
{ "subscriptionId": "...", "timeRangeDays": 30 }

# Check job status
GET /api/metrics/job/{jobId}

# Get completed results
GET /api/metrics/job/{jobId}/results
```

### App 4: Right-Sizing
```bash
# Full analysis with email
POST /api/rightsizing/analyze
{ "subscriptionId": "...", "timeRangeDays": 30, "userEmail": "..." }

# Quick preview (no email)
POST /api/rightsizing/quick
{ "subscriptionId": "..." }
```

---

## Revision Management

### Check Active Revision
```bash
az containerapp revision list --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --query "[0:3].{name:name, trafficWeight:properties.trafficWeight, state:properties.runningState}" -o table
```

### Cleanup Old Revisions
```bash
# Set max inactive revisions
az containerapp update --name vmperf-slack-bot --resource-group Sai-Test-rg \
  --max-inactive-revisions 5
```

---

## Troubleshooting

### Common Issues

| Issue | Solution |
|-------|----------|
| Bot not responding | Check revision status: `az containerapp revision list` |
| "No subscriptions" | Verify orchestrator health and Key Vault access |
| Reports not sending | Check SendGrid API key in Key Vault |
| Slow performance report | Large subscription - check App 3 batch queue |

### View Logs
```bash
az containerapp logs show --name vmperf-slack-bot --resource-group Sai-Test-rg --follow
```

### Health Endpoints
All services expose `/health` for monitoring.

---

## Release History

| Version | Date | Description |
|---------|------|-------------|
| `v12-fix3` | 2026-02-05 | Clark persona, compact welcome, human-like responses |
| `v12.0.0` | 2026-02-04 | Microservices architecture, reliable batch processing |

---

## Support

For issues:
1. Check container app logs
2. Verify Key Vault secrets
3. Test health endpoints
4. Review AI Foundry agent status
