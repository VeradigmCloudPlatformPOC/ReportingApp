# Configuration Guide - VM Performance Monitoring Solution

## Overview
This guide covers customizing the VM Performance Monitoring Solution for your specific environment and requirements.

## Configuration Files

### 1. Deployment Parameters (`deployment/parameters.json`)

#### Basic Configuration
```json
{
  "location": {
    "value": "eastus"
    // Options: Any Azure region with AI Foundry support
    // Recommended: eastus, westeurope, westus2
  },
  "resourcePrefix": {
    "value": "vmperf"
    // Naming prefix for all resources
    // Must be lowercase, alphanumeric, max 8 chars
  }
}
```

#### Email Configuration
```json
{
  "technicalEmailRecipients": {
    "value": "devops@company.com,platform-eng@company.com"
    // Comma-separated list of email addresses
    // These recipients get detailed technical reports
  },
  "executiveEmailRecipients": {
    "value": "cto@company.com,leadership@company.com"
    // Comma-separated list of email addresses
    // These recipients get high-level executive summaries
  }
}
```

#### Schedule Configuration
```json
{
  "scheduleDayOfWeek": {
    "value": "Monday"
    // Options: Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday
  },
  "scheduleHour": {
    "value": 8
    // Hour in UTC (0-23)
    // 8 = 8:00 AM UTC
  }
}
```

### 2. KQL Query Customization (`src/queries/vm-metrics-query.kql`)

#### Adjust Time Window
```kql
// Default: 7 days
let startDate = ago(7d);

// Options:
let startDate = ago(3d);   // 3 days
let startDate = ago(14d);  // 2 weeks
let startDate = ago(30d);  // 1 month
```

#### Filter Specific Resource Groups
```kql
// Add after vmDetails definition
| where ResourceGroup in ("production-rg", "staging-rg")
```

#### Exclude Test VMs
```kql
// Add to final query
| where not(VMName startswith "test-" or VMName startswith "dev-")
```

#### Filter by Tags
```kql
// Add Azure Resource Graph query for tag filtering
let taggedVMs = ResourceContainers
| where type =~ "microsoft.compute/virtualmachines"
| where tags["Environment"] == "Production"
| project VMName = name;

// Then join with main query
```

### 3. AI Prompt Customization

#### Technical Report Prompt (`src/prompts/technical-analysis.txt`)

**Modify Thresholds:**
```
Default thresholds:
- CPU P95 < 20% = Underutilized
- CPU P95 > 80% = Overutilized

Custom thresholds (edit in prompt):
- CPU P95 < 25% = Underutilized (more conservative)
- CPU P95 > 75% = Overutilized (more aggressive)
```

**Add Custom Sections:**
```
Add after "Risk Assessment" section:

### Compliance Notes
- [HIPAA/PCI/SOC2 considerations]
- [Data residency requirements]

### Backup Impact
- [Backup window considerations]
- [RPO/RTO impact]
```

#### Executive Report Prompt (`src/prompts/executive-analysis.txt`)

**Customize Business Context:**
```
Add to executive summary guidance:

- Link recommendations to business OKRs
- Include department-specific insights
- Reference budget cycles and planning periods
```

### 4. Email Template Customization

#### Technical Email (`src/templates/email-technical.html`)

**Change Color Scheme:**
```css
/* Current: Blue theme */
.header {
    background: linear-gradient(135deg, #0078d4 0%, #004a8c 100%);
}

/* Custom: Green theme */
.header {
    background: linear-gradient(135deg, #107c10 0%, #004b1c 100%);
}
```

**Add Company Logo:**
```html
<!-- Add after <div class="header"> -->
<img src="https://yourcompany.com/logo.png"
     alt="Company Logo"
     style="height: 40px; margin-bottom: 10px;">
```

**Add Custom Footer Links:**
```html
<div class="footer">
    <!-- Existing content -->
    <p>
        <a href="https://wiki.company.com/vm-sizing">Sizing Guidelines</a> |
        <a href="https://wiki.company.com/runbooks">Runbooks</a> |
        <a href="mailto:platform-team@company.com">Support</a>
    </p>
</div>
```

#### Executive Email (`src/templates/email-executive.html`)

