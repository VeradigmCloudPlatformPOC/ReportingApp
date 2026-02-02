# Architecture Documentation

## System Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                    Azure Subscription: Zirconium - Veradigm Sandbox         │
│                                                                             │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │                 Target Subscription (VM Monitoring)                    │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐                      │  │
│  │  │  VM 1  │  │  VM 2  │  │  VM 3  │  │ VM 194 │  ...                 │  │
│  │  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘                      │  │
│  │       │           │           │           │                           │  │
│  │       │     Azure Monitor Agent / Log Analytics Agent                 │  │
│  │       │           │           │           │                           │  │
│  └───────┼───────────┼───────────┼───────────┼───────────────────────────┘  │
│          │           │           │           │                              │
│          └───────────┴───────────┴───────────┘                              │
│                          │                                                   │
│                          ▼                                                   │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │              Log Analytics Workspace (aa7bf3ad-...)                    │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Performance Counters (Perf table):                             │  │  │
│  │  │  • Processor % Processor Time (_Total)                          │  │  │
│  │  │  • Memory % Committed Bytes In Use                              │  │  │
│  │  │  • LogicalDisk Reads/sec + Writes/sec (IOPS)                   │  │  │
│  │  │  • 7-day analysis window                                        │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  └────────────────────────────┬──────────────────────────────────────────┘  │
│                               │                                              │
│                               │ KQL Query via REST API                       │
│                               ▼                                              │
│  ┌───────────────────────────────────────────────────────────────────────┐  │
│  │           Azure Container App: vmperf-orchestrator                     │  │
│  │           Environment: vmperf-env (West US 2)                          │  │
│  │  ┌─────────────────────────────────────────────────────────────────┐  │  │
│  │  │  Node.js Express API (Port 8080)                                │  │  │
│  │  │                                                                 │  │  │
│  │  │  Orchestration Steps:                                           │  │  │
│  │  │  1. Load secrets from Azure Key Vault                          │  │  │
│  │  │  2. Query Log Analytics (KQL) for VM metrics                   │  │  │
│  │  │  3. Get VM inventory via Azure Compute API                     │  │  │
│  │  │  4. Batch AI analysis (10 VMs per batch)                       │  │  │
│  │  │  5. Generate Technical & Executive HTML reports                │  │  │
│  │  │  6. Send emails via SendGrid                                   │  │  │
│  │  └─────────────────────────────────────────────────────────────────┘  │  │
│  │                                                                        │  │
│  │  Authentication: System-Assigned Managed Identity                      │  │
│  │  URL: https://vmperf-orchestrator.calmsand-17418731.westus2.azure...  │  │
│  └──────┬────────────────────┬──────────────────────┬────────────────────┘  │
│         │                    │                      │                       │
│         ▼                    ▼                      ▼                       │
│  ┌──────────────┐  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ Azure OpenAI │  │    SendGrid      │  │  Azure Key Vault           │   │
│  │ (GPT-5)      │  │ (Email Service)  │  │  vmperf-kv-18406           │   │
│  │              │  │                  │  │                            │   │
│  │ Endpoint:    │  │ From Address:    │  │  Secrets:                  │   │
│  │ saig-test-   │  │ saigunaranjan.   │  │  • LogAnalyticsWorkspaceId │   │
│  │ openai...    │  │ andhra@          │  │  • LogAnalyticsClientId    │   │
│  │              │  │ veradigm.com     │  │  • LogAnalyticsClientSecret│   │
│  │ • Right-     │  │                  │  │  • LogAnalyticsTenantId    │   │
│  │   sizing     │  │ To Address:      │  │  • TargetSubscriptionId    │   │
│  │   analysis   │  │ saigunaranjan.   │  │  • OpenAIEndpoint          │   │
│  │ • Cost       │  │ andhra@          │  │  • OpenAIApiKey            │   │
│  │   estimates  │  │ veradigm.com     │  │  • SendGridApiKey          │   │
│  └──────────────┘  └────────┬─────────┘  │  • EmailAddress            │   │
│                             │            └────────────────────────────┘   │
└─────────────────────────────┼────────────────────────────────────────────┘
                              │
                              ▼
                   ┌──────────────────────┐
                   │   Email Recipients   │
                   │                      │
                   │  Technical Report:   │
                   │  • VM-by-VM metrics  │
                   │  • AI recommendations│
                   │  • SKU suggestions   │
                   │                      │
                   │  Executive Report:   │
                   │  • Cost savings      │
                   │  • Summary stats     │
                   │  • Action items      │
                   └──────────────────────┘
