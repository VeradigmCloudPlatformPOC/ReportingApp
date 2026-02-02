/**
 * @fileoverview VM Performance Bot - Azure AI Foundry Agent Handler
 *
 * This module implements the main bot logic using Azure AI Foundry Agent Service.
 * All natural language processing is handled by the agent, with tools for
 * interacting with the VM Performance orchestrator.
 *
 * Channels supported: Slack, Microsoft Teams
 *
 * @version v8-agent
 * @author VM Performance Monitoring Team
 */

const { ActivityHandler } = require('botbuilder');
const { createAgentService } = require('../services/agentService');
const { createConversationState } = require('../services/conversationState');
const { channelAdapter } = require('./channelAdapter');
const { OrchestrationClient } = require('../services/orchestrationClient');

class VMPerfBot extends ActivityHandler {
    /**
     * Create a new VMPerfBot instance.
     *
     * @param {Object} config - Bot configuration
     */
    constructor(config) {
        super();

        this.config = config;
        this.orchestrationClient = new OrchestrationClient(config.orchestratorUrl);

        // Initialize agent service (lazy - will init on first message)
        this.agentService = null;
        this.conversationState = createConversationState(config);

        // Flag to track if agent is available
        this.agentAvailable = !!config.aiFoundry?.agentId;

        // Subscription context per user/channel - tracks selected subscription for queries
        // Key format: `${userId}_${channelId}` -> { subscriptionId, subscriptionName, tenantName, tenantId }
        this.subscriptionContext = new Map();

        // Handle incoming messages
        this.onMessage(async (context, next) => {
            await this.handleMessage(context);
            await next();
        });

        // Handle new members added to conversation
        this.onMembersAdded(async (context, next) => {
            const membersAdded = context.activity.membersAdded;
            for (const member of membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    const welcome = channelAdapter.formatWelcome(context.activity.channelId);
                    await context.sendActivity(welcome);
                }
            }
            await next();
        });
    }

    /**
     * Initialize the agent service lazily.
     */
    async initializeAgent() {
        if (this.agentService) return;

        if (!this.agentAvailable) {
            console.log('Agent service not configured - using fallback mode');
            return;
        }

        try {
            this.agentService = createAgentService(this.config, this.orchestrationClient);
            await this.agentService.initialize();
            console.log('Agent service initialized successfully');
        } catch (error) {
            console.error('Failed to initialize agent service:', error.message);
            this.agentAvailable = false;
        }
    }

    /**
     * Handle incoming messages.
     *
     * @param {Object} context - Bot turn context
     */
    async handleMessage(context) {
        const text = context.activity.text?.trim() || '';
        const userId = context.activity.from.id;
        const channelId = context.activity.channelId;

        console.log(`[${channelId}] Message from ${userId}: "${text}"`);

        // Check for special commands
        if (this.isSpecialCommand(text)) {
            await this.handleSpecialCommand(context, text);
            return;
        }

        // Send typing indicator for Teams
        const typing = channelAdapter.createTypingActivity(channelId);
        if (typing) {
            await context.sendActivity(typing);
        }

        // Try agent-based processing
        if (this.agentAvailable) {
            await this.handleAgentMessage(context, text, userId, channelId);
        } else {
            // Fallback to direct orchestration if agent not available
            await this.handleFallbackMessage(context, text);
        }
    }

    /**
     * Process message through AI Foundry Agent.
     *
     * @param {Object} context - Bot turn context
     * @param {string} text - User message
     * @param {string} userId - User identifier
     * @param {string} channelId - Channel identifier
     */
    async handleAgentMessage(context, text, userId, channelId) {
        try {
            await this.initializeAgent();

            if (!this.agentService) {
                await this.handleFallbackMessage(context, text);
                return;
            }

            // Get existing thread ID for multi-turn conversation
            const threadId = await this.conversationState.getThreadId(userId, channelId);

            // Process through agent
            const result = await this.agentService.processMessage(threadId, text, {
                channel: channelId,
                userId
            });

            // Save thread ID for future messages
            if (result.threadId && result.threadId !== threadId) {
                await this.conversationState.setThreadId(userId, channelId, result.threadId);
            }

            // Format and send response
            const response = channelAdapter.formatResponse(result.response, channelId);
            await context.sendActivity(response);

            console.log(`Agent response sent (tools used: ${result.toolsUsed || 0})`);

        } catch (error) {
            console.error('Agent processing error:', error);

            // Send user-friendly error
            const errorResponse = channelAdapter.formatError(error, channelId);
            await context.sendActivity(errorResponse);
        }
    }

    /**
     * Fallback message handling when agent is not available.
     * Uses direct orchestration client calls.
     *
     * @param {Object} context - Bot turn context
     * @param {string} text - User message
     */
    async handleFallbackMessage(context, text) {
        const lowerText = text.toLowerCase();
        const channelId = context.activity.channelId;

        try {
            // Simple intent matching for fallback mode
            if (lowerText.includes('report') || lowerText.includes('analyze') || lowerText.includes('run')) {
                const result = await this.orchestrationClient.triggerOrchestration({});
                const response = `Starting VM performance analysis...\nRun ID: \`${result.runId}\`\n\nI'll send email reports when complete.`;
                await context.sendActivity(channelAdapter.formatResponse(response, channelId));

            } else if (lowerText.includes('underutilized')) {
                const vms = await this.orchestrationClient.getVMsByStatus('UNDERUTILIZED');
                await context.sendActivity(this.formatVMList(vms, 'Underutilized VMs', channelId));

            } else if (lowerText.includes('overutilized')) {
                const vms = await this.orchestrationClient.getVMsByStatus('OVERUTILIZED');
                await context.sendActivity(this.formatVMList(vms, 'Overutilized VMs', channelId));

            } else if (lowerText.includes('optimal')) {
                const vms = await this.orchestrationClient.getVMsByStatus('OPTIMAL');
                await context.sendActivity(this.formatVMList(vms, 'Optimal VMs', channelId));

            } else if (lowerText.includes('help')) {
                await context.sendActivity(channelAdapter.formatWelcome(channelId));

            } else {
                // Unknown intent
                const response = `I understand you said: "${text}"\n\n` +
                    'I can help you with:\n' +
                    '- "Run a performance report"\n' +
                    '- "Show underutilized VMs"\n' +
                    '- "Show overutilized VMs"\n' +
                    '- "Help"';
                await context.sendActivity(channelAdapter.formatResponse(response, channelId));
            }
        } catch (error) {
            console.error('Fallback processing error:', error);
            await context.sendActivity(channelAdapter.formatError(error, channelId));
        }
    }

    /**
     * Format VM list for display.
     *
     * @param {Array} vms - List of VMs
     * @param {string} title - List title
     * @param {string} channelId - Channel identifier
     * @returns {Object} Formatted activity
     */
    formatVMList(vms, title, channelId) {
        if (!vms || vms.length === 0) {
            return channelAdapter.formatResponse(`No ${title.toLowerCase()} found.`, channelId);
        }

        let text = `**${title}** (${vms.length} found)\n\n`;
        const displayVMs = vms.slice(0, 10);

        for (const vm of displayVMs) {
            text += `- **${vm.vmName}** (${vm.vmSize})\n`;
            text += `  CPU: ${vm.CPU_Avg?.toFixed(1) || 'N/A'}% avg | Memory: ${vm.Memory_Avg?.toFixed(1) || 'N/A'}% avg\n`;
        }

        if (vms.length > 10) {
            text += `\n... and ${vms.length - 10} more`;
        }

        return channelAdapter.formatResponse(text, channelId);
    }

    /**
     * Check if message is a special command.
     *
     * @param {string} text - User message
     * @returns {boolean} True if special command
     */
    isSpecialCommand(text) {
        const lowerText = text.toLowerCase().trim();
        return lowerText === 'clear' ||
               lowerText === 'reset' ||
               lowerText === 'new conversation' ||
               lowerText === 'start over';
    }

    /**
     * Handle special commands.
     *
     * @param {Object} context - Bot turn context
     * @param {string} text - Command text
     */
    async handleSpecialCommand(context, text) {
        const userId = context.activity.from.id;
        const channelId = context.activity.channelId;
        const lowerText = text.toLowerCase().trim();

        if (lowerText === 'clear' || lowerText === 'reset' ||
            lowerText === 'new conversation' || lowerText === 'start over') {

            // Clear conversation state
            const threadId = await this.conversationState.getThreadId(userId, channelId);
            if (threadId && this.agentService) {
                await this.agentService.deleteThread(threadId);
            }
            await this.conversationState.clearConversation(userId, channelId);

            const response = 'Conversation cleared. Starting fresh!\n\nHow can I help you with VM performance today?';
            await context.sendActivity(channelAdapter.formatResponse(response, channelId));
        }
    }

    /**
     * Handle direct Slack Events API messages.
     * This is for direct Slack integration without Azure Bot Service.
     *
     * @param {Object} event - Slack event object
     * @param {string} teamId - Slack team ID
     * @param {Object} slackConfig - Slack credentials (for API calls)
     */
    async handleSlackEvent(event, teamId, slackConfig) {
        const axios = require('axios');
        const text = event.text?.trim() || '';
        const userId = event.user;
        const channel = event.channel;
        const channelId = 'slack'; // For internal channel identification

        // Remove bot mention if present (for app_mention events)
        const cleanText = text.replace(/<@[A-Z0-9]+>/g, '').trim();

        console.log(`[Slack Direct] Message from ${userId} in ${channel}: "${cleanText}"`);

        // Check for special commands (clear, reset)
        if (this.isSpecialCommand(cleanText)) {
            await this.handleSlackSpecialCommand(cleanText, userId, channel, slackConfig);
            return;
        }

        // Check for greeting/help - show welcome with subscription info
        const lowerText = cleanText.toLowerCase();
        if (lowerText === 'hi' || lowerText === 'hello' || lowerText === 'hey' ||
            lowerText === 'help' || lowerText === '?' || lowerText === 'start' ||
            lowerText === 'subscriptions' || lowerText === 'subs') {
            await this.handleSlackWelcome(channel, slackConfig, userId);
            return;
        }

        // Check if user has subscription context
        const subContext = this.getSubscriptionContext(userId, channel);

        // Check if this looks like a known command/query
        const isKnownCommand = this.isKnownCommand(lowerText);

        // If no subscription context and not a known command, try to match as subscription
        if (!subContext && !isKnownCommand) {
            // Try to match as a subscription selection
            const matched = await this.handleSubscriptionSelection(cleanText, userId, channel, slackConfig);
            if (matched) {
                return; // Subscription was selected, message already sent
            }
            // If not matched and multiple options shown, we're done
            // The user will type again with a more specific name
            return;
        }

        // If no context but is a known command, prompt to select subscription first
        if (!subContext && isKnownCommand) {
            await this.sendSlackMessage(channel,
                ':point_up: *Please select a subscription first!*\n\n' +
                'Type a subscription name (e.g., "Zirconium") or say "hello" to see all available subscriptions.\n\n' +
                '_Once you select a subscription, I can help with performance queries._',
                slackConfig);
            return;
        }

        // User has subscription context - process the query
        let responseText;

        if (this.agentAvailable) {
            responseText = await this.processSlackAgentMessage(cleanText, userId, channelId);
        } else {
            responseText = await this.processSlackFallbackMessage(cleanText, channel, slackConfig, userId);
        }

        // Send response via Slack API
        if (responseText) {
            await this.sendSlackMessage(channel, responseText, slackConfig);
        }
    }

    /**
     * Check if text appears to be a known command/query.
     *
     * @param {string} lowerText - Lowercase user text
     * @returns {boolean} True if it looks like a command
     */
    isKnownCommand(lowerText) {
        const knownPatterns = [
            'report', 'analyze', 'run',
            'underutilized', 'overutilized', 'optimal',
            'summary', 'investigate', 'show', 'list',
            'inventory', 'vms', 'performance',
            'download', 'regenerate'
        ];
        return knownPatterns.some(pattern => lowerText.includes(pattern));
    }

    /**
     * Handle welcome message with tenant and subscription information.
     * Prompts user to select a subscription for context.
     */
    async handleSlackWelcome(channel, slackConfig, userId = null) {
        try {
            // Send initial greeting
            await this.sendSlackMessage(channel,
                ':wave: *Welcome to VM Performance Bot!*\n\nLet me check which subscriptions I have access to...',
                slackConfig);

            // Fetch subscriptions across all tenants
            const subscriptions = await this.orchestrationClient.getSubscriptions();

            if (!subscriptions || subscriptions.length === 0) {
                await this.sendSlackMessage(channel,
                    ':warning: No subscriptions found. Please contact your administrator.',
                    slackConfig);
                return;
            }

            // Group subscriptions by tenant
            const byTenant = {};
            for (const sub of subscriptions) {
                const tenantName = sub.tenantName || 'Unknown Tenant';
                if (!byTenant[tenantName]) {
                    byTenant[tenantName] = [];
                }
                byTenant[tenantName].push(sub);
            }

            // Format subscription list by tenant
            let subText = '*Available Subscriptions:*\n\n';
            for (const [tenantName, tenantSubs] of Object.entries(byTenant)) {
                subText += `:office: *${tenantName}* (${tenantSubs.length} subscriptions)\n`;
                // Show first 5 subscriptions per tenant
                const displaySubs = tenantSubs.slice(0, 5);
                for (const sub of displaySubs) {
                    subText += `   • ${sub.name}\n`;
                }
                if (tenantSubs.length > 5) {
                    subText += `   _... and ${tenantSubs.length - 5} more_\n`;
                }
                subText += '\n';
            }

            subText += `_Total: ${subscriptions.length} subscriptions across ${Object.keys(byTenant).length} tenant(s)_\n\n`;

            // Check if user already has a subscription context
            const contextKey = userId ? `${userId}_${channel}` : channel;
            const existingContext = this.subscriptionContext.get(contextKey);

            if (existingContext) {
                subText += `:dart: *Current Context:* ${existingContext.subscriptionName}\n\n`;
            }

            subText += ':point_right: *To get started, please select a subscription:*\n' +
                '_Type a subscription name (or partial name) to set your context._\n' +
                '_Example: "Zirconium" or "VEHR-Management"_\n\n' +
                ':bulb: _After selecting a subscription, you can:_\n' +
                '• "Run a performance report" - Analyze VMs in this subscription\n' +
                '• "Show underutilized VMs" - List VMs that can be downsized\n' +
                '• "Show overutilized VMs" - List VMs needing more resources\n' +
                '• "clear" - Clear subscription context and start fresh';

            await this.sendSlackMessage(channel, subText, slackConfig);

        } catch (error) {
            console.error('Error in welcome flow:', error);
            await this.sendSlackMessage(channel,
                ':warning: Could not fetch subscription information.\n\n' +
                'You can still try:\n' +
                '• "Show underutilized VMs"\n' +
                '• "Show overutilized VMs"\n' +
                '• "Run a performance report"',
                slackConfig);
        }
    }

    /**
     * Handle subscription selection from user input.
     * Searches for matching subscriptions and sets context.
     *
     * @param {string} query - User's subscription search query
     * @param {string} userId - User identifier
     * @param {string} channel - Channel identifier
     * @param {Object} slackConfig - Slack configuration
     * @returns {boolean} True if subscription was selected, false if we need more input
     */
    async handleSubscriptionSelection(query, userId, channel, slackConfig) {
        try {
            // Search for matching subscriptions
            const matches = await this.orchestrationClient.searchSubscriptions(query);

            if (!matches || matches.length === 0) {
                await this.sendSlackMessage(channel,
                    `:mag: No subscriptions found matching "*${query}*"\n\n` +
                    'Try a different search term, or type "hello" to see all available subscriptions.',
                    slackConfig);
                return false;
            }

            // Exact match or single result - set context
            if (matches.length === 1) {
                const sub = matches[0];
                const contextKey = `${userId}_${channel}`;
                this.subscriptionContext.set(contextKey, {
                    subscriptionId: sub.subscriptionId,  // API returns subscriptionId, not id
                    subscriptionName: sub.name,
                    tenantName: sub.tenantName,
                    tenantId: sub.tenantId
                });

                await this.sendSlackMessage(channel,
                    `:white_check_mark: *Subscription selected: ${sub.name}*\n` +
                    `_Tenant: ${sub.tenantName}_\n\n` +
                    '*What would you like to do?*\n' +
                    '• "Run a performance report" - Analyze VMs in this subscription\n' +
                    '• "Show underutilized VMs" - List VMs that can be downsized\n' +
                    '• "Show overutilized VMs" - List VMs needing more resources\n' +
                    '• "Investigate <vm-name>" - Get details about a specific VM\n' +
                    '• "Show summary" - Performance overview\n' +
                    '• "clear" - Clear subscription context',
                    slackConfig);
                return true;
            }

            // Multiple matches - ask user to pick
            let pickText = `:mag: Found ${matches.length} subscriptions matching "*${query}*":\n\n`;
            const displayMatches = matches.slice(0, 10);
            displayMatches.forEach((sub, index) => {
                pickText += `${index + 1}. *${sub.name}*\n`;
                pickText += `   _Tenant: ${sub.tenantName}_\n`;
            });

            if (matches.length > 10) {
                pickText += `\n_... and ${matches.length - 10} more_\n`;
            }

            pickText += '\n:point_right: Please be more specific, or type the exact subscription name.';

            await this.sendSlackMessage(channel, pickText, slackConfig);
            return false;

        } catch (error) {
            console.error('Error searching subscriptions:', error);
            await this.sendSlackMessage(channel,
                ':warning: Error searching subscriptions. Please try again.',
                slackConfig);
            return false;
        }
    }

    /**
     * Get current subscription context for a user/channel.
     *
     * @param {string} userId - User identifier
     * @param {string} channel - Channel identifier
     * @returns {Object|null} Subscription context or null
     */
    getSubscriptionContext(userId, channel) {
        const contextKey = `${userId}_${channel}`;
        return this.subscriptionContext.get(contextKey) || null;
    }

    /**
     * Clear subscription context for a user/channel.
     *
     * @param {string} userId - User identifier
     * @param {string} channel - Channel identifier
     */
    clearSubscriptionContext(userId, channel) {
        const contextKey = `${userId}_${channel}`;
        this.subscriptionContext.delete(contextKey);
    }

    /**
     * Process message through agent for Slack.
     */
    async processSlackAgentMessage(text, userId, channelId) {
        try {
            await this.initializeAgent();

            if (!this.agentService) {
                return this.processSlackFallbackMessage(text);
            }

            // Get existing thread ID for multi-turn conversation
            const threadId = await this.conversationState.getThreadId(userId, channelId);

            // Process through agent
            const result = await this.agentService.processMessage(threadId, text, {
                channel: channelId,
                userId
            });

            // Save thread ID for future messages
            if (result.threadId && result.threadId !== threadId) {
                await this.conversationState.setThreadId(userId, channelId, result.threadId);
            }

            console.log(`Agent response generated (tools used: ${result.toolsUsed || 0})`);
            return result.response;

        } catch (error) {
            console.error('Agent processing error:', error);
            return `Sorry, I encountered an error: ${error.message}\n\nPlease try again or type "help" for available commands.`;
        }
    }

    /**
     * Process fallback message for Slack with interactive feedback.
     * Uses subscription context if available.
     *
     * @param {string} text - User message
     * @param {string} channel - Slack channel
     * @param {Object} slackConfig - Slack configuration
     * @param {string} userId - User identifier (optional)
     */
    async processSlackFallbackMessage(text, channel = null, slackConfig = null, userId = null) {
        const lowerText = text.toLowerCase();

        // Get subscription context
        const subContext = userId && channel ? this.getSubscriptionContext(userId, channel) : null;
        const contextHeader = subContext
            ? `:dart: _Context: ${subContext.subscriptionName}_\n\n`
            : '';

        try {
            // Handle performance report with progress feedback
            if (lowerText.includes('report') || lowerText.includes('analyze') || lowerText.includes('run')) {
                return await this.handlePerformanceReport(channel, slackConfig, subContext, text);
            }

            // Handle VM status queries with loading feedback
            if (lowerText.includes('underutilized')) {
                if (channel && slackConfig) {
                    const msg = subContext
                        ? `:hourglass_flowing_sand: Querying underutilized VMs in *${subContext.subscriptionName}*...`
                        : ':hourglass_flowing_sand: Querying underutilized VMs...';
                    await this.sendSlackMessage(channel, msg, slackConfig);
                }
                const vms = await this.orchestrationClient.getVMsByStatus('UNDERUTILIZED');
                // Filter by subscription if context is set
                const filteredVMs = subContext
                    ? vms.filter(vm => vm.subscriptionId === subContext.subscriptionId)
                    : vms;
                return contextHeader + this.formatSlackVMList(filteredVMs, 'Underutilized VMs');
            }

            if (lowerText.includes('overutilized')) {
                if (channel && slackConfig) {
                    const msg = subContext
                        ? `:hourglass_flowing_sand: Querying overutilized VMs in *${subContext.subscriptionName}*...`
                        : ':hourglass_flowing_sand: Querying overutilized VMs...';
                    await this.sendSlackMessage(channel, msg, slackConfig);
                }
                const vms = await this.orchestrationClient.getVMsByStatus('OVERUTILIZED');
                const filteredVMs = subContext
                    ? vms.filter(vm => vm.subscriptionId === subContext.subscriptionId)
                    : vms;
                return contextHeader + this.formatSlackVMList(filteredVMs, 'Overutilized VMs');
            }

            if (lowerText.includes('optimal')) {
                if (channel && slackConfig) {
                    const msg = subContext
                        ? `:hourglass_flowing_sand: Querying optimal VMs in *${subContext.subscriptionName}*...`
                        : ':hourglass_flowing_sand: Querying optimal VMs...';
                    await this.sendSlackMessage(channel, msg, slackConfig);
                }
                const vms = await this.orchestrationClient.getVMsByStatus('OPTIMAL');
                const filteredVMs = subContext
                    ? vms.filter(vm => vm.subscriptionId === subContext.subscriptionId)
                    : vms;
                return contextHeader + this.formatSlackVMList(filteredVMs, 'Optimal VMs');
            }

            // Handle download/regenerate request
            if (lowerText.includes('download') || lowerText.includes('regenerate')) {
                if (channel && slackConfig) {
                    await this.sendSlackMessage(channel, ':hourglass_flowing_sand: Getting download links...', slackConfig);
                }
                const subscriptionId = subContext?.subscriptionId || null;
                const downloads = await this.orchestrationClient.getReportDownloads(subscriptionId);

                if (downloads.error || !downloads.downloads) {
                    return `:warning: ${downloads.error || 'No reports found'}\n\n` +
                        '_Run a performance report first, then use "download" to get the links._';
                }

                let response = `:arrow_down: *Download Reports*\n` +
                    `_Run ID: \`${downloads.runId}\`_\n` +
                    `_Expires in: ${downloads.expiresIn}_\n\n`;

                // HTML Reports
                if (downloads.downloads.technical?.url) {
                    response += `• <${downloads.downloads.technical.url}|Technical Report (HTML)>\n`;
                }
                if (downloads.downloads.executive?.url) {
                    response += `• <${downloads.downloads.executive.url}|Executive Report (HTML)>\n`;
                }
                // Raw JSON Data
                if (downloads.downloads.rawData?.url) {
                    response += `• <${downloads.downloads.rawData.url}|Raw Analysis Data (JSON)>\n`;
                }

                response += `\n_Links valid for up to 7 days after report generation._`;
                return contextHeader + response;
            }

            // Handle summary request - use run summary when subscription context is set
            if (lowerText.includes('summary')) {
                if (channel && slackConfig) {
                    await this.sendSlackMessage(channel, ':hourglass_flowing_sand: Generating performance summary...', slackConfig);
                }

                // If subscription context is set, show run summary (analysis results)
                // Otherwise show cross-tenant inventory summary
                if (subContext?.subscriptionId) {
                    const runSummary = await this.orchestrationClient.getRunSummary(subContext.subscriptionId);
                    if (runSummary) {
                        return contextHeader + this.formatRunSummary(runSummary, subContext);
                    }
                    // Fall back to inventory if no run found
                    return contextHeader + ':warning: No analysis runs found for this subscription.\n\n' +
                        '_Run a performance report first to see the summary._';
                }

                // No subscription context - show cross-tenant inventory
                const summary = await this.orchestrationClient.getCrosstenantSummary();
                return contextHeader + this.formatSlackSummary(summary, subContext);
            }

            // Handle VM investigation
            const investigateMatch = lowerText.match(/investigate\s+(.+)/i);
            if (investigateMatch) {
                const vmName = investigateMatch[1].trim();
                if (channel && slackConfig) {
                    await this.sendSlackMessage(channel, `:mag: Investigating *${vmName}*...`, slackConfig);
                }
                const vm = await this.orchestrationClient.getVMDetails(vmName);
                if (vm) {
                    return contextHeader + this.formatVMInvestigation(vm);
                }
                return `:warning: VM not found: *${vmName}*\n\nTry "Show underutilized VMs" to see available VMs.`;
            }

            // Handle help
            if (lowerText.includes('help') || lowerText === '?') {
                return this.getSlackHelpText(subContext);
            }

            // Unknown command
            return `:thinking_face: I understand you said: "${text}"\n\n` +
                '*I can help you with:*\n' +
                '• "Run a performance report"\n' +
                '• "Show underutilized VMs"\n' +
                '• "Show overutilized VMs"\n' +
                '• "Show summary"\n' +
                '• "Investigate <vm-name>"\n' +
                '• "Help" or "Hi" for more info';

        } catch (error) {
            console.error('Fallback processing error:', error);

            // Provide more helpful error messages
            if (error.message.includes('504') || error.message.includes('timeout')) {
                return ':warning: *Request timed out*\n\n' +
                    'The operation is taking longer than expected. This can happen during:\n' +
                    '• Large performance reports (analyzing 200+ VMs)\n' +
                    '• High Azure API load\n\n' +
                    'The analysis may still be running. Try "Show summary" in a few minutes.';
            }

            if (error.message.includes('403')) {
                return ':warning: *Access denied*\n\n' +
                    'Unable to reach the orchestrator. Please contact your administrator.';
            }

            return `:x: Sorry, I encountered an error: ${error.message}\n\nTry "help" to see available commands.`;
        }
    }

    /**
     * Handle performance report with progress feedback.
     *
     * @param {string} channel - Slack channel
     * @param {Object} slackConfig - Slack configuration
     * @param {Object} subContext - Subscription context (optional)
     * @param {string} originalText - Original user message (to check for force refresh)
     */
    async handlePerformanceReport(channel, slackConfig, subContext = null, originalText = '') {
        try {
            // Check if user wants to force refresh (bypass 48hr cache)
            const forceRefresh = /force|refresh|new|fresh/i.test(originalText);

            // Send initial acknowledgment
            if (channel && slackConfig) {
                const scopeMsg = subContext
                    ? `in *${subContext.subscriptionName}*`
                    : 'across all tenants';
                const cacheNote = forceRefresh
                    ? '\n:arrows_counterclockwise: _Force refresh requested - bypassing cache._'
                    : '\n:file_cabinet: _Cached reports < 48hrs will be reused._';
                await this.sendSlackMessage(channel,
                    ':rocket: *Starting VM Performance Analysis*\n\n' +
                    `:hourglass_flowing_sand: Initializing analysis ${scopeMsg}...` +
                    cacheNote +
                    '\n_This may take 5-15 minutes depending on VM count._',
                    slackConfig);
            }

            // Prepare orchestration options - IMPORTANT: Include channelId for progress notifications
            const orchestrationOptions = {
                forceRefresh,
                channelId: channel  // Pass channel ID so orchestrator can send progress updates
            };
            if (subContext) {
                orchestrationOptions.subscriptionId = subContext.subscriptionId;
                orchestrationOptions.tenantId = subContext.tenantId;
                orchestrationOptions.tenantName = subContext.tenantName;
            }

            // Trigger orchestration (this can take a while)
            // The orchestrator will send progress messages directly to Slack
            const result = await this.orchestrationClient.triggerOrchestration(orchestrationOptions);

            // Check if cached response (orchestrator sends its own Slack message for cache)
            if (result?.cached) {
                // Orchestrator already sent a cache notification to Slack
                // Just return null to avoid duplicate message
                return null;
            }

            // Check if result has runId
            const runId = result?.runId || result;

            if (channel && slackConfig) {
                const contextMsg = subContext
                    ? `_Context: ${subContext.subscriptionName}_\n\n`
                    : '';
                await this.sendSlackMessage(channel,
                    `:white_check_mark: *Analysis Started Successfully!*\n\n` +
                    contextMsg +
                    `*Run ID:* \`${runId}\`\n\n` +
                    ':clock1: *What happens next:*\n' +
                    '1. Query Log Analytics for 30-day metrics\n' +
                    '2. Analyze each VM with AI\n' +
                    '3. Generate recommendations\n' +
                    '4. Email reports to stakeholders\n\n' +
                    '_While you wait, try:_\n' +
                    '• "Show summary" - View latest analysis results\n' +
                    '• "Show underutilized VMs" - From previous analysis',
                    slackConfig);
            }

            return null; // Already sent messages

        } catch (error) {
            console.error('Performance report error:', error);

            if (error.message.includes('504') || error.message.includes('timeout')) {
                // The request may have started even if we got a timeout
                return ':hourglass: *Request is processing...*\n\n' +
                    'The orchestration was triggered but the response timed out.\n' +
                    'The analysis is likely still running in the background.\n\n' +
                    '_Check back in 10-15 minutes:_\n' +
                    '• "Show summary" - View results when ready\n' +
                    '• Email reports will be sent when complete';
            }

            throw error;
        }
    }

    /**
     * Format cross-tenant summary for Slack.
     *
     * @param {Object} summary - Summary data
     * @param {Object} subContext - Subscription context (optional)
     */
    formatSlackSummary(summary, subContext = null) {
        if (!summary) {
            return ':warning: No summary data available. Try running a performance report first.';
        }

        const title = subContext
            ? `:bar_chart: *Performance Summary: ${subContext.subscriptionName}*`
            : ':bar_chart: *Cross-Tenant Performance Summary*';

        let text = title + '\n\n';

        if (summary.totalVMs !== undefined) {
            text += `*Total VMs Analyzed:* ${summary.totalVMs}\n`;
        }

        if (summary.lastRunTime) {
            const lastRun = new Date(summary.lastRunTime).toLocaleString();
            text += `*Last Analysis:* ${lastRun}\n\n`;
        }

        // Status breakdown
        if (summary.byStatus) {
            text += '*VM Status Breakdown:*\n';
            text += `• :large_green_circle: Optimal: ${summary.byStatus.OPTIMAL || 0}\n`;
            text += `• :large_yellow_circle: Underutilized: ${summary.byStatus.UNDERUTILIZED || 0}\n`;
            text += `• :red_circle: Overutilized: ${summary.byStatus.OVERUTILIZED || 0}\n`;
            if (summary.byStatus.NEEDS_REVIEW) {
                text += `• :question: Needs Review: ${summary.byStatus.NEEDS_REVIEW}\n`;
            }
        }

        // Tenant breakdown (only show if not filtered by subscription)
        if (!subContext && summary.byTenant && Object.keys(summary.byTenant).length > 0) {
            text += '\n*By Tenant:*\n';
            for (const [tenant, count] of Object.entries(summary.byTenant)) {
                text += `• ${tenant}: ${count} VMs\n`;
            }
        }

        // Savings potential
        if (summary.estimatedSavings) {
            text += `\n:moneybag: *Estimated Monthly Savings:* $${summary.estimatedSavings.toLocaleString()}\n`;
        }

        return text;
    }

    /**
     * Format run-based summary for Slack (analysis results, not live inventory).
     *
     * @param {Object} runSummary - Run summary data from /api/runs/latest/summary
     * @param {Object} subContext - Subscription context
     */
    formatRunSummary(runSummary, subContext) {
        const title = `:bar_chart: *Analysis Summary: ${subContext?.subscriptionName || 'All Subscriptions'}*`;

        let text = title + '\n\n';

        // Run metadata
        if (runSummary.lastRunTime) {
            const lastRun = new Date(runSummary.lastRunTime).toLocaleString();
            text += `*Last Analysis:* ${lastRun}\n`;
        }
        text += `*Run ID:* \`${runSummary.runId}\`\n`;
        text += `*Status:* ${runSummary.status}\n\n`;

        // VM count from analysis
        text += `*Total VMs Analyzed:* ${runSummary.totalVMs}\n\n`;

        // Status breakdown
        text += '*VM Status Breakdown:*\n';
        text += `• :large_green_circle: Optimal: ${runSummary.byStatus?.OPTIMAL || 0}\n`;
        text += `• :large_yellow_circle: Underutilized: ${runSummary.byStatus?.UNDERUTILIZED || 0}\n`;
        text += `• :red_circle: Overutilized: ${runSummary.byStatus?.OVERUTILIZED || 0}\n`;
        if (runSummary.byStatus?.NEEDS_REVIEW) {
            text += `• :question: Needs Review: ${runSummary.byStatus.NEEDS_REVIEW}\n`;
        }

        // Action required count
        if (runSummary.actionRequired) {
            text += `\n:wrench: *Action Required:* ${runSummary.actionRequired} VMs need attention\n`;
        }

        text += '\n_Type "show underutilized" or "show overutilized" to see details._';
        text += '\n_Type "download" to get report download links._';

        return text;
    }

    /**
     * Format VM investigation for Slack.
     */
    formatVMInvestigation(vm) {
        let text = `:mag_right: *VM Investigation: ${vm.vmName}*\n\n`;

        // Status with emoji
        const statusEmoji = {
            'UNDERUTILIZED': ':large_yellow_circle:',
            'OVERUTILIZED': ':red_circle:',
            'OPTIMAL': ':large_green_circle:',
            'NEEDS_REVIEW': ':question:'
        };
        const emoji = statusEmoji[vm.analysis?.status] || ':grey_question:';
        text += `*Status:* ${emoji} ${vm.analysis?.status || 'UNKNOWN'}\n`;
        text += `*Recommendation:* ${vm.analysis?.action || 'REVIEW'}\n\n`;

        // Configuration
        text += '*Configuration:*\n';
        text += `• Size: \`${vm.vmSize}\`\n`;
        text += `• Location: ${vm.location}\n`;
        text += `• Resource Group: ${vm.resourceGroup}\n`;
        if (vm.tenant) {
            text += `• Tenant: ${vm.tenant}\n`;
        }

        // Performance metrics
        text += '\n*Performance (30-day):*\n';
        text += `• CPU: ${vm.CPU_Avg?.toFixed(1) || 'N/A'}% avg, ${vm.CPU_Max?.toFixed(1) || 'N/A'}% max\n`;
        text += `• Memory: ${vm.Memory_Avg?.toFixed(1) || 'N/A'}% avg, ${vm.Memory_Max?.toFixed(1) || 'N/A'}% max\n`;

        // Recommendation details
        if (vm.analysis?.recommendation) {
            text += `\n*AI Analysis:*\n${vm.analysis.recommendation}\n`;
        }

        // Suggested size
        if (vm.analysis?.suggestedSize) {
            text += `\n:arrow_right: *Suggested Size:* \`${vm.analysis.suggestedSize}\`\n`;
        }

        // Estimated savings
        if (vm.analysis?.estimatedMonthlySavings) {
            text += `:moneybag: *Est. Monthly Savings:* $${vm.analysis.estimatedMonthlySavings}\n`;
        }

        return text;
    }

    /**
     * Format VM list for Slack.
     */
    formatSlackVMList(vms, title) {
        if (!vms || vms.length === 0) {
            return `No ${title.toLowerCase()} found.`;
        }

        let text = `*${title}* (${vms.length} found)\n\n`;
        const displayVMs = vms.slice(0, 10);

        for (const vm of displayVMs) {
            text += `• *${vm.vmName}* (${vm.vmSize})\n`;
            text += `  CPU: ${vm.CPU_Avg?.toFixed(1) || 'N/A'}% avg | Memory: ${vm.Memory_Avg?.toFixed(1) || 'N/A'}% avg\n`;
        }

        if (vms.length > 10) {
            text += `\n... and ${vms.length - 10} more`;
        }

        return text;
    }

    /**
     * Get help text for Slack.
     *
     * @param {Object} subContext - Current subscription context (optional)
     */
    getSlackHelpText(subContext = null) {
        let helpText = '*VM Performance Bot* :robot_face:\n\n' +
            'I help you monitor and analyze Azure VM performance across your subscriptions.\n\n';

        if (subContext) {
            helpText += `:dart: *Current Context:* ${subContext.subscriptionName}\n` +
                `_Tenant: ${subContext.tenantName}_\n\n`;
        } else {
            helpText += ':point_right: *No subscription selected.* Type a subscription name to set context.\n\n';
        }

        helpText += '*:clipboard: Available Commands:*\n\n' +
            '*Getting Started:*\n' +
            '• Type a subscription name - Set subscription context\n' +
            '• "Hello" or "Subscriptions" - Show all available subscriptions\n\n' +
            '*Performance Analysis:*\n' +
            '• "Run a performance report" - Start a new analysis\n' +
            '• "Show summary" - Performance overview from latest run\n\n' +
            '*VM Queries:*\n' +
            '• "Show underutilized VMs" - List VMs that can be downsized\n' +
            '• "Show overutilized VMs" - List VMs needing more resources\n' +
            '• "Investigate <vm-name>" - Detailed analysis of a specific VM\n\n' +
            '*Reports:*\n' +
            '• "Download" - Get download links for latest reports\n' +
            '• "Regenerate download" - Get fresh download links\n\n' +
            '*Other:*\n' +
            '• "Clear" - Clear subscription context and start fresh\n\n' +
            ':bulb: _Queries are filtered by your selected subscription context._\n' +
            ':file_cabinet: _Reports are cached for 48 hours. Add "force" to run fresh analysis._';

        return helpText;
    }

    /**
     * Handle special commands for Slack.
     */
    async handleSlackSpecialCommand(text, userId, channel, slackConfig) {
        const lowerText = text.toLowerCase().trim();
        const channelId = 'slack';

        if (lowerText === 'clear' || lowerText === 'reset' ||
            lowerText === 'new conversation' || lowerText === 'start over') {

            // Clear agent conversation thread
            const threadId = await this.conversationState.getThreadId(userId, channelId);
            if (threadId && this.agentService) {
                await this.agentService.deleteThread(threadId);
            }
            await this.conversationState.clearConversation(userId, channelId);

            // Clear subscription context
            this.clearSubscriptionContext(userId, channel);

            await this.sendSlackMessage(channel,
                ':sparkles: *Conversation and subscription context cleared!*\n\n' +
                'Type a subscription name to get started, or say "hello" to see all available subscriptions.',
                slackConfig);
        }
    }

    /**
     * Send a message to Slack via API.
     */
    async sendSlackMessage(channel, text, slackConfig) {
        const axios = require('axios');

        try {
            // Use Slack Bot Token to send message
            // Token should be in Key Vault as Slack-BotToken
            const { getSecret } = require('../services/keyVaultService');
            const botToken = await getSecret('Slack-BotToken').catch(() => null);

            if (!botToken) {
                console.error('Slack Bot Token not configured in Key Vault (Slack-BotToken)');
                return;
            }

            await axios.post('https://slack.com/api/chat.postMessage', {
                channel,
                text,
                mrkdwn: true
            }, {
                headers: {
                    'Authorization': `Bearer ${botToken}`,
                    'Content-Type': 'application/json'
                }
            });

            console.log(`Slack message sent to ${channel}`);
        } catch (error) {
            console.error('Error sending Slack message:', error.message);
        }
    }

    /**
     * Handle Slack interactive component actions.
     * This handles button clicks from Adaptive Cards/Slack blocks.
     *
     * @param {Object} payload - Interaction payload
     * @param {Object} slackConfig - Slack credentials
     */
    async handleSlackInteraction(payload, slackConfig) {
        const { type, actions, response_url, user, channel } = payload;

        if (type === 'block_actions' && actions?.length > 0) {
            const action = actions[0];
            const data = action.value ? JSON.parse(action.value) : {};

            console.log(`Slack interaction: ${action.action_id}`, data);

            // Handle common actions
            switch (action.action_id) {
                case 'show_underutilized':
                case 'query_status_UNDERUTILIZED':
                    await this.handleInteractionQuery('UNDERUTILIZED', response_url);
                    break;

                case 'show_overutilized':
                case 'query_status_OVERUTILIZED':
                    await this.handleInteractionQuery('OVERUTILIZED', response_url);
                    break;

                case 'investigate':
                    if (data.vmName) {
                        await this.handleInteractionInvestigate(data.vmName, response_url);
                    }
                    break;

                default:
                    console.log(`Unhandled action: ${action.action_id}`);
            }
        }
    }

    /**
     * Handle Teams Adaptive Card action.
     *
     * @param {Object} context - Bot turn context
     * @param {Object} data - Action data
     */
    async handleTeamsAction(context, data) {
        const { action, status, vmName } = data;

        switch (action) {
            case 'query_status':
                if (status) {
                    const vms = await this.orchestrationClient.getVMsByStatus(status);
                    await context.sendActivity(this.formatVMList(vms, `${status} VMs`, 'msteams'));
                }
                break;

            case 'investigate':
                if (vmName) {
                    const vm = await this.orchestrationClient.getVMDetails(vmName);
                    if (vm) {
                        await context.sendActivity(channelAdapter.formatResponse(
                            this.formatInvestigation(vm),
                            'msteams'
                        ));
                    }
                }
                break;

            case 'show_more':
                // Handle pagination
                break;
        }
    }

    /**
     * Handle interaction query (from button clicks).
     */
    async handleInteractionQuery(status, responseUrl) {
        try {
            const { SlackNotifier } = require('../services/slackNotifier');
            const notifier = new SlackNotifier();

            const vms = await this.orchestrationClient.getVMsByStatus(status);

            let text = `*${status} VMs* (${vms.length} found)\n\n`;
            const displayVMs = vms.slice(0, 10);

            for (const vm of displayVMs) {
                text += `• *${vm.vmName}* (${vm.vmSize})\n`;
                text += `  CPU: ${vm.CPU_Avg?.toFixed(1) || 'N/A'}% | Memory: ${vm.Memory_Avg?.toFixed(1) || 'N/A'}%\n`;
            }

            if (vms.length > 10) {
                text += `\n... and ${vms.length - 10} more`;
            }

            await notifier.sendResponse(responseUrl, { text });

        } catch (error) {
            console.error('Error handling interaction query:', error);
        }
    }

    /**
     * Handle interaction investigate (from button clicks).
     */
    async handleInteractionInvestigate(vmName, responseUrl) {
        try {
            const { SlackNotifier } = require('../services/slackNotifier');
            const notifier = new SlackNotifier();

            const vm = await this.orchestrationClient.getVMDetails(vmName);

            if (!vm) {
                await notifier.sendResponse(responseUrl, {
                    text: `VM not found: ${vmName}`
                });
                return;
            }

            const text = this.formatInvestigation(vm);
            await notifier.sendResponse(responseUrl, { text });

        } catch (error) {
            console.error('Error handling investigation:', error);
        }
    }

    /**
     * Format VM investigation as text.
     */
    formatInvestigation(vm) {
        return `*VM Investigation: ${vm.vmName}*\n\n` +
            `*Status:* ${vm.analysis?.status || 'UNKNOWN'}\n` +
            `*Action:* ${vm.analysis?.action || 'REVIEW'}\n\n` +
            `*Configuration:*\n` +
            `• Size: ${vm.vmSize}\n` +
            `• Location: ${vm.location}\n` +
            `• Resource Group: ${vm.resourceGroup}\n\n` +
            `*Performance (30-day):*\n` +
            `• CPU: ${vm.CPU_Avg?.toFixed(1) || 'N/A'}% avg, ${vm.CPU_Max?.toFixed(1) || 'N/A'}% max\n` +
            `• Memory: ${vm.Memory_Avg?.toFixed(1) || 'N/A'}% avg, ${vm.Memory_Max?.toFixed(1) || 'N/A'}% max\n\n` +
            `*Recommendation:* ${vm.analysis?.recommendation || 'No specific recommendation'}`;
    }

    /**
     * Health check for the bot.
     *
     * @returns {Promise<Object>} Health status
     */
    async healthCheck() {
        const health = {
            bot: 'healthy',
            orchestrator: 'unknown',
            agent: 'unknown',
            conversationState: 'unknown'
        };

        // Check orchestrator
        try {
            await this.orchestrationClient.healthCheck();
            health.orchestrator = 'healthy';
        } catch (error) {
            health.orchestrator = 'unhealthy';
        }

        // Check agent
        if (this.agentService) {
            const agentHealth = await this.agentService.healthCheck();
            health.agent = agentHealth.healthy ? 'healthy' : 'unhealthy';
        } else if (this.agentAvailable) {
            health.agent = 'not initialized';
        } else {
            health.agent = 'not configured';
        }

        // Check conversation state
        const stateHealth = await this.conversationState.healthCheck();
        health.conversationState = stateHealth.healthy ? 'healthy' : 'unhealthy';

        return health;
    }
}

module.exports = { VMPerfBot };
