/**
 * @fileoverview Azure AI Foundry Agent Service Client
 *
 * Manages conversations with the AI Foundry Agent using the OpenAI Assistants API.
 * Azure AI Foundry agents use the OpenAI-compatible Assistants API format.
 *
 * @version v9-dynamic-queries
 */

const { AzureOpenAI } = require('openai');
const { DefaultAzureCredential, getBearerTokenProvider } = require('@azure/identity');

/**
 * Human-readable status messages for each tool.
 * These are shown to users in Slack while tools are executing.
 */
const TOOL_STATUS_MESSAGES = {
    'trigger_performance_report': ':rocket: Starting performance analysis...',
    'query_vms_by_status': ':mag: Searching VMs by status...',
    'search_vms': ':mag: Searching for VMs...',
    'investigate_vm': ':microscope: Investigating VM metrics...',
    'query_inventory': ':file_cabinet: Querying VM inventory...',
    'get_cross_tenant_summary': ':bar_chart: Generating summary...',
    'execute_dynamic_query': ':gear: Executing query...',
    'generate_kql_query': ':pencil: Generating KQL query...',
    'generate_resourcegraph_query': ':pencil: Generating Resource Graph query...'
};

/**
 * Get a user-friendly status message for a tool.
 * @param {string} toolName - Name of the tool
 * @returns {string} Status message
 */
function getToolStatusMessage(toolName) {
    return TOOL_STATUS_MESSAGES[toolName] || `:hourglass_flowing_sand: Processing...`;
}

/**
 * AgentService class for interacting with Azure AI Foundry Agent Service.
 * Uses OpenAI Assistants API through Azure AI Foundry endpoint.
 */
class AgentService {
    /**
     * Create an AgentService instance.
     * @param {Object} config - Configuration object
     * @param {string} config.projectEndpoint - AI Foundry project endpoint URL (fallback)
     * @param {string} config.openaiEndpoint - Azure OpenAI endpoint URL (preferred)
     * @param {string} config.agentId - Deployed agent/assistant ID
     * @param {string} config.apiKey - Optional API key (if not using managed identity)
     */
    constructor(config) {
        this.projectEndpoint = config.projectEndpoint;
        this.openaiEndpoint = config.openaiEndpoint;
        this.agentId = config.agentId;
        this.apiKey = config.apiKey;
        this.client = null;
        this.toolHandlers = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the Agent Service client.
     * Uses either API key or DefaultAzureCredential for authentication.
     */
    async initialize() {
        if (this.initialized) return;

        try {
            // Determine the base endpoint
            // Priority: OpenAI endpoint > AI Foundry project endpoint
            let baseEndpoint;

            if (this.openaiEndpoint) {
                // Extract base URL from OpenAI endpoint
                // e.g., https://saig-test-openai.cognitiveservices.azure.com/openai/deployments/gpt-5/chat/completions?...
                // -> https://saig-test-openai.cognitiveservices.azure.com
                const url = new URL(this.openaiEndpoint);
                baseEndpoint = `${url.protocol}//${url.host}`;
            } else if (this.projectEndpoint) {
                // Extract from AI Foundry project endpoint
                baseEndpoint = this.projectEndpoint;
                if (baseEndpoint.includes('/api/projects/')) {
                    baseEndpoint = baseEndpoint.split('/api/projects/')[0];
                }
            } else {
                throw new Error('No endpoint configured for AgentService');
            }

            console.log(`Initializing AgentService with endpoint: ${baseEndpoint}`);

            if (this.apiKey) {
                // Use API key authentication
                this.client = new AzureOpenAI({
                    endpoint: baseEndpoint,
                    apiKey: this.apiKey,
                    apiVersion: '2024-05-01-preview'
                });
            } else {
                // Use managed identity with token provider
                const credential = new DefaultAzureCredential();
                const scope = 'https://cognitiveservices.azure.com/.default';
                const azureADTokenProvider = getBearerTokenProvider(credential, scope);

                this.client = new AzureOpenAI({
                    endpoint: baseEndpoint,
                    azureADTokenProvider,
                    apiVersion: '2024-05-01-preview'
                });
            }

            this.initialized = true;
            console.log('AgentService initialized successfully');
            console.log(`  Agent ID: ${this.agentId}`);
        } catch (error) {
            console.error('Failed to initialize AgentService:', error.message);
            throw error;
        }
    }

    /**
     * Register a tool handler function.
     * Tool handlers are called when the agent requests tool execution.
     *
     * @param {string} toolName - Name of the tool (must match agent definition)
     * @param {Function} handler - Async function to handle tool execution
     */
    registerToolHandler(toolName, handler) {
        this.toolHandlers.set(toolName, handler);
        console.log(`Registered tool handler: ${toolName}`);
    }

    /**
     * Process a user message through the agent.
     * Handles multi-turn conversation with automatic tool execution.
     *
     * @param {string|null} threadId - Existing thread ID or null for new conversation
     * @param {string} userMessage - The user's message
     * @param {Object} context - Channel context information
     * @param {string} context.channel - Channel identifier (slack, msteams)
     * @param {string} context.userId - User identifier
     * @param {Function|null} statusCallback - Optional async callback for status updates (e.g., Slack messages)
     * @returns {Promise<Object>} Response object with threadId and response text
     */
    async processMessage(threadId, userMessage, context = {}, statusCallback = null) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            // Send initial acknowledgment with context paraphrasing
            if (statusCallback && context.subscriptionName) {
                const ackMessage = this.generateAcknowledgment(userMessage, context);
                if (ackMessage) {
                    await statusCallback(ackMessage);
                }
            }

            // Create new thread if needed
            if (!threadId) {
                const thread = await this.client.beta.threads.create();
                threadId = thread.id;
                console.log(`Created new thread: ${threadId}`);
            } else {
                // Wait for any active runs to complete before adding new message
                await this.waitForActiveRuns(threadId);
            }

            // Add user message to thread
            await this.client.beta.threads.messages.create(threadId, {
                role: 'user',
                content: userMessage,
                metadata: {
                    channel: context.channel || 'unknown',
                    userId: context.userId || 'unknown'
                }
            });

            // Run the agent/assistant
            let run = await this.client.beta.threads.runs.create(threadId, {
                assistant_id: this.agentId
            });

            console.log(`Started run ${run.id} for thread ${threadId}`);

            // Poll for completion with tool execution
            const maxIterations = 60; // 60 iterations * 1 second = 1 minute max
            let iterations = 0;
            let toolsUsedCount = 0;

            while (iterations < maxIterations) {
                iterations++;

                if (run.status === 'completed') {
                    break;
                }

                if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
                    console.error(`Run ${run.id} ended with status: ${run.status}`);
                    const errorMsg = run.last_error?.message || 'Unknown error';
                    throw new Error(`Agent run ${run.status}: ${errorMsg}`);
                }

                if (run.status === 'requires_action') {
                    console.log('Agent requires tool execution...');
                    const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
                    toolsUsedCount += toolCalls.length;
                    // Pass context and statusCallback to tool handlers
                    run = await this.handleToolCalls(threadId, run, context, statusCallback);
                } else {
                    // Wait and poll again
                    await this.sleep(1000);
                    run = await this.client.beta.threads.runs.retrieve(threadId, run.id);
                }
            }

