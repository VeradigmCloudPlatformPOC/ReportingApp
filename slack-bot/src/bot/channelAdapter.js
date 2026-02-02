/**
 * @fileoverview Channel Adapter for Multi-Channel Response Formatting
 *
 * Formats bot responses appropriately for each channel (Slack, Teams).
 * Handles the differences in rich message formats between platforms.
 *
 * @version v8-agent
 */

const { CardFactory } = require('botbuilder');
const { buildSlackBlocks } = require('./cards/slackBlocks');
const { buildAdaptiveCard } = require('./cards/adaptiveCards');

/**
 * ChannelAdapter handles channel-specific message formatting.
 */
class ChannelAdapter {
    /**
     * Format a response based on the channel.
     *
     * @param {string} text - Plain text response from agent
     * @param {string} channel - Channel identifier (slack, msteams, emulator)
     * @param {Object} [data] - Optional structured data for rich formatting
     * @returns {Object} Formatted activity for Bot Framework
     */
    formatResponse(text, channel, data = null) {
        switch (channel) {
            case 'slack':
                return this.formatSlackResponse(text, data);
            case 'msteams':
                return this.formatTeamsResponse(text, data);
            case 'emulator':
            default:
                return this.formatDefaultResponse(text, data);
        }
    }

    /**
     * Format response for Slack.
     *
     * @param {string} text - Plain text response
     * @param {Object} [data] - Structured data
     * @returns {Object} Slack-formatted activity
     */
    formatSlackResponse(text, data) {
        // If we have structured data, use Slack Block Kit
        if (data && data.type) {
            const blocks = buildSlackBlocks(data);
            if (blocks) {
                return {
                    type: 'message',
                    text: this.stripMarkdown(text), // Fallback text
                    channelData: {
                        blocks
                    }
                };
            }
        }

        // For plain text, convert markdown to Slack-friendly format
        return {
            type: 'message',
            text: this.convertToSlackMarkdown(text)
        };
    }

    /**
     * Format response for Microsoft Teams.
     *
     * @param {string} text - Plain text response
     * @param {Object} [data] - Structured data
     * @returns {Object} Teams-formatted activity
     */
    formatTeamsResponse(text, data) {
        // If we have structured data, use Adaptive Cards
        if (data && data.type) {
            const card = buildAdaptiveCard(data);
            if (card) {
                return {
                    type: 'message',
                    text: this.stripMarkdown(text), // Fallback text
                    attachments: [CardFactory.adaptiveCard(card)]
                };
            }
        }

        // For plain text, use standard markdown (Teams supports it)
        return {
            type: 'message',
            text: text,
            textFormat: 'markdown'
        };
    }

    /**
     * Format response for default/emulator channel.
     *
     * @param {string} text - Plain text response
     * @param {Object} [data] - Structured data
     * @returns {Object} Default activity
     */
    formatDefaultResponse(text, data) {
        // In emulator, just use plain text with markdown
        return {
            type: 'message',
            text: text
        };
    }

    /**
     * Convert markdown to Slack's mrkdwn format.
     *
     * @param {string} text - Standard markdown
     * @returns {string} Slack mrkdwn
     */
    convertToSlackMarkdown(text) {
        if (!text) return '';

        return text
            // Bold: **text** -> *text*
            .replace(/\*\*([^*]+)\*\*/g, '*$1*')
            // Italic: _text_ stays the same
            // Code blocks: ```code``` stays the same
            // Inline code: `code` stays the same
            // Links: [text](url) -> <url|text>
            .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<$2|$1>')
            // Headers: ## Header -> *Header*
            .replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
    }

    /**
     * Strip markdown for plain text fallback.
     *
     * @param {string} text - Markdown text
     * @returns {string} Plain text
     */
    stripMarkdown(text) {
        if (!text) return '';

        return text
            .replace(/\*\*([^*]+)\*\*/g, '$1')
            .replace(/\*([^*]+)\*/g, '$1')
            .replace(/_([^_]+)_/g, '$1')
            .replace(/`([^`]+)`/g, '$1')
            .replace(/```[\s\S]*?```/g, '')
            .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
            .replace(/^#{1,6}\s+/gm, '')
            .trim();
    }

    /**
     * Create a typing indicator activity.
     *
     * @param {string} channel - Channel identifier
     * @returns {Object|null} Typing activity or null if not supported
     */
    createTypingActivity(channel) {
        // Typing indicators are supported in Teams but not Slack
        if (channel === 'msteams' || channel === 'emulator') {
            return {
                type: 'typing'
            };
        }
        return null;
    }

    /**
     * Format an error message appropriately.
     *
     * @param {Error} error - The error object
     * @param {string} channel - Channel identifier
     * @returns {Object} Error activity
     */
    formatError(error, channel) {
        const message = `I encountered an issue: ${error.message || 'Unknown error'}. Please try again.`;

        if (channel === 'slack') {
            return {
                type: 'message',
                channelData: {
                    blocks: [
                        {
                            type: 'section',
                            text: {
                                type: 'mrkdwn',
                                text: `:warning: ${message}`
                            }
                        }
                    ]
                }
            };
        }

        if (channel === 'msteams') {
            return {
                type: 'message',
                attachments: [CardFactory.adaptiveCard({
                    type: 'AdaptiveCard',
                    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
                    version: '1.4',
                    body: [
                        {
                            type: 'TextBlock',
                            text: message,
                            color: 'Attention',
                            wrap: true
                        }
                    ]
                })]
            };
        }

        return {
            type: 'message',
            text: message
        };
    }

    /**
     * Format a welcome message for new users.
     *
     * @param {string} channel - Channel identifier
     * @returns {Object} Welcome activity
     */
    formatWelcome(channel) {
        const welcomeText = `Hello! I'm the VM Performance Bot. I can help you with:

• **Run performance reports** - Analyze VMs across your tenants
• **Query VM status** - Find underutilized or overutilized VMs
• **Investigate VMs** - Get detailed analysis on specific VMs
• **Query inventory** - List VMs with filters (location, tags)
• **Get summaries** - Cross-tenant performance overview

Just ask me naturally, like "Show me underutilized VMs" or "Why is vm-prod-001 flagged?"`;

        return this.formatResponse(welcomeText, channel);
    }
}

// Export singleton instance
module.exports = {
    ChannelAdapter,
    channelAdapter: new ChannelAdapter()
};
