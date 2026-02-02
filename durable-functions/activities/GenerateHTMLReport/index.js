const { app } = require('@azure/functions');

/**
 * Activity: Generate HTML Report from Analysis Results
 */
app.activity('GenerateHTMLReport', {
    handler: async (input, context) => {
        const { analyses, reportType } = input;

        context.log(`Generating ${reportType} HTML report for ${analyses.length} VMs`);

        // Calculate summary statistics
        const summary = {
            totalVMs: analyses.length,
            underutilized: analyses.filter(a => a.analysis.status === 'UNDERUTILIZED').length,
            overutilized: analyses.filter(a => a.analysis.status === 'OVERUTILIZED').length,
            optimal: analyses.filter(a => a.analysis.status === 'OPTIMAL').length,
            actionRequired: analyses.filter(a => a.analysis.action !== 'MAINTAIN').length
        };

        if (reportType === 'technical') {
            return {
                html: generateTechnicalReport(analyses, summary),
                summary
            };
        } else {
            return {
                html: generateExecutiveReport(analyses, summary),
                summary
            };
        }
    }
});

function generateTechnicalReport(analyses, summary) {
    const reportDate = new Date().toISOString().split('T')[0];

    return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>VM Performance Report - ${reportDate}</title>
    <style>
        body { font-family: 'Segoe UI', Arial, sans-serif; margin: 0; padding: 20px; background: #f5f5f5; }
        .container { max-width: 1200px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        .header { background: linear-gradient(135deg, #0078d4 0%, #004a8c 100%); color: white; padding: 30px; margin: -40px -40px 30px -40px; border-radius: 8px 8px 0 0; }
        h1 { margin: 0; font-size: 28px; }
        .summary { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin: 30px 0; }
        .metric-card { background: linear-gradient(135deg, #f0f6ff 0%, #e7f3ff 100%); padding: 20px; border-radius: 8px; border-left: 4px solid #0078d4; }
        .metric-value { font-size: 36px; font-weight: bold; color: #0078d4; margin: 10px 0; }
        .metric-label { font-size: 14px; color: #666; text-transform: uppercase; font-weight: 600; }
        .vm-card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 25px; margin: 20px 0; background: #fafafa; }
        .vm-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; border-bottom: 2px solid #0078d4; padding-bottom: 10px; }
        .vm-name { font-size: 20px; font-weight: bold; color: #0078d4; }
        .status-badge { padding: 5px 15px; border-radius: 20px; font-size: 12px; font-weight: bold; text-transform: uppercase; }
        .status-underutilized { background: #fff4ce; color: #d68910; }
        .status-overutilized { background: #fce4e4; color: #d13438; }
        .status-optimal { background: #dff6dd; color: #107c10; }
        .inventory-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin: 15px 0; }
        .inventory-item { background: white; padding: 12px; border-radius: 6px; border: 1px solid #e0e0e0; }
        .inventory-label { font-size: 11px; color: #666; text-transform: uppercase; font-weight: 600; }
        .inventory-value { font-size: 16px; color: #333; margin-top: 5px; font-weight: 500; }
        .metrics-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin: 15px 0; }
        .metric-box { background: white; padding: 15px; border-radius: 6px; border: 1px solid #e0e0e0; }
        .analysis-box { background: #e8f4f8; border-left: 4px solid #00bcf2; padding: 20px; margin: 15px 0; border-radius: 4px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 2px solid #e0e0e0; text-align: center; color: #666; font-size: 12px; }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <h1>🔧 VM Performance & Sizing Recommendations</h1>
            <p>Technical Report for DevOps Engineers</p>
            <p>Report Date: ${reportDate} | Analysis Period: Last 7 days</p>
        </div>

        <div class="summary">
            <div class="metric-card">
                <div class="metric-label">Total VMs Analyzed</div>
                <div class="metric-value">${summary.totalVMs}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Action Required</div>
                <div class="metric-value" style="color: #d68910;">${summary.actionRequired}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Underutilized</div>
                <div class="metric-value" style="color: #d68910;">${summary.underutilized}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Overutilized</div>
                <div class="metric-value" style="color: #d13438;">${summary.overutilized}</div>
            </div>
            <div class="metric-card">
                <div class="metric-label">Optimally Sized</div>
                <div class="metric-value" style="color: #107c10;">${summary.optimal}</div>
            </div>
        </div>

        <h2>VM Details & Recommendations</h2>

        ${analyses.map(result => `
        <div class="vm-card">
            <div class="vm-header">
                <div class="vm-name">${result.vmData.VMName}</div>
                <span class="status-badge status-${result.analysis.status.toLowerCase()}">${result.analysis.status}</span>
            </div>

            <h3>Inventory Details</h3>
            <div class="inventory-grid">
                <div class="inventory-item">
                    <div class="inventory-label">Current SKU</div>
                    <div class="inventory-value">${result.vmData.vmSize || 'Unknown'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">OS Type</div>
                    <div class="inventory-value">${result.vmData.osType || 'Unknown'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">OS SKU</div>
                    <div class="inventory-value">${result.vmData.osSku || 'Unknown'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">vCPUs</div>
                    <div class="inventory-value">${result.vmData.vCPUs || 'N/A'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">Memory (GB)</div>
                    <div class="inventory-value">${result.vmData.memoryGB || 'N/A'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">Max IOPS</div>
                    <div class="inventory-value">${result.vmData.maxIOPS || 'N/A'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">Location</div>
                    <div class="inventory-value">${result.vmData.location || 'Unknown'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">Power State</div>
                    <div class="inventory-value">${result.vmData.powerState || 'Unknown'}</div>
                </div>
                <div class="inventory-item">
                    <div class="inventory-label">Resource Group</div>
                    <div class="inventory-value">${result.vmData.ResourceGroup}</div>
                </div>
            </div>

            <h3>Performance Metrics (7-day)</h3>
            <div class="metrics-grid">
                <div class="metric-box">
                    <div class="inventory-label">CPU Utilization</div>
                    <div class="inventory-value">${result.vmData.CPU_P95}%</div>
                    <div style="font-size: 12px; color: #666; margin-top: 5px;">
                        Max: ${result.vmData.CPU_Max}% | Avg: ${result.vmData.CPU_Avg}%
                    </div>
                </div>
                <div class="metric-box">
                    <div class="inventory-label">Memory Utilization</div>
                    <div class="inventory-value">${result.vmData.Memory_P95}%</div>
                    <div style="font-size: 12px; color: #666; margin-top: 5px;">
                        Max: ${result.vmData.Memory_Max}% | Avg: ${result.vmData.Memory_Avg}%
                    </div>
                </div>
                <div class="metric-box">
                    <div class="inventory-label">Disk IOPS</div>
                    <div class="inventory-value">${result.vmData.DiskIOPS_P95}</div>
                    <div style="font-size: 12px; color: #666; margin-top: 5px;">
                        Max: ${result.vmData.DiskIOPS_Max} | Avg: ${result.vmData.DiskIOPS_Avg}
                    </div>
                </div>
            </div>

            <div class="analysis-box">
                <h3 style="margin-top: 0; color: #00bcf2;">💡 AI-Powered Recommendation</h3>
                <pre style="white-space: pre-wrap; font-family: inherit; margin: 0;">${result.analysis.fullText}</pre>
            </div>
        </div>
        `).join('')}

        <div class="footer">
            <p><strong>Generated by VM Performance Monitoring System (Azure Durable Functions)</strong></p>
            <p>Powered by Azure OpenAI (GPT-5) | Data from Log Analytics</p>
            <p>Report generated at: ${new Date().toISOString()}</p>
        </div>
    </div>
</body>
</html>
    `;
}

function generateExecutiveReport(analyses, summary) {
    // Simple executive summary version
    return generateTechnicalReport(analyses, summary); // Can be customized separately
}