Similar customizations available for executive report.

## Multi-Tenant Configuration

### Tenant Configuration in Azure Table Storage

Each tenant is stored in the `tenants` table with the following structure:

| Field | Type | Description |
|-------|------|-------------|
| `tenantId` | string | Azure AD tenant GUID (RowKey) |
| `tenantName` | string | Friendly name (e.g., "Veradigm Production") |
| `subscriptionIds` | JSON array | List of subscription IDs |
| `logAnalyticsWorkspaces` | JSON array | Workspace IDs for this tenant |
| `enabled` | boolean | Whether tenant is active |

### Example Tenant Configuration

```json
{
  "tenantId": "7e0ad0b6-cd3e-477a-865e-150be7298935",
  "tenantName": "VEHR / Amby",
  "subscriptionIds": [
    "00795996-9aef-4113-b543-3466dca3809c"
  ],
  "logAnalyticsWorkspaces": [
    "77ceef74-c36a-4ed0-b47d-fdd205d5cf4c"
  ],
  "enabled": true
}
```

### Per-Tenant OAuth Authentication

The system authenticates to each tenant's Log Analytics workspace using per-tenant OAuth:

1. **Service Principal**: Single SP with access to multiple tenants
2. **OAuth Token**: Retrieved using tenant-specific Azure AD endpoint
3. **Workspace Query**: Uses tenant's Log Analytics workspace ID

```javascript
// Per-tenant OAuth flow
const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
// Uses same clientId/clientSecret but tenant-specific OAuth
```

### Key Vault Secrets Required

| Secret Name | Description |
|-------------|-------------|
| `LogAnalyticsWorkspaceId` | Default workspace (fallback) |
| `LogAnalyticsClientId` | Service principal client ID |
| `LogAnalyticsClientSecret` | Service principal secret |
| `LogAnalyticsTenantId` | Default Azure AD tenant (fallback) |
| `TargetSubscriptionId` | Default subscription (fallback) |
| `OpenAIEndpoint` | Azure OpenAI endpoint URL |
| `OpenAIApiKey` | Azure OpenAI API key |
| `SendGridApiKey` | SendGrid API key for emails |
| `EmailAddress` | Default recipient email |
| `StorageConnectionString` | Azure Storage for state/results |
| `Slack-BotToken` | Slack bot OAuth token |

### Adding a New Tenant

1. **Create Service Principal Access**:
   ```bash
   # Grant SP access to new tenant's Log Analytics workspace
   az role assignment create \
     --assignee <sp-client-id> \
     --role "Log Analytics Reader" \
     --scope "/subscriptions/<sub-id>/resourceGroups/<rg>/providers/Microsoft.OperationalInsights/workspaces/<workspace>"
   ```

2. **Add Tenant to Table Storage**:
   ```bash
   # Use Azure Storage Explorer or CLI to add tenant config
   az storage entity insert \
     --table-name tenants \
     --entity PartitionKey=config \
              RowKey=<tenant-id> \
              tenantName="New Tenant" \
              subscriptionIds='["sub-id-1","sub-id-2"]' \
              logAnalyticsWorkspaces='["workspace-id"]' \
              enabled=true
   ```

## Slack Bot Configuration

### Subscription Search (Fuzzy Matching)

The bot supports fuzzy subscription search that normalizes input:
- "vehr management" → "VEHR-Management" ✓
- "veradigm prod" → "Veradigm-Production" ✓

Normalization removes spaces, hyphens, and underscores for flexible matching.

### Progress Notifications

During orchestration, the bot sends step-by-step progress to Slack:

| Step | Message |
|------|---------|
| 1/5 | 🔍 Querying Log Analytics |
| 1 Complete | ✅ Found X VMs (+ "WOW!" if >50) |
| 2/5 | 📁 Getting VM Inventory |
| 3/5 | 🤖 AI Analysis |
| 4/5 | 📄 Generating Reports |
| 5/5 | 📧 Sending Emails |
| Complete | 🎉 Analysis Complete! |

## Advanced Configuration

### 1. Multiple Environments

Deploy separate instances for different environments:

```bash
# Production
export RESOURCE_GROUP="vmperf-prod-rg"
export WORKSPACE_ID="/subscriptions/.../production-workspace"
./deploy.sh

# Staging
export RESOURCE_GROUP="vmperf-staging-rg"
export WORKSPACE_ID="/subscriptions/.../staging-workspace"
./deploy.sh
```

### 2. Custom Performance Thresholds

Create environment-specific thresholds:

```json
// Add to Logic App parameters
{
  "performanceThresholds": {
    "production": {
      "cpu_underutilized": 15,
      "cpu_overutilized": 85,
      "memory_underutilized": 25,
      "memory_overutilized": 90
    },
    "development": {
      "cpu_underutilized": 10,
      "cpu_overutilized": 70,
      "memory_underutilized": 20,
      "memory_overutilized": 80
    }
  }
}
```

### 3. Integration with Cost Management

Add Azure Cost Management queries to Logic App:

```json
{
  "actions": {
    "Get_VM_Costs": {
      "type": "Http",
      "inputs": {
        "method": "POST",
        "uri": "https://management.azure.com/subscriptions/@{variables('SubscriptionId')}/providers/Microsoft.CostManagement/query",
        "authentication": {
          "type": "ManagedServiceIdentity"
        },
        "body": {
          "type": "ActualCost",
          "timeframe": "MonthToDate",
          "dataset": {
            "granularity": "None",
            "aggregation": {
              "totalCost": {
                "name": "Cost",
                "function": "Sum"
              }
            }
          }
        }
      }
    }
  }
}
```

### 4. Add Alerting

Configure alerts for high-priority VMs:

```bash
# Create action group
az monitor action-group create \
  --name vmperf-alerts \
  --resource-group vmperf-monitoring-rg \
  --short-name vmperf \
  --email-receiver email=devops@company.com

# Create alert for overutilized VMs
az monitor metrics alert create \
  --name vm-high-cpu-alert \
  --resource-group production-rg \
  --scopes "/subscriptions/.../resourceGroups/production-rg" \
  --condition "avg Percentage CPU > 90" \
  --window-size 5m \
  --evaluation-frequency 1m \
  --action vmperf-alerts
```

### 5. Multi-Subscription Support

Modify KQL query to include multiple subscriptions:

```kql
// Query across multiple subscriptions
union
  (workspace("<workspace-id-1>").Perf | where ...),
  (workspace("<workspace-id-2>").Perf | where ...)
| summarize ...
```

Grant Logic App access to multiple subscriptions:

```bash
# For each subscription
az role assignment create \
  --assignee <logic-app-principal-id> \
  --role "Reader" \
  --scope "/subscriptions/<subscription-id>"
```

## Performance Tuning

### 1. Optimize KQL Query

```kql
// Use specific time ranges
| where TimeGenerated > ago(7d)

// Limit data early in query
| where Computer in (dynamic(["vm1", "vm2", "vm3"]))

// Use summarize instead of multiple queries
| summarize
    CPU_Max = max(CPUValue),
    Mem_Max = max(MemValue),
    Disk_Max = max(DiskValue)
    by Computer
```

### 2. Batch Processing

For large environments (100+ VMs), implement batching:

```json
{
  "actions": {
    "Batch_VMs": {
      "type": "Compose",
      "inputs": "@chunk(body('Parse_VMs'), 20)"
    },
    "For_Each_Batch": {
      "foreach": "@outputs('Batch_VMs')",
      "actions": {
        "Process_Batch": {
          "type": "Http",
          "inputs": {
            "method": "POST",
            "uri": "@parameters('aiFoundryEndpoint')",
            "body": {
              "vms": "@items('For_Each_Batch')"
            }
          }
        }
      }
    }
  }
}
```

### 3. Caching Strategy

Implement caching for frequently accessed data:

```json
{
  "actions": {
    "Check_Cache": {
      "type": "ApiConnection",
      "inputs": {
        "host": {
          "connection": {
            "name": "@parameters('$connections')['azureblob']['connectionId']"
          }
        },
        "method": "get",
        "path": "/datasets/default/files/@{encodeURIComponent('cache/vm-pricing.json')}/content"
      },
      "runAfter": {}
    }
  }
}
```