```

## Current Deployment Details

### Resource Summary

| Resource | Name | Location | Resource Group |
|----------|------|----------|----------------|
| Container App | vmperf-orchestrator | West US 2 | Sai-Test-rg |
| Container Environment | vmperf-env | West US 2 | Sai-Test-rg |
| Container Registry | ca0bf4270c7eacr | West US 2 | Sai-Test-rg |
| Key Vault | vmperf-kv-18406 | West US 2 | Sai-Test-rg |
| Log Analytics | aa7bf3ad-b626-49f8-96bf-16276c3df7fc | - | Target Subscription |
| OpenAI Service | saig-test-openai | - | - |

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check - returns `{"status": "healthy"}` |
| `/api/orchestrate` | POST | Triggers the full orchestration workflow |

### Container App URL
```
https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io
```

## Component Details

### 1. Data Collection Layer

#### Azure Monitor Agent
- **Purpose**: Collect performance metrics from VMs
- **Metrics Collected**:
  - CPU: `\Processor(_Total)\% Processor Time`
  - Memory: `\Memory\% Committed Bytes In Use`
  - Disk: `\LogicalDisk(*)\Disk Reads/sec`, `\LogicalDisk(*)\Disk Writes/sec`
- **Collection Frequency**: Every 60 seconds
- **Supported OS**: Windows Server 2012+, Linux (RHEL, Ubuntu, SUSE)

#### Log Analytics Workspace
- **Workspace ID**: `aa7bf3ad-b626-49f8-96bf-16276c3df7fc`
- **Purpose**: Central data store for performance metrics
- **Query Engine**: Kusto Query Language (KQL)
- **Analysis Period**: 30 days of performance data
- **Metrics Aggregation**: Max, Average, P95 (95th percentile)

### 2. Orchestration Layer

#### Azure Container App
- **Name**: vmperf-orchestrator
- **Runtime**: Node.js 20 (Alpine Linux)
- **Framework**: Express.js
- **Authentication**: System-Assigned Managed Identity
- **Scaling**: 0-1 replicas (on-demand)
- **Resources**: 0.5 vCPU, 1 GB Memory

**Workflow Execution Flow**:
```
POST /api/orchestrate
  ↓
Load Secrets from Key Vault
  ↓
Query Log Analytics (KQL via REST API)
  ↓
Parse VM Metrics (CPU, Memory, Disk IOPS)
  ↓
Get VM Inventory (Azure Compute API)
  ↓
For Each Batch (10 VMs):
  ↓
  Azure OpenAI Analysis
  ↓
  Parse Recommendations
  ↓
End Batch Loop
  ↓
Generate Technical Report (HTML)
  ↓
Generate Executive Report (HTML)
  ↓
Send Technical Email (SendGrid)
  ↓
Send Executive Email (SendGrid)
  ↓
Return Summary JSON
```

### 3. AI Processing Layer

#### Azure OpenAI
- **Endpoint**: `https://saig-test-openai.cognitiveservices.azure.com`
- **Model**: GPT-5 deployment
- **API Version**: 2025-01-01-preview

**Analysis Criteria**:
| Status | CPU P95 | Memory P95 | Action |
|--------|---------|------------|--------|
| UNDERUTILIZED | < 20% | < 30% | DOWNSIZE |
| OVERUTILIZED | > 80% | > 85% | UPSIZE |
| OPTIMAL | 40-70% | 50-75% | MAINTAIN |

**AI Response Format**:
- **Status**: UNDERUTILIZED | OVERUTILIZED | OPTIMAL
- **Action**: DOWNSIZE | UPSIZE | MAINTAIN
- **Recommended SKU**: Specific Azure VM size
- **Risk Level**: LOW | MEDIUM | HIGH
- **Cost Impact**: Estimated monthly savings/cost
- **Justification**: 2-3 sentence explanation

### 4. Email & Reporting Layer

#### SendGrid Configuration
- **From Address**: `saigunaranjan.andhra@veradigm.com`
- **From Name**: VM Performance Monitor
- **To Address**: `saigunaranjan.andhra@veradigm.com`

#### Report Types

**Technical Report**:
- Audience: DevOps Engineers
- Format: HTML with summary cards and data table
- Content:
  - Summary cards (Total VMs, Actions Required, Status breakdown)
  - Analysis period indicator (30 days)
  - VM Right-Sizing Table with columns:
    - VM Name
    - Current SKU
    - SKU Capabilities (vCPUs, Memory GB)
    - Max CPU %
    - Max Memory %
    - Max Disk IOPS
    - Recommended SKU
    - Recommended Action (DOWNSIZE/UPSIZE/MAINTAIN)

**Executive Report**:
- Audience: Senior Leadership
- Format: HTML with summary stats and data table
- Content:
  - Estimated monthly savings opportunity
  - VM count by status category (30-day analysis)
  - Key recommendations bullet points
  - VM Right-Sizing Summary Table (same columns as Technical)

### 5. Secrets Management

#### Azure Key Vault
- **Name**: vmperf-kv-18406
- **Access Policy**: Managed Identity with get/list permissions

