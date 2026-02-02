/**
 * @fileoverview Slack Block Kit Builders
 *
 * Utility functions for building Slack Block Kit JSON structures.
 * Used for rich, interactive message formatting in Slack.
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

/**
 * Build a progress update block.
 *
 * @param {string} runId - Run identifier
 * @param {Object} progress - Progress information
 * @returns {Array} Slack blocks array
 */
function buildProgressBlock(runId, progress) {
    return [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*Analysis In Progress*\nRun ID: \`${runId}\``
            }
        },
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `${getProgressEmoji(progress?.step)} ${progress?.message || 'Processing...'}`
            }
        },
        {
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `Step ${progress?.currentStep || '?'}/${progress?.totalSteps || '?'}`
                }
            ]
        }
    ];
}

/**
 * Build a results block based on type.
 *
 * @param {string} type - Result type (report, inventory, status)
 * @param {Object|Array} data - Result data
 * @param {Object} filters - Applied filters (optional)
 * @returns {Array} Slack blocks array
 */
function buildResultsBlock(type, data, filters = {}) {
    switch (type) {
        case 'report':
            return buildReportResultsBlock(data);
        case 'inventory':
            return buildInventoryResultsBlock(data, filters);
        case 'status':
            return buildStatusResultsBlock(data, filters);
        default:
            return buildGenericResultsBlock(data);
    }
}

/**
 * Build report results block.
 *
 * @param {Object} summary - Run summary
 * @returns {Array} Slack blocks array
 */
function buildReportResultsBlock(summary) {
    const actionsRequired = (summary.underutilized || 0) + (summary.overutilized || 0);

    return [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: 'VM Performance Analysis Complete',
                emoji: true
            }
        },
        {
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `*Total VMs*\n${summary.totalVMs || 0}`
                },
                {
                    type: 'mrkdwn',
                    text: `*Actions Required*\n${actionsRequired}`
                }
            ]
        },
        {
            type: 'divider'
        },
        {
            type: 'section',
            fields: [
                {
                    type: 'mrkdwn',
                    text: `:arrow_down: *Underutilized*\n${summary.underutilized || 0}`
                },
                {
                    type: 'mrkdwn',
                    text: `:arrow_up: *Overutilized*\n${summary.overutilized || 0}`
                },
                {
                    type: 'mrkdwn',
                    text: `:white_check_mark: *Optimal*\n${summary.optimal || 0}`
                },
                {
                    type: 'mrkdwn',
                    text: `:grey_question: *Needs Review*\n${summary.needsReview || 0}`
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
                        text: 'Show Underutilized',
                        emoji: true
                    },
                    action_id: 'show_underutilized',
                    style: 'primary'
                },
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'Show Overutilized',
                        emoji: true
                    },
                    action_id: 'show_overutilized',
                    style: 'danger'
                },
                {
                    type: 'button',
                    text: {
                        type: 'plain_text',
                        text: 'Export CSV',
                        emoji: true
                    },
                    action_id: 'export_csv',
                    value: 'all'
                }
            ]
        }
    ];
}

/**
 * Build inventory results block.
 *
 * @param {Array} vms - VM inventory array
 * @param {Object} filters - Applied filters
 * @returns {Array} Slack blocks array
 */
function buildInventoryResultsBlock(vms, filters = {}) {
    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `VM Inventory (${vms.length} VMs)`,
                emoji: true
            }
        }
    ];

    // Add filter summary if filters applied
    if (Object.keys(filters).length > 0) {
        const filterText = Object.entries(filters)
            .map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : v}`)
            .join(', ');

        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `Filters: ${filterText}`
                }
            ]
        });
    }

    blocks.push({ type: 'divider' });

    // Group by tenant
    const byTenant = {};
    for (const vm of vms) {
        const tenant = vm.tenantName || 'Default';
        if (!byTenant[tenant]) byTenant[tenant] = [];
        byTenant[tenant].push(vm);
    }

    // Build tenant sections
    for (const [tenant, tenantVMs] of Object.entries(byTenant)) {
        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${tenant}* (${tenantVMs.length} VMs)`
            }
        });

        // Show first 5 VMs
        const displayVMs = tenantVMs.slice(0, 5);
        const vmList = displayVMs
            .map(vm => `• \`${vm.vmName}\` - ${vm.vmSize} (${vm.location})`)
            .join('\n');

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: vmList
            }
        });

        if (tenantVMs.length > 5) {
            blocks.push({
                type: 'context',
                elements: [
                    {
                        type: 'mrkdwn',
                        text: `_... and ${tenantVMs.length - 5} more_`
                    }
                ]
            });
        }
    }

    // Add export button
    blocks.push({
        type: 'actions',
        elements: [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: 'Export Full Inventory',
                    emoji: true
                },
                action_id: 'export_csv',
                value: 'inventory'
            }
        ]
    });

    return blocks;
}

