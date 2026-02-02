# VM Performance Bot - TODO List

## Version: v8-agent

Last updated: 2026-01-27

---

## Priority Legend

- **P0** - Critical - Must complete for basic functionality
- **P1** - High - Important for production readiness
- **P2** - Medium - Nice to have improvements
- **P3** - Low - Future enhancements

---

## Completed

- [x] Create AgentService for Azure AI Foundry integration
- [x] Create ConversationState for Cosmos DB persistence
- [x] Create tool handlers for all 6 orchestrator operations
- [x] Update vmPerfBot.js with agent-based message handling
- [x] Implement direct Slack Events API endpoint
- [x] Add Slack signature verification
- [x] Fix URL verification challenge handling (must be before signature check)
- [x] Store Slack Bot Token in Key Vault
- [x] Deploy updated container to Azure
- [x] Verify Slack URL verification works
- [x] Update ARCHITECTURE.md with v8-agent documentation
- [x] Create IMPLEMENTATION.md with implementation details
- [x] Create TODO.md for tracking
- [x] Enable Slack App Home "Messages Tab" for DMs
- [x] Fix orchestrator IP restrictions (added AllowAll rule for Container Apps)
- [x] Increase orchestration client timeout (60s default, 5min for orchestrate)

---

## P0 - Critical

### Azure AI Foundry Agent Configuration

