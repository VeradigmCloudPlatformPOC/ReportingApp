/**
 * @fileoverview HTML Report Generator Service
 *
 * This module generates HTML reports from VM analysis results.
 * It produces two types of reports:
 *
 * 1. Technical Report (for DevOps engineers):
 *    - Detailed VM metrics and recommendations
 *    - Methodology section with KQL query
 *    - Threshold documentation
 *    - Full performance data table
 *
 * 2. Executive Report (for leadership):
 *    - High-level cost savings summary
 *    - Key statistics and recommendations
 *    - Simplified data table
 *
 * Report Features:
 * - Dark header theme (#1a1a2e, #16213e)
 * - Microsoft Azure Advisor aligned thresholds
 * - Color-coded metrics (red=high, orange=low, green=optimal)
 * - Reason column for quick justification
 *
 * @version v6-parallel
 * @author VM Performance Monitoring Team
 */

/**
 * Generate HTML Report from analysis results.
 *
 * This is the main entry point for report generation. It calculates
 * summary statistics and delegates to the appropriate report generator.
 *
 * @param {Array} analyses - Array of VM analysis results from aiAnalysis
 * @param {string} reportType - Report type: 'executive' or 'technical'
 * @returns {Promise<Object>} Object containing {html: string, summary: Object}
 */
async function generateHTMLReport(analyses, reportType) {
    const summary = calculateSummary(analyses);

    const html = reportType === 'executive'
        ? generateExecutiveReport(analyses, summary)
        : generateTechnicalReport(analyses, summary);

    return { html, summary };
}

/**
 * Calculate summary statistics from VM analyses.
 *
 * Groups VMs by their status (UNDERUTILIZED, OVERUTILIZED, OPTIMAL, NEEDS_REVIEW)
 * and counts how many require action (any action other than MAINTAIN).
 *
 * @param {Array} analyses - Array of VM analysis results
 * @returns {Object} Summary statistics
 * @returns {number} returns.totalVMs - Total number of VMs analyzed
 * @returns {number} returns.underutilized - VMs that can be downsized
 * @returns {number} returns.overutilized - VMs that need more resources
 * @returns {number} returns.optimal - VMs that are right-sized
 * @returns {number} returns.needsReview - VMs with mixed patterns
 * @returns {number} returns.actionRequired - VMs needing any action (not MAINTAIN)
 */
function calculateSummary(analyses) {
    return {
        totalVMs: analyses.length,
        underutilized: analyses.filter(a => a.analysis?.status === 'UNDERUTILIZED').length,
        overutilized: analyses.filter(a => a.analysis?.status === 'OVERUTILIZED').length,
        optimal: analyses.filter(a => a.analysis?.status === 'OPTIMAL').length,
        needsReview: analyses.filter(a => a.analysis?.status === 'NEEDS_REVIEW').length,
        actionRequired: analyses.filter(a => a.analysis?.action !== 'MAINTAIN').length
    };
}

/**
 * Generate Technical Report for DevOps engineers.
 *
 * This report includes:
 * - Summary cards (total VMs, actions required, by status)
 * - Methodology section explaining analysis approach
 * - Threshold table (Microsoft Azure Advisor aligned)
 * - KQL query used for data collection
 * - Detailed VM table with all metrics and recommendations
 *
 * CSS Theme:
 * - Header gradient: #1a1a2e → #16213e (dark blue)
 * - Table headers: #1a1a2e (matching dark blue)
 * - Metric colors: red (>90%), orange (<30%/<40%), green (40-80%)
 *
 * @param {Array} analyses - Array of VM analysis results
 * @param {Object} summary - Calculated summary statistics
 * @returns {string} Complete HTML document as string
 */
