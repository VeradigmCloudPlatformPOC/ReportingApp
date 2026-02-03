# Changelog

All notable changes to the VMPerf Monitoring System are documented in this file.

## [v10-fix3] - 2026-02-03

### Fixed
- **Temperature parameter compatibility**: Removed `temperature` parameter from Azure OpenAI API calls in `dynamicQueryTool.js`. Newer Azure OpenAI models (o1 series, etc.) only support the default temperature value (1), causing `BadRequestError: 400 Unsupported value: 'temperature' does not support 0.3`.

### Deployment
- `vmperf-slack-bot:v10-fix3` deployed to Azure Container Apps

---

## [v10-fix2] - 2026-02-03

### Fixed
- **max_tokens parameter**: Changed `max_tokens` to `max_completion_tokens` in all Azure OpenAI API calls. Newer models require the new parameter name.

### Deployment
- `vmperf-slack-bot:v10-fix2` deployed to Azure Container Apps

---

## [v10-fixes] - 2026-02-02

### Added
- **Agent verbosity**: Real-time Slack status messages during tool execution (e.g., ":rocket: Starting performance analysis...", ":mag: Searching VMs...")
- **Export CSV handler**: Implemented `export_csv` action in Slack button interactions with email delivery
- **getUserEmail helper**: Fetch user email from Slack profile for export functionality

### Fixed
- **Email endpoint bug**: Added missing `const secrets = await loadSecrets();` in `/api/query/email-results` handler - emails were failing because secrets were undefined
- **VM name matching**: Implemented case-insensitive, FQDN-aware VM name matching in `investigateVMTool.js` using `tolower()` and `startswith` in KQL queries

### Changed
- **Container resources upgraded**:
  - `vmperf-orchestrator`: 2.0 CPU / 4.0 Gi memory
  - `vmperf-slack-bot`: 1.0 CPU / 2.0 Gi memory

### Deployment
- `vmperf-orchestrator:v10-fixes` deployed to Azure Container Apps
- `vmperf-slack-bot:v10-fixes` deployed to Azure Container Apps

---

## [v10-perf-only] - 2026-02-03

### Changed
- **Perf table enforcement**: ALL performance metrics (CPU, Memory, Disk) must now be queried from the `Perf` table ONLY
- Removed `InsightsMetrics` and `AzureMetrics` from allowed KQL tables in query validation
- Updated AI prompts with critical instruction to use Perf table exclusively

### Security
- Query validation now blocks queries attempting to use InsightsMetrics or AzureMetrics for performance data

---

## [v9-dynamic-queries] - 2026-01-28

### Added
- **Dynamic query system**: AI-generated KQL and Resource Graph queries from natural language
- **Query validation**: Security layer with table whitelist, dangerous operation blocking, injection detection
- **Auto-detect delivery**: Results ≤50 rows → Slack, >50 rows → Email automatically
- **AI Foundry Agent integration**: Azure AI Foundry Assistants API for conversation handling
- **Tool framework**: 9 tools for VM analysis, inventory, and dynamic queries

### Tools Added
| Tool | Description |
|------|-------------|
| `trigger_performance_report` | Full 30-day performance analysis |
| `query_vms_by_status` | Filter VMs by status |
| `search_vms` | Search VMs by name pattern |
| `investigate_vm` | Deep-dive VM investigation |
| `query_inventory` | Live VM inventory |
| `get_cross_tenant_summary` | Multi-tenant summary |
| `execute_dynamic_query` | AI-generated queries |
| `generate_kql_query` | KQL generation only |
| `generate_resourcegraph_query` | Resource Graph generation only |

---

## [v7-slack-bot] - 2026-01-26

### Added
- **Slack bot interface**: Natural language query processing
- **Subscription selection**: Fuzzy search and multi-tenant support
- **Progress notifications**: Real-time Slack updates during analysis
- **Conversation state**: Azure Table Storage for multi-turn conversations

---

## [v6-parallel] - 2026-01-24

### Added
- **Parallel AI analysis**: Batch processing (5 VMs per batch) with parallel execution
- **Report caching**: 48-hour cache for completed analysis runs
- **Blob storage**: HTML reports and raw JSON data saved to Azure Blob Storage
- **SAS URL generation**: Secure download links for reports

### Improved
- Analysis time reduced from 30+ minutes to 5-10 minutes for 100 VMs

---

## Architecture Overview

```
┌──────────────┐
│    Slack     │
└──────┬───────┘
       │
       ▼
┌────────────────────────────────────┐
│     vmperf-slack-bot (Container)   │
│  - AI Foundry Agent                │
│  - 9 Tool handlers                 │
│  - Status callbacks                │
└────────────────┬───────────────────┘
                 │
                 ▼
┌────────────────────────────────────┐
│   vmperf-orchestrator (Container)  │
│  - Query validation (Perf only)    │
│  - Dynamic KQL/RG execution        │
│  - Email report delivery           │
└────────────────┬───────────────────┘
                 │
    ┌────────────┼────────────┐
    ▼            ▼            ▼
┌────────┐  ┌────────┐  ┌────────┐
│  Log   │  │Resource│  │ Azure  │
│Analytics│ │ Graph  │  │ OpenAI │
│ (Perf) │  │        │  │        │
└────────┘  └────────┘  └────────┘
```

## Deployment Status

| Component | Image | Resources | Status |
|-----------|-------|-----------|--------|
| vmperf-orchestrator | v10-fixes | 2.0 CPU / 4.0 Gi | ✅ Healthy |
| vmperf-slack-bot | v10-fix3 | 1.0 CPU / 2.0 Gi | ✅ Healthy |
