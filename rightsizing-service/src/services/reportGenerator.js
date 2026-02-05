/**
 * @fileoverview Report Generator Service
 *
 * Generates HTML email reports with detailed right-sizing analysis
 * including per-VM recommendations and justifications.
 *
 * @version v1.0
 */

/**
 * Generate HTML email report for right-sizing analysis.
 *
 * @param {Object} analysisResults - Full analysis results
 * @param {Object} options - Report options
 * @returns {string} HTML report content
 */
function generateHTMLReport(analysisResults, options = {}) {
    const {
        summary,
        recommendations,
        details,
        subscriptionName,
        subscriptionId,
        analyzedAt,
        timeRangeDays,
        executiveSummary
    } = analysisResults;

    const { userName, reportTitle } = options;

    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${reportTitle || 'VM Right-Sizing Analysis Report'}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            line-height: 1.6;
            color: #333;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #f5f5f5;
        }
        .container {
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            padding: 30px;
        }
        h1 {
            color: #1a73e8;
            border-bottom: 3px solid #1a73e8;
            padding-bottom: 10px;
        }
        h2 {
            color: #333;
            margin-top: 30px;
            border-bottom: 1px solid #ddd;
            padding-bottom: 5px;
        }
        h3 {
            color: #555;
            margin-top: 20px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 20px;
            margin: 20px 0;
        }
        .summary-card {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 20px;
            border-radius: 8px;
            text-align: center;
        }
        .summary-card.underutilized {
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
        }
        .summary-card.overutilized {
            background: linear-gradient(135deg, #fa709a 0%, #fee140 100%);
        }
        .summary-card.rightsized {
            background: linear-gradient(135deg, #11998e 0%, #38ef7d 100%);
        }
        .summary-card.savings {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
        .summary-card h3 {
            color: white;
            margin: 0 0 10px 0;
            font-size: 14px;
            text-transform: uppercase;
            opacity: 0.9;
        }
        .summary-card .value {
            font-size: 36px;
            font-weight: bold;
        }
        .executive-summary {
            background-color: #e8f0fe;
            border-left: 4px solid #1a73e8;
            padding: 15px 20px;
            margin: 20px 0;
            font-style: italic;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin: 20px 0;
            font-size: 14px;
        }
        th, td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #ddd;
        }
        th {
            background-color: #f8f9fa;
            font-weight: 600;
            color: #333;
        }
        tr:hover {
            background-color: #f5f5f5;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
        }
        .status-underutilized {
            background-color: #fce4ec;
            color: #c62828;
        }
        .status-overutilized {
            background-color: #fff3e0;
            color: #e65100;
        }
        .status-rightsized {
            background-color: #e8f5e9;
            color: #2e7d32;
        }
        .status-review {
            background-color: #e3f2fd;
            color: #1565c0;
        }
        .risk-low {
            color: #2e7d32;
        }
        .risk-medium {
            color: #f57c00;
        }
        .risk-high {
            color: #c62828;
        }
        .recommendation-card {
            border: 1px solid #ddd;
            border-radius: 8px;
            padding: 15px;
            margin: 15px 0;
            background-color: #fafafa;
        }
        .recommendation-card h4 {
            margin: 0 0 10px 0;
            color: #333;
        }
        .recommendation-card .reason {
            background-color: white;
            padding: 10px;
            border-radius: 4px;
            margin-top: 10px;
            font-size: 14px;
        }
        .metrics-inline {
            display: flex;
            gap: 20px;
            margin: 10px 0;
            flex-wrap: wrap;
        }
        .metric {
            background-color: white;
            padding: 5px 10px;
            border-radius: 4px;
            font-size: 13px;
        }
        .footer {
            margin-top: 40px;
            padding-top: 20px;
            border-top: 1px solid #ddd;
            color: #666;
            font-size: 12px;
            text-align: center;
        }
        @media (max-width: 768px) {
            .summary-grid {
                grid-template-columns: 1fr 1fr;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔍 VM Right-Sizing Analysis Report</h1>

        <p>
            <strong>Subscription:</strong> ${subscriptionName || subscriptionId || 'Unknown'}<br>
            <strong>Analysis Period:</strong> ${timeRangeDays || 30} days<br>
            <strong>Generated:</strong> ${new Date(analyzedAt || Date.now()).toLocaleString()}<br>
            ${userName ? `<strong>Requested by:</strong> ${userName}` : ''}
        </p>

        ${executiveSummary ? `
        <div class="executive-summary">
            <strong>Executive Summary:</strong> ${executiveSummary}
        </div>
        ` : ''}

        <h2>📊 Summary Overview</h2>
        <table style="width: 100%; border-collapse: separate; border-spacing: 10px; margin: 20px 0;">
            <tr>
                <td style="background-color: #667eea; color: white; padding: 20px; border-radius: 8px; text-align: center; width: 20%;">
                    <div style="font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Total VMs</div>
                    <div style="font-size: 32px; font-weight: bold;">${summary?.totalVMs || 0}</div>
                </td>
                <td style="background-color: #f5576c; color: white; padding: 20px; border-radius: 8px; text-align: center; width: 20%;">
                    <div style="font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Underutilized</div>
                    <div style="font-size: 32px; font-weight: bold;">${summary?.underutilized || 0}</div>
                </td>
                <td style="background-color: #f57c00; color: white; padding: 20px; border-radius: 8px; text-align: center; width: 20%;">
                    <div style="font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Overutilized</div>
                    <div style="font-size: 32px; font-weight: bold;">${summary?.overutilized || 0}</div>
                </td>
                <td style="background-color: #2e7d32; color: white; padding: 20px; border-radius: 8px; text-align: center; width: 20%;">
                    <div style="font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Right-Sized</div>
                    <div style="font-size: 32px; font-weight: bold;">${summary?.rightSized || 0}</div>
                </td>
                <td style="background-color: ${(summary?.netMonthlyImpact || 0) >= 0 ? '#2e7d32' : '#c62828'}; color: white; padding: 20px; border-radius: 8px; text-align: center; width: 20%;">
                    <div style="font-size: 12px; text-transform: uppercase; margin-bottom: 5px;">Net Impact/mo</div>
                    <div style="font-size: 32px; font-weight: bold;">${formatNetImpact(summary?.netMonthlyImpact, summary?.estimatedMonthlySavings, summary?.estimatedAdditionalCost)}</div>
                </td>
            </tr>
        </table>

        <h2>🎯 Top Recommendations</h2>
        ${generateRecommendationsHTML(recommendations.filter(r => r.action === 'DOWNSIZE' || r.action === 'UPSIZE').slice(0, 10))}

        <h2>📉 Underutilized VMs (${summary.underutilized})</h2>
        ${generateVMTableHTML(details?.underutilized || [], recommendations)}

        <h2>📈 Overutilized VMs (${summary.overutilized})</h2>
        ${generateVMTableHTML(details?.overutilized || [], recommendations)}

        <h2>✅ Right-Sized VMs (${summary.rightSized})</h2>
        ${generateVMTableHTML(details?.rightSized || [], recommendations, true)}

        ${(details?.insufficientData?.length > 0) ? `
        <h2>⚠️ Insufficient Data (${summary.insufficientData})</h2>
        <p>These VMs had fewer than 500 metric samples over ${timeRangeDays} days and could not be accurately classified.</p>
        ${generateSimpleVMTableHTML(details.insufficientData)}
        ` : ''}

        <div class="footer">
            <p>
                This report was generated by the VM Performance Monitoring System.<br>
                Thresholds are aligned with Azure Advisor recommendations.<br>
                For questions or support, contact your cloud operations team.
            </p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate HTML for recommendations section.
 */
function generateRecommendationsHTML(recommendations) {
    if (!recommendations || recommendations.length === 0) {
        return '<p><em>No actionable recommendations at this time.</em></p>';
    }

    return recommendations.map(rec => `
        <div class="recommendation-card">
            <h4>${rec.action === 'DOWNSIZE' ? '⬇️' : '⬆️'} ${rec.vmName}</h4>
            <div class="metrics-inline">
                <span class="metric"><strong>Current:</strong> ${rec.currentSize}</span>
                <span class="metric"><strong>Recommended:</strong> ${rec.recommendedSize || 'Review'}</span>
                <span class="metric"><strong>Risk:</strong> <span class="risk-${rec.riskLevel?.toLowerCase() || 'low'}">${rec.riskLevel || 'LOW'}</span></span>
                ${rec.estimatedMonthlySavings ? `<span class="metric"><strong>Savings:</strong> $${rec.estimatedMonthlySavings}/mo</span>` : ''}
            </div>
            <div class="reason">
                <strong>Reason:</strong> ${rec.reason || 'Based on 30-day performance analysis.'}
                ${rec.riskExplanation ? `<br><strong>Risk Assessment:</strong> ${rec.riskExplanation}` : ''}
            </div>
        </div>
    `).join('');
}

/**
 * Generate HTML table for VM list with recommendations.
 */
function generateVMTableHTML(vms, recommendations, simplified = false) {
    if (!vms || vms.length === 0) {
        return '<p><em>No VMs in this category.</em></p>';
    }

    // Create lookup map for recommendations
    const recMap = new Map();
    (recommendations || []).forEach(r => recMap.set(r.vmName, r));

    // Show all VMs in the report
    const displayVMs = vms;

    let html = `
    <table>
        <thead>
            <tr>
                <th>VM Name</th>
                <th>Current Size</th>
                <th>Location</th>
                <th>CPU Avg/Max/P95</th>
                <th>Memory Avg/Max/P95</th>
                ${!simplified ? '<th>Recommendation</th>' : ''}
            </tr>
        </thead>
        <tbody>
    `;

    displayVMs.forEach(vm => {
        const rec = recMap.get(vm.vmName);
        const metrics = vm.metrics || {};

        html += `
            <tr>
                <td><strong>${vm.vmName}</strong></td>
                <td>${vm.currentSize}</td>
                <td>${vm.location}</td>
                <td>${formatMetric(metrics.cpuAvg)}% / ${formatMetric(metrics.cpuMax)}% / ${formatMetric(metrics.cpuP95)}%</td>
                <td>${formatMetric(metrics.memoryAvg)}% / ${formatMetric(metrics.memoryMax)}% / ${formatMetric(metrics.memoryP95)}%</td>
                ${!simplified ? `<td>${rec ? `${rec.action === 'DOWNSIZE' ? '⬇️' : rec.action === 'UPSIZE' ? '⬆️' : '✓'} ${rec.recommendedSize || rec.action}` : '-'}</td>` : ''}
            </tr>
        `;
    });

    html += `
        </tbody>
    </table>
    `;

    return html;
}

/**
 * Generate simple VM table without recommendations.
 */
function generateSimpleVMTableHTML(vms) {
    if (!vms || vms.length === 0) {
        return '<p><em>No VMs in this category.</em></p>';
    }

    // Show all VMs
    const displayVMs = vms;

    let html = `
    <table>
        <thead>
            <tr>
                <th>VM Name</th>
                <th>Size</th>
                <th>Location</th>
                <th>Resource Group</th>
                <th>Sample Count</th>
            </tr>
        </thead>
        <tbody>
    `;

    displayVMs.forEach(vm => {
        html += `
            <tr>
                <td>${vm.vmName}</td>
                <td>${vm.currentSize}</td>
                <td>${vm.location}</td>
                <td>${vm.resourceGroup}</td>
                <td>${vm.metrics?.cpuSamples || 0}</td>
            </tr>
        `;
    });

    html += '</tbody></table>';

    return html;
}

/**
 * Format metric value for display.
 */
function formatMetric(value) {
    if (value === null || value === undefined || isNaN(value)) {
        return 'N/A';
    }
    return value.toFixed(1);
}

/**
 * Format net monthly impact for display.
 * Shows savings (positive) or additional cost (negative).
 */
function formatNetImpact(netImpact, savings, additionalCost) {
    // If we have specific values, use them
    if (typeof savings === 'number' && typeof additionalCost === 'number') {
        if (savings > 0 && additionalCost === 0) {
            return `+$${savings}`;  // Pure savings
        }
        if (additionalCost > 0 && savings === 0) {
            return `-$${additionalCost}`;  // Pure additional cost
        }
        if (savings > 0 || additionalCost > 0) {
            const net = savings - additionalCost;
            return net >= 0 ? `+$${net}` : `-$${Math.abs(net)}`;
        }
    }

    // Use netImpact if available
    if (typeof netImpact === 'number') {
        if (netImpact === 0) return '$0';
        return netImpact > 0 ? `+$${netImpact}` : `-$${Math.abs(netImpact)}`;
    }

    return '$0';
}

/**
 * Generate plain text email body as fallback.
 */
function generatePlainTextReport(analysisResults) {
    const { summary, recommendations, subscriptionName, analyzedAt } = analysisResults;

    let text = `VM Right-Sizing Analysis Report\n`;
    text += `================================\n\n`;
    text += `Subscription: ${subscriptionName || 'Unknown'}\n`;
    text += `Generated: ${new Date(analyzedAt || Date.now()).toLocaleString()}\n\n`;

    text += `SUMMARY\n`;
    text += `-------\n`;
    text += `Total VMs: ${summary.totalVMs}\n`;
    text += `Underutilized: ${summary.underutilized}\n`;
    text += `Overutilized: ${summary.overutilized}\n`;
    text += `Right-sized: ${summary.rightSized}\n`;
    text += `Insufficient Data: ${summary.insufficientData}\n`;
    text += `Estimated Monthly Savings: $${summary.estimatedMonthlySavings || 0}\n\n`;

    text += `TOP RECOMMENDATIONS\n`;
    text += `-------------------\n`;

    const actionable = recommendations
        .filter(r => r.action === 'DOWNSIZE' || r.action === 'UPSIZE')
        .slice(0, 10);

    if (actionable.length === 0) {
        text += `No actionable recommendations at this time.\n`;
    } else {
        actionable.forEach((rec, i) => {
            text += `${i + 1}. ${rec.vmName}\n`;
            text += `   Current: ${rec.currentSize} -> Recommended: ${rec.recommendedSize || 'Review'}\n`;
            text += `   Action: ${rec.action} | Risk: ${rec.riskLevel || 'LOW'}\n`;
            text += `   Reason: ${rec.reason || 'Based on performance analysis'}\n\n`;
        });
    }

    return text;
}

module.exports = {
    generateHTMLReport,
    generatePlainTextReport,
    generateRecommendationsHTML,
    generateVMTableHTML
};
