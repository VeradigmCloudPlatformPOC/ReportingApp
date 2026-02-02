/**
 * @fileoverview Azure AI Foundry Agent Service Client
 *
 * Manages conversations with the AI Foundry Agent and handles tool execution.
 * The agent provides natural language understanding and multi-turn conversation
 * support for the VM Performance Bot.
 *
 * @version v8-agent
 */

const { AgentsClient } = require('@azure/ai-projects');
const { DefaultAzureCredential } = require('@azure/identity');

/**
 * AgentService class for interacting with Azure AI Foundry Agent Service.
 */
class AgentService {
    /**
     * Create an AgentService instance.
     * @param {Object} config - Configuration object
     * @param {string} config.projectEndpoint - AI Foundry project endpoint URL
     * @param {string} config.agentId - Deployed agent ID
     */
    constructor(config) {
        this.projectEndpoint = config.projectEndpoint;
        this.agentId = config.agentId;
        this.client = null;
        this.toolHandlers = new Map();
        this.initialized = false;
    }

    /**
     * Initialize the Agent Service client.
     * Uses DefaultAzureCredential for managed identity authentication.
     */
    async initialize() {
        if (this.initialized) return;

        try {
            const credential = new DefaultAzureCredential();
            this.client = new AgentsClient(this.projectEndpoint, credential);
            this.initialized = true;
            console.log('AgentService initialized successfully');
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
     * @returns {Promise<Object>} Response object with threadId and response text
     */
    async processMessage(threadId, userMessage, context = {}) {
        if (!this.initialized) {
            await this.initialize();
        }

        try {
            // Create new thread if needed
            if (!threadId) {
                const thread = await this.client.threads.create();
                threadId = thread.id;
                console.log(`Created new thread: ${threadId}`);
            }

            // Add user message to thread
            await this.client.threads.messages.create(threadId, {
                role: 'user',
                content: userMessage,
                metadata: {
                    channel: context.channel || 'unknown',
                    userId: context.userId || 'unknown'
                }
            });

            // Run the agent
            let run = await this.client.threads.runs.create(threadId, {
                assistant_id: this.agentId
            });

            console.log(`Started run ${run.id} for thread ${threadId}`);

            // Poll for completion with tool execution
            const maxIterations = 60; // 60 iterations * 1 second = 1 minute max
            let iterations = 0;

            while (iterations < maxIterations) {
                iterations++;

                if (run.status === 'completed') {
                    break;
                }

                if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'expired') {
                    console.error(`Run ${run.id} ended with status: ${run.status}`);
                    throw new Error(`Agent run ${run.status}: ${run.last_error?.message || 'Unknown error'}`);
                }

                if (run.status === 'requires_action') {
                    console.log('Agent requires tool execution...');
                    run = await this.handleToolCalls(threadId, run);
                } else {
                    // Wait and poll again
                    await this.sleep(1000);
                    run = await this.client.threads.runs.retrieve(threadId, run.id);
                }
            }

            if (iterations >= maxIterations) {
                throw new Error('Agent response timed out');
            }

            // Get the latest assistant message
            const messages = await this.client.threads.messages.list(threadId, {
                order: 'desc',
                limit: 1
            });

            const responseMessage = messages.data[0];
            const responseText = responseMessage?.content[0]?.text?.value || 'No response from agent';

            return {
                threadId,
                response: responseText,
                status: run.status,
                toolsUsed: run.required_action?.submit_tool_outputs?.tool_calls?.length || 0
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
     * @returns {Promise<Object>} Updated run object after tool submission
     */
    async handleToolCalls(threadId, run) {
        const toolCalls = run.required_action?.submit_tool_outputs?.tool_calls || [];
        const toolOutputs = [];

        for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const handler = this.toolHandlers.get(toolName);

            console.log(`Executing tool: ${toolName}`);

            if (handler) {
                try {
                    const args = JSON.parse(toolCall.function.arguments || '{}');
                    const result = await handler(args);

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
        return await this.client.threads.runs.submitToolOutputs(threadId, run.id, {
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
            await this.client.threads.delete(threadId);
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
            const messages = await this.client.threads.messages.list(threadId, {
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

            // Try to retrieve the agent to verify connectivity
            const agent = await this.client.agents.get(this.agentId);

            return {
                healthy: true,
                agentId: this.agentId,
                agentName: agent.name,
                model: agent.model
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
        agentId: config.aiFoundry?.agentId
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