/**
 * Build status results block.
 *
 * @param {Array} vms - VMs with specific status
 * @param {Object} filters - Applied filters
 * @returns {Array} Slack blocks array
 */
function buildStatusResultsBlock(vms, filters = {}) {
    const status = filters.status || 'FILTERED';
    const emoji = getStatusEmoji(status);

    const blocks = [
        {
            type: 'header',
            text: {
                type: 'plain_text',
                text: `${emoji} ${status} VMs (${vms.length})`,
                emoji: true
            }
        },
        {
            type: 'divider'
        }
    ];

    // Show VM details (max 10)
    const displayVMs = vms.slice(0, 10);

    for (const vm of displayVMs) {
        const vmName = vm.vmName || vm.VMName;
        const cpuAvg = vm.CPU_Avg || vm.analysis?.metrics?.CPU_Avg || 'N/A';
        const memAvg = vm.Memory_Avg || vm.analysis?.metrics?.Memory_Avg || 'N/A';
        const recommendation = vm.analysis?.recommendation || vm.recommendation || '';

        blocks.push({
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: `*${vmName}*\n` +
                    `Size: ${vm.vmSize} | CPU: ${cpuAvg}% | Memory: ${memAvg}%\n` +
                    (recommendation ? `_${recommendation}_` : '')
            },
            accessory: {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: 'Investigate',
                    emoji: true
                },
                action_id: 'investigate_vm',
                value: vmName
            }
        });
    }

    if (vms.length > 10) {
        blocks.push({
            type: 'context',
            elements: [
                {
                    type: 'mrkdwn',
                    text: `_Showing 10 of ${vms.length} VMs. Export for full list._`
                }
            ]
        });
    }

    // Add export button
    blocks.push({
        type: 'actions',
        elements: [
            {
                type: 'button',
                text: {
                    type: 'plain_text',
                    text: `Export ${status} VMs`,
                    emoji: true
                },
                action_id: 'export_csv',
                value: status.toLowerCase()
            }
        ]
    });

    return blocks;
}

/**
 * Build generic results block.
 *
 * @param {Object} data - Generic data
 * @returns {Array} Slack blocks array
 */
function buildGenericResultsBlock(data) {
    return [
        {
            type: 'section',
            text: {
                type: 'mrkdwn',
                text: '```' + JSON.stringify(data, null, 2).slice(0, 2900) + '```'
            }
        }
    ];
}

/**
 * Build error block.
 *
 * @param {Error} error - Error object
 * @returns {Object} Slack message with error
 */
function buildErrorBlock(error) {
    return {
        text: 'An error occurred',
        attachments: [
            {
                color: '#dc3545',
                title: 'Error',
                text: error.message || 'Unknown error',
                footer: 'VM Performance Monitor'
            }
        ]
    };
}

/**
 * Get progress emoji based on step.
 *
 * @param {string} step - Current step
 * @returns {string} Emoji
 */
function getProgressEmoji(step) {
    const stepLower = (step || '').toLowerCase();

    if (stepLower.includes('query') || stepLower.includes('log analytics')) return ':mag:';
    if (stepLower.includes('inventory')) return ':clipboard:';
    if (stepLower.includes('analyz') || stepLower.includes('ai')) return ':brain:';
    if (stepLower.includes('sav') || stepLower.includes('stor')) return ':floppy_disk:';
    if (stepLower.includes('complete')) return ':white_check_mark:';

    return ':hourglass_flowing_sand:';
}

/**
 * Get status emoji.
 *
 * @param {string} status - VM status
 * @returns {string} Emoji
 */
function getStatusEmoji(status) {
    switch (status?.toUpperCase()) {
        case 'UNDERUTILIZED':
            return ':arrow_down:';
        case 'OVERUTILIZED':
            return ':arrow_up:';
        case 'OPTIMAL':
            return ':white_check_mark:';
        case 'NEEDS_REVIEW':
            return ':grey_question:';
        default:
            return ':desktop_computer:';
    }
}

module.exports = {
    buildProgressBlock,
    buildResultsBlock,
    buildReportResultsBlock,
    buildInventoryResultsBlock,
    buildStatusResultsBlock,
    buildErrorBlock,
    getProgressEmoji,
    getStatusEmoji
};