- [ ] **Create AI Foundry Project**
  - Go to [Azure AI Foundry](https://ai.azure.com)
  - Create or select a project in the same resource group
  - Note the Project Endpoint URL

- [ ] **Create and Configure Agent**
  - Navigate to Agents section
  - Create new agent with model (e.g., gpt-4o)
  - Configure system instructions:
    ```
    You are a VM Performance Analyst assistant for Azure infrastructure teams.

    CAPABILITIES:
    1. Trigger Performance Reports - Run VM analysis across tenants
    2. Query VM Status - Find underutilized, overutilized, or optimal VMs
    3. Search VMs - Find VMs by name pattern
    4. Investigate Issues - Explain why VMs are flagged
    5. Query Inventory - List VMs with filters
    6. Summarize Performance - Get cross-tenant summaries

    GUIDELINES:
    - Always use tools to fetch real data; never make up VM names
    - Remember context from previous messages
    - Provide actionable recommendations
    ```

- [ ] **Add Tool Definitions to Agent**
  - Add all 6 tool definitions from `tools/index.js` `getToolDefinitions()`
  - Verify tool names match exactly:
    - `trigger_performance_report`
    - `query_vms_by_status`
    - `search_vms`
    - `investigate_vm`
    - `query_inventory`
    - `get_cross_tenant_summary`

- [ ] **Store Agent Secrets in Key Vault**
  ```bash
  az keyvault secret set --vault-name vmperf-kv-18406 \
    --name AIFoundry-ProjectEndpoint \
    --value '<your-project-endpoint>'

  az keyvault secret set --vault-name vmperf-kv-18406 \
    --name AIFoundry-AgentId \
    --value '<your-agent-id>'
  ```

### Cosmos DB Setup

- [ ] **Create Cosmos DB Resources** (if not using setup script)
  ```bash
  # Create account
  az cosmosdb create \
    --name vmperf-conversations \
    --resource-group Sai-Test-rg \
    --enable-serverless

  # Create database
  az cosmosdb sql database create \
    --account-name vmperf-conversations \
    --resource-group Sai-Test-rg \
    --name vmperf-bot

  # Create container
  az cosmosdb sql container create \
    --account-name vmperf-conversations \
    --resource-group Sai-Test-rg \
    --database-name vmperf-bot \
    --name conversations \
    --partition-key-path /partitionKey
  ```

- [ ] **Store Cosmos DB Connection String**
  ```bash
  # Get connection string
  az cosmosdb keys list \
    --name vmperf-conversations \
    --resource-group Sai-Test-rg \
    --type connection-strings

  # Store in Key Vault
  az keyvault secret set --vault-name vmperf-kv-18406 \
    --name CosmosDB-ConnectionString \
    --value '<connection-string>'
  ```

---

## P1 - High Priority

### Slack App Configuration

- [x] **Verify Slack App Scopes** (DONE)
  - `chat:write` - Send messages
  - `channels:history` - Read channel messages
  - `im:history` - Read DM history
  - `im:write` - Start DMs
  - `app_mentions:read` - Receive @mentions

- [x] **Subscribe to Bot Events** (DONE)
  - Event Subscriptions URL: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/events`
  - Bot events: `message.channels`, `message.im`, `app_mention`

- [x] **Enable Interactivity** (DONE)
  - Interactivity URL: `https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/api/slack/interactions`

### Testing (Fallback Mode)

- [x] **Test basic commands in fallback mode**
  - "Help" - shows available commands
  - "Run a performance report" - triggers orchestration (with 5min timeout)
  - "Show underutilized VMs" - returns VM list

- [ ] **Test Multi-Turn Conversation**
  - Start conversation: "Show me underutilized VMs"
  - Follow up: "Tell me more about the first one"
  - Verify context is maintained

- [ ] **Test Conversation Reset**
  - Send "clear" or "reset"
  - Verify new thread is created
  - Verify old context is gone

### Error Handling

- [ ] **Add retry logic to agent service**
  - Retry on transient failures (429, 503)
  - Exponential backoff

- [ ] **Improve error messages**
  - User-friendly messages for common failures
  - Include suggestions for next steps

---

## P2 - Medium Priority

### Teams Channel Support

- [ ] **Register Bot in Azure Bot Service**
  - Run `scripts/setup-agent-resources.sh` or manually create
  - Note the App ID and Password

- [ ] **Configure Teams Channel**
  - Go to Azure Portal > Bot Service > Channels
  - Click "Microsoft Teams" to enable
  - Update messaging endpoint

- [ ] **Test Teams Integration**
  - Install bot in Teams
  - Test natural language queries
  - Verify Adaptive Cards render

### Proactive Notifications

- [ ] **Implement Report Completion Notifications**
  - Store channel/user info when report triggered
  - Poll orchestrator for completion
  - Send proactive message when done

- [ ] **Add Scheduled Summaries**
  - Option for daily/weekly summary messages
  - User preference storage in Cosmos DB

### Rich Formatting

- [ ] **Create Slack Block Kit cards**
  - Complete `src/bot/cards/slackBlocks.js`
  - VM list cards with action buttons
  - Summary cards with charts

- [ ] **Create Teams Adaptive Cards**
  - Complete `src/bot/cards/adaptiveCards.js`
  - VM list cards with actions
  - Summary cards

### Code Quality

- [ ] **Add unit tests**
  - Test tool handlers
  - Test channel adapter formatting
  - Test conversation state operations

- [ ] **Add integration tests**
  - Mock AI Foundry responses
  - Test full message flow

- [ ] **Add TypeScript definitions**
  - Create type definitions for config
  - Add JSDoc types throughout

---

## P3 - Low Priority / Future

### Deprecation Cleanup

- [ ] **Remove deprecated files**
  - `src/services/conversationAI.js` (replaced by agent)
  - `src/bot/dialogs/mainDialog.js` (agent handles flow)
  - Old slash command handlers

### Performance Optimization

- [ ] **Add caching for frequently accessed data**
  - Cache VM status results (short TTL)
  - Cache inventory queries

- [ ] **Optimize Cosmos DB queries**
  - Add indexes for common queries
  - Implement pagination for large result sets

### Advanced Features

- [ ] **Add user preferences**
  - Default result limits
  - Preferred notification channel
  - Time zone for scheduled reports

- [ ] **Add conversation analytics**
  - Track common queries
  - Monitor tool usage
  - Identify areas for improvement

- [ ] **Support file attachments**
  - Allow users to request CSV exports
  - Send reports as file attachments

- [ ] **Add voice input support**
  - Teams audio support
  - Slack Huddles integration

### Security Enhancements

- [ ] **Implement rate limiting**
  - Per-user message limits
  - Per-channel limits

- [ ] **Add audit logging**
  - Log all tool invocations
  - Track sensitive operations

- [ ] **Implement role-based access**
  - Admin vs viewer roles
  - Tenant-specific access control

---

## Quick Reference Commands

### Deploy

```bash
# Build and deploy bot
cd slack-bot
az acr build --registry ca0bf4270c7eacr --image vmperf-slack-bot:latest --file Dockerfile .
az containerapp update \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --image ca0bf4270c7eacr.azurecr.io/vmperf-slack-bot:latest
```

### Key Vault Operations

```bash
# List secrets
az keyvault secret list --vault-name vmperf-kv-18406 --output table

# Get secret value
az keyvault secret show --vault-name vmperf-kv-18406 --name Slack-BotToken --query value -o tsv

# Set secret
az keyvault secret set --vault-name vmperf-kv-18406 --name <name> --value '<value>'
```

### View Logs

```bash
# Container App logs
az containerapp logs show \
  --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --follow
```

### Health Check

```bash
curl https://vmperf-slack-bot.calmsand-17418731.westus2.azurecontainerapps.io/health
curl https://vmperf-orchestrator.calmsand-17418731.westus2.azurecontainerapps.io/health
```

---

## Notes

- The bot currently uses **fallback mode** (AI Foundry Agent not yet configured)
- Fallback mode provides basic intent matching:
  - "help" - Shows capabilities
  - "report/analyze/run" - Triggers orchestration
  - "underutilized/overutilized/optimal" - Queries VMs by status
- Full conversational AI requires completing P0 items (AI Foundry Agent setup)
- Teams support requires completing P2 Teams items
- Orchestrator IP restrictions removed (AllowAll rule added)
- Orchestration timeout increased to 5 minutes
