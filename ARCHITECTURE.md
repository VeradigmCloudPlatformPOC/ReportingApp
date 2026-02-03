# Architecture Documentation

## Version 9: Container Apps with Dynamic Queries (Current)

### Overview

The v9 architecture uses Azure Container Apps for the backend services with a Slack bot interface. It supports both static scheduled reports and dynamic AI-generated queries.

### Architecture Diagram (v9)

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│                              User Interaction Layer                              │
│                                                                                 │
│   ┌─────────────────┐                                                           │
│   │     Slack       │  "Show me VMs with high CPU"                              │
│   │   (User Chat)   │  "List all VMs in eastus"                                 │
│   └────────┬────────┘                                                           │
│            │                                                                    │
│            ▼                                                                    │
└────────────┼────────────────────────────────────────────────────────────────────┘
             │
┌────────────┼────────────────────────────────────────────────────────────────────┐
│            ▼                         Azure Container Apps                        │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                        vmperf-slack-bot                                  │   │
│   │  ┌───────────────┐    ┌───────────────┐    ┌───────────────────────┐    │   │
│   │  │ Slack Events  │───▶│ Command       │───▶│ OpenAI Client         │    │   │
│   │  │ Handler       │    │ Router        │    │ (Dynamic Queries)     │    │   │
│   │  └───────────────┘    └───────┬───────┘    └───────────┬───────────┘    │   │
│   │                               │                        │                │   │
│   │                               │                        │ Generate KQL   │   │
│   │                               ▼                        ▼                │   │
│   │                     ┌─────────────────────────────────────┐             │   │
│   │                     │        Orchestration Client         │             │   │
│   │                     └─────────────────┬───────────────────┘             │   │
│   └───────────────────────────────────────┼─────────────────────────────────┘   │
│                                           │                                     │
│                                           │ REST API                            │
│                                           ▼                                     │
│   ┌─────────────────────────────────────────────────────────────────────────┐   │
│   │                      vmperf-orchestrator                                 │   │
│   │                                                                         │   │
│   │  ┌─────────────────┐  ┌─────────────────┐  ┌────────────────────────┐   │   │
│   │  │ Static Reports  │  │ Dynamic Queries │  │ Query Validation       │   │   │
│   │  │ /api/orchestrate│  │ /api/query/*    │  │ Security Layer         │   │   │
│   │  └────────┬────────┘  └────────┬────────┘  │ • Table whitelist      │   │   │
│   │           │                    │           │ • Dangerous ops block  │   │   │
│   │           │                    │           │ • Injection detection  │   │   │
│   │           ▼                    ▼           └────────────────────────┘   │   │
│   │  ┌─────────────────────────────────────────────────────────────────┐    │   │
│   │  │              Multi-Tenant Services Layer                        │    │   │
│   │  │  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────┐   │    │   │
│   │  │  │ Log Analytics   │  │ Resource Graph   │  │ Storage       │   │    │   │
│   │  │  │ (KQL Queries)   │  │ (VM Inventory)   │  │ (Results)     │   │    │   │
│   │  │  └────────┬────────┘  └────────┬─────────┘  └───────────────┘   │    │   │
│   │  └───────────┼────────────────────┼────────────────────────────────┘    │   │
│   └──────────────┼────────────────────┼─────────────────────────────────────┘   │
│                  │                    │                                         │
└──────────────────┼────────────────────┼─────────────────────────────────────────┘
                   │                    │
┌──────────────────┼────────────────────┼─────────────────────────────────────────┐
│                  ▼                    ▼                Azure Services            │
│   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐      │
│   │ Log Analytics      │   │ Resource Graph     │   │ Azure OpenAI       │      │
│   │ Workspaces         │   │ (ARM API)          │   │ (Query Generation) │      │
│   │ • Perf metrics     │   │ • VM inventory     │   │ • KQL generation   │      │
│   │ • Multi-tenant     │   │ • Cross-tenant     │   │ • Result synthesis │      │
│   └────────────────────┘   └────────────────────┘   └────────────────────┘      │
│                                                                                 │
│   ┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐      │
│   │ Key Vault          │   │ Table Storage      │   │ SendGrid           │      │
│   │ • All secrets      │   │ • Tenant configs   │   │ • Email delivery   │      │
│   │ • Per-tenant creds │   │ • Run history      │   │ • Large results    │      │
│   └────────────────────┘   └────────────────────┘   └────────────────────┘      │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### Data Flow: Dynamic Query (v9)

```
User                    Slack Bot               Orchestrator           Azure Services
  │                         │                         │                      │
  │ "Show VMs with          │                         │                      │
  │  high CPU in eastus"    │                         │                      │
  │────────────────────────▶│                         │                      │
  │                         │                         │                      │
  │                         │ 1. Detect query type    │                      │
  │                         │    (KQL vs Resource     │                      │
  │                         │    Graph)               │                      │
  │                         │                         │                      │
  │                         │ 2. Generate KQL         │                      │
  │                         │    via OpenAI           │                      │
  │                         │─────────────────────────┼─────────────────────▶│
  │                         │                         │    Azure OpenAI      │
  │                         │◀────────────────────────┼──────────────────────│
  │                         │    KQL Query            │                      │
  │                         │                         │                      │
  │                         │ 3. POST /api/query/     │                      │
  │                         │    dynamic-kql          │                      │
  │                         │────────────────────────▶│                      │
  │                         │                         │                      │
  │                         │                         │ 4. Validate query    │
  │                         │                         │    (security checks) │
  │                         │                         │                      │
  │                         │                         │ 5. Execute against   │
  │                         │                         │    Log Analytics     │
  │                         │                         │─────────────────────▶│
  │                         │                         │◀─────────────────────│
  │                         │                         │    Raw results       │
  │                         │                         │                      │
  │                         │◀────────────────────────│                      │
  │                         │    Results              │                      │
  │                         │                         │                      │
  │                         │ 6. Format for Slack     │                      │
  │                         │    (≤50 rows: inline)   │                      │
  │                         │    (>50 rows: email)    │                      │
  │                         │                         │                      │
  │◀────────────────────────│                         │                      │
  │    Formatted response   │                         │                      │
  │                         │                         │                      │
```

### API Endpoints (v9)

#### Orchestrator (`vmperf-orchestrator`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/orchestrate` | POST | Trigger full performance analysis run |
| `/api/runs/latest/summary` | GET | Get latest run summary |
| `/api/vms/status/:status` | GET | Get VMs by status (UNDERUTILIZED, OVERUTILIZED, etc.) |
| `/api/subscriptions` | GET | List all accessible subscriptions |
| `/api/subscriptions/search` | GET | Search subscriptions by name |
| `/api/query/dynamic-kql` | POST | Execute validated KQL query |
| `/api/query/dynamic-resourcegraph` | POST | Execute validated Resource Graph query |
| `/api/query/format` | POST | Format query results for display |
| `/api/query/email-results` | POST | Send large results via email |
| `/api/reports/latest/download` | GET | Get download links for latest reports |

#### Slack Bot (`vmperf-slack-bot`)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/slack/events` | POST | Slack Events API endpoint |
| `/api/messages` | POST | Bot Framework messages (Teams) |

### Query Validation Security (v9)

The dynamic query system includes multiple security layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     Query Validation Pipeline                    │
│                                                                 │
│  Input: AI-generated KQL query                                  │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 1. Table Whitelist Check (v10)                          │    │
│  │    Allowed: Perf (PRIMARY for all metrics),             │    │
│  │    Heartbeat, Event, Syslog, VMProcess,                 │    │
│  │    VMConnection, VMBoundPort                            │    │
│  │    ❌ BLOCK: InsightsMetrics, AzureMetrics              │    │
│  │    ❌ BLOCK if table not in whitelist                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 2. Dangerous Operations Check                           │    │
│  │    Block: .delete, .set, .append, .ingest, .alter,      │    │
│  │    .drop, .execute, external_data, materialize,         │    │
│  │    union *, .set-or-append, .set-or-replace             │    │
│  │    ❌ BLOCK if dangerous operation detected             │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 3. Injection Pattern Detection                          │    │
│  │    Warn: '; (quote+semicolon), ' | union, print,        │    │
│  │    toscalar+getschema, multiple statements              │    │
│  │    ⚠️ WARNING logged (may not block)                    │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 4. Comment Stripping & Sanitization                     │    │
│  │    Remove: /* */, //, -- comments                       │    │
│  │    Output: Sanitized query                              │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ 5. Execution Limits                                     │    │
│  │    • Max results: 1000 rows (configurable)              │    │
│  │    • Timeout: 60 seconds (max 5 minutes)                │    │
│  │    • Time filter warning if missing                     │    │
│  └─────────────────────────────────────────────────────────┘    │
│         │                                                       │
│         ▼                                                       │
│  Output: Validated & sanitized query OR error response          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Auto-Detect Delivery (v9)

Results are automatically delivered via the appropriate channel:

| Row Count | Delivery Method | User Experience |
|-----------|-----------------|-----------------|
| ≤50 rows | Slack inline | Formatted table in chat |
| >50 rows | Email | "Results sent to your email" + summary |

### Key Vault Secrets (v9)

| Secret Name | Description |
|-------------|-------------|
| `LogAnalyticsWorkspaceId` | Default workspace ID |
| `LogAnalyticsTenantId` | Default tenant ID |
| `LogAnalyticsClientId` | Service principal client ID |
| `LogAnalyticsClientSecret` | Service principal secret |
| `TargetSubscriptionId` | Default subscription ID |
| `OpenAIEndpoint` | Azure OpenAI endpoint URL |
| `OpenAIApiKey` | Azure OpenAI API key |
| `OpenAIDeploymentName` | OpenAI model deployment (default: gpt-4) |
| `SendGridApiKey` | SendGrid API key for email |
| `EmailAddress` | Default email recipient |
| `StorageConnectionString` | Azure Storage connection |
| `Slack-BotToken` | Slack bot OAuth token |
| `{TenantName}-ClientId` | Per-tenant SP client ID |
| `{TenantName}-ClientSecret` | Per-tenant SP secret |

### Slack Bot Commands (v9)