function generateTechnicalReport(analyses, summary) {
    const date = new Date().toISOString().split('T')[0];

    // =========================================================================
    // TECHNICAL REPORT HTML TEMPLATE
    // =========================================================================
    // Features:
    // - Responsive grid layout for summary cards
    // - Methodology section with KQL query and threshold documentation
    // - Full metrics table with color-coded values
    // - Reason column for quick justification
    // =========================================================================
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>VM Performance Report - ${date}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1400px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 30px; border-radius: 8px 8px 0 0; }
        .header h1 { margin: 0 0 10px 0; }
        .header p { margin: 0; opacity: 0.9; }
        .summary-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 15px; padding: 20px; background: white; }
        .summary-card { text-align: center; padding: 20px; border-radius: 8px; }
        .summary-card.total { background: #e3f2fd; }
        .summary-card.underutilized { background: #fff3e0; }
        .summary-card.overutilized { background: #ffebee; }
        .summary-card.optimal { background: #e8f5e9; }
        .summary-card.action { background: #fce4ec; }
        .summary-card .number { font-size: 36px; font-weight: bold; }
        .summary-card .label { font-size: 12px; text-transform: uppercase; color: #666; }
        .table-container { padding: 20px; background: white; overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #1a1a2e; color: white; padding: 12px 8px; text-align: left; font-weight: 600; white-space: nowrap; }
        td { padding: 10px 8px; border-bottom: 1px solid #e0e0e0; vertical-align: middle; }
        tr:hover { background: #f5f5f5; }
        tr:nth-child(even) { background: #fafafa; }
        tr:nth-child(even):hover { background: #f0f0f0; }
        .vm-name { font-weight: 600; color: #333; }
        .sku-current { font-family: monospace; background: #e3f2fd; padding: 2px 6px; border-radius: 4px; }
        .sku-recommended { font-family: monospace; background: #e8f5e9; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
        .sku-caps { font-size: 11px; color: #666; }
        .metric { font-family: monospace; text-align: right; }
        .metric-high { color: #d32f2f; font-weight: 600; }
        .metric-low { color: #ff9800; }
        .metric-optimal { color: #4caf50; }
        .action-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .action-DOWNSIZE { background: #fff3e0; color: #e65100; }
        .action-UPSIZE { background: #ffebee; color: #c62828; }
        .action-MAINTAIN { background: #e8f5e9; color: #2e7d32; }
        .action-REVIEW { background: #f5f5f5; color: #666; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; background: white; border-radius: 0 0 8px 8px; }
        .analysis-period { background: #fff8e1; padding: 10px 20px; border-left: 4px solid #ffc107; margin-bottom: 20px; }
        .methodology-section { background: #f8f9fa; padding: 20px; border-radius: 8px; margin-bottom: 20px; border: 1px solid #dee2e6; }
        .methodology-section h3 { margin-top: 0; color: #1a1a2e; font-size: 16px; }
        .methodology-section h4 { margin: 15px 0 10px 0; color: #2c3e50; font-size: 14px; }
        .methodology-section ul { margin: 0; padding-left: 20px; font-size: 13px; }
        .methodology-section li { margin-bottom: 6px; }
        .kql-query { background: #1a1a2e; color: #00ff88; padding: 15px; border-radius: 6px; font-family: 'Consolas', 'Monaco', monospace; font-size: 11px; overflow-x: auto; white-space: pre-wrap; word-break: break-all; }
        .threshold-table { width: 100%; border-collapse: collapse; margin: 10px 0; font-size: 12px; }
        .threshold-table th { background: #e9ecef; padding: 8px; text-align: left; color: #1a1a2e; }
        .threshold-table td { padding: 8px; border-bottom: 1px solid #dee2e6; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VM Performance & Sizing Recommendations</h1>
            <p>Technical Report - Generated ${new Date().toLocaleString()}</p>
        </div>

        <div class="summary-cards">
            <div class="summary-card total">
                <div class="number">${summary.totalVMs}</div>
                <div class="label">Total VMs</div>
            </div>
            <div class="summary-card action">
                <div class="number">${summary.actionRequired}</div>
                <div class="label">Actions Required</div>
            </div>
            <div class="summary-card underutilized">
                <div class="number">${summary.underutilized}</div>
                <div class="label">Underutilized</div>
            </div>
            <div class="summary-card overutilized">
                <div class="number">${summary.overutilized}</div>
                <div class="label">Overutilized</div>
            </div>
            <div class="summary-card optimal">
                <div class="number">${summary.optimal}</div>
                <div class="label">Optimal</div>
            </div>
        </div>

        <div class="table-container">
            <div class="analysis-period">
                <strong>Analysis Period:</strong> Last 30 days of performance data
            </div>

            <div class="methodology-section">
                <h3>Analysis Methodology</h3>

                <h4>Performance Metrics Collected</h4>
                <ul>
                    <li><strong>CPU:</strong> % Processor Time (_Total instance) - Max and Average</li>
                    <li><strong>Memory:</strong> % Committed Bytes In Use, % Used Memory - Max and Average</li>
                    <li><strong>Disk:</strong> Disk Bytes/sec, Disk Transfers/sec (_Total instance) - Max and Average</li>
                </ul>

                <h4>Classification Thresholds (Microsoft Azure Advisor Aligned)</h4>
                <table class="threshold-table">
                    <tr><th>Status</th><th>CPU Criteria</th><th>Memory Criteria</th><th>Action</th></tr>
                    <tr><td>UNDERUTILIZED</td><td>Max CPU &lt; 5% OR Max CPU &lt; 30%</td><td>Max Memory &lt; 40%</td><td>DOWNSIZE</td></tr>
                    <tr><td>OVERUTILIZED</td><td>Max CPU &gt; 90%</td><td>Max Memory &gt; 90%</td><td>UPSIZE</td></tr>
                    <tr><td>OPTIMAL (RIGHT-SIZED)</td><td>Max CPU 40-80%</td><td>Max Memory 40-80%</td><td>MAINTAIN</td></tr>
                    <tr><td>NEEDS_REVIEW</td><td colspan="2">Mixed patterns (e.g., high CPU but low memory)</td><td>REVIEW</td></tr>
                </table>

                <h4>KQL Query Used</h4>
                <div class="kql-query">Perf
| where TimeGenerated >= ago(30d)
| where Computer in ('vm1','vm2',...)
| where ObjectName in ("Processor", "Memory", "LogicalDisk", "Logical Disk")
| where (ObjectName == "Processor" and CounterName == "% Processor Time" and InstanceName == "_Total")
    or (ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory"))
    or (ObjectName in ("LogicalDisk", "Logical Disk") and CounterName in ("Disk Bytes/sec", "Disk Transfers/sec") and InstanceName == "_Total")
| summarize
    AvgCPU = avgif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
    MaxCPU = maxif(CounterValue, ObjectName == "Processor" and CounterName == "% Processor Time"),
    AvgMemoryUsage = avgif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
    MaxMemory = maxif(CounterValue, ObjectName == "Memory" and CounterName in ("% Committed Bytes In Use", "% Used Memory")),
    AvgDiskBytesPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Bytes/sec"),
    AvgDiskTransfersPerSec = avgif(CounterValue, ObjectName in ("LogicalDisk", "Logical Disk") and CounterName == "Disk Transfers/sec")
  by Computer</div>
            </div>

            <h2>VM Right-Sizing Analysis</h2>
            <table>
                <thead>
                    <tr>
                        <th>VM Name</th>
                        <th>Current SKU</th>
                        <th>SKU Capabilities</th>
                        <th>Max CPU %</th>
                        <th>Max Memory %</th>
                        <th>Max Disk IOPS</th>
                        <th>Recommended SKU</th>
                        <th>Action</th>
                        <th>Reason</th>
                    </tr>
                </thead>
                <tbody>
                    ${analyses.map(item => generateTableRow(item)).join('')}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <p>Generated by VM Performance Monitoring System | ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate a single table row for the technical report.
 *
 * Applies color-coding based on Microsoft Azure Advisor thresholds:
 * - metric-high (red): CPU > 90% or Memory > 90%
 * - metric-low (orange): CPU < 30% or Memory < 40%
 * - metric-optimal (green): CPU/Memory in 40-80% range
 *
 * @param {Object} item - Analysis result for a single VM
 * @param {Object} item.vmData - VM metrics and inventory
 * @param {Object} item.analysis - AI/fallback analysis results
 * @returns {string} HTML table row (<tr>) as string
 */
function generateTableRow(item) {
    const vm = item.vmData || item;
    const analysis = item.analysis || {};

    // Format SKU capabilities (vCPUs and memory)
    const vCPUs = vm.skuLimits?.vCPUs || 'N/A';
    const memoryGB = vm.skuLimits?.memoryGB || 'N/A';
    const skuCaps = `${vCPUs} vCPU, ${memoryGB} GB`;

    // Apply color classes based on Microsoft-aligned thresholds
    // Red (>90%), Orange (<30%/<40%), Green (40-80%)
    const cpuClass = vm.CPU_Max > 90 ? 'metric-high' : vm.CPU_Max < 30 ? 'metric-low' : 'metric-optimal';
    const memClass = vm.Memory_Max > 90 ? 'metric-high' : vm.Memory_Max < 40 ? 'metric-low' : 'metric-optimal';

    // Extract action and reason from analysis
    const action = analysis.action || 'REVIEW';
    const reason = analysis.reason || analysis.justification || '-';

    return `
                    <tr>
                        <td class="vm-name">${vm.VMName}</td>
                        <td><span class="sku-current">${vm.inventory?.vmSize || 'Unknown'}</span></td>
                        <td class="sku-caps">${skuCaps}</td>
                        <td class="metric ${cpuClass}">${vm.CPU_Max}%</td>
                        <td class="metric ${memClass}">${vm.Memory_Max}%</td>
                        <td class="metric">${vm.DiskIOPS_Max}</td>
                        <td><span class="sku-recommended">${analysis.recommendedSKU || 'Review'}</span></td>
                        <td><span class="action-badge action-${action}">${action}</span></td>
                        <td style="font-size: 11px; color: #555;">${reason}</td>
                    </tr>`;
}

/**
 * Generate Executive Report for leadership.
 *
 * This report focuses on business impact and cost savings:
 * - Prominent savings highlight box
 * - Key statistics in grid layout
 * - Actionable recommendations
 * - Simplified VM table (no methodology details)
 *
 * Cost Calculation:
 * - Estimated $50 per month savings per underutilized VM
 * - This is a conservative estimate; actual savings vary by SKU
 *
 * @param {Array} analyses - Array of VM analysis results
 * @param {Object} summary - Calculated summary statistics
 * @returns {string} Complete HTML document as string
 */
function generateExecutiveReport(analyses, summary) {
    const date = new Date().toISOString().split('T')[0];

    // Conservative cost savings estimate: $50/month per underutilized VM
    // Actual savings depend on current/recommended SKU pricing
    const potentialSavings = summary.underutilized * 50;

    // =========================================================================
    // EXECUTIVE REPORT HTML TEMPLATE
    // =========================================================================
    // Features:
    // - Large savings highlight at top
    // - 2x2 statistics grid
    // - Key recommendations summary
    // - Simplified VM table
    // =========================================================================
    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>VM Cost Optimization Summary - ${date}</title>
    <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; }
        .header { background: linear-gradient(135deg, #1a1a2e, #16213e); color: white; padding: 40px; border-radius: 8px 8px 0 0; text-align: center; }
        .header h1 { margin: 0 0 10px 0; font-size: 28px; }
        .content { background: white; padding: 30px; }
        .highlight-box { background: linear-gradient(135deg, #e8f5e9, #c8e6c9); padding: 30px; border-radius: 8px; text-align: center; margin-bottom: 30px; }
        .highlight-box .big-number { font-size: 48px; font-weight: bold; color: #2e7d32; }
        .highlight-box .label { font-size: 16px; color: #666; }
        .stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 20px; margin-bottom: 30px; }
        .stat-box { background: #f5f5f5; padding: 20px; border-radius: 8px; text-align: center; }
        .stat-box .number { font-size: 32px; font-weight: bold; }
        .stat-box .label { font-size: 14px; color: #666; }
        .stat-box.action .number { color: #d32f2f; }
        .recommendations { background: #fff3e0; padding: 20px; border-radius: 8px; margin-bottom: 30px; }
        .recommendations h3 { margin-top: 0; color: #e65100; }
        .recommendations ul { margin: 0; padding-left: 20px; }
        .recommendations li { margin-bottom: 10px; }
        .table-container { overflow-x: auto; }
        table { width: 100%; border-collapse: collapse; font-size: 13px; }
        th { background: #1a1a2e; color: white; padding: 12px 8px; text-align: left; font-weight: 600; }
        td { padding: 10px 8px; border-bottom: 1px solid #e0e0e0; }
        tr:nth-child(even) { background: #fafafa; }
        .sku-current { font-family: monospace; background: #e3f2fd; padding: 2px 6px; border-radius: 4px; }
        .sku-recommended { font-family: monospace; background: #e8f5e9; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
        .action-badge { display: inline-block; padding: 4px 10px; border-radius: 12px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
        .action-DOWNSIZE { background: #fff3e0; color: #e65100; }
        .action-UPSIZE { background: #ffebee; color: #c62828; }
        .action-MAINTAIN { background: #e8f5e9; color: #2e7d32; }
        .footer { text-align: center; padding: 20px; color: #666; font-size: 12px; background: white; border-radius: 0 0 8px 8px; }
        .analysis-period { background: #fff8e1; padding: 10px 20px; border-left: 4px solid #ffc107; margin-bottom: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>VM Cost Optimization Summary</h1>
            <p>Executive Report - ${new Date().toLocaleDateString()}</p>
        </div>
        <div class="content">
            <div class="highlight-box">
                <div class="big-number">$${potentialSavings.toLocaleString()}</div>
                <div class="label">Estimated Monthly Savings Opportunity</div>
            </div>
            <div class="stats-grid">
                <div class="stat-box">
                    <div class="number">${summary.totalVMs}</div>
                    <div class="label">VMs Analyzed (30-day period)</div>
                </div>
                <div class="stat-box action">
                    <div class="number">${summary.actionRequired}</div>
                    <div class="label">Actions Required</div>
                </div>
                <div class="stat-box">
                    <div class="number">${summary.underutilized}</div>
                    <div class="label">Underutilized (Downsize)</div>
                </div>
                <div class="stat-box">
                    <div class="number">${summary.overutilized}</div>
                    <div class="label">Overutilized (Upsize)</div>
                </div>
            </div>
            <div class="recommendations">
                <h3>Key Recommendations</h3>
                <ul>
                    <li><strong>${summary.underutilized} VMs</strong> are underutilized and can be downsized to reduce costs</li>
                    <li><strong>${summary.overutilized} VMs</strong> need additional resources to ensure performance</li>
                    <li><strong>${summary.optimal} VMs</strong> are optimally sized - no action needed</li>
                    <li>Potential monthly savings: <strong>$${potentialSavings.toLocaleString()}</strong></li>
                </ul>
            </div>

            <div class="analysis-period">
                <strong>Analysis Period:</strong> Last 30 days of performance data
            </div>

            <h3>VM Right-Sizing Summary</h3>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>VM Name</th>
                            <th>Current SKU</th>
                            <th>SKU Capabilities</th>
                            <th>Max CPU %</th>
                            <th>Max Memory %</th>
                            <th>Max Disk IOPS</th>
                            <th>Recommended SKU</th>
                            <th>Action</th>
                            <th>Reason</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${analyses.map(item => generateExecutiveTableRow(item)).join('')}
                    </tbody>
                </table>
            </div>
        </div>
        <div class="footer">
            <p>Generated by VM Performance Monitoring System | ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>`;
}

/**
 * Generate a single table row for the executive report.
 *
 * Similar to technical report row but without color-coded metrics
 * for cleaner executive presentation.
 *
 * @param {Object} item - Analysis result for a single VM
 * @param {Object} item.vmData - VM metrics and inventory
 * @param {Object} item.analysis - AI/fallback analysis results
 * @returns {string} HTML table row (<tr>) as string
 */
function generateExecutiveTableRow(item) {
    const vm = item.vmData || item;
    const analysis = item.analysis || {};

    // Format SKU capabilities for display
    const vCPUs = vm.skuLimits?.vCPUs || 'N/A';
    const memoryGB = vm.skuLimits?.memoryGB || 'N/A';
    const skuCaps = `${vCPUs} vCPU, ${memoryGB} GB`;

    // Extract action and reason for recommendation
    const action = analysis.action || 'REVIEW';
    const reason = analysis.reason || analysis.justification || '-';

    return `
                        <tr>
                            <td>${vm.VMName}</td>
                            <td><span class="sku-current">${vm.inventory?.vmSize || 'Unknown'}</span></td>
                            <td>${skuCaps}</td>
                            <td>${vm.CPU_Max}%</td>
                            <td>${vm.Memory_Max}%</td>
                            <td>${vm.DiskIOPS_Max}</td>
                            <td><span class="sku-recommended">${analysis.recommendedSKU || 'Review'}</span></td>
                            <td><span class="action-badge action-${action}">${action}</span></td>
                            <td style="font-size: 11px; color: #555;">${reason}</td>
                        </tr>`;
}

module.exports = { generateHTMLReport };
