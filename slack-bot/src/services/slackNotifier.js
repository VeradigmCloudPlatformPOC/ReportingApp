/**
 * @fileoverview Slack Notification Service
 *
 * Handles sending notifications and messages to Slack channels.
 * Uses Slack's Incoming Webhooks and Web API.
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');

class SlackNotifier {
    /**
     * Create a SlackNotifier instance.
     *
     * @param {Object} options - Configuration options
     */
    constructor(options = {}) {
        this.webhookUrl = options.webhookUrl || process.env.SLACK_INCOMING_WEBHOOK_URL;
        this.botToken = options.botToken || process.env.SLACK_BOT_TOKEN;

        this.client = axios.create({
            timeout: 10000,
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Send a response to a Slack response URL.
     *
     * @param {string} responseUrl - Slack response URL
     * @param {Object} message - Message payload
     * @returns {Promise<void>}
     */
    async sendResponse(responseUrl, message) {
        try {
            await this.client.post(responseUrl, message);
        } catch (error) {
            console.error('Failed to send Slack response:', error.message);
            throw error;
        }
    }

    /**
     * Send a message to a Slack channel.
     *
     * @param {string} channelId - Slack channel ID
     * @param {Object} message - Message payload
     * @returns {Promise<void>}
     */
    async sendToChannel(channelId, message) {
        if (!this.botToken) {
            console.warn('Slack bot token not configured, cannot send to channel');
            return;
        }

        try {
            await axios.post(
                'https://slack.com/api/chat.postMessage',
                {
                    channel: channelId,
                    ...message
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.botToken}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
        } catch (error) {
            console.error('Failed to send Slack message:', error.message);
            throw error;
        }
    }

    /**
     * Send a message via webhook.
     *
     * @param {Object} message - Message payload
     * @returns {Promise<void>}
     */
    async sendWebhook(message) {
        if (!this.webhookUrl) {
            console.warn('Slack webhook URL not configured');
            return;
        }

        try {
            await this.client.post(this.webhookUrl, message);
        } catch (error) {
            console.error('Failed to send Slack webhook:', error.message);
            throw error;
        }
    }

    /**
     * Send a progress update notification.
     *
     * @param {string} channelId - Slack channel ID
     * @param {string} runId - Run identifier
     * @param {Object} progress - Progress information
     * @returns {Promise<void>}
     */
    async sendProgressUpdate(channelId, runId, progress) {
        const message = {
            text: `Analysis Progress: ${progress.step}`,
            attachments: [{
                color: '#36a64f',
                fields: [
                    {
                        title: 'Run ID',
                        value: runId,
                        short: true
                    },
                    {
                        title: 'Status',
                        value: progress.message,
                        short: true
                    }
                ],
                footer: 'VM Performance Monitor',
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        await this.sendToChannel(channelId, message);
    }

    /**
     * Send a completion notification.
     *
     * @param {string} channelId - Slack channel ID
     * @param {Object} summary - Run summary
     * @returns {Promise<void>}
     */
    async sendCompletionNotification(channelId, summary) {
        const message = {
            text: 'VM Performance Analysis Complete!',
            blocks: [
                {
                    type: 'header',
                    text: {
                        type: 'plain_text',
                        text: 'Analysis Complete',
                        emoji: true
                    }
                },
                {
                    type: 'section',
                    fields: [
                        {
                            type: 'mrkdwn',
                            text: `*Total VMs:*\n${summary.totalVMs}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Actions Required:*\n${summary.underutilized + summary.overutilized}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Underutilized:*\n${summary.underutilized}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Overutilized:*\n${summary.overutilized}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Optimal:*\n${summary.optimal}`
                        },
                        {
                            type: 'mrkdwn',
                            text: `*Needs Review:*\n${summary.needsReview || 0}`
                        }
                    ]
                },
                {
                    type: 'actions',
                    elements: [
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'Show Underutilized'
                            },
                            action_id: 'show_underutilized',
                            style: 'primary'
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'Show Overutilized'
                            },
                            action_id: 'show_overutilized'
                        },
                        {
                            type: 'button',
                            text: {
                                type: 'plain_text',
                                text: 'Export CSV'
                            },
                            action_id: 'export_csv',
                            value: 'all'
                        }
                    ]
                }
            ]
        };

        await this.sendToChannel(channelId, message);
    }

    /**
     * Send an error notification.
     *
     * @param {string} channelId - Slack channel ID
     * @param {string} runId - Run identifier
     * @param {string} errorMessage - Error message
     * @returns {Promise<void>}
     */
    async sendErrorNotification(channelId, runId, errorMessage) {
        const message = {
            text: 'VM Performance Analysis Failed',
            attachments: [{
                color: '#dc3545',
                title: 'Analysis Failed',
                text: errorMessage,
                fields: [{
                    title: 'Run ID',
                    value: runId,
                    short: true
                }],
                footer: 'VM Performance Monitor',
                ts: Math.floor(Date.now() / 1000)
            }]
        };

        await this.sendToChannel(channelId, message);
    }
}

module.exports = { SlackNotifier };