| Command | Description |
|---------|-------------|
| `hello` / `hi` / `help` | Show welcome message and subscription list |
| `<subscription name>` | Select subscription context |
| `show underutilized vms` | List VMs that can be downsized |
| `show overutilized vms` | List VMs needing more resources |
| `show summary` | Performance overview for selected subscription |
| `run a performance report` | Trigger full analysis run |
| `investigate <vm-name>` | Get details for specific VM |
| `download` | Get report download links |
| `clear` | Clear subscription context |

### Component Versions

| Component | Image Tag | Description |
|-----------|-----------|-------------|
| vmperf-orchestrator | v10-fixes | Backend API and query execution (2.0 CPU / 4.0 Gi) |
| vmperf-slack-bot | v10-fix3 | Slack integration, AI agent, tool handlers (1.0 CPU / 2.0 Gi) |
| Dynamic Query System | v10 | AI-generated KQL/RG queries with Perf table enforcement |

### v10 Changes (2026-02-03)
- **Perf table enforcement**: Performance metrics (CPU, Memory, Disk) must use Perf table only
- **AI parameter compatibility**: Fixed `max_completion_tokens` and removed `temperature` parameter
- **Agent verbosity**: Real-time Slack status updates during tool execution
- **Export functionality**: CSV export via email with user profile lookup
- **VM name matching**: Case-insensitive, FQDN-aware matching in KQL queries

---

## Legacy Architecture (Logic Apps)

The following sections describe the original Logic Apps-based architecture, which is still supported but not actively developed.

### High-Level Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────┐
│                         Azure Subscription                         │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                    Resource Group: VMs                       │  │
│  │  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐              │  │
│  │  │  VM 1  │  │  VM 2  │  │  VM 3  │  │  VM N  │              │  │
│  │  └────┬───┘  └────┬───┘  └────┬───┘  └────┬───┘              │  │
│  │       │           │           │           │                  │  │
│  │       │   Azure Monitor Agent / Log Analytics Agent          │  │
│  │       │           │           │           │                  │  │
│  └───────┼───────────┼───────────┼───────────┼──────────────────┘  │
│          │           │           │           │                     │
│          └───────────┴───────────┴───────────┘                     │
│                          │                                         │
│                          ▼                                         │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │           Log Analytics Workspace                            │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Performance Counters:                                 │  │  │
│  │  │  • Processor % Processor Time                          │  │  │
│  │  │  • Memory % Committed Bytes In Use                     │  │  │
│  │  │  • Disk Reads/sec, Disk Writes/sec                     │  │  │
│  │  │  • 90-day retention                                    │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────────────────────┬───────────────────────────────────────┘  │
│                         │                                          │
│                         │ KQL Query (Weekly)                       │
│                         ▼                                          │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                 Azure Logic App (Orchestrator)               │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │  Workflow Steps:                                          │  │
│  │  │  1. Trigger: Recurrence (Weekly - Monday 8 AM UTC)     │  │  │
│  │  │  2. Query Log Analytics for VM metrics                 │  │  │
│  │  │  3. Get VM SKU and pricing information                 │  │  │
│  │  │  4. For each VM:                                       │  │  │
│  │  │     - Compose data payload                             │  │  │
│  │  │     - Call AI Foundry for analysis                     │  │  │
│  │  │     - Aggregate recommendations                        │  │  │
│  │  │  5. Generate Technical Report (AI Foundry)             │  │  │
│  │  │  6. Generate Executive Report (AI Foundry)             │  │  │
│  │  │  7. Send emails to recipients                          │  │  │
│  │  │  8. Archive reports to storage                         │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └──────┬────────────────────┬──────────────────────┬────────── ┘  │
│         │                    │                      │              │
│         ▼                    ▼                      ▼              │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │ AI Foundry   │  │ Office 365       │  │ Storage Account  │      │
│  │ (GPT-4)      │  │ (Email Service)  │  │ (Report Archive) │      │
│  │              │  │                  │  │                  │      │
│  │ • Technical  │  │ • DevOps Team    │  │ • Blob Container │      │
│  │   Analysis   │  │ • Leadership     │  │ • JSON Reports   │      │
│  │ • Executive  │  │                  │  │ • 30-day retain  │      │
│  │   Summary    │  │                  │  │                  │      │
│  └──────────────┘  └────────┬─────────┘  └──────────────────┘      │
│                             │                                      │
└─────────────────────────────┼───-──────────────────────────────────┘
                              │
                              ▼
                    ┌──────────────────────┐
                    │  Email Recipients    │
                    │                      │
                    │  📧 DevOps Team      │
                    │  📊 Technical Report │
                    │                      │
                    │  📧 Leadership       │
                    │  💼 Executive Report │
                    └──────────────────────┘
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
- **Purpose**: Central data store for performance metrics
- **Retention**: 90 days minimum (configurable)
- **Query Engine**: Kusto Query Language (KQL)
- **Data Volume**: ~5-10 MB per VM per day
- **Cost**: $2.30 per GB ingested

### 2. Orchestration Layer

#### Azure Logic App
- **Purpose**: Weekly workflow orchestration
- **Trigger**: Recurrence schedule
- **Authentication**: Managed Identity
- **Connections**:
  - Azure Monitor Logs API
  - Office 365 API
  - Azure Resource Manager API
  - HTTP (AI Foundry)

**Workflow Execution Flow**:
```
Start (Recurrence Trigger)
  ↓
Initialize Variables
  ↓
Query Log Analytics (KQL)
  ↓
Parse VM Metrics
  ↓
Get VM SKU Info (Azure API)
  ↓
For Each VM:
  ↓
  Compose Data Payload
  ↓
  AI Foundry Analysis
  ↓
  Append to Results Array
  ↓
End For Each
  ↓
Generate Technical Report (AI Foundry)
  ↓
Generate Executive Report (AI Foundry)
  ↓
Send Technical Email (Office 365)
  ↓
Send Executive Email (Office 365)
  ↓
Archive Reports (Blob Storage)
  ↓
End (Success/Failure)
```

### 3. AI Processing Layer

#### Azure AI Foundry
- **Models Used**:
  - **GPT-4** (recommended): Higher accuracy for complex analysis
  - **GPT-4-turbo**: Faster, lower cost alternative
  - **GPT-3.5-turbo**: Budget option for high-volume scenarios

**Processing Pipeline**:
```
VM Metrics Input
  ↓
System Prompt (Role: Cloud Infrastructure Expert)
  ↓
User Prompt (VM Data + Context)
  ↓
AI Analysis
  ↓
Structured Recommendations Output
```

**Token Usage** (per VM):
- Input: ~500 tokens (metrics data)
- Output: ~800 tokens (recommendations)
- Total: ~1,300 tokens per VM
- Cost: ~$0.04 per VM with GPT-4

### 4. Reporting Layer

#### Email Reports
- **Technical Report**:
  - Audience: DevOps Engineers
  - Format: HTML with detailed metrics tables
  - Content: Performance data, SKU recommendations, implementation steps
  - Size: ~50-100 KB

- **Executive Report**:
  - Audience: Senior Leadership
  - Format: HTML with high-level summaries
  - Content: Cost savings, business impact, strategic recommendations
  - Size: ~30-50 KB

#### Report Archive
- **Storage**: Azure Blob Storage
- **Format**: JSON (raw data) + HTML (rendered reports)
- **Retention**: 30 days (configurable)
- **Organization**: `/vm-reports/{year}/{month}/{day}/`

## Data Flow

### Metric Collection Flow
```
VM → Azure Monitor Agent → Log Analytics Workspace
                                    ↓
                            Performance Counters Table
                                    ↓
                            7-day data aggregation
```

### Analysis Flow
```
Log Analytics ← KQL Query ← Logic App
       ↓
   Raw Metrics
       ↓
AI Foundry ← Metrics + Context ← Logic App
       ↓
Recommendations
       ↓
Email Service ← Reports ← Logic App
       ↓
Recipients (DevOps + Leadership)
```

## Security Architecture

### Authentication & Authorization

```
┌────────────────────────────────────────────────────────────┐
│                    Logic App (Managed Identity)             │
└────────────┬────────────┬─────────────┬────────────────────┘
             │            │             │
             ▼            ▼             ▼
   ┌─────────────┐ ┌───────────┐ ┌──────────────┐
   │ Log         │ │   Azure   │ │  AI Foundry  │
   │ Analytics   │ │   VMs     │ │              │
   │             │ │           │ │              │
   │ Role: Log   │ │ Role:     │ │ Auth: API    │
   │ Analytics   │ │ Reader    │ │ Key (KeyVault│
   │ Reader      │ │           │ │ Reference)   │
   └─────────────┘ └───────────┘ └──────────────┘
```

### Network Security
- **Logic App**: Public endpoint with HTTPS only
- **API Connections**: Azure-managed, encrypted in transit
- **Storage**: Private endpoint (optional), HTTPS only
- **AI Foundry**: API key authentication over HTTPS

### Data Protection
- **In Transit**: TLS 1.2+ encryption
- **At Rest**: Azure Storage encryption (256-bit AES)
- **Secrets**: Azure Key Vault integration
- **Compliance**: Inherits Azure compliance certifications

## Scalability & Performance

### Performance Characteristics

| Metric | Value | Notes |
|--------|-------|-------|
| VMs per run | 1-500 | Recommended range |
| Execution time | 5-30 min | Depends on VM count |
| Concurrent processing | Up to 50 | Logic App concurrency limit |
| AI API calls | 1-500 | One per VM + 2 for reports |
| Max email size | 10 MB | Office 365 limit |

### Scaling Considerations

**Small Environment (< 50 VMs)**
- Single Logic App instance
- Standard AI Foundry endpoint
- Run time: ~5-10 minutes
- Cost: ~$20/month

**Medium Environment (50-200 VMs)**
- Standard Logic App (consider batching)
- Provisioned AI Foundry throughput
- Run time: ~15-20 minutes
- Cost: ~$50-100/month

**Large Environment (200+ VMs)**
- Implement batching in Logic App
- Dedicated AI Foundry deployment
- Consider Azure Functions for processing
- Run time: ~20-30 minutes
- Cost: ~$150-300/month

### Optimization Strategies

1. **Batch Processing**
   ```json
   {
     "actions": {
       "Batch_VMs": {
         "type": "Compose",
         "inputs": "@chunk(body('Parse_VMs'), 25)"
       }
     }
   }
   ```

