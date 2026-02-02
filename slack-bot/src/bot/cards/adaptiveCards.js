/**
 * @fileoverview Microsoft Teams Adaptive Cards Builder
 *
 * Creates Adaptive Card JSON for rich Teams messages.
 * Supports VM lists, summaries, and investigation results.
 *
 * @version v8-agent
 */

/**
 * Build an Adaptive Card based on data type.
 *
 * @param {Object} data - Structured data with type property
 * @returns {Object|null} Adaptive Card JSON or null
 */
function buildAdaptiveCard(data) {
    if (!data || !data.type) return null;

    switch (data.type) {
        case 'vm_list':
            return buildVMListCard(data);
        case 'vm_investigation':
            return buildInvestigationCard(data);
        case 'report_summary':
            return buildReportSummaryCard(data);
        case 'cross_tenant_summary':
            return buildCrossTenantSummaryCard(data);
        case 'report_started':
            return buildReportStartedCard(data);
        default:
            return null;
    }
}

/**
 * Build a card showing a list of VMs.
 */
function buildVMListCard(data) {
    const { title, vms, totalCount, status } = data;

    const vmItems = (vms || []).slice(0, 10).map(vm => ({
        type: 'Container',
        items: [
            {
                type: 'ColumnSet',
                columns: [
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            {
                                type: 'TextBlock',
                                text: vm.name || vm.vmName,
                                weight: 'Bolder',
                                wrap: true
                            },
                            {
                                type: 'TextBlock',
                                text: `${vm.size || vm.vmSize} | ${vm.location}`,
                                size: 'Small',
                                isSubtle: true,
                                wrap: true
                            }
                        ]
                    },
                    {
                        type: 'Column',
                        width: 'auto',
                        items: [
                            {
                                type: 'TextBlock',
                                text: `CPU: ${vm.metrics?.cpuAvg || 'N/A'}`,
                                size: 'Small'
                            },
                            {
                                type: 'TextBlock',
                                text: `Mem: ${vm.metrics?.memoryAvg || 'N/A'}`,
                                size: 'Small'
                            }
                        ]
                    }
                ]
            }
        ],
        separator: true
    }));

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: title || `${status || ''} VMs`,
                weight: 'Bolder',
                size: 'Large',
                wrap: true
            },
            {
                type: 'TextBlock',
                text: `Showing ${vms?.length || 0} of ${totalCount || vms?.length || 0} VMs`,
                size: 'Small',
                isSubtle: true
            },
            ...vmItems
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: 'Show More',
                data: { action: 'show_more', status }
            }
        ]
    };
}

/**
 * Build a card showing VM investigation results.
 */
function buildInvestigationCard(data) {
    const { vmName, investigation } = data;
    const { basicInfo, currentConfiguration, performanceMetrics, analysis } = investigation || {};

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: `VM Investigation: ${vmName}`,
                weight: 'Bolder',
                size: 'Large',
                wrap: true
            },
            {
                type: 'Container',
                style: analysis?.status === 'OVERUTILIZED' ? 'attention' :
                       analysis?.status === 'UNDERUTILIZED' ? 'warning' : 'good',
                items: [
                    {
                        type: 'TextBlock',
                        text: `Status: ${analysis?.status || 'UNKNOWN'}`,
                        weight: 'Bolder'
                    },
                    {
                        type: 'TextBlock',
                        text: `Action: ${analysis?.action || 'REVIEW'}`,
                        isSubtle: true
                    }
                ]
            },
            {
                type: 'TextBlock',
                text: 'Configuration',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'VM Size', value: currentConfiguration?.vmSize || 'Unknown' },
                    { title: 'vCPUs', value: String(currentConfiguration?.vCPUs || 'Unknown') },
                    { title: 'Memory', value: `${currentConfiguration?.memoryGB || 'Unknown'} GB` },
                    { title: 'Location', value: basicInfo?.location || 'Unknown' },
                    { title: 'Resource Group', value: basicInfo?.resourceGroup || 'Unknown' }
                ]
            },
            {
                type: 'TextBlock',
                text: 'Performance Metrics (30-day)',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'ColumnSet',
                columns: [
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            {
                                type: 'TextBlock',
                                text: 'CPU',
                                weight: 'Bolder',
                                size: 'Small'
                            },
                            {
                                type: 'TextBlock',
                                text: `Avg: ${performanceMetrics?.cpu?.average || 'N/A'}`,
                                size: 'Small'
                            },
                            {
                                type: 'TextBlock',
                                text: `Max: ${performanceMetrics?.cpu?.maximum || 'N/A'}`,
                                size: 'Small'
                            }
                        ]
                    },
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            {
                                type: 'TextBlock',
                                text: 'Memory',
                                weight: 'Bolder',
                                size: 'Small'
                            },
                            {
                                type: 'TextBlock',
                                text: `Avg: ${performanceMetrics?.memory?.average || 'N/A'}`,
                                size: 'Small'
                            },
                            {
                                type: 'TextBlock',
                                text: `Max: ${performanceMetrics?.memory?.maximum || 'N/A'}`,
                                size: 'Small'
                            }
                        ]
                    }
                ]
            },
            {
                type: 'TextBlock',
                text: 'Recommendation',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'TextBlock',
                text: analysis?.recommendation || 'No specific recommendation available.',
                wrap: true
            }
        ]
    };
}

/**
 * Build a card showing report summary.
 */