            if (iterations >= maxIterations) {
                throw new Error('Agent response timed out');
            }

            // Get the latest assistant message
            const messages = await this.client.beta.threads.messages.list(threadId, {
                order: 'desc',
                limit: 1
            });

            const responseMessage = messages.data[0];
            let responseText = 'No response from agent';

            if (responseMessage?.content?.[0]?.type === 'text') {
                responseText = responseMessage.content[0].text.value;
            }

            return {
                threadId,
                response: responseText,
                status: run.status,
                toolsUsed: toolsUsedCount
            };

        } catch (error) {
            console.error('Error processing message:', error);
            throw error;
        }
    }

    /**
     * Handle tool calls from the agent.
     * Executes registered tool handlers and submits results back to the agent.
     *
     * @param {string} threadId - Thread ID
     * @param {Object} run - Current run object
     * @param {Object} context - Context including subscription info
     * @param {Function|null} statusCallback - Optional callback for status updates
     * @returns {Promise<Object>} Updated run object after tool submission
     */
    async handleToolCalls(threadId, run, context = {}, statusCallback = null) {
        const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const handler = this.toolHandlers.get(toolName);

            console.log(`Executing tool: ${toolName}`);
            if (context.subscriptionId) {
                console.log(`  With subscription context: ${context.subscriptionName} (${context.subscriptionId})`);
            }

            // Send status update to user before executing tool
            if (statusCallback) {
                try {
                    const statusMessage = getToolStatusMessage(toolName);
                    await statusCallback(statusMessage);
                } catch (callbackError) {
                    console.warn('Status callback failed:', callbackError.message);
                }
            }

            if (handler) {
                try {
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    // Pass context as second argument to tool handler
                    const result = await handler(args, context);

                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify(result)
                    });

                    console.log(`Tool ${toolName} completed successfully`);
                } catch (error) {
                    console.error(`Tool ${toolName} failed:`, error.message);
                    toolOutputs.push({
                        tool_call_id: toolCall.id,
                        output: JSON.stringify({
                            error: true,
                            message: error.message
                        })
                    });
                }
            } else {
                console.warn(`No handler registered for tool: ${toolName}`);
                toolOutputs.push({
                    tool_call_id: toolCall.id,
                    output: JSON.stringify({
                        error: true,
                        message: `Tool handler not found: ${toolName}`
                    })
                });
            }
        }

        // Submit tool outputs back to the agent
        return await this.client.beta.threads.runs.submitToolOutputs(threadId, run.id, {
            tool_outputs: toolOutputs
        });
    }

    /**
     * Delete a conversation thread.
     * Use this when user wants to start fresh.
     *
     * @param {string} threadId - Thread ID to delete
     */
    async deleteThread(threadId) {
        if (!threadId) return;

        try {
            await this.client.beta.threads.del(threadId);
            console.log(`Deleted thread: ${threadId}`);
        } catch (error) {
            console.warn(`Failed to delete thread ${threadId}:`, error.message);
        }
    }

    /**
     * Get conversation history for a thread.
     *
     * @param {string} threadId - Thread ID
     * @param {number} limit - Maximum messages to retrieve
     * @returns {Promise<Array>} Array of messages
     */
    async getThreadHistory(threadId, limit = 20) {
        if (!threadId) return [];

        try {
            const messages = await this.client.beta.threads.messages.list(threadId, {
                order: 'asc',
                limit
            });
            return messages.data;
        } catch (error) {
            console.error(`Failed to get thread history:`, error.message);
            return [];
        }
    }

    /**
     * Check if the agent service is healthy.
     *
     * @returns {Promise<Object>} Health check result
     */
    async healthCheck() {
        try {
            if (!this.initialized) {
                await this.initialize();
            }

            // Try to retrieve the assistant to verify connectivity
            const assistant = await this.client.beta.assistants.retrieve(this.agentId);

            return {
                healthy: true,
                agentId: this.agentId,
                agentName: assistant.name,
                model: assistant.model
            };
        } catch (error) {
            return {
                healthy: false,
                error: error.message
            };
        }
    }

    /**
     * Sleep helper for polling.
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Generate a context-aware acknowledgment message for the user's request.
     * Paraphrases the user's intent with subscription context.
     *
     * @param {string} userMessage - The user's message
     * @param {Object} context - Context including subscription info
     * @returns {string|null} Acknowledgment message or null if not applicable
     */
    generateAcknowledgment(userMessage, context) {
        const message = userMessage.toLowerCase().trim();
        const subscriptionName = context.subscriptionName || 'your subscription';

        // Skip acknowledgment for greetings and simple queries
        const skipPatterns = [
            /^(hi|hello|hey|thanks|thank you|ok|okay|yes|no|sure)[\s!.]*$/i,
            /^help$/i,
            /^clear$/i,
            /^\?$/
        ];

        for (const pattern of skipPatterns) {
            if (pattern.test(message)) {
                return null;
            }
        }

        // Intent patterns and their acknowledgment templates
        const intentPatterns = [
            // VM search patterns
            {
                patterns: [/find\s+(.+?)\s*vms?/i, /search\s+(?:for\s+)?(.+?)\s*vms?/i, /list\s+(.+?)\s*vms?/i, /show\s+(.+?)\s*vms?/i, /get\s+(.+?)\s*vms?/i],
                template: (match) => `:mag: Searching for ${match[1]} VMs in *${subscriptionName}*...`
            },
            // Filter by name patterns
            {
                patterns: [/filter\s+(?:for\s+)?(?:all\s+)?(.+?)\s*vms?/i, /vms?\s+(?:with|named|like)\s+(.+)/i],
                template: (match) => `:mag: Finding all ${match[1]} VMs in *${subscriptionName}*...`
            },
            // List all VMs
            {
                patterns: [/list\s+(?:all\s+)?vms?/i, /show\s+(?:all\s+)?vms?/i, /get\s+(?:all\s+)?vms?/i, /all\s+vms?/i],
                template: () => `:file_cabinet: Listing all VMs in *${subscriptionName}*...`
            },
            // VM count
            {
                patterns: [/how\s+many\s+vms?/i, /count\s+(?:of\s+)?vms?/i, /number\s+of\s+vms?/i],
                template: () => `:1234: Counting VMs in *${subscriptionName}*...`
            },
            // High CPU/Memory
            {
                patterns: [/high\s+cpu/i, /cpu\s+(?:above|over|greater|>)\s*(\d+)/i],
                template: (match) => `:fire: Looking for VMs with high CPU usage in *${subscriptionName}*...`
            },
            {
                patterns: [/high\s+memory/i, /memory\s+(?:above|over|greater|>)\s*(\d+)/i],
                template: (match) => `:fire: Looking for VMs with high memory usage in *${subscriptionName}*...`
            },
            // Underutilized/overutilized
            {
                patterns: [/underutilized/i, /under-utilized/i, /idle\s+vms?/i, /low\s+usage/i],
                template: () => `:chart_with_downwards_trend: Finding underutilized VMs in *${subscriptionName}*...`
            },
            {
                patterns: [/overutilized/i, /over-utilized/i, /overloaded/i],
                template: () => `:chart_with_upwards_trend: Finding overutilized VMs in *${subscriptionName}*...`
            },
            // Performance report
            {
                patterns: [/performance\s+report/i, /run\s+(?:a\s+)?report/i, /analyze\s+performance/i, /full\s+analysis/i],
                template: () => `:rocket: Starting performance analysis for *${subscriptionName}*...`
            },
            // Investigate specific VM
            {
                patterns: [/investigate\s+(.+)/i, /check\s+(?:on\s+)?(.+)/i, /look\s+at\s+(.+)/i, /details\s+(?:for|on)\s+(.+)/i],
                template: (match) => `:microscope: Investigating *${match[1].trim()}* in *${subscriptionName}*...`
            },
            // Running/stopped VMs
            {
                patterns: [/running\s+vms?/i, /vms?\s+(?:that\s+are\s+)?running/i],
                template: () => `:green_circle: Finding running VMs in *${subscriptionName}*...`
            },
            {
                patterns: [/stopped\s+vms?/i, /deallocated\s+vms?/i, /vms?\s+(?:that\s+are\s+)?stopped/i],
                template: () => `:red_circle: Finding stopped VMs in *${subscriptionName}*...`
            },
            // Location-based queries
            {
                patterns: [/vms?\s+in\s+(east\s*us|west\s*us|central\s*us|north\s*europe|west\s*europe|[a-z]+\d*)/i, /in\s+(east\s*us|west\s*us|central\s*us|north\s*europe|west\s*europe|[a-z]+\d*)\s+region/i],
                template: (match) => `:earth_americas: Looking for VMs in *${match[1]}* region in *${subscriptionName}*...`
            },
            // Generic query fallback
            {
                patterns: [/^.{10,}$/],  // Any message with 10+ characters
                template: () => `:hourglass_flowing_sand: Processing your request for *${subscriptionName}*...`
            }
        ];

        // Try to match intent patterns
        for (const intent of intentPatterns) {
            for (const pattern of intent.patterns) {
                const match = message.match(pattern);
                if (match) {
                    return intent.template(match);
                }
            }
        }

        return null;
    }

    /**
     * Wait for any active runs on a thread to complete.
     * This prevents the "Can't add messages while a run is active" error.
     *
     * @param {string} threadId - Thread ID to check
     * @param {number} maxWaitMs - Maximum time to wait (default: 30 seconds)
     */
    async waitForActiveRuns(threadId, maxWaitMs = 30000) {
        const startTime = Date.now();

        while (Date.now() - startTime < maxWaitMs) {
            try {
                // List runs on this thread
                const runs = await this.client.beta.threads.runs.list(threadId, { limit: 1 });

                if (!runs.data || runs.data.length === 0) {
                    return; // No runs, safe to proceed
                }

                const latestRun = runs.data[0];
                const activeStatuses = ['queued', 'in_progress', 'requires_action'];

                if (!activeStatuses.includes(latestRun.status)) {
                    return; // No active runs, safe to proceed
                }

                console.log(`Waiting for active run ${latestRun.id} (status: ${latestRun.status})...`);

                // If run requires action but we're not handling it (different context), cancel it
                if (latestRun.status === 'requires_action') {
                    console.log(`Cancelling stale run ${latestRun.id} that requires action...`);
                    try {
                        await this.client.beta.threads.runs.cancel(threadId, latestRun.id);
                    } catch (cancelErr) {
                        console.warn(`Failed to cancel run: ${cancelErr.message}`);
                    }
                }

                // Wait and check again
                await this.sleep(1000);

            } catch (error) {
                console.warn(`Error checking for active runs: ${error.message}`);
                return; // Continue anyway if we can't check
            }
        }

        console.warn(`Timeout waiting for active runs on thread ${threadId}`);
    }
}

/**
 * Create and configure an AgentService instance with tool handlers.
 *
 * @param {Object} config - Configuration object
 * @param {Object} orchestrationClient - Orchestration client for tool execution
 * @param {Object} aiClient - Optional Azure OpenAI client for dynamic query generation
 * @returns {AgentService} Configured agent service
 */
function createAgentService(config, orchestrationClient, aiClient = null) {
    const agentService = new AgentService({
        projectEndpoint: config.aiFoundry?.projectEndpoint,
        openaiEndpoint: config.openai?.endpoint, // Use OpenAI endpoint for Assistants API
        agentId: config.aiFoundry?.agentId,
        apiKey: config.openai?.apiKey // Use OpenAI API key if available
    });

    // Register all tool handlers
    if (orchestrationClient) {
        const tools = require('../tools');
        tools.registerAllTools(agentService, orchestrationClient, aiClient);
    }

    return agentService;
}

module.exports = {
    AgentService,
    createAgentService
};
