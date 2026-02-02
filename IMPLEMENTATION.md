# VM Performance Bot - Implementation Guide

## Version: v8-agent

This document details the implementation of the VM Performance Bot using Azure AI Foundry Agent Service with direct Slack Events API integration.

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Message Flow](#message-flow)
5. [Agent Tools](#agent-tools)
6. [Conversation State](#conversation-state)
7. [Channel Integration](#channel-integration)
8. [Configuration](#configuration)
9. [Deployment](#deployment)
10. [Testing](#testing)

---

## Overview

The v8-agent implementation replaces slash commands with a conversational AI interface that:

- **Uses Natural Language**: Users interact naturally instead of memorizing commands
- **Maintains Context**: Multi-turn conversations with memory via Cosmos DB
- **Executes Tools**: AI agent calls orchestrator APIs to fetch real data
- **Supports Multiple Channels**: Slack (direct API) and Teams (Bot Framework)

### Key Technologies

| Component | Technology |
|-----------|------------|
| AI Engine | Azure AI Foundry Agent Service |
| Slack Integration | Direct Slack Events API |
| Teams Integration | Azure Bot Service + Bot Framework SDK |
| State Storage | Azure Cosmos DB (with in-memory fallback) |
| Secrets | Azure Key Vault |
| Hosting | Azure Container Apps |

---

## Architecture

```
                          ┌─────────────────────────────┐
                          │        Slack App            │
                          │   (api.slack.com/apps)      │
                          └─────────────┬───────────────┘
                                        │
                         Event Subscriptions
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────┐
│                   vmperf-slack-bot Container                    │
│                      (Express Server)                           │
│                                                                 │
│  ┌─────────────────────┐    ┌─────────────────────────────┐   │
│  │  POST /api/slack/   │    │  POST /api/messages         │   │
│  │      events         │    │  (Bot Framework - Teams)    │   │
│  │                     │    │                             │   │
│  │  URL verification   │    │  Adapter processes          │   │
│  │  Signature check    │    │  Teams activities           │   │
│  │  Event handling     │    │                             │   │
│  └──────────┬──────────┘    └──────────────┬──────────────┘   │
│             │                               │                  │
│             └───────────┬───────────────────┘                  │
│                         │                                      │
│                         ▼                                      │
│           ┌─────────────────────────────────┐                 │
│           │        VMPerfBot                │                 │
│           │    (bot/vmPerfBot.js)           │                 │
│           │                                 │                 │
│           │  handleSlackEvent()      ←──── Slack              │
│           │  handleMessage()         ←──── Teams              │
│           └──────────────┬──────────────────┘                 │
│                          │                                     │
│            ┌─────────────┼─────────────┐                      │
│            │             │             │                      │
│            ▼             ▼             ▼                      │
│  ┌────────────────┐ ┌──────────────┐ ┌─────────────────┐     │
│  │ AgentService   │ │ Conversation │ │ Channel         │     │
│  │                │ │ State        │ │ Adapter         │     │
│  │ processMessage │ │              │ │                 │     │
│  │ handleToolCalls│ │ getThreadId  │ │ formatResponse  │     │
│  │                │ │ setThreadId  │ │ formatSlack     │     │
│  └───────┬────────┘ └──────────────┘ └─────────────────┘     │
│          │                                                    │
│          │ Tool Execution                                     │
│          ▼                                                    │
│  ┌─────────────────────────────────────────────────────────┐ │
│  │                   Tool Registry                          │ │
│  │                                                          │ │
│  │  trigger_performance_report  →  POST /api/orchestrate   │ │
│  │  query_vms_by_status        →  GET /api/vms/status/:s   │ │
│  │  search_vms                 →  GET /api/vms/search?q=   │ │
│  │  investigate_vm             →  GET /api/vms/:vmName     │ │
│  │  query_inventory            →  GET /api/inventory       │ │
│  │  get_cross_tenant_summary   →  GET /api/summary         │ │
│  └────────────────────────┬────────────────────────────────┘ │
└───────────────────────────┼──────────────────────────────────┘
                            │
                            ▼
              ┌─────────────────────────────────┐
              │     vmperf-orchestrator         │
              │         Container               │
              │                                 │
              │   REST API endpoints            │
              │   Azure Monitor integration     │
              │   Multi-tenant support          │
              └─────────────────────────────────┘
```

---

## Components

### 1. Entry Point (`src/index.js`)

The main Express server with dual endpoints:

```javascript
// Slack Events API endpoint (direct integration)
app.post('/api/slack/events', async (req, res) => {
    // 1. Handle URL verification challenge FIRST
    if (body.type === 'url_verification') {
        return res.json({ challenge: body.challenge });
    }

    // 2. Verify Slack request signature
    if (!verifySlackSignature(req, signingSecret)) {
        return res.status(401).send('Invalid signature');
    }

    // 3. Acknowledge immediately (prevent retries)
    res.status(200).send();

    // 4. Process event asynchronously
    if (body.type === 'event_callback') {
        await bot.handleSlackEvent(event, teamId, config.slack);
    }
});

// Bot Framework endpoint (for Teams)
app.post('/api/messages', async (req, res) => {
    await adapter.process(req, res, (context) => bot.run(context));
});
```

**Key Implementation Details:**

- URL verification challenge MUST be handled before signature verification
- Signature uses HMAC-SHA256 with constant-time comparison
- Events are acknowledged with 200 immediately to prevent Slack retries
- Raw body is preserved for signature verification

### 2. Bot Handler (`src/bot/vmPerfBot.js`)

The main bot class that handles messages from both channels:

```javascript
class VMPerfBot extends ActivityHandler {
    constructor(config) {
        // Initialize conversation state (Cosmos DB or in-memory)
        this.conversationState = createConversationState(config);

        // Check if agent is configured
        this.agentAvailable = !!config.aiFoundry?.agentId;

        // Bot Framework message handler (for Teams)
        this.onMessage(async (context, next) => {
            await this.handleMessage(context);
            await next();
        });
    }

    // Direct Slack Events API handler
    async handleSlackEvent(event, teamId, slackConfig) {
        const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

        let responseText;
        if (this.agentAvailable) {
            responseText = await this.processSlackAgentMessage(cleanText, userId, 'slack');
        } else {
            responseText = await this.processSlackFallbackMessage(cleanText);
        }

        await this.sendSlackMessage(channel, responseText, slackConfig);
    }
}
```

**Key Implementation Details:**

- Agent service is initialized lazily on first message
- Bot mention prefixes (`<@BOTID>`) are stripped from messages
- Fallback mode provides basic functionality if agent is unavailable
- Responses are sent via Slack API using `chat.postMessage`

### 3. Agent Service (`src/services/agentService.js`)

Manages conversations with Azure AI Foundry Agent:

```javascript
class AgentService {
    async processMessage(threadId, userMessage, context) {
        // Create new thread if needed
        if (!threadId) {
            const thread = await this.client.threads.create();
            threadId = thread.id;
        }

        // Add user message to thread
        await this.client.threads.messages.create(threadId, {
            role: 'user',
            content: userMessage
        });

        // Run the agent
        let run = await this.client.threads.runs.create(threadId, {
            assistant_id: this.agentId
        });

        // Poll for completion with tool execution
        while (run.status !== 'completed') {
            if (run.status === 'requires_action') {
                run = await this.handleToolCalls(threadId, run);
            } else {
                await this.sleep(1000);
                run = await this.client.threads.runs.retrieve(threadId, run.id);
            }
        }

        // Get response
        const messages = await this.client.threads.messages.list(threadId);
        return { threadId, response: messages.data[0].content[0].text.value };
    }
}
```

**Key Implementation Details:**

- Uses `@azure/ai-projects` SDK for agent interaction
- Authentication via `DefaultAzureCredential` (Managed Identity)
- Polls for completion with 1-second intervals (max 60 iterations)
- Tool calls are handled synchronously during polling

### 4. Conversation State (`src/services/conversationState.js`)

Persists thread IDs for multi-turn conversations:

```javascript
class ConversationState {
    async getThreadId(userId, channelId) {
        const id = `${channelId}:${userId}`;
        const { resource } = await this.container.item(id, id).read();
        return resource?.threadId || null;
    }

    async setThreadId(userId, channelId, threadId) {
        const id = `${channelId}:${userId}`;
        await this.container.items.upsert({
            id,
            partitionKey: id,
            userId,
            channelId,
            threadId,
            updatedAt: new Date().toISOString()
        });
    }
}

// Fallback for local development
class InMemoryConversationState {
    constructor() {
        this.store = new Map();
    }
}
```

**Key Implementation Details:**

- Document ID format: `{channelId}:{userId}`
- Partition key matches document ID for efficient queries
- Auto-creates database and container if not exists
- In-memory fallback when Cosmos DB not configured

### 5. Tool Registry (`src/tools/index.js`)

Registers all tools with the agent service:

```javascript
function registerAllTools(agentService, orchestrationClient) {
    agentService.registerToolHandler(
        'trigger_performance_report',
        createTriggerReportTool(orchestrationClient)
    );

    agentService.registerToolHandler(
        'query_vms_by_status',
        createQueryVMsByStatusTool(orchestrationClient)
    );

    // ... more tools
}
```

### 6. Tool Implementation Pattern

Each tool follows this pattern:

```javascript
function createToolName(orchestrationClient) {
    return async function toolName(args) {
        try {
            const result = await orchestrationClient.someMethod(args);
            return {
                success: true,
                data: result,
                message: 'Human-readable summary'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message,
                suggestion: 'What to try next'
            };
        }
    };
}
```

---

## Message Flow

### Slack Message Flow

```
1. User sends message in Slack
   ↓
2. Slack sends POST to /api/slack/events
   ↓
3. Server verifies signature (HMAC-SHA256)
   ↓
4. Server responds with 200 immediately
   ↓
5. VMPerfBot.handleSlackEvent() called
   ↓
6. Get existing threadId from ConversationState
   ↓
7. AgentService.processMessage(threadId, text)
   ↓
8. Agent processes, may call tools
   ↓
9. Tool handlers call orchestrator APIs
   ↓
10. Agent generates response
    ↓
11. Save new threadId to ConversationState
    ↓
12. Send response via Slack API (chat.postMessage)
```

### Teams Message Flow

```
1. User sends message in Teams
   ↓
2. Bot Framework routes to /api/messages
   ↓
3. CloudAdapter validates token
   ↓
4. VMPerfBot.handleMessage() called
   ↓
5. Same agent processing as Slack
   ↓
6. ChannelAdapter formats for Teams
   ↓
7. Response sent via Bot Framework
```

---

## Agent Tools

### Tool Definitions

| Tool | Description | API Endpoint |
|------|-------------|--------------|
| `trigger_performance_report` | Start VM analysis | `POST /api/orchestrate` |
| `query_vms_by_status` | Get VMs by status | `GET /api/vms/status/:status` |
| `search_vms` | Search by name pattern | `GET /api/vms/search?q=` |
| `investigate_vm` | Get VM details | `GET /api/vms/:vmName` |
| `query_inventory` | List VMs with filters | `GET /api/inventory` |
| `get_cross_tenant_summary` | Cross-tenant stats | `GET /api/summary` |

### Tool JSON Schema (for AI Foundry)

```json
{
  "type": "function",
  "function": {
    "name": "query_vms_by_status",
    "description": "Get VMs filtered by performance status",
    "parameters": {
      "type": "object",
      "properties": {
        "status": {
          "type": "string",
          "enum": ["UNDERUTILIZED", "OVERUTILIZED", "OPTIMAL", "NEEDS_REVIEW"]
        },
        "limit": {
          "type": "integer",
          "default": 10
        }
      },
      "required": ["status"]
    }
  }
}
```

---

## Conversation State

### Cosmos DB Schema

```json
{
  "id": "slack:U123456789",
  "partitionKey": "slack:U123456789",
  "userId": "U123456789",
  "channelId": "slack",
  "threadId": "thread_abc123xyz",
  "preferences": {
    "defaultLimit": 10
  },
  "updatedAt": "2026-01-26T10:30:00.000Z"
}
```

### State Operations

| Operation | Method | Description |
|-----------|--------|-------------|
| Get Thread | `getThreadId(userId, channelId)` | Retrieve existing conversation thread |
| Save Thread | `setThreadId(userId, channelId, threadId)` | Save new or updated thread |
| Clear | `clearConversation(userId, channelId)` | Delete thread for fresh start |
| Cleanup | `cleanupStaleConversations(days)` | Remove old conversations |

---

## Channel Integration

### Slack Configuration

1. **Event Subscriptions URL**: `https://<domain>/api/slack/events`
2. **Interactivity URL**: `https://<domain>/api/slack/interactions`
3. **Required Bot Events**:
   - `message.channels` - Messages in public channels
   - `message.im` - Direct messages
   - `app_mention` - When @mentioned

### Teams Configuration

1. **Messaging Endpoint**: `https://<domain>/api/messages`
2. **App Registration**: Multi-tenant Azure AD app
3. **Bot Framework**: Registered in Azure Bot Service

---

## Configuration

### Key Vault Secrets

| Secret Name | Description |
|-------------|-------------|
| `Bot-MicrosoftAppId` | Bot Framework app ID |
| `Bot-MicrosoftAppPassword` | Bot Framework app secret |
| `Bot-MicrosoftAppTenantId` | Azure AD tenant ID |
| `Slack-BotToken` | Slack Bot User OAuth Token (xoxb-) |
| `Slack-SigningSecret` | Slack app signing secret |
| `AIFoundry-ProjectEndpoint` | AI Foundry project URL |
| `AIFoundry-AgentId` | Deployed agent ID |
| `CosmosDB-ConnectionString` | Cosmos DB connection string |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3978 | Server port |
| `KEY_VAULT_URL` | - | Key Vault URL |
| `ORCHESTRATOR_URL` | http://localhost:3000 | Orchestrator API URL |

---

## Deployment

### Container Apps Deployment

```bash
# Build and push
az acr build -t vmperf-slack-bot:v8 -r yourregistry .

# Deploy
az containerapp update \
  --name vmperf-slack-bot \
  --resource-group your-rg \
  --image yourregistry.azurecr.io/vmperf-slack-bot:v8
```

### Resource Setup Script

Use `scripts/setup-agent-resources.sh` to create:
- App Registration (bot identity)
- Azure Bot Service
- Cosmos DB account + database + container
- Key Vault secrets

---

## Testing

### Local Testing

1. **Start locally**: `npm run dev`
2. **Use ngrok**: `ngrok http 3978`
3. **Update Slack Event URL** to ngrok URL
4. **Verify URL verification** challenge works

### Health Check

```bash
curl https://<domain>/health
```

Response:
```json
{
  "status": "healthy",
  "version": "2.0.0",
  "botFramework": "configured",
  "aiFoundryAgent": "configured",
  "orchestratorUrl": "https://..."
}
```

### Conversation Testing

| Input | Expected Behavior |
|-------|-------------------|
| "Show underutilized VMs" | Agent calls `query_vms_by_status(UNDERUTILIZED)` |
| "Run a report" | Agent calls `trigger_performance_report()` |
| "Why is vm-prod-001 flagged?" | Agent calls `investigate_vm(vm-prod-001)` |
| "clear" | Clears conversation, starts fresh |
| "help" | Shows capabilities |

---

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| URL verification fails | Signature check before challenge | Move challenge handler first |
| Messages not received | Wrong Slack event URL | Verify Event Subscriptions URL |
| "Sending messages turned off" | Slack App Home not configured | Enable "Messages Tab" in App Home |
| 403 Forbidden to orchestrator | IP restrictions on Container App | Add AllowAll rule or bot outbound IPs |
| Orchestration timeout | Default 30s timeout too short | Timeout increased to 5 min for orchestrate |
| Agent timeout | Tools taking too long | Check orchestrator health |
| No response sent | Missing Slack-BotToken | Add token to Key Vault |
| Context lost | Thread not saved | Check Cosmos DB connectivity |

### Orchestrator IP Restrictions

Container Apps have many possible outbound IPs. To allow bot-to-orchestrator communication:

```bash
# Add AllowAll rule (simplest)
az containerapp ingress access-restriction set \
  --name vmperf-orchestrator \
  --resource-group Sai-Test-rg \
  --rule-name "AllowAll" \
  --action Allow \
  --ip-address "0.0.0.0/0"

# Or get bot outbound IPs and add individually
az containerapp show --name vmperf-slack-bot \
  --resource-group Sai-Test-rg \
  --query "properties.outboundIpAddresses" -o json
```

### Timeout Configuration

The orchestration client has configurable timeouts:

```javascript
// Default timeout: 60 seconds
this.client = axios.create({
    timeout: 60000
});

// Orchestration trigger: 5 minutes (may take time to initialize)
await this.client.post('/api/orchestrate', data, {
    timeout: 300000
});
```

### Debug Logging

Enable verbose logging:
```javascript
console.log(`[${channelId}] Message from ${userId}: "${text}"`);
console.log(`Agent response sent (tools used: ${result.toolsUsed || 0})`);
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/index.js` | Express server, endpoints |
| `src/bot/vmPerfBot.js` | Main bot handler |
| `src/services/agentService.js` | AI Foundry client |
| `src/services/conversationState.js` | Cosmos DB state |
| `src/services/keyVaultService.js` | Secret management |
| `src/tools/index.js` | Tool registry |
| `src/tools/*.js` | Individual tool handlers |
| `src/bot/channelAdapter.js` | Channel formatting |
