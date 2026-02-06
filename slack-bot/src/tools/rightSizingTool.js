/**
 * @fileoverview Right-Sizing Analysis Tool
 *
 * Tool handler for triggering VM right-sizing analysis.
 * Calls App 4 (Right-Sizing Service) to analyze VMs and generate
 * AI-powered recommendations with Slack summary + email report.
 *
 * @version v12-microservices
 */

const axios = require('axios');

/**
 * Right-Sizing Tool Definition for AI Foundry agent.
 */
const RIGHT_SIZING_TOOL_DEFINITION = {
    type: 'function',
    function: {
        name: 'analyze_rightsizing',
        description: `Analyze VM right-sizing for a subscription. Provides AI-powered recommendations to optimize VM sizes based on 30-day performance metrics.

Results are delivered in two ways:
1. Slack: High-level summary with top recommendations and estimated savings
2. Email: Detailed report sent to user's email (fetched from Slack profile) with per-VM analysis and justifications

Use this tool when users ask about:
- VM right-sizing or optimization
- Underutilized or overutilized VMs
- Cost savings opportunities
- VM size recommendations`,
        parameters: {
            type: 'object',
            properties: {
                subscription_name: {
                    type: 'string',
                    description: 'The subscription name or ID to analyze. If not provided, uses the default subscription from context.'
                },
                time_range_days: {
                    type: 'integer',
                    description: 'Analysis time range in days (default: 30, minimum: 7 recommended for accuracy)',
                    default: 30
                },
                quick_mode: {
                    type: 'boolean',
                    description: 'If true, performs quick analysis (top 10 only, 7 days, no email). Use for preview.',
                    default: false
                }
            }
        }
    }
};

