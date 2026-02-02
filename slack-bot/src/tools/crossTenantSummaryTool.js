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
     * Get cross-tenant summary statistics.
     *
     * @returns {Promise<Object>} Summary across all tenants
     */
    return async function getCrossTenantSummary() {
        try {
            console.log('Getting cross-tenant summary...');

            const summary = await orchestrationClient.getCrosstenantSummary();

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

            // Format the summary for readability
            const formattedSummary = {
                success: true,
                overview: {
                    totalVMs: summary.totalVMs || 0,
                    tenantsAnalyzed: summary.tenantCount || summary.tenants?.length || 1,
                    lastAnalysis: summary.lastRunTime || 'Unknown'
                },
                performanceBreakdown: {
                    underutilized: {
                        count: summary.underutilized || 0,
                        percentage: summary.totalVMs ? `${((summary.underutilized || 0) / summary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Consider downsizing these VMs to reduce costs'
                    },
                    overutilized: {
                        count: summary.overutilized || 0,
                        percentage: summary.totalVMs ? `${((summary.overutilized || 0) / summary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Consider upsizing these VMs to improve performance'
                    },
                    optimal: {
                        count: summary.optimal || 0,
                        percentage: summary.totalVMs ? `${((summary.optimal || 0) / summary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'These VMs are right-sized for their workload'
                    },
                    needsReview: {
                        count: summary.needsReview || 0,
                        percentage: summary.totalVMs ? `${((summary.needsReview || 0) / summary.totalVMs * 100).toFixed(1)}%` : '0%',
                        recommendation: 'Manual review recommended due to unusual patterns'
                    }
                },
                actionRequired: {
                    total: (summary.underutilized || 0) + (summary.overutilized || 0),
                    insight: getActionInsight(summary)
                }
            };

            // Add per-tenant breakdown if available
            if (summary.tenants && summary.tenants.length > 0) {
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