**Stored Secrets**:
| Secret Name | Purpose |
|-------------|---------|
| LogAnalyticsWorkspaceId | Log Analytics workspace GUID |
| LogAnalyticsClientId | Service Principal client ID |
| LogAnalyticsClientSecret | Service Principal secret |
| LogAnalyticsTenantId | Azure AD tenant ID |
| TargetSubscriptionId | Subscription to monitor |
| OpenAIEndpoint | Full Azure OpenAI endpoint URL |
| OpenAIApiKey | Azure OpenAI API key |
| SendGridApiKey | SendGrid API key |
| EmailAddress | From/To email address |

## Data Flow

### Metric Collection Flow
```
VM → Azure Monitor Agent → Log Analytics Workspace
                                    ↓
                            Perf Table (Performance Counters)
                                    ↓
                            7-day data aggregation
```

### Orchestration Flow
```
HTTP POST Request
       ↓
Key Vault ← Secrets ← Container App
       ↓
Log Analytics ← KQL Query ← Container App
       ↓
   VM Metrics (194 VMs)
       ↓
Azure Compute API ← Inventory Request ← Container App
       ↓
   VM Details (SKU, OS, Location)
       ↓
Azure OpenAI ← Analysis Request ← Container App
       ↓
   Recommendations
       ↓
SendGrid ← HTML Reports ← Container App
       ↓
Email Recipients
```

## Security Architecture

### Authentication & Authorization

```
┌─────────────────────────────────────────────────────────────────┐
│         Container App (System-Assigned Managed Identity)         │
│                  Principal ID: 251b8653-d039-...                 │
└──────────┬──────────────┬─────────────────┬─────────────────────┘
           │              │                 │
           ▼              ▼                 ▼
  ┌─────────────┐  ┌────────────┐  ┌──────────────────┐
  │ Key Vault   │  │ Azure VMs  │  │  Service Principal│
  │             │  │            │  │  (Log Analytics)  │
  │ Policy:     │  │ Role:      │  │                   │
  │ get, list   │  │ Reader     │  │  OAuth 2.0 Token  │
  │ secrets     │  │            │  │  for API access   │
  └─────────────┘  └────────────┘  └──────────────────┘
```

### Network Security
- **Container App**: Public endpoint with HTTPS only
- **Key Vault**: Public access with access policies
- **Log Analytics API**: OAuth 2.0 authentication
- **Azure OpenAI**: API key authentication over HTTPS
- **SendGrid**: API key authentication over HTTPS

### Data Protection
- **In Transit**: TLS 1.2+ encryption for all API calls
- **At Rest**: Azure-managed encryption for Key Vault secrets
- **Secrets**: Never logged or exposed in responses
- **Container**: Non-root user, minimal Alpine base image

## Performance Characteristics

### Latest Test Run Results (2026-01-24)

| Metric | Value |
|--------|-------|
| Total VMs Analyzed | 231 |
| Underutilized | ~200+ |
| Overutilized | ~10 |
| Optimal | ~10 |
| Actions Required | ~220 |
| Execution Time | ~6 minutes |
| Emails Sent | 2 (Technical + Executive) |
| Analysis Period | 30 days |
| Email Format | Table structure |

### Email Report Table Columns

| Column | Description |
|--------|-------------|
| VM Name | Virtual machine name |
| Current SKU | Current Azure VM size (e.g., Standard_D4s_v3) |
| SKU Capabilities | vCPUs and Memory in GB |
| Max CPU % | Maximum CPU utilization over analysis period |
| Max Memory % | Maximum memory utilization over analysis period |
| Max Disk IOPS | Maximum disk I/O operations per second |
| Recommended SKU | AI-recommended VM size |
| Recommended Action | DOWNSIZE, UPSIZE, or MAINTAIN |

### Scaling Configuration

| Setting | Value |
|---------|-------|
| Min Replicas | 0 (scale to zero) |
| Max Replicas | 1 |
| CPU | 0.5 vCPU |
| Memory | 1 GB |
| AI Batch Size | 10 VMs per batch |

## Cost Analysis

### Monthly Cost Breakdown (Estimated)

| Component | Cost Estimate | Notes |
|-----------|--------------|-------|
| Container App | $0-10 | Scale-to-zero, pay per use |
| Container Registry | $5 | Basic tier |
| Azure OpenAI | $20-100 | ~$0.10-0.50 per VM |
| Key Vault | $0.03/secret/month | Minimal |
| Log Analytics | Existing | Already provisioned |
| SendGrid | Free tier | Up to 100 emails/day |
| **Total** | **$25-115/month** | Depends on frequency |

## Disaster Recovery

### Recovery Procedures

**Scenario 1: Container App Failure**
```bash
# Redeploy from source
az containerapp up \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --environment vmperf-env \
  --source ./container-app
```