2. **Parallel AI Calls**
   ```json
   {
     "actions": {
       "For_Each_VM": {
         "type": "Foreach",
         "foreach": "@variables('VMList')",
         "runtimeConfiguration": {
           "concurrency": {
             "repetitions": 20
           }
         }
       }
     }
   }
   ```

3. **Caching Pricing Data**
   - Cache VM SKU pricing for 24 hours
   - Reduces API calls to Azure pricing API

## Disaster Recovery & High Availability

### Backup Strategy
- **Logic App**: ARM template in source control
- **Configuration**: Parameters file in secure storage
- **Reports**: 30-day retention in storage account
- **Metrics Data**: 90-day retention in Log Analytics

### Recovery Procedures

**Scenario 1: Logic App Failure**
```bash
# Redeploy from template
az deployment group create \
  --resource-group vmperf-monitoring-rg \
  --template-file main.bicep \
  --parameters parameters.json
```

**Scenario 2: Missed Schedule Run**
```bash
# Manual trigger
az logic workflow run trigger \
  --resource-group vmperf-monitoring-rg \
  --name vmperf-logic-app \
  --trigger-name Recurrence
```

**Scenario 3: Data Loss**
- Metrics data: Recoverable from Log Analytics (90-day retention)
- Reports: Recoverable from storage (30-day retention)
- Configuration: Recoverable from source control

### Monitoring & Alerts

```bash
# Create alert for failed runs
az monitor metrics alert create \
  --name vmperf-logic-app-failures \
  --resource-group vmperf-monitoring-rg \
  --scopes <logic-app-id> \
  --condition "count Failed Runs > 0" \
  --window-size 1h \
  --evaluation-frequency 15m
```

## Cost Analysis

### Monthly Cost Breakdown

| Component | Cost Estimate | Notes |
|-----------|--------------|-------|
| Logic App | $5-30 | Based on actions executed |
| AI Foundry (GPT-4) | $20-150 | Depends on VM count |
| Log Analytics | $10-50 | Depends on data ingestion |
| Storage Account | $1-5 | Report archive |
| Data Transfer | $0-5 | Minimal |
| **Total** | **$36-240/month** | Scales with VM count |

### Cost Per VM

- **Small deployment (< 50 VMs)**: ~$0.40-0.80 per VM/month
- **Medium deployment (50-200 VMs)**: ~$0.25-0.50 per VM/month
- **Large deployment (200+ VMs)**: ~$0.15-0.30 per VM/month

### Cost Optimization Tips

1. Use GPT-3.5-turbo instead of GPT-4: Save ~70%
2. Reduce AI token usage: Save ~30%
3. Optimize KQL queries: Save on Log Analytics costs
4. Use storage lifecycle policies: Save on storage

## Design Decisions

### Why Logic Apps vs Azure Functions?

**Logic Apps (Chosen)**:
- ✅ Visual workflow designer
- ✅ Built-in connectors (Office 365, Azure Monitor)
- ✅ No code deployment required
- ✅ Easy to modify and maintain
- ❌ Higher cost for complex workflows

**Azure Functions**:
- ✅ More flexible and powerful
- ✅ Lower cost at scale
- ❌ Requires code development
- ❌ More complex deployment

**Decision**: Logic Apps for simplicity and maintainability

### Why AI Foundry vs Custom ML?

**AI Foundry (Chosen)**:
- ✅ No ML expertise required
- ✅ Natural language recommendations
- ✅ Quick time to value
- ✅ Continuously improving models

**Custom ML**:
- ✅ More control over logic
- ✅ Lower cost at very large scale
- ❌ Requires data science expertise
- ❌ Months of development time

**Decision**: AI Foundry for faster implementation and better insights

### Why Weekly vs Daily Reports?

**Weekly (Chosen)**:
- ✅ Sufficient for capacity planning
- ✅ Lower noise and alert fatigue
- ✅ More time for analysis
- ✅ Lower AI API costs

**Daily**:
- ✅ Faster issue detection
- ❌ Higher costs
- ❌ More noise
- ❌ Action fatigue

**Decision**: Weekly for balance of timeliness and cost

## Future Enhancements

### Planned Features
1. **Anomaly Detection**: ML-based spike detection
2. **Predictive Scaling**: Forecast future capacity needs
3. **Auto-Remediation**: Automatic resizing for non-production
4. **Dashboard**: Power BI dashboard for real-time insights
5. **Multi-Cloud**: Support for AWS and GCP VMs
6. **FinOps Integration**: Integration with Azure Cost Management

### Integration Roadmap
1. **ServiceNow**: Automatic ticket creation
2. **Slack/Teams**: Real-time notifications
3. **Terraform**: Infrastructure as Code integration
4. **Azure DevOps**: Automated deployment pipelines

---

## Container App Implementation (v6-parallel)

### Overview
The system has been migrated to Azure Container Apps for improved scalability and cost efficiency. The current production image is `v6-parallel`, deployed on 2026-01-26.

### Architecture Changes

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Azure Container Apps                              │
│                                                                      │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │                  Container App: vmperf-app                    │  │
│  │                                                                │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │              Express.js Server (index.js)              │  │  │
│  │  │                                                         │  │  │
│  │  │  Endpoints:                                            │  │  │
│  │  │  • GET  /health         - Health check                 │  │  │
│  │  │  • POST /api/orchestrate - Main orchestration          │  │  │
│  │  └─────────────────────────────────────────────────────────┘  │  │
│  │                          │                                     │  │
│  │        ┌─────────────────┼─────────────────┐                 │  │
│  │        ▼                 ▼                 ▼                  │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐      │  │
│  │  │ logAnalytics│  │ vmInventory  │  │   aiAnalysis    │      │  │
│  │  │    .js     │  │    .js       │  │      .js        │      │  │
│  │  │            │  │              │  │                 │      │  │
│  │  │ 3 parallel │  │ ARM API      │  │ 5 parallel      │      │  │
│  │  │ KQL batches│  │ queries      │  │ AI calls/batch  │      │  │
│  │  └────────────┘  └──────────────┘  └─────────────────┘      │  │
│  │                          │                                     │  │
│  │        ┌─────────────────┼─────────────────┐                 │  │
│  │        ▼                 ▼                 ▼                  │  │
│  │  ┌────────────┐  ┌──────────────┐  ┌─────────────────┐      │  │
│  │  │ report     │  │ emailService │  │   Key Vault     │      │  │
│  │  │ Generator  │  │    .js       │  │   (secrets)     │      │  │
│  │  │    .js     │  │              │  │                 │      │  │
│  │  └────────────┘  └──────────────┘  └─────────────────┘      │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

### Parallel Processing Implementation

#### KQL Query Processing (logAnalytics.js)
- **Batch Size**: 30 VMs per batch
- **Parallel Batches**: 3 batches processed concurrently
- **Delay Between Groups**: 2 seconds (with random jitter)
- **Retry Logic**: Exponential backoff (5s, 10s, 20s, max 60s)
- **Rate Limit Handling**: Auto-retry on 429 errors

```javascript
// Configuration
const VM_BATCH_SIZE = 30;          // VMs per batch
const PARALLEL_BATCHES = 3;         // Concurrent batches
const DELAY_BETWEEN_PARALLEL_GROUPS_MS = 2000; // Delay + jitter
```

#### AI Analysis Processing (aiAnalysis.js)
- **Batch Size**: 5 VMs per batch
- **Parallel Calls**: 5 concurrent AI calls per batch
- **Delay Between Batches**: 3 seconds (with random jitter)
- **Retry Logic**: Exponential backoff (1s, 2s, 4s, 8s, 16s)
- **Fallback**: Rule-based analysis when AI unavailable

```javascript
// Configuration
const batchSize = 5;               // VMs per batch
const delayBetweenBatches = 3000;  // Delay between batches
```

### Performance Improvements

| Metric | Sequential (v5) | Parallel (v6) | Improvement |
|--------|-----------------|---------------|-------------|
| KQL Queries (8 batches) | ~7 min | ~3 min | 2.3x faster |
| AI Analysis (77 VMs) | ~77 min | ~20 min | 3.8x faster |
| **Total (77 VMs)** | **~90 min** | **~25 min** | **3.6x faster** |

### Microsoft Azure Advisor Aligned Thresholds

The AI analysis now follows Microsoft Azure Advisor recommendations:

| Status | CPU Criteria | Memory Criteria | Action |
|--------|-------------|-----------------|--------|
| UNDERUTILIZED | Max CPU < 5% | Any | DOWNSIZE |
| UNDERUTILIZED | Max CPU < 30% | Max Memory < 40% | DOWNSIZE |
| OVERUTILIZED | Max CPU > 90% | Any | UPSIZE |
| OVERUTILIZED | Any | Max Memory > 90% | UPSIZE |
| OPTIMAL | 40-80% | 40-80% | MAINTAIN |
| NEEDS_REVIEW | Mixed patterns | Mixed patterns | REVIEW |

### Report Enhancements