## Security Configuration

### 1. Managed Identity Setup

```bash
# Grant specific permissions
az role assignment create \
  --assignee <logic-app-principal-id> \
  --role "Log Analytics Reader" \
  --scope "/subscriptions/.../resourceGroups/.../providers/Microsoft.OperationalInsights/workspaces/..."

# Avoid using "Contributor" - use least privilege
```

### 2. Key Vault Integration

```bash
# Store all secrets in Key Vault
az keyvault secret set \
  --vault-name vmperf-kv \
  --name ai-foundry-api-key \
  --value "<key>"

az keyvault secret set \
  --vault-name vmperf-kv \
  --name office365-client-secret \
  --value "<secret>"
```

Reference in Logic App:

```json
{
  "parameters": {
    "aiFoundryApiKey": {
      "type": "securestring",
      "value": "@secretsJson(body('Get_Secret')).value"
    }
  }
}
```

### 3. Network Isolation

For highly secure environments:

```bash
# Deploy Logic App with VNet integration
az logic workflow create \
  --resource-group vmperf-monitoring-rg \
  --name vmperf-logic-app \
  --integration-service-environment <ise-id>
```

## Cost Optimization

### 1. Reduce AI Foundry Costs

```json
// Use GPT-3.5-turbo for technical reports (cheaper)
"technicalModel": "gpt-35-turbo",

// Use GPT-4 only for executive summaries (more expensive but better quality)
"executiveModel": "gpt-4",

// Reduce token usage
"max_tokens": 1000,  // Default: 2000
"temperature": 0.1    // More deterministic = fewer retries
```

### 2. Optimize Log Analytics

```kql
// Query only necessary fields
| project Computer, TimeGenerated, CounterValue
// vs.
| project * // Expensive!

// Use time-generated index
| where TimeGenerated > ago(7d)
// vs.
| where format_datetime(TimeGenerated, 'yyyy-MM-dd') > '2024-01-01'
```

### 3. Schedule Optimization

```json
// Run during off-peak hours for lower costs
"schedule": {
  "hours": [2],  // 2 AM UTC
  "weekDays": ["Monday"]
}
```

## Testing Configuration

### 1. Test with Sample Data

```bash
# Create test VMs or use sample data
az logic workflow run trigger \
  --resource-group vmperf-monitoring-rg \
  --name vmperf-logic-app \
  --trigger-name manual
```

### 2. Validate Email Templates

```bash
# Send test email
az logic workflow run trigger \
  --resource-group vmperf-monitoring-rg \
  --name vmperf-logic-app \
  --trigger-name manual \
  --parameters '{"testMode": true, "testRecipients": "your-email@company.com"}'
```

### 3. Dry Run Mode

Add a parameter for dry-run (no emails sent):

```json
{
  "parameters": {
    "dryRunMode": {
      "type": "bool",
      "defaultValue": false
    }
  },
  "actions": {
    "Condition_Send_Email": {
      "type": "If",
      "expression": {
        "and": [
          {"equals": ["@parameters('dryRunMode')", false]}
        ]
      },
      "actions": {
        "Send_Email": { ... }
      }
    }
  }
}
```

## Troubleshooting Configuration Issues

### Common Issues

1. **No emails received**: Check Office 365 connection authorization
2. **Empty reports**: Verify KQL query returns data in Log Analytics
3. **High costs**: Review AI model usage and token limits
4. **Timeout errors**: Implement batching for large VM counts

### Debug Mode

Enable detailed logging:

```json
{
  "definition": {
    "actions": {
      "Log_Debug_Info": {
        "type": "Compose",
        "inputs": {
          "vmCount": "@length(body('Parse_VMs'))",
          "timestamp": "@utcNow()",
          "queryResults": "@body('Query_Log_Analytics')"
        }
      }
    }
  }
}
```

## Support and Resources

- **Azure Logic Apps Documentation**: https://docs.microsoft.com/azure/logic-apps/
- **AI Foundry Documentation**: https://aka.ms/aistudio/docs
- **KQL Reference**: https://docs.microsoft.com/azure/data-explorer/kusto/query/
- **Community Support**: Open an issue in the GitHub repository