**Scenario 2: Manual Trigger**
```bash
# Trigger orchestration via curl
curl -X POST https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/orchestrate
```

**Scenario 3: Check Health**
```bash
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
```

## Design Decisions

### Why Azure Container Apps vs Azure Functions?

**Azure Container Apps (Current)**:
- ✅ Full control over runtime and dependencies
- ✅ No cold start issues with complex Node.js apps
- ✅ Scale-to-zero for cost optimization
- ✅ Easy local development and debugging
- ✅ Standard Dockerfile deployment
- ✅ Managed identity integration

**Azure Functions (Previous Attempt)**:
- ❌ Deployment sync issues with v4 programming model
- ❌ Function discovery problems
- ❌ Complex durable functions configuration
- ❌ Limited debugging in cloud environment

**Decision**: Container Apps for reliability and simpler deployment

### Why SendGrid vs Office 365?

**SendGrid (Current)**:
- ✅ Simple API integration
- ✅ No Office 365 license required
- ✅ Reliable delivery with tracking
- ✅ Free tier available (100 emails/day)

**Office 365**:
- ❌ Requires licensed mailbox
- ❌ More complex OAuth setup
- ❌ Rate limiting for automation

**Decision**: SendGrid for simplicity and cost

## Source Code Structure

```
container-app/
├── package.json              # Node.js dependencies
├── Dockerfile                # Container build configuration
├── .dockerignore             # Docker build exclusions
└── src/
    ├── index.js              # Express server & orchestration
    └── services/
        ├── logAnalytics.js   # Log Analytics KQL queries
        ├── vmInventory.js    # Azure Compute API integration
        ├── aiAnalysis.js     # Azure OpenAI analysis
        ├── reportGenerator.js # HTML report generation
        └── emailService.js   # SendGrid email delivery
```

## Future Enhancements

### Planned Features
1. **Scheduled Triggers**: Add CRON-based automatic execution
2. **Teams Integration**: Send notifications to Microsoft Teams
3. **Report Archive**: Store reports in Azure Blob Storage
4. **Dashboard**: Power BI dashboard for historical trends
5. **Multi-Subscription**: Monitor VMs across multiple subscriptions
6. **Cost API Integration**: Include actual Azure pricing data

### API Enhancements
1. Add authentication to API endpoints
2. Add rate limiting
3. Add async execution with status polling
4. Add webhook callbacks for completion notification

## TODO / Known Issues

### Completed (Deployed)
1. **Optimized Log Analytics Queries** - Deployed 2026-01-25:
   - **New approach**: Single-scan query with `avgif`/`maxif` functions (no joins)
   - **VM batching**: 50 VMs per batch to limit query size
   - **Analysis period**: 30 days of performance data
   - **Performance**: ~6 minutes for 231 VMs (vs timeouts with previous approach)
   - Query format:
     ```kql
     Perf
     | where TimeGenerated >= ago(30d)
     | where Computer in ('vm1','vm2',...)
     | where ObjectName in ("Processor", "Memory", "LogicalDisk", "Logical Disk")
     | summarize
         AvgCPU = avgif(CounterValue, ObjectName == "Processor"...),
         MaxCPU = maxif(CounterValue, ObjectName == "Processor"...),
         ...
       by Computer
     ```

### Known Issues
1. **AI Analysis Errors (400 Bad Request)**: Azure OpenAI returning 400 errors
   - **Symptoms**: All AI calls fail with "Request failed with status code 400"
   - **Root Cause**: Likely endpoint configuration issue - Azure OpenAI requires specific URL format:
     `https://{resource}.openai.azure.com/openai/deployments/{deployment}/chat/completions?api-version=2024-02-15-preview`
   - **Current Workaround**: Fallback analysis provides SKU recommendations based on metrics thresholds
   - **Fixes Implemented (not yet deployed)**:
     - Exponential backoff retry logic (5 retries with jitter)
     - Sequential processing (5 VMs per batch with 3s delay)
     - Compact JSON format for prompts (reduced tokens)
     - Improved fallback SKU recommendations with size progression
   - **To Fix**:
     1. Verify `OpenAIEndpoint` secret in Key Vault has correct format
     2. Ensure deployment name is included in endpoint URL
     3. Verify API version is supported

2. **Fallback Analysis Active**: When AI fails, fallback provides:
   - Status based on CPU/Memory thresholds
   - SKU recommendations using size progression (e.g., B4ms → B2ms for downsize)
   - Cost impact estimates

### Code Changes (Pending Final Deployment)
Files modified in v3-retry build:
- `aiAnalysis.js`: Added retry logic, JSON prompts, improved fallback SKU sizing
- `index.js`: Uses `batchAnalyzeWithAI` for sequential processing
- Temp file saving: VM data saved to `/tmp/vmperf/` for debugging
