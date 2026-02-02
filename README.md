# VM Performance Monitoring & Recommendation System

## Overview
AI-powered Azure solution that monitors VM performance metrics and generates weekly recommendations for VM resizing, targeting both DevOps engineers (technical details) and senior leadership (cost optimization).

## Architecture Components

### Multi-Tenant Container Architecture

```
┌──────────────┐
│    Slack     │
└──────┬───────┘
       │
       ▼
┌────────────────────────────────────┐
│     vmperf-slack-bot (Container)   │
│  - Natural language processing     │
│  - Subscription selection flow     │
│  - Conversation state management   │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│   vmperf-orchestrator (Container)  │
│  - Log Analytics queries           │
│  - AI analysis (GPT-4)             │
│  - Email report generation         │
│  - Slack progress notifications    │
└────────────────┬───────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│Tenant A│  │Tenant B│  │Tenant C│
│ - LA   │  │ - LA   │  │ - LA   │
│ - Subs │  │ - Subs │  │ - Subs │
└────────┘  └────────┘  └────────┘
```

### 1. Data Collection Layer
- **Azure Monitor**: Collects VM metrics (CPU, Memory, Disk IOPS)
- **Log Analytics Workspace**: Per-tenant workspaces for data isolation
- **Multi-Tenant Support**: Query different tenants with per-tenant OAuth
- **Retention**: 90-day minimum for trend analysis

### 2. Processing Layer (Container Apps)
- **vmperf-orchestrator**: Main analysis engine
  - Queries Log Analytics with per-tenant authentication
  - AI-powered VM analysis using GPT-4
  - Generates HTML reports (Technical & Executive)
  - Sends Slack progress notifications
- **vmperf-slack-bot**: Conversational interface
  - Natural language query processing
  - Subscription selection with fuzzy search
  - Multi-turn conversation support

### 3. Output Layer
- **Email Reports**: Differentiated for technical and leadership audiences
- **Slack Notifications**: Real-time progress updates during analysis
- **Azure Storage**: Archives reports and analysis results (gzipped JSON)

## Key Features

### Metrics Analyzed
1. **CPU Utilization**
   - Max, Average, P95 over 7 days
   - Threshold: <20% underutilized, >80% overutilized

2. **Memory Consumption**
   - Max, Average, P95 over 7 days
   - Threshold: <30% underutilized, >85% overutilized

3. **Disk IOPS**
   - Max, Average IOPS consumed
   - Compare against VM SKU limits

### Report Types
- **Technical Report**: Detailed metrics, sizing recommendations, migration steps
- **Executive Report**: Cost savings, risk assessment, business impact

## Cost Analysis
- Current VM costs (compute + storage)
- Recommended VM costs
- Monthly/Annual savings potential
- TCO impact over 1-3 years

## Slack Bot Features

### Natural Language Queries
- "Run a performance report for VEHR-Management"
- "Show me underutilized VMs"
- "Investigate vm-prod-db-001"

### Subscription Selection
- Fuzzy search: "vehr management" matches "VEHR-Management"
- Multi-tenant support: Query across different Azure AD tenants
- Per-tenant workspace routing

### Progress Notifications
During analysis, the bot provides real-time progress updates:
- **Step 1/5**: Querying Log Analytics (with "WOW!" message for 50+ VMs)
- **Step 2/5**: Getting VM Inventory
- **Step 3/5**: AI Analysis (with batch progress)
- **Step 4/5**: Generating Reports
- **Step 5/5**: Sending Email Reports

### Multi-Tenant Configuration
Each tenant is configured with:
- **Tenant ID**: Azure AD tenant GUID
- **Subscription IDs**: List of subscriptions in the tenant
- **Log Analytics Workspace**: Tenant-specific workspace ID
- **OAuth Authentication**: Per-tenant service principal authentication

## Prerequisites
- Azure Subscription with appropriate permissions
- Azure AI Foundry workspace
- Log Analytics workspace
- Azure Monitor configured for target VMs

## Deployment
See `deployment/` folder for:
- Bicep templates
- Logic App definitions
- Configuration parameters

## Files Structure
```
/container-app                        # Orchestrator service
  ├── src/
  │   ├── index.js                   # Main Express app & orchestration API
  │   └── services/
  │       ├── logAnalytics.js        # Log Analytics queries (per-tenant OAuth)
  │       ├── aiAnalysis.js          # GPT-4 VM analysis
  │       ├── reportGenerator.js     # HTML report generation
  │       ├── emailService.js        # SendGrid email delivery
  │       └── storageService.js      # Azure Table/Blob storage
  ├── Dockerfile
  └── package.json
/slack-bot                           # Slack bot service
  ├── src/
  │   ├── index.js                   # Bot Framework Express app
  │   ├── bot/
  │   │   └── vmPerfBot.js           # Main bot logic & conversation handling
  │   └── services/
  │       ├── orchestrationClient.js # HTTP client for orchestrator
  │       ├── conversationState.js   # Azure Table conversation state
  │       └── keyVaultService.js     # Key Vault secrets loading
  ├── Dockerfile
  └── package.json
/deployment
  ├── main.bicep                    # Main deployment template
  ├── parameters.json               # Configuration parameters
  └── logic-app-definition.json     # Logic App workflow
/src
  ├── queries/
  │   └── vm-metrics-query.kql      # KQL queries for metrics
  ├── prompts/
  │   ├── technical-analysis.txt    # AI prompt for technical report
  │   └── executive-analysis.txt    # AI prompt for executive report
  └── templates/
      ├── email-technical.html      # Technical email template
      └── email-executive.html      # Executive email template
```