#### Technical Report
- **Header Colors**: Darker gradient (#1a1a2e → #16213e)
- **Methodology Section**: Explains metrics collected, thresholds, and KQL query
- **Reason Column**: 4-5 word summary per VM recommendation
- **Threshold Table**: Visual reference for classification rules

#### Executive Report
- **Header Colors**: Matching darker theme
- **Reason Column**: Brief justification for each recommendation
- **Cost Summary**: Total potential savings highlighted

### KQL Query - Performance Metrics

The following KQL query is used to collect VM performance data:

```kusto
Perf
| where TimeGenerated >= ago(30d)
| where Computer in ('vm1','vm2','vm3')
| where ObjectName in ("Processor", "Memory", "LogicalDisk", "Logical Disk")
| where (ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total")
    or (ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "Available MBytes", "% Used Memory"))
    or (ObjectName in ("LogicalDisk", "Logical Disk") and CounterName in ("Disk Bytes/sec", "Disk Transfers/sec"))
| summarize
    AvgCPU = avgif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
    MaxCPU = maxif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
    AvgMemoryUsage = avgif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
    MaxMemory = maxif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
    AvgDiskBytesPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Bytes/sec"),
    MaxDiskBytesPerSec = maxif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Bytes/sec"),
    AvgDiskTransfersPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec"),
    MaxDiskTransfers = maxif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec")
  by Computer
| order by Computer asc
```

### Deployment Commands

```bash
# Build and push new image
docker build -t vmperf-app:v6-parallel ./container-app
docker tag vmperf-app:v6-parallel <acr>.azurecr.io/vmperf-app:v6-parallel
docker push <acr>.azurecr.io/vmperf-app:v6-parallel

# Update Container App
az containerapp update \
  --name vmperf-app \
  --resource-group vmperf-rg \
  --image <acr>.azurecr.io/vmperf-app:v6-parallel

# Trigger orchestration
curl -X POST https://vmperf-app.<region>.azurecontainerapps.io/api/orchestrate

# Monitor logs
az containerapp logs show --name vmperf-app --resource-group vmperf-rg --follow
```

### Version History

| Version | Date | Changes |
|---------|------|---------|
| v4-gpt5 | 2026-01-25 | GPT-5 compatibility (max_completion_tokens, no temperature) |
| v5-quality | 2026-01-26 | Microsoft thresholds, methodology section, reason column |
| v6-parallel | 2026-01-26 | Parallel processing for KQL and AI (3.6x speedup) |

### Troubleshooting

#### Common Issues

1. **504 Gateway Timeout**
   - Long orchestration runs may timeout at the gateway level
   - Solution: Trigger via curl in background, monitor via logs

2. **Rate Limit Errors (429)**
   - KQL or AI API hitting rate limits
   - Solution: Implemented exponential backoff with jitter

3. **Container Restart During Run**
   - Container may restart during long orchestrations
   - Solution: Monitor logs and re-trigger if needed

#### Log Analysis
```bash
# View recent logs
az containerapp logs show --name vmperf-app --resource-group vmperf-rg --tail 100

# Filter for errors
az containerapp logs show --name vmperf-app --resource-group vmperf-rg | grep -i error
```

---

## Slack Bot Integration (v7-slack-bot)

### Overview

The v7-slack-bot release adds conversational Slack integration, enabling users to:
- Trigger VM performance reports via `/vmreport` slash command
- Query VM inventory via `/vminventory` command
- Ask natural language questions about VM status
- Investigate specific VM recommendations with AI assistance

**Deployment Date**: 2026-01-26

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Azure Resources                                  │
│                                                                               │
│  ┌─────────────────────────────────────────────────────────────────────────┐ │
│  │                    Resource Group: Sai-Test-rg                           │ │
│  │                                                                          │ │
│  │   ┌────────────────────┐     ┌──────────────────────────────────────┐  │ │
│  │   │   Slack Workspace   │────▶│      vmperf-slack-bot               │  │ │
│  │   │                     │     │      (Container App)                 │  │ │
│  │   │  • /vmreport        │     │                                      │  │ │
│  │   │  • /vminventory     │     │  Port: 3978                         │  │ │
│  │   │  • Conversations    │◀────│  Endpoints:                         │  │ │
│  │   └────────────────────┘     │  • /api/slack/commands              │  │ │
│  │                               │  • /api/slack/interactions          │  │ │
│  │                               │  • /health                          │  │ │
│  │                               └──────────────┬───────────────────────┘  │ │
│  │                                              │                          │ │
│  │                                              │ HTTP                     │ │
│  │                                              ▼                          │ │
│  │   ┌──────────────────────────────────────────────────────────────────┐ │ │
│  │   │                   vmperf-orchestrator                             │ │ │
│  │   │                   (Container App)                                 │ │ │
│  │   │                                                                   │ │ │
│  │   │   Port: 3000                                                     │ │ │
│  │   │   Endpoints:                                                     │ │ │
│  │   │   • POST /api/orchestrate      - Trigger analysis               │ │ │
│  │   │   • GET  /api/runs/:id/status  - Run status                     │ │ │
│  │   │   • GET  /api/runs/latest      - Latest run                     │ │ │
│  │   │   • GET  /api/vms/status/:s    - VMs by status                  │ │ │
│  │   │   • GET  /api/vms/search       - Search VMs                     │ │ │
│  │   │   • GET  /api/vms/:name        - VM details                     │ │ │
│  │   │   • GET  /api/inventory        - Resource Graph inventory       │ │ │
│  │   │   • GET  /api/summary          - Cross-tenant summary           │ │ │
│  │   │   • GET  /api/tenants          - Tenant configurations          │ │ │
│  │   │   • GET  /health               - Health check                   │ │ │
│  │   └─────────┬─────────────────────┬─────────────────────────────────┘ │ │
│  │             │                     │                                    │ │
│  │             │                     │                                    │ │
│  │             ▼                     ▼                                    │ │
│  │   ┌─────────────────┐   ┌──────────────────────────────────────────┐ │ │
│  │   │  Log Analytics   │   │           Azure Storage                  │ │ │
│  │   │   Workspace      │   │          (saitestrg88fe)                 │ │ │
│  │   │                  │   │                                          │ │ │
│  │   │  • Perf counters │   │   Table: runs                           │ │ │
│  │   │  • 30-day data   │   │   ├── PartitionKey: subscriptionId      │ │ │
│  │   │                  │   │   └── RowKey: runId                      │ │ │
│  │   └─────────────────┘   │                                          │ │ │
│  │                          │   Table: tenants                         │ │ │
│  │                          │   ├── PartitionKey: "config"             │ │ │
│  │                          │   └── RowKey: tenantId                   │ │ │
│  │                          │                                          │ │ │
│  │                          │   Blob: analysis-results                 │ │ │
│  │                          │   └── {runId}/results.json               │ │ │
│  │                          └──────────────────────────────────────────┘ │ │
│  │                                                                        │ │
│  │   ┌─────────────────┐   ┌─────────────────┐   ┌─────────────────────┐ │ │
│  │   │   Key Vault      │   │  Azure OpenAI   │   │  Azure Resource    │ │ │
│  │   │ vmperf-kv-18406  │   │   (GPT-5.1)     │   │      Graph         │ │ │
│  │   │                  │   │                 │   │                    │ │ │
│  │   │ Secrets:         │   │  • AI Analysis  │   │  • VM Inventory    │ │ │
│  │   │ • Slack-*        │   │  • Chat queries │   │  • Cross-sub query │ │ │
│  │   │ • OpenAI*        │   │  • Reports      │   │  • Tag filtering   │ │ │
│  │   │ • Storage*       │   │                 │   │                    │ │ │
│  │   │ • LogAnalytics*  │   │                 │   │                    │ │ │
│  │   └─────────────────┘   └─────────────────┘   └─────────────────────┘ │ │
│  │                                                                        │ │
│  │   ┌─────────────────────────────────────────────────────────────────┐ │ │
│  │   │              Container Registry: ca0bf4270c7eacr                 │ │ │
│  │   │                                                                  │ │ │
│  │   │   Images:                                                       │ │ │
│  │   │   • vmperf-orchestrator:v2                                      │ │ │
│  │   │   • vmperf-slack-bot:v1                                         │ │ │
│  │   └─────────────────────────────────────────────────────────────────┘ │ │
│  │                                                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Slack Bot Container App (vmperf-slack-bot)

**Purpose**: Handle Slack slash commands and interactions, provide conversational interface

**URL**: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io`

**Files Structure**:
```
slack-bot/
├── src/
│   ├── index.js                    # Express server + Bot Framework setup
│   ├── bot/
│   │   ├── vmPerfBot.js            # Main ActivityHandler
│   │   ├── dialogs/
│   │   │   └── mainDialog.js       # Dialog routing
│   │   └── cards/
│   │       └── slackBlocks.js      # Slack Block Kit builders
│   ├── services/
│   │   ├── keyVaultService.js      # Centralized secret management
│   │   ├── orchestrationClient.js  # HTTP client to orchestrator
│   │   ├── slackNotifier.js        # Slack webhook notifications
│   │   └── conversationAI.js       # GPT-5.1 for chat queries
│   └── tests/
│       └── testSlackBot.js         # Unit tests
├── package.json
└── Dockerfile
```

**Endpoints**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Health check with Key Vault status |
| `/api/slack/commands` | POST | Slash command handler |
| `/api/slack/interactions` | POST | Interactive component handler |
| `/api/messages` | POST | Bot Framework (optional) |

**Security**:
- Slack request signature verification (HMAC-SHA256)
- All secrets loaded from Azure Key Vault
- Managed Identity for Azure resource access

#### 2. Orchestrator Container App (vmperf-orchestrator)

**Purpose**: Execute VM performance analysis, manage runs, provide API for queries

**URL**: `https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io`

**Files Structure**:
```
container-app/
├── src/
│   ├── index.js                    # Express server + API endpoints
│   └── services/
│       ├── logAnalytics.js         # KQL queries (parallel batching)
│       ├── vmInventory.js          # Azure ARM VM metadata
│       ├── aiAnalysis.js           # GPT-5.1 analysis (parallel)
│       ├── reportGenerator.js      # HTML report generation
│       ├── emailService.js         # SendGrid email delivery
│       ├── storageService.js       # Azure Table + Blob storage
│       ├── resourceGraph.js        # Cross-subscription inventory
│       ├── multiTenantAuth.js      # Per-tenant credentials
│       └── multiTenantLogAnalytics.js # Multi-workspace queries
├── package.json
└── Dockerfile
```

**New API Endpoints (v7)**:
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/runs/:runId/status` | GET | Get run status and progress |
| `/api/runs/latest` | GET | Get most recent run |
| `/api/vms/status/:status` | GET | Filter VMs by UNDERUTILIZED, OVERUTILIZED, etc. |
| `/api/vms/search` | GET | Search VMs by name pattern |
| `/api/vms/:vmName` | GET | Get detailed VM analysis |
| `/api/inventory` | GET | Query Resource Graph for VM inventory |
| `/api/summary` | GET | Cross-tenant summary statistics |
| `/api/tenants` | GET | List tenant configurations |

#### 3. Azure Storage (storageService.js)

**Storage Account**: `saitestrg88fe`

**Data Model**:

```
Azure Storage Account
├── Table: runs
│   ├── PartitionKey: subscriptionId (or "all")
│   ├── RowKey: runId (timestamp-based, e.g., "run-1706xxx")
│   └── Properties:
│       ├── status: IN_PROGRESS | COMPLETED | FAILED
│       ├── summary: { totalVMs, underutilized, overutilized, optimal, ... }
│       ├── startTime, endTime, duration
│       ├── channelId, requestedBy (for Slack tracking)
│       └── errorMessage (if failed)
│
├── Table: tenants
│   ├── PartitionKey: "config"
│   ├── RowKey: tenantId (Azure AD GUID)
│   └── Properties:
│       ├── tenantName: "Production", "Development", etc.
│       ├── subscriptionIds: ["sub1", "sub2", ...] (JSON)
│       ├── logAnalyticsWorkspaces: [...] (JSON)
│       ├── enabled: true/false
│       └── servicePrincipal: { clientId, secretName }
│
└── Blob Container: analysis-results
    └── {runId}/
        └── results.json  (full VM analysis array, gzipped)
```

**Key Methods**:
```javascript
// Run management
saveRun(runData)                    // Create new run record
updateRun(subscriptionId, runId, updates)  // Update run status
getRun(subscriptionId, runId)       // Get specific run
getLatestRun(subscriptionId)        // Get most recent run

// Analysis results
saveAnalysisResults(runId, analyses)  // Save to Blob
getAnalysisResults(runId)             // Load from Blob
getVMsByStatus(runId, status)         // Filter by status
getVMDetails(runId, vmName)           // Single VM
searchVMs(runId, query)               // Search by name

// Tenant configuration
saveTenantConfig(config)              // Create/update tenant
getTenantConfigs(enabledOnly)         // List all tenants
```

#### 4. Azure Key Vault (keyVaultService.js)

**Key Vault**: `vmperf-kv-18406`

**Secrets Stored**:
| Secret Name | Purpose |
|-------------|---------|
| `StorageConnectionString` | Azure Storage access |
| `Slack-ClientId` | Slack OAuth Client ID |
| `Slack-ClientSecret` | Slack OAuth Client Secret |
| `Slack-SigningSecret` | Slack request verification |
| `OpenAIEndpoint` | Azure OpenAI endpoint URL |
| `OpenAIApiKey` | Azure OpenAI API key |
| `LogAnalyticsWorkspaceId` | Log Analytics workspace |
| `LogAnalyticsClientId` | Service principal for LA |
| `LogAnalyticsClientSecret` | Service principal secret |
| `LogAnalyticsTenantId` | Azure AD tenant |
| `TargetSubscriptionId` | Target subscription |
| `SendGridApiKey` | Email service |
| `EmailAddress` | Report recipient |
| `Bot-MicrosoftAppId` | Bot Framework (optional) |
| `Bot-MicrosoftAppPassword` | Bot Framework (optional) |
| `{TenantName}-ClientId` | Per-tenant SP (multi-tenant) |
| `{TenantName}-ClientSecret` | Per-tenant SP (multi-tenant) |

**Access Pattern**:
- Both Container Apps use System-Assigned Managed Identity
- Key Vault access policy grants `get` and `list` permissions
- 5-minute secret cache to reduce API calls

#### 5. Azure Resource Graph (resourceGraph.js)

**Purpose**: Query VM inventory across subscriptions without Log Analytics

**Capabilities**:
- Cross-subscription VM queries
- Filter by tags, location, size, resource group
- Real-time inventory (not dependent on agent data)
- Support for multi-tenant queries

**Query Examples**:
```javascript
// Query all VMs with filters
queryVMInventory(tenantConfig, {
    location: 'eastus',
    tag: { key: 'environment', value: 'prod' },
    sizePattern: 'Standard_D'
});

// Aggregate by resource group
aggregateByResourceGroup(tenantConfig);

// Cross-tenant summary
getCrossTenantSummary(tenantConfigs);
```

#### 6. Multi-Tenant Support

**Architecture**:
```
┌─────────────────────────────────────────────────────────────────┐
│  User: "run report for Production tenant"                        │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  1. Load tenant config from Table Storage                        │
│     → { tenantId, tenantName, subscriptionIds, workspaces }     │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  2. Get credentials from Key Vault                               │
│     → {TenantName}-ClientId, {TenantName}-ClientSecret          │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼ (parallel per workspace)
┌─────────────────────────────────────────────────────────────────┐
│  3. Query all Log Analytics workspaces                           │
│     → Merge results with tenant/workspace labels                │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│  4. Aggregate and store results                                  │
│     → Tag each VM with tenantName, workspaceName                │
└─────────────────────────────────────────────────────────────────┘
```

**Files**:
- `multiTenantAuth.js`: Per-tenant credential management
- `multiTenantLogAnalytics.js`: Cross-workspace KQL queries
- `resourceGraph.js`: Cross-subscription Resource Graph queries

### Complete Orchestration Data Flow

The following diagram shows the end-to-end flow from trigger to email delivery:

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                            ORCHESTRATION DATA FLOW                                   │
│                        (Tested: 231 VMs in 25.5 minutes)                            │
└─────────────────────────────────────────────────────────────────────────────────────┘

    ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────────────┐
    │    Slack     │     │   Manual     │     │          Scheduled               │
    │  /vmreport   │     │  curl POST   │     │     (Future: Timer Trigger)      │
    └──────┬───────┘     └──────┬───────┘     └────────────────┬─────────────────┘
           │                    │                              │
           └────────────────────┼──────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 0: Initialize                                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │  • Generate Run ID (run-1769463572535)                                         │ │
│  │  • Load secrets from Key Vault (vmperf-kv-18406)                               │ │
│  │  • Initialize Azure Storage (saitestrg88fe)                                    │ │
│  │  • Save run record to Table Storage (status: IN_PROGRESS)                      │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 1: Query Log Analytics (~3.5 min for 231 VMs)                                 │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                         Log Analytics Workspace                                 │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  1. Get VM list from subscription                                        │  │ │
│  │  │  2. Batch VMs into groups of 30                                          │  │ │
│  │  │  3. Query 3 batches in parallel                                          │  │ │
│  │  │  4. KQL: Perf | where TimeGenerated >= ago(30d)                          │  │ │
│  │  │  5. Collect: CPU%, Memory%, Disk I/O (avg, max over 30 days)             │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                 │ │
│  │  Output: 231 VMs with performance metrics                                      │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 2: Get VM Inventory (~15 sec)                                                  │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           Azure Resource Manager                                │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  • Query VM SKU details (vCPU, memory, disk)                             │  │ │
│  │  │  • Get resource group, location, tags                                    │  │ │
│  │  │  • Enrich performance data with inventory metadata                       │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                 │ │
│  │  Output: 231 VMs with metrics + SKU details                                    │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 3: AI Analysis (~21 min for 231 VMs)                                          │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                            Azure OpenAI (GPT-5.1)                               │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  • Process 5 VMs per batch in parallel                                   │  │ │
│  │  │  • 47 batches total (231 VMs ÷ 5)                                        │  │ │
│  │  │  • 3-second delay between batches                                        │  │ │
│  │  │                                                                          │  │ │
│  │  │  Per VM Analysis:                                                        │  │ │
│  │  │  ┌────────────────────────────────────────────────────────────────────┐ │  │ │
│  │  │  │  Input:  VM metrics + SKU info + Microsoft Advisor thresholds      │ │  │ │
│  │  │  │  Output: { status, action, recommendation, reason, confidence }    │ │  │ │
│  │  │  │                                                                     │ │  │ │
│  │  │  │  Status:  UNDERUTILIZED | OVERUTILIZED | OPTIMAL | NEEDS_REVIEW    │ │  │ │
│  │  │  │  Action:  DOWNSIZE | UPSIZE | MAINTAIN | REVIEW                    │ │  │ │
│  │  │  └────────────────────────────────────────────────────────────────────┘ │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                 │ │
│  │  Output: 231 VM analyses with recommendations                                  │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 4: Generate Reports (<1 sec)                                                   │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                          Report Generator                                       │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Technical Report (HTML)               Executive Report (HTML)           │  │ │
│  │  │  ├── Summary statistics                ├── High-level summary            │  │ │
│  │  │  ├── Methodology section               ├── Cost savings potential        │  │ │
│  │  │  ├── Detailed VM table                 ├── Top recommendations           │  │ │
│  │  │  ├── Status/Action/Reason columns      ├── Business impact               │  │ │
│  │  │  └── Threshold reference               └── Strategic guidance            │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 5: Send Emails (<1 sec)                                                        │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                             SendGrid API                                        │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │                                                                          │  │ │
│  │  │   📧 Technical Report ────────────────▶ DevOps Team                     │  │ │
│  │  │      (saigunaranjan.andhra@veradigm.com)                                │  │ │
│  │  │                                                                          │  │ │
│  │  │   📊 Executive Report ────────────────▶ Leadership                      │  │ │
│  │  │      (saigunaranjan.andhra@veradigm.com)                                │  │ │
│  │  │                                                                          │  │ │
│  │  │   ✅ Email sent successfully                                            │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│  STEP 6: Save Results & Complete                                                     │
│  ┌────────────────────────────────────────────────────────────────────────────────┐ │
│  │                           Azure Storage                                         │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Blob: analysis-results/run-1769463572535/results.json (28.1 KB gzip)   │  │ │
│  │  │  Table: runs → Update status to COMPLETED, add summary                   │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  │                                                                                 │ │
│  │  Final Summary:                                                                │ │
│  │  ┌─────────────────────────────────────────────────────────────────────────┐  │ │
│  │  │  Run ID:        run-1769463572535                                        │  │ │
│  │  │  Duration:      1528.7 seconds (25.5 minutes)                            │  │ │
│  │  │  VMs Analyzed:  231                                                      │  │ │
│  │  │  Status:        COMPLETED                                                │  │ │
│  │  └─────────────────────────────────────────────────────────────────────────┘  │ │
│  └────────────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

### Performance Breakdown (231 VMs)

| Step | Description | Duration | Details |
|------|-------------|----------|---------|
| 0 | Initialize | ~3s | Key Vault + Storage init |
| 1 | Log Analytics | ~3.5 min | 8 batches × 3 parallel |
| 2 | VM Inventory | ~15s | ARM API queries |
| 3 | AI Analysis | ~21 min | 47 batches × 5 parallel |
| 4 | Generate Reports | <1s | HTML generation |
| 5 | Send Emails | <1s | SendGrid API |
| 6 | Save Results | ~1s | Blob + Table update |
| **Total** | | **~25.5 min** | |

### Component Sequence Diagram

```
┌──────────┐ ┌──────────────┐ ┌─────────────┐ ┌───────────┐ ┌─────────┐ ┌─────────┐ ┌─────────┐
│  User/   │ │ Slack Bot    │ │Orchestrator │ │Key Vault  │ │   Log   │ │ OpenAI  │ │SendGrid │
│  Slack   │ │ Container    │ │ Container   │ │           │ │Analytics│ │ GPT-5.1 │ │         │
└────┬─────┘ └──────┬───────┘ └──────┬──────┘ └─────┬─────┘ └────┬────┘ └────┬────┘ └────┬────┘
     │              │                │              │            │           │           │
     │ /vmreport    │                │              │            │           │           │
     │─────────────▶│                │              │            │           │           │
     │              │                │              │            │           │           │
     │              │ POST /api/     │              │            │           │           │
     │              │ orchestrate    │              │            │           │           │
     │              │───────────────▶│              │            │           │           │
     │              │                │              │            │           │           │
     │              │                │ Get Secrets  │            │           │           │
     │              │                │─────────────▶│            │           │           │
     │              │                │◀─────────────│            │           │           │
     │              │                │              │            │           │           │
     │              │                │    Step 1: Query VMs      │           │           │
     │              │                │────────────────────────────▶          │           │
     │              │                │◀────────────────────────────          │           │
     │              │                │              │  (231 VMs) │           │           │
     │              │                │              │            │           │           │
     │              │                │    Step 2: Get Inventory  │           │           │
     │              │                │────────────(ARM API)──────▶           │           │
     │              │                │◀──────────────────────────│           │           │
     │              │                │              │            │           │           │
     │              │                │    Step 3: AI Analysis (47 batches)   │           │
     │              │                │───────────────────────────────────────▶           │
     │              │                │◀───────────────────────────────────────           │
     │              │                │              │            │           │           │
     │              │                │    Step 4: Generate HTML Reports      │           │
     │              │                │──────────(internal)───────│           │           │
     │              │                │              │            │           │           │
     │              │                │    Step 5: Send Emails                │           │
     │              │                │───────────────────────────────────────────────────▶
     │              │                │◀───────────────────────────────────────────────────
     │              │                │              │            │ (Technical + Executive)│
     │              │                │              │            │           │           │
     │              │                │    Step 6: Save to Azure Storage      │           │
     │              │                │───────────(Blob + Table)──│           │           │
     │              │                │              │            │           │           │
     │              │ Response:      │              │            │           │           │
     │              │ {success,runId}│              │            │           │           │
     │              │◀───────────────│              │            │           │           │
     │              │                │              │            │           │           │
     │ "Analysis    │                │              │            │           │           │
     │  Complete!"  │                │              │            │           │           │
     │◀─────────────│                │              │            │           │           │
     │              │                │              │            │           │           │
┌────┴─────┐ ┌──────┴───────┐ ┌──────┴──────┐ ┌─────┴─────┐ ┌────┴────┐ ┌────┴────┐ ┌────┴────┐
│  User    │ │ Slack Bot    │ │Orchestrator │ │Key Vault  │ │   Log   │ │ OpenAI  │ │SendGrid │
│  Inbox   │ │              │ │             │ │           │ │Analytics│ │         │ │         │
└──────────┘ └──────────────┘ └─────────────┘ └───────────┘ └─────────┘ └─────────┘ └─────────┘
                                                                                        │
                                                                                        ▼
                                                                              ┌─────────────────┐
                                                                              │  📧 Technical   │
                                                                              │     Report      │
                                                                              │                 │
                                                                              │  📊 Executive   │
                                                                              │     Report      │
                                                                              └─────────────────┘
```

### Service Integration Map

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              Azure Resources Integration                             │
└─────────────────────────────────────────────────────────────────────────────────────┘

                    ┌──────────────────────────────────────────┐
                    │         vmperf-kv-18406 (Key Vault)      │
                    │                                          │
                    │  Secrets:                                │
                    │  ├── LogAnalytics* (workspace creds)     │
                    │  ├── OpenAI* (endpoint + key)            │
                    │  ├── SendGridApiKey                      │
                    │  ├── StorageConnectionString             │
                    │  └── Slack-* (bot credentials)           │
                    └─────────────────┬────────────────────────┘
                                      │
                    ┌─────────────────┼─────────────────┐
                    │                 │                 │
                    ▼                 ▼                 ▼
    ┌───────────────────────┐ ┌─────────────────┐ ┌───────────────────────┐
    │   vmperf-slack-bot    │ │vmperf-orchestrator│ │   Azure Services     │
    │   (Container App)     │ │ (Container App) │ │                       │
    │                       │ │                 │ │  ┌─────────────────┐  │
    │  • Slack commands     │ │  • /orchestrate │ │  │  Log Analytics  │  │
    │  • /vmreport          │ │  • /runs/*      │──┼─▶│  (KQL queries)  │  │
    │  • /vminventory       │ │  • /vms/*       │ │  └─────────────────┘  │
    │  • Bot Framework      │ │  • /inventory   │ │                       │
    │                       │ │  • /summary     │ │  ┌─────────────────┐  │
    │  Port: 3978           │ │                 │──┼─▶│  Azure OpenAI   │  │
    └───────────┬───────────┘ │  Port: 3000     │ │  │  (GPT-5.1)      │  │
                │             └────────┬────────┘ │  └─────────────────┘  │
                │                      │          │                       │
                │     HTTP calls       │          │  ┌─────────────────┐  │
                └──────────────────────┤          ├─▶│  SendGrid       │  │
                                       │          │  │  (Email)        │  │
                                       │          │  └─────────────────┘  │
                                       │          │                       │
                                       │          │  ┌─────────────────┐  │
                                       │          ├─▶│  Azure Storage  │  │
                                       │          │  │  (Table + Blob) │  │
                                       │          │  └─────────────────┘  │
                                       │          │                       │
                                       │          │  ┌─────────────────┐  │
                                       │          └─▶│  Resource Graph │  │
                                       │             │  (VM Inventory) │  │
                                       │             └─────────────────┘  │
                                       │                                  │
                                       └──────────────────────────────────┘
```

### Slack Bot Conversation Flows

#### Flow 1: Trigger Report (`/vmreport`)

```
User: /vmreport
Bot:  Starting VM performance analysis...
      Run ID: run-1706xxx | Status: In Progress

      [Updates via webhook...]

Bot:  Analysis Complete!
      77 VMs | 23 Underutilized | 8 Overutilized | 35 Optimal
      Actions Required: 31
      [Show Details] [Show Underutilized] [Show Savings]
```

#### Flow 2: Query Results

```
User: show me underutilized VMs
Bot:  Found 23 underutilized VMs from latest run:

      1. vm-dev-001 - Standard_D8s_v3 → D4s_v3 (CPU: 12%, Mem: 25%)
      2. vm-test-003 - Standard_D16s_v3 → D8s_v3 (CPU: 8%, Mem: 18%)
      ...
```

#### Flow 3: Investigate VM

```
User: why is vm-prod-001 flagged?
Bot:  vm-prod-001 Analysis:

      Current: Standard_D4s_v3 (4 vCPU, 16 GB)
      Recommendation: UPSIZE to Standard_D8s_v3

      Reason: Max CPU reached 94% over the past 30 days...
```

#### Flow 4: Resource Inventory (`/vminventory`)

```
User: /vminventory environment=prod
Bot:  Found 89 VMs with tag environment=prod:

      1. vm-web-001 (D4s_v3, eastus, running)
      2. vm-web-002 (D4s_v3, eastus, running)
      ...
```

### Deployment Configuration

#### Container Apps Environment

| Setting | Orchestrator | Slack Bot |
|---------|-------------|-----------|
| Name | vmperf-orchestrator | vmperf-slack-bot |
| Environment | vmperf-env | vmperf-env |
| Location | West US 2 | West US 2 |
| Port | 3000 | 3978 |
| Min Replicas | 1 | 1 |
| Max Replicas | 5 | 3 |
| CPU | 1 vCPU | 0.5 vCPU |
| Memory | 2 GB | 1 GB |

#### Environment Variables

**Orchestrator**:
- `KEY_VAULT_URL`: https://vmperf-kv-18406.vault.azure.net

**Slack Bot**:
- `KEY_VAULT_URL`: https://vmperf-kv-18406.vault.azure.net
- `ORCHESTRATOR_URL`: https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io

### Deployment Scripts

```bash
# Deploy orchestrator
./scripts/deploy-orchestrator.sh

# Deploy slack-bot
./scripts/deploy-slack-bot.sh

# Setup Key Vault secrets (one-time)
./scripts/setup-keyvault-secrets.sh
```

### Slack App Configuration

After deployment, configure the Slack App at https://api.slack.com:

1. **Slash Commands**:
   - `/vmreport`: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/commands`
   - `/vminventory`: Same URL

2. **Interactivity & Shortcuts**:
   - Request URL: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/interactions`

3. **OAuth & Permissions**:
   - `commands` - Add slash commands
   - `chat:write` - Send messages
   - `incoming-webhook` - Webhooks

### Version History

| Version | Date | Changes |
|---------|------|---------|
| v4-gpt5 | 2026-01-25 | GPT-5 compatibility |
| v5-quality | 2026-01-26 | Microsoft thresholds, methodology section |
| v6-parallel | 2026-01-26 | Parallel processing (3.6x speedup) |
| **v7-slack-bot** | **2026-01-26** | **Slack integration, multi-tenant, Azure Storage** |

### Cost Analysis (v7)

| Component | Monthly Cost | Notes |
|-----------|-------------|-------|
| Orchestrator Container App | $15-50 | Based on usage |
| Slack Bot Container App | $5-20 | Consumption plan |
| Azure Storage (Table + Blob) | $1-5 | ~500KB per run |
| Azure OpenAI (GPT-5.1) | $20-150 | Depends on VM count |
| Log Analytics | $10-50 | Existing |
| Key Vault | $0.03/10K ops | Minimal |
| **Total** | **$51-275/month** | Scales with usage |

### Security Considerations

1. **Slack Request Verification**
   - HMAC-SHA256 signature validation
   - Timestamp check (5-minute window)
   - Signing secret stored in Key Vault

2. **Azure Authentication**
   - System-assigned Managed Identity
   - No credentials in code or environment variables
   - Key Vault access via RBAC

3. **Network Security**
   - HTTPS-only endpoints
   - No public IP for storage (optional private endpoint)
   - Container Apps ingress controls

### Monitoring & Troubleshooting

```bash
# View orchestrator logs
az containerapp logs show \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --follow

# View slack-bot logs
az containerapp logs show \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --follow

# Test health endpoints
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health

# Trigger manual orchestration
curl -X POST https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/orchestrate
```

---

## Conversational AI Bot (v8-agent)

### Current Production Deployment

| Resource | Name | URL/Details |
|----------|------|-------------|
| **Subscription** | Zirconium - Veradigm Sandbox | `ffd7017b-28ed-4e90-a2ec-4a6958578f98` |
| **Resource Group** | Sai-Test-rg | West US 2 |
| **Container Registry** | ca0bf4270c7eacr | `ca0bf4270c7eacr.azurecr.io` |
| **Orchestrator** | vmperf-orchestrator | https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io |
| **Slack Bot** | vmperf-slack-bot | https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io |
| **Key Vault** | vmperf-kv-18406 | Stores all secrets |
| **Storage Account** | saitestrg88fe | Table + Blob storage |

### Overview

The v8-agent release transforms the Slack bot from slash commands to a **conversational AI interface** using Azure AI Foundry Agent Service. Users can now interact with natural language instead of structured commands.

**Key Changes from v7**:
- Replace slash commands with natural language conversations
- Direct Slack Events API integration (no Azure Bot Service for Slack)
- Azure AI Foundry Agent for intent understanding and tool execution
- Multi-turn conversation support with context memory
- Microsoft Teams support via Azure Bot Service (optional)
- 48-hour report caching to reduce costs
- Download/regenerate commands for report access
- Subscription context for multi-subscription environments

**Deployment Date**: 2026-01-27 (v8.1-enhanced)

### Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              v8-agent Architecture                            │
└──────────────────────────────────────────────────────────────────────────────┘

                    ┌─────────────────┐
                    │   Slack App     │
                    │  (Existing)     │
                    │                 │
                    │  Events API ────┼────────┐
                    │  Interactivity ─┼────────┤
                    └─────────────────┘        │
                                               │
                    ┌─────────────────┐        │
                    │  Microsoft      │        │
                    │  Teams          │        │
                    │                 │        │
                    │  Bot Service ───┼────────┤
                    └─────────────────┘        │
                                               │
                                               ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                      vmperf-slack-bot (Container App)                         │
│                                                                               │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                        Express.js Server                             │   │
│   │                                                                      │   │
│   │   Endpoints:                                                         │   │
│   │   • GET  /health              - Health check                         │   │
│   │   • POST /api/slack/events    - Direct Slack Events API              │   │
│   │   • POST /api/slack/interactions - Slack Block Kit interactions      │   │
│   │   • POST /api/messages        - Bot Framework (Teams)                │   │
│   └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
│                                    ▼                                         │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │                          VMPerfBot                                   │   │
│   │                                                                      │   │
│   │   ┌───────────────────┐    ┌───────────────────────────────────┐   │   │
│   │   │   AgentService    │    │     ConversationState             │   │   │
│   │   │                   │    │     (Cosmos DB / In-Memory)       │   │   │
│   │   │   • processMessage│    │                                   │   │   │
│   │   │   • handleTools   │    │   • getThreadId(userId)          │   │   │
│   │   │   • threadMgmt    │    │   • setThreadId(userId, threadId)│   │   │
│   │   └───────────────────┘    │   • clearConversation(userId)    │   │   │
│   │            │               └───────────────────────────────────┘   │   │
│   │            │                                                        │   │
│   │            ▼                                                        │   │
│   │   ┌───────────────────────────────────────────────────────────┐   │   │
│   │   │                    Tool Handlers                           │   │   │
│   │   │                                                            │   │   │
│   │   │   • trigger_performance_report                             │   │   │
│   │   │   • query_vms_by_status                                    │   │   │
│   │   │   • search_vms                                             │   │   │
│   │   │   • investigate_vm                                         │   │   │
│   │   │   • query_inventory                                        │   │   │
│   │   │   • get_cross_tenant_summary                               │   │   │
│   │   └───────────────────────────────────────────────────────────┘   │   │
│   │            │                                                        │   │
│   └────────────┼────────────────────────────────────────────────────────┘   │
│                │                                                             │
└────────────────┼─────────────────────────────────────────────────────────────┘
                 │
                 ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│                         vmperf-orchestrator (Container App)                   │
│                                                                               │
│   API Endpoints:                                                              │
│   • POST /api/orchestrate           - Trigger analysis (48hr caching)        │
│   • GET  /api/runs/:id/status       - Run status                             │
│   • GET  /api/runs/latest           - Latest run metadata                    │
│   • GET  /api/runs/latest/summary   - Run-based VM status summary            │
│   • GET  /api/reports/latest/download - SAS token URLs for reports           │
│   • GET  /api/vms/status/:status    - Get VMs by status                      │
│   • GET  /api/vms/search            - Search VMs by name                     │
│   • GET  /api/vms/:vmName           - Get VM details                         │
│   • GET  /api/inventory             - Query Resource Graph                   │
│   • GET  /api/summary               - Cross-tenant summary                   │
│   • GET  /api/subscriptions         - List available subscriptions           │
│   • GET  /api/subscriptions/search  - Search subscriptions by name           │
│   • GET  /health                    - Health check                           │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Message Flow

```
User: "Show me underutilized VMs"
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1. Slack Events API receives message                                        │
│     POST /api/slack/events                                                   │
│     { type: "event_callback", event: { type: "message", text: "..." } }     │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2. VMPerfBot.handleSlackEvent()                                             │
│     • Extract user message                                                   │
│     • Get/create thread ID from ConversationState                           │
│     • Route to agent or fallback mode                                        │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼ (Agent Mode)
┌─────────────────────────────────────────────────────────────────────────────┐
│  3. AgentService.processMessage(threadId, "Show me underutilized VMs")       │
│     • Send message to AI Foundry Agent                                       │
│     • Agent determines intent and selects tool                               │
│     • Agent returns: requires_action → query_vms_by_status(UNDERUTILIZED)   │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4. Tool Execution: query_vms_by_status                                      │
│     • Call orchestrator: GET /api/vms/status/UNDERUTILIZED                   │
│     • Return VM list to agent                                                │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5. Agent generates natural language response                                │
│     "Found 45 underutilized VMs. Here are the top 10:                        │
│      1. vm-dev-001 - CPU: 3% avg, Memory: 8% avg                            │
│      ..."                                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6. Send response via Slack API                                              │
│     POST https://slack.com/api/chat.postMessage                              │
│     { channel, text, mrkdwn: true }                                          │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. AgentService (agentService.js)

Manages conversations with Azure AI Foundry Agent Service.

```javascript
class AgentService {
    constructor(config) {
        this.projectEndpoint = config.projectEndpoint;
        this.agentId = config.agentId;
        this.toolHandlers = new Map();
    }

    // Process a user message through the agent
    async processMessage(threadId, userMessage, context) {
        // Create/reuse thread
        // Send message to agent
        // Poll for completion with tool execution
        // Return response
    }

    // Register tool handlers for agent calls
    registerToolHandler(toolName, handler) { ... }

    // Execute tools when agent requests
    async handleToolCalls(threadId, run) { ... }
}
```

#### 2. Tool Registry (tools/index.js)

Maps agent tool calls to orchestrator API endpoints.

| Tool Name | Orchestrator Endpoint | Description |
|-----------|----------------------|-------------|
| `trigger_performance_report` | POST /api/orchestrate | Start VM analysis (uses 48hr cache) |
| `query_vms_by_status` | GET /api/vms/status/:status | Filter by UNDERUTILIZED, etc. |
| `search_vms` | GET /api/vms/search?q= | Search by name pattern |
| `investigate_vm` | GET /api/vms/:vmName | Get detailed analysis |
| `query_inventory` | GET /api/inventory | Resource Graph query |
| `get_cross_tenant_summary` | GET /api/summary | Cross-tenant statistics |
| `get_run_summary` | GET /api/runs/latest/summary | VM counts from latest run |
| `download_reports` | GET /api/reports/latest/download | Get SAS URLs for reports |
| `list_subscriptions` | GET /api/subscriptions | List available subscriptions |
| `search_subscriptions` | GET /api/subscriptions/search | Search subscriptions by name |

#### 3. ConversationState (conversationState.js)

Stores thread IDs and user preferences for multi-turn conversations.

**Cosmos DB Mode** (production):
```
Database: vmperf-bot
Container: conversations
Document: {
    id: "slack:U12345",
    partitionKey: "slack:U12345",
    userId: "U12345",
    channelId: "slack",
    threadId: "thread_abc123",
    preferences: { ... },
    updatedAt: "2026-01-27T..."
}
```

**In-Memory Mode** (development):
```javascript
Map<string, { threadId, preferences, updatedAt }>
```

#### 4. Channel Adapters (channelAdapter.js, adaptiveCards.js)

Format responses appropriately for each channel.

**Slack**: Markdown with Slack-specific formatting
```
*Underutilized VMs* (45 found)

• *vm-dev-001* (Standard_D4s_v3)
  CPU: 3% avg | Memory: 8% avg
```

**Teams**: Adaptive Cards (JSON)
```json
{
    "type": "AdaptiveCard",
    "body": [
        { "type": "TextBlock", "text": "Underutilized VMs", "weight": "Bolder" },
        ...
    ]
}
```

### Files Structure (v8.1)

```
slack-bot/
├── src/
│   ├── index.js                      # Express server + endpoints
│   ├── bot/
│   │   ├── vmPerfBot.js              # Main bot handler
│   │   │                             # - Handles Slack Events API
│   │   │                             # - Subscription context management
│   │   │                             # - Download/regenerate commands
│   │   ├── channelAdapter.js         # Channel-specific formatting
│   │   └── cards/
│   │       └── adaptiveCards.js      # Teams Adaptive Cards
│   ├── services/
│   │   ├── agentService.js           # AI Foundry Agent client
│   │   ├── conversationState.js      # Cosmos DB state management
│   │   ├── keyVaultService.js        # Centralized secrets
│   │   └── orchestrationClient.js    # HTTP client to orchestrator
│   │                                 # - triggerOrchestration()
│   │                                 # - getRunSummary()
│   │                                 # - getReportDownloads()
│   │                                 # - getSubscriptions()
│   │                                 # - searchSubscriptions()
│   └── tools/
│       ├── index.js                  # Tool registry
│       ├── triggerReportTool.js
│       ├── queryVMsByStatusTool.js
│       ├── searchVMsTool.js
│       ├── investigateVMTool.js
│       ├── queryInventoryTool.js
│       └── crossTenantSummaryTool.js
├── package.json
└── Dockerfile
```

### OrchestrationClient Methods (v8.1)

The `orchestrationClient.js` service provides these methods:

| Method | Endpoint | Description |
|--------|----------|-------------|
| `triggerOrchestration(options)` | POST /api/orchestrate | Start analysis, supports caching |
| `getRunStatus(runId)` | GET /api/runs/:id/status | Check run progress |
| `getLatestRun(subscriptionId)` | GET /api/runs/latest | Get latest run metadata |
| `getRunSummary(subscriptionId)` | GET /api/runs/latest/summary | VM counts from analysis |
| `getReportDownloads(subscriptionId, expiryHours)` | GET /api/reports/latest/download | SAS URLs for reports |
| `getVMsByStatus(status)` | GET /api/vms/status/:status | Filter by status |
| `getVMDetails(vmName)` | GET /api/vms/:vmName | Single VM details |
| `searchVMs(pattern)` | GET /api/vms/search | Search by name |
| `getInventory(filters)` | GET /api/inventory | Resource Graph query |
| `getCrosstenantSummary()` | GET /api/summary | Cross-tenant stats |
| `getSubscriptions()` | GET /api/subscriptions | List all subscriptions |
| `searchSubscriptions(query)` | GET /api/subscriptions/search | Search by name |
| `healthCheck()` | GET /health | Service health |

### Key Vault Secrets (v8.1)

| Secret Name | Purpose |
|-------------|---------|
| `Slack-BotToken` | Bot User OAuth Token (xoxb-...) |
| `Slack-SigningSecret` | Request signature verification |
| `StorageConnectionString` | Azure Storage for runs/reports |
| `OpenAIEndpoint` | Azure OpenAI endpoint URL |
| `OpenAIApiKey` | Azure OpenAI API key |
| `LogAnalyticsWorkspaceId` | Log Analytics workspace ID |
| `LogAnalyticsClientId` | Service principal client ID |
| `LogAnalyticsClientSecret` | Service principal secret |
| `LogAnalyticsTenantId` | Azure AD tenant ID |
| `TargetSubscriptionId` | Default target subscription |
| `SendGridApiKey` | Email service API key |
| `EmailAddress` | Report recipient email |
| `AIFoundry-ProjectEndpoint` | AI Foundry project URL (optional) |
| `AIFoundry-AgentId` | Deployed agent ID (optional) |
| `CosmosDB-ConnectionString` | Conversation state (optional) |
| `Bot-MicrosoftAppId` | Teams Bot Framework (optional) |
| `Bot-MicrosoftAppPassword` | Teams Bot Framework (optional) |

### Slack App Configuration (v8)

**Event Subscriptions**:
- Request URL: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/events`
- Bot Events:
  - `message.channels` - Messages in public channels
  - `message.im` - Direct messages
  - `app_mention` - When @mentioned

**Interactivity**:
- Request URL: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/interactions`

**OAuth Scopes**:
- `chat:write` - Send messages
- `channels:history` - Read channel messages
- `im:history` - Read DM messages
- `app_mentions:read` - Read mentions

### Conversation Examples

**Natural Language Queries**:
```
User: Show me underutilized VMs
Bot:  Found 45 underutilized VMs. Here are the top 10:
      • vm-dev-001 (D4s_v3) - CPU: 3%, Memory: 8%
      ...

User: Tell me more about vm-dev-001
Bot:  **VM Investigation: vm-dev-001**
      Status: UNDERUTILIZED
      Recommendation: Downsize from D4s_v3 to D2s_v3
      Estimated Savings: $87/month
      ...

User: Run a performance report
Bot:  Starting VM performance analysis...
      Run ID: run-xxx
      I'll update you when it's complete.
```

**Download/Regenerate Commands**:
```
User: download
Bot:  Here are your latest reports (Run ID: run-xxx):
      Technical Report: https://... (expires in 1 hour)
      Executive Report: https://... (expires in 1 hour)

User: regenerate
Bot:  Starting fresh VM performance analysis (ignoring cache)...
      Run ID: run-xxx
      I'll update you when it's complete.
```

**Subscription Context**:
```
User: use subscription Zirconium
Bot:  Subscription context set to: Zirconium - Veradigm Sandbox
      All future queries will use this subscription.

User: list subscriptions
Bot:  Available subscriptions:
      1. Zirconium - Veradigm Sandbox
      2. Production-East
      ...
```

**Special Commands**:
```
User: clear
Bot:  Conversation cleared! Starting fresh.
      How can I help you with VM performance today?

User: help
Bot:  I can help you with:
      • Run performance analysis ("run a report")
      • Query VMs by status ("show underutilized VMs")
      • Download reports ("download")
      • Set subscription context ("use subscription X")
      ...
```

### Report Caching (48-hour TTL)

The orchestrator implements intelligent report caching to avoid redundant expensive operations:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Report Caching Logic                                │
└─────────────────────────────────────────────────────────────────────────────┘

User: "run a report"
        │
        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  Check: Is there a recent completed run for this subscription?               │
│         (within last 48 hours)                                               │
└─────────────────────────────────────────────────────────────────────────────┘
        │
        ├── YES ──▶ Return cached summary + reports
        │           "Using cached report from X hours ago"
        │
        └── NO ───▶ Start new orchestration
                    "Starting fresh analysis..."
```

**Cache Bypass**:
- Use "regenerate" command to force new analysis
- Use `?force=true` parameter on API call
- Cache is per-subscription (different subscriptions have separate caches)

**Benefits**:
- Reduces AI API costs (no redundant analysis)
- Faster response for repeated queries
- Still allows manual refresh when needed

### Fallback Mode

When AI Foundry Agent is not configured, the bot falls back to pattern matching:

```javascript
if (text.includes('underutilized')) {
    return orchestrationClient.getVMsByStatus('UNDERUTILIZED');
}
if (text.includes('report') || text.includes('analyze')) {
    return orchestrationClient.triggerOrchestration({});
}
```

### Orchestrator API Reference

#### POST /api/orchestrate
Trigger VM performance analysis. Uses 48-hour caching unless bypassed.

**Request**:
```json
{
  "subscriptionId": "optional - override target subscription",
  "force": false,  // Set true to bypass cache
  "days": 30       // Analysis period
}
```

**Response**:
```json
{
  "success": true,
  "runId": "run-1769463572535",
  "cached": false,
  "message": "Analysis started"
}
```

#### GET /api/runs/latest/summary
Get VM status counts from the latest completed analysis run.

**Response**:
```json
{
  "runId": "run-1769463572535",
  "subscriptionId": "ffd7017b-...",
  "analyzedAt": "2026-01-27T10:30:00Z",
  "summary": {
    "totalVMs": 231,
    "underutilized": 45,
    "overutilized": 8,
    "optimal": 178
  },
  "ageHours": 2.5
}
```

#### GET /api/reports/latest/download
Get SAS URLs for downloading reports from the latest run.

**Query Parameters**:
- `subscriptionId`: Filter by subscription (optional)
- `expiryHours`: URL expiry time, 1-24 hours (default: 1)

**Response**:
```json
{
  "runId": "run-1769463572535",
  "reports": {
    "technical": "https://saitestrg88fe.blob.core.windows.net/reports/run-.../technical.html?sv=...",
    "executive": "https://saitestrg88fe.blob.core.windows.net/reports/run-.../executive.html?sv=..."
  },
  "expiresAt": "2026-01-27T11:30:00Z"
}
```

#### GET /api/subscriptions
List all available subscriptions across tenants.

**Response**:
```json
[
  {
    "id": "ffd7017b-28ed-4e90-a2ec-4a6958578f98",
    "name": "Zirconium - Veradigm Sandbox",
    "tenantId": "...",
    "tenantName": "Default"
  }
]
```

#### GET /api/subscriptions/search?q={query}
Search subscriptions by name pattern.

### Deployment Commands (v8)

```bash
# Build and push orchestrator
az acr build --registry ca0bf4270c7eacr --image vmperf-orchestrator:latest ./container-app

# Build and push slack-bot
az acr build --registry ca0bf4270c7eacr --image vmperf-slack-bot:latest ./slack-bot

# Restart container apps to pick up new images
az containerapp revision restart --name vmperf-orchestrator --resource-group Sai-Test-rg
az containerapp revision restart --name vmperf-slack-bot --resource-group Sai-Test-rg

# Add Slack Bot Token to Key Vault
az keyvault secret set --vault-name vmperf-kv-18406 \
    --name Slack-BotToken --value 'xoxb-...'

# Verify health endpoints
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health

# Test new endpoints
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/runs/latest/summary
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/api/reports/latest/download
```

### Version History

| Version | Date | Changes |
|---------|------|---------|
| v4-gpt5 | 2026-01-25 | GPT-5 compatibility |
| v5-quality | 2026-01-26 | Microsoft thresholds, methodology |
| v6-parallel | 2026-01-26 | Parallel processing (3.6x speedup) |
| v7-slack-bot | 2026-01-26 | Slack slash commands, multi-tenant |
| v8-agent | 2026-01-27 | Conversational AI, direct Slack Events API |
| **v8.1-enhanced** | **2026-01-27** | **48hr caching, download/regenerate, subscription context, SAS URLs** |

### New Features (v8.1)

1. **48-Hour Report Caching**: Avoids redundant expensive AI analysis
2. **Download Command**: Get SAS URLs for Technical and Executive reports
3. **Regenerate Command**: Force new analysis bypassing cache
4. **Subscription Context**: Set subscription for multi-subscription environments
5. **Run-Based Summary**: `/api/runs/latest/summary` returns counts from analysis (not live inventory)
6. **SAS Token Generation**: Secure, time-limited download URLs for reports