function buildReportSummaryCard(data) {
    const { summary, runId, duration } = data;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: 'VM Performance Analysis Complete',
                weight: 'Bolder',
                size: 'Large'
            },
            {
                type: 'TextBlock',
                text: `Run ID: ${runId || 'Unknown'} | Duration: ${duration || 'N/A'}`,
                size: 'Small',
                isSubtle: true
            },
            {
                type: 'ColumnSet',
                columns: [
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            { type: 'TextBlock', text: 'Total VMs', weight: 'Bolder', horizontalAlignment: 'Center' },
                            { type: 'TextBlock', text: String(summary?.totalVMs || 0), size: 'ExtraLarge', horizontalAlignment: 'Center' }
                        ]
                    },
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            { type: 'TextBlock', text: 'Actions Required', weight: 'Bolder', horizontalAlignment: 'Center' },
                            { type: 'TextBlock', text: String((summary?.underutilized || 0) + (summary?.overutilized || 0)), size: 'ExtraLarge', color: 'Warning', horizontalAlignment: 'Center' }
                        ]
                    }
                ]
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'Underutilized', value: String(summary?.underutilized || 0) },
                    { title: 'Overutilized', value: String(summary?.overutilized || 0) },
                    { title: 'Optimal', value: String(summary?.optimal || 0) },
                    { title: 'Needs Review', value: String(summary?.needsReview || 0) }
                ]
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: 'Show Underutilized',
                data: { action: 'query_status', status: 'UNDERUTILIZED' }
            },
            {
                type: 'Action.Submit',
                title: 'Show Overutilized',
                data: { action: 'query_status', status: 'OVERUTILIZED' }
            }
        ]
    };
}

/**
 * Build a card showing cross-tenant summary.
 */
function buildCrossTenantSummaryCard(data) {
    const { overview, performanceBreakdown, byTenant } = data;

    const tenantRows = (byTenant || []).map(t => ({
        type: 'TableRow',
        cells: [
            { type: 'TableCell', items: [{ type: 'TextBlock', text: t.name }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: String(t.totalVMs) }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: String(t.underutilized) }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: String(t.overutilized) }] },
            { type: 'TableCell', items: [{ type: 'TextBlock', text: String(t.optimal) }] }
        ]
    }));

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.5',
        body: [
            {
                type: 'TextBlock',
                text: 'Cross-Tenant VM Performance Summary',
                weight: 'Bolder',
                size: 'Large'
            },
            {
                type: 'ColumnSet',
                columns: [
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            { type: 'TextBlock', text: 'Total VMs', size: 'Small', isSubtle: true },
                            { type: 'TextBlock', text: String(overview?.totalVMs || 0), size: 'ExtraLarge', weight: 'Bolder' }
                        ]
                    },
                    {
                        type: 'Column',
                        width: 'stretch',
                        items: [
                            { type: 'TextBlock', text: 'Tenants', size: 'Small', isSubtle: true },
                            { type: 'TextBlock', text: String(overview?.tenantsAnalyzed || 0), size: 'ExtraLarge', weight: 'Bolder' }
                        ]
                    }
                ]
            },
            {
                type: 'TextBlock',
                text: 'Performance Breakdown',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'Underutilized', value: `${performanceBreakdown?.underutilized?.count || 0} (${performanceBreakdown?.underutilized?.percentage || '0%'})` },
                    { title: 'Overutilized', value: `${performanceBreakdown?.overutilized?.count || 0} (${performanceBreakdown?.overutilized?.percentage || '0%'})` },
                    { title: 'Optimal', value: `${performanceBreakdown?.optimal?.count || 0} (${performanceBreakdown?.optimal?.percentage || '0%'})` }
                ]
            },
            ...(byTenant && byTenant.length > 0 ? [{
                type: 'TextBlock',
                text: 'By Tenant',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'Table',
                columns: [
                    { width: 2 },
                    { width: 1 },
                    { width: 1 },
                    { width: 1 },
                    { width: 1 }
                ],
                rows: [
                    {
                        type: 'TableRow',
                        cells: [
                            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Tenant', weight: 'Bolder' }] },
                            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Total', weight: 'Bolder' }] },
                            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Under', weight: 'Bolder' }] },
                            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Over', weight: 'Bolder' }] },
                            { type: 'TableCell', items: [{ type: 'TextBlock', text: 'Optimal', weight: 'Bolder' }] }
                        ]
                    },
                    ...tenantRows
                ]
            }] : [])
        ]
    };
}

/**
 * Build a card showing report started confirmation.
 */
function buildReportStartedCard(data) {
    const { runId, scope, analysisPeriod } = data;

    return {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.4',
        body: [
            {
                type: 'TextBlock',
                text: 'Performance Analysis Started',
                weight: 'Bolder',
                size: 'Large',
                color: 'Good'
            },
            {
                type: 'FactSet',
                facts: [
                    { title: 'Run ID', value: runId || 'Unknown' },
                    { title: 'Scope', value: scope || 'All tenants' },
                    { title: 'Analysis Period', value: analysisPeriod || '30 days' }
                ]
            },
            {
                type: 'TextBlock',
                text: 'The analysis is running in the background. You will receive email reports when complete. You can ask me about the results once finished.',
                wrap: true,
                spacing: 'Medium'
            }
        ]
    };
}

module.exports = {
    buildAdaptiveCard,
    buildVMListCard,
    buildInvestigationCard,
    buildReportSummaryCard,
    buildCrossTenantSummaryCard,
    buildReportStartedCard
};
