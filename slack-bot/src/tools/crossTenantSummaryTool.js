/**
 * @fileoverview Cross-Tenant Summary Tool
 *
 * Retrieves summary statistics across all configured tenants,
 * including VM counts and performance breakdown.
 *
 * @version v8-agent
 */

/**
 * Create the cross-tenant summary tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createCrossTenantSummaryTool(orchestrationClient) {
    /**
     * Get performance summary statistics.
     * If subscription context is set, filters to that subscription only.
     *
     * @param {Object} args - Tool arguments (currently unused)
     * @param {Object} context - Context with subscription info
     * @returns {Promise<Object>} Summary (filtered if subscription selected)
     */
    return async function getCrossTenantSummary(args = {}, context = {}) {
        try {
            const hasSubscriptionFilter = !!context.subscriptionId;
            let summary;

            if (hasSubscriptionFilter) {
                // Use getRunSummary with subscription filter for server-side filtering
                console.log(`Getting performance summary for subscription: ${context.subscriptionName || context.subscriptionId}`);
                summary = await orchestrationClient.getRunSummary(context.subscriptionId);

                // If no subscription-specific summary, try global and filter client-side
                if (!summary) {
                    console.log('  No subscription-specific summary, fetching global summary...');
                    summary = await orchestrationClient.getCrosstenantSummary();
                }
            } else {
                console.log('Getting cross-tenant summary (all subscriptions)...');
                summary = await orchestrationClient.getCrosstenantSummary();
            }

            if (!summary || summary.totalVMs === 0) {
                return {
                    success: true,
                    message: 'No VM data available. Run a performance report to generate analysis data.',
                    summary: {
                        totalVMs: 0,
                        tenantCount: 0
                    }
                };
            }

            // Normalize the summary format - getRunSummary returns byStatus object, getCrosstenantSummary returns flat
            let filteredSummary;
            if (summary.byStatus) {
                // Format from /api/runs/latest/summary endpoint
                filteredSummary = {
                    totalVMs: summary.totalVMs,
                    tenantCount: 1,
                    lastRunTime: summary.lastRunTime,
                    underutilized: summary.byStatus.UNDERUTILIZED || 0,
                    overutilized: summary.byStatus.OVERUTILIZED || 0,
                    optimal: summary.byStatus.OPTIMAL || 0,
                    needsReview: summary.byStatus.NEEDS_REVIEW || 0,
                    subscriptionId: summary.subscriptionId
                };
                console.log(`  Subscription summary: ${filteredSummary.totalVMs} VMs`);
            } else {
                // Format from /api/summary endpoint (cross-tenant)
                filteredSummary = summary;
            }

            // Format the summary for readability
            const formattedSummary = {
                success: true,
                scope: hasSubscriptionFilter
                    ? `Subscription: ${context.subscriptionName || context.subscriptionId}`
                    : 'All subscriptions/tenants',
                overview: {
                    totalVMs: filteredSummary.totalVMs || 0,
                    tenantsAnalyzed: filteredSummary.tenantCount || filteredSummary.tenants?.length || 1,
                    lastAnalysis: filteredSummary.lastRunTime || 'Unknown'
                },
                performanceBreakdown: {
                    underutilized: {
                        count: filteredSummary.underutilized || 0,
                        percentage: filteredSummary.totalVMs ? `${((filteredSummary.underutilized || 0) / filteredSummary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Consider downsizing these VMs to reduce costs'
                    },
                    overutilized: {
                        count: filteredSummary.overutilized || 0,
                        percentage: filteredSummary.totalVMs ? `${((filteredSummary.overutilized || 0) / filteredSummary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Consider upsizing these VMs to improve performance'
                    },
                    optimal: {
                        count: filteredSummary.optimal || 0,
                        percentage: filteredSummary.totalVMs ? `${((filteredSummary.optimal || 0) / filteredSummary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'These VMs are right-sized for their workload'
                    },
                    needsReview: {
                        count: filteredSummary.needsReview || 0,
                        percentage: filteredSummary.totalVMs ? `${((filteredSummary.needsReview || 0) / filteredSummary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Manual review recommended due to unusual patterns'
                    }
                },
                actionRequired: {
                    total: (filteredSummary.underutilized || 0) + (filteredSummary.overutilized || 0),
                    insight: getActionInsight(filteredSummary)
                }
            };

            // Add per-tenant breakdown only if not filtered by subscription
            if (!hasSubscriptionFilter && summary.tenants && summary.tenants.length > 0) {
                formattedSummary.byTenant = summary.tenants.map(t => ({
                    name: t.tenantName || t.name,
                    totalVMs: t.totalVMs || t.count || 0,
                    underutilized: t.underutilized || 0,
                    overutilized: t.overutilized || 0,
                    optimal: t.optimal || 0
                }));
            }

            return formattedSummary;
        } catch (error) {
            console.error('Failed to get cross-tenant summary:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'Summary data unavailable. Run a performance report to generate analysis data.'
            };
        }
    };
}

/**
 * Generate actionable insight based on summary data.
 */
function getActionInsight(summary) {
    const total = summary.totalVMs || 1;
    const underutilizedPct = ((summary.underutilized || 0) / total) * 100;
    const overutilizedPct = ((summary.overutilized || 0) / total) * 100;

    if (underutilizedPct > 30) {
        return `High optimization opportunity: ${underutilizedPct.toFixed(0)}% of VMs are underutilized. Significant cost savings possible through rightsizing.`;
    } else if (overutilizedPct > 20) {
        return `Performance attention needed: ${overutilizedPct.toFixed(0)}% of VMs are overutilized. Consider upsizing to prevent performance issues.`;
    } else if (underutilizedPct + overutilizedPct < 10) {
        return 'Excellent! Your VMs are well-optimized with minimal action required.';
    } else {
        return `Moderate optimization opportunity: ${(underutilizedPct + overutilizedPct).toFixed(0)}% of VMs may benefit from resizing.`;
    }
}

module.exports = createCrossTenantSummaryTool;
