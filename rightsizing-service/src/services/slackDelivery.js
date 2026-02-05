/**
 * @fileoverview Slack Delivery Service
 *
 * Handles Slack interactions for right-sizing service:
 * - Fetches user email from Slack profile
 * - Sends summary messages to Slack channels
 * - Formats results for Slack display
 *
 * @version v1.0
 */

const axios = require('axios');

/**
 * Slack Delivery class for sending right-sizing results.
 */
class SlackDelivery {
    /**
     * Create a Slack Delivery instance.
     *
     * @param {string} botToken - Slack bot token
     */
    constructor(botToken) {
        this.botToken = botToken;
        this.apiUrl = 'https://slack.com/api';
    }

    /**
     * Fetch user email from Slack profile.
     *
     * @param {string} userId - Slack user ID (e.g., U0A6F7ERM37)
     * @returns {Promise<string|null>} User email or null if not found
     */
    async getUserEmail(userId) {
        try {
            const response = await axios.get(`${this.apiUrl}/users.info`, {
                params: { user: userId },
                headers: { 'Authorization': `Bearer ${this.botToken}` }
            });

            if (response.data.ok && response.data.user?.profile?.email) {
                return response.data.user.profile.email;
            }

            console.warn(`[SlackDelivery] No email found for user ${userId}`);
            return null;

        } catch (error) {
            console.error(`[SlackDelivery] Error fetching user email:`, error.message);
            return null;
        }
    }

    /**
     * Send a message to a Slack channel.
     *
     * @param {string} channelId - Slack channel ID
     * @param {string} text - Message text (fallback)
     * @param {Array} blocks - Slack Block Kit blocks
     * @param {string} threadTs - Optional thread timestamp for replies
     * @returns {Promise<Object>} Slack API response
     */
    async sendMessage(channelId, text, blocks = null, threadTs = null) {
        try {
            const payload = {
                channel: channelId,
                text: text
            };

            if (blocks) {
                payload.blocks = blocks;
            }

            if (threadTs) {
                payload.thread_ts = threadTs;
            }

            const response = await axios.post(
                `${this.apiUrl}/chat.postMessage`,
                payload,
                {
                    headers: {
                        'Authorization': `Bearer ${this.botToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );

            if (!response.data.ok) {
                throw new Error(response.data.error || 'Slack API error');
            }

            return response.data;

        } catch (error) {
            console.error(`[SlackDelivery] Error sending message:`, error.message);
            throw error;
        }
    }

    /**
     * Format and send right-sizing summary to Slack.
     *
     * @param {string} channelId - Slack channel ID
     * @param {Object} analysisResults - Analysis results from right-sizing service
     * @param {Object} options - Additional options
     * @returns {Promise<Object>} Slack API response
     */
    async sendRightSizingSummary(channelId, analysisResults, options = {}) {
        const { summary, recommendations, subscriptionName, executiveSummary } = analysisResults;
        const { userEmail, threadTs } = options;

        // Build Slack blocks
        const blocks = [];

        // Header
        blocks.push({
            type: 'header',
            text: {
                type: 'plain_text',
                text: ':chart_with_downwards_trend: Right-Sizing Analysis Complete',
                emoji: true
            }
        });

        // Subscription info
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Subscription:* ${subscriptionName || 'Unknown'}\n*VMs Analyzed:* ${summary.analyzed} of ${summary.totalVMs}${summary.insufficientData > 0 ? ` (${summary.insufficientData} had insufficient data)` : ''}`
            }
        });

        // Summary section
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '*Summary:*\n' +
                    `• :red_circle: *${summary.underutilized} Underutilized* - Consider downsizing\n` +
                    `• :orange_circle: *${summary.overutilized} Overutilized* - May need upsizing\n` +
                    `• :green_circle: *${summary.rightSized} Right-sized* - No action needed`
            }
        });

        // Estimated savings
        if (summary.estimatedMonthlySavings > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `:moneybag: *Estimated Monthly Savings:* $${summary.estimatedMonthlySavings.toLocaleString()}`
                }
            });
        }

        blocks.push({ type: 'divider' });

        // Top recommendations
        const actionableRecs = recommendations.filter(r =>
            r.action === 'DOWNSIZE' || r.action === 'UPSIZE'
        ).slice(0, 5);

        if (actionableRecs.length > 0) {
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: '*Top Recommendations:*'
                }
            });

            actionableRecs.forEach((rec, index) => {
                const emoji = rec.action === 'DOWNSIZE' ? ':arrow_down:' : ':arrow_up:';
                const savings = rec.estimatedMonthlySavings
                    ? ` (saves $${rec.estimatedMonthlySavings}/mo)`
                    : '';

                blocks.push({
                    type: 'section',
                    text: {
                        type: 'mrkdwn',
                        text: `${index + 1}. ${emoji} \`${rec.vmName}\` → ${rec.action} to ${rec.recommendedSize || 'review'}${savings}`
                    }
                });
            });
        }

        // Executive summary if available
        if (executiveSummary) {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `_${executiveSummary}_`
                }
            });
        }

        // Email notification
        if (userEmail) {
            blocks.push({ type: 'divider' });
            blocks.push({
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `:email: *Full detailed report sent to ${userEmail}* with per-VM analysis and recommendations.`
                    }
                ]
            });
        }

        // Send the message
        const fallbackText = `Right-Sizing Analysis: ${summary.underutilized} underutilized, ${summary.overutilized} overutilized, ${summary.rightSized} right-sized VMs. Est. savings: $${summary.estimatedMonthlySavings || 0}/mo`;

        return this.sendMessage(channelId, fallbackText, blocks, threadTs);
    }

    /**
     * Send a progress update message.
     *
     * @param {string} channelId - Slack channel ID
     * @param {string} message - Progress message
     * @param {string} threadTs - Thread timestamp
     * @returns {Promise<Object>} Slack API response
     */
    async sendProgressUpdate(channelId, message, threadTs = null) {
        return this.sendMessage(channelId, message, null, threadTs);
    }

    /**
     * Send error notification to Slack.
     *
     * @param {string} channelId - Slack channel ID
     * @param {string} errorMessage - Error description
     * @param {string} threadTs - Thread timestamp
     * @returns {Promise<Object>} Slack API response
     */
    async sendErrorNotification(channelId, errorMessage, threadTs = null) {
        const blocks = [
            {
                type: 'section',
                text: {
                    type: 'mrkdwn',
                    text: `:x: *Right-Sizing Analysis Failed*\n\n${errorMessage}\n\nPlease try again or contact support.`
                }
            }
        ];

        return this.sendMessage(
            channelId,
            `Right-Sizing Analysis Failed: ${errorMessage}`,
            blocks,
            threadTs
        );
    }
}

/**
 * Format a VM list for Slack display.
 *
 * @param {Array} vms - Array of VMs
 * @param {number} limit - Maximum VMs to show
 * @returns {string} Formatted string
 */
function formatVMList(vms, limit = 10) {
    if (!vms || vms.length === 0) {
        return '_No VMs in this category_';
    }

    const display = vms.slice(0, limit);
    let result = display.map(vm =>
        `• \`${vm.vmName}\` (${vm.vmSize}) - CPU avg: ${vm.metrics?.CPU_Avg?.toFixed(1) || 'N/A'}%`
    ).join('\n');

    if (vms.length > limit) {
        result += `\n_...and ${vms.length - limit} more_`;
    }

    return result;
}

module.exports = { SlackDelivery, formatVMList };