/**
 * Create the right-sizing tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createRightSizingTool(orchestrationClient) {
    /**
     * Analyze VM right-sizing for a subscription.
     *
     * @param {Object} args - Tool arguments
     * @param {string} args.subscription_name - Subscription to analyze
     * @param {number} args.time_range_days - Analysis period
     * @param {boolean} args.quick_mode - Quick analysis mode
     * @param {Object} context - Execution context with user/channel info
     * @returns {Promise<Object>} Analysis results
     */
    return async function analyzeRightSizing(
        { subscription_name, time_range_days = 30, quick_mode = false },
        context = {}
    ) {
        const startTime = Date.now();

        try {
            console.log(`[RightSizingTool] Starting analysis for: ${subscription_name || 'default subscription'}`);
            console.log(`  Time range: ${time_range_days} days`);
            console.log(`  Quick mode: ${quick_mode}`);
            console.log(`  User: ${context.userId || 'unknown'}`);
            console.log(`  Channel: ${context.channel || 'unknown'}`);

            // Get subscription ID from name or context
            const subscriptionId = await resolveSubscriptionId(
                orchestrationClient,
                subscription_name,
                context.subscriptionId
            );

            if (!subscriptionId) {
                return {
                    success: false,
                    error: 'SUBSCRIPTION_NOT_FOUND',
                    message: subscription_name
                        ? `Could not find subscription "${subscription_name}". Please provide a valid subscription name or ID.`
                        : 'No subscription specified and no default subscription in context. Please specify a subscription name.'
                };
            }

            // Call App 4 (Right-Sizing Service)
            const rightSizingServiceUrl = process.env.RIGHT_SIZING_SERVICE_URL ||
                'https://vmperf-rightsizing.calmsand-17418731.westus2.azurecontainerapps.io';

            const endpoint = quick_mode ? '/api/rightsizing/quick' : '/api/rightsizing/analyze';

            const response = await axios.post(
                `${rightSizingServiceUrl}${endpoint}`,
                {
                    subscriptionId,
                    subscriptionName: subscription_name || context.subscriptionName,
                    tenantId: context.tenantId,
                    timeRangeDays: quick_mode ? 7 : time_range_days,
                    slackUserId: context.userId,
                    slackChannelId: context.channel,
                    includeAIAnalysis: !quick_mode
                },
                {
                    timeout: quick_mode ? 120000 : 300000, // 2 min for quick, 5 min for full
                    headers: {
                        'Content-Type': 'application/json'
                    }
                }
            );

            const result = response.data;

            if (!result.success) {
                return {
                    success: false,
                    error: result.error || 'ANALYSIS_FAILED',
                    message: result.message || 'Right-sizing analysis failed'
                };
            }

            const executionTimeMs = Date.now() - startTime;

            // Format response for AI agent
            return {
                success: true,
                subscriptionId,
                subscriptionName: subscription_name || context.subscriptionName || subscriptionId,
                analysisType: quick_mode ? 'quick' : 'full',
                timeRangeDays: quick_mode ? 7 : time_range_days,
                summary: result.summary,
                estimatedMonthlySavings: result.estimatedMonthlySavings || result.summary?.estimatedMonthlySavings || 0,
                topRecommendations: formatRecommendations(result.topRecommendations || []),
                executiveSummary: result.executiveSummary,
                emailSentTo: result.emailSentTo,
                executionTimeMs,
                hint: quick_mode
                    ? 'This is a quick analysis. Run without quick_mode for full AI-powered recommendations and email report.'
                    : result.emailSentTo
                        ? `Full detailed report has been sent to ${result.emailSentTo}`
                        : 'Full analysis complete. No email sent (user email not available).'
            };

        } catch (error) {
            console.error('[RightSizingTool] Error:', error.message);

            if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
                return {
                    success: false,
                    error: 'SERVICE_UNAVAILABLE',
                    message: 'Right-sizing service is not available. Please try again later.'
                };
            }

            if (error.response?.status === 504 || error.code === 'ETIMEDOUT') {
                return {
                    success: false,
                    error: 'ANALYSIS_TIMEOUT',
                    message: 'Analysis timed out. This can happen with large subscriptions. Try quick_mode=true for faster results.'
                };
            }

            return {
                success: false,
                error: 'TOOL_EXECUTION_FAILED',
                message: error.response?.data?.message || error.message
            };
        }
    };
}

/**
 * Resolve subscription ID from name or use context default.
 */
async function resolveSubscriptionId(orchestrationClient, subscriptionName, contextSubscriptionId) {
    // If already an ID (GUID format), use it directly
    if (subscriptionName && isGuid(subscriptionName)) {
        return subscriptionName;
    }

    // If name provided, try to resolve it
    if (subscriptionName) {
        try {
            const subscriptions = await orchestrationClient.getSubscriptions();
            if (subscriptions && Array.isArray(subscriptions)) {
                const match = subscriptions.find(s =>
                    s.name?.toLowerCase().includes(subscriptionName.toLowerCase()) ||
                    s.displayName?.toLowerCase().includes(subscriptionName.toLowerCase())
                );
                if (match) {
                    return match.subscriptionId || match.id;
                }
            }
        } catch (error) {
            console.warn('[RightSizingTool] Failed to resolve subscription name:', error.message);
        }
    }

    // Fall back to context subscription
    return contextSubscriptionId || null;
}

/**
 * Check if a string is a GUID.
 */
function isGuid(str) {
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(str);
}

/**
 * Format recommendations for AI agent response.
 */
function formatRecommendations(recommendations) {
    return recommendations.map(rec => ({
        vmName: rec.vmName,
        currentSize: rec.currentSize,
        recommendedSize: rec.recommendedSize,
        action: rec.action,
        reason: rec.reason,
        riskLevel: rec.riskLevel || 'LOW',
        estimatedMonthlySavings: rec.estimatedMonthlySavings || rec.estimatedSavings || 0
    }));
}

module.exports = {
    RIGHT_SIZING_TOOL_DEFINITION,
    createRightSizingTool
};
