/**
 * @fileoverview Trigger Performance Report Tool
 *
 * Triggers a new VM performance analysis through the orchestrator.
 * This is a long-running operation that starts the analysis and returns
 * immediately with a run ID that can be used to track progress.
 *
 * @version v8-agent
 */

/**
 * Create the trigger report tool handler.
 *
 * @param {Object} orchestrationClient - The orchestration client
 * @returns {Function} Tool handler function
 */
function createTriggerReportTool(orchestrationClient) {
    /**
     * Trigger a performance report.
     *
     * @param {Object} args - Tool arguments
     * @param {string} [args.tenant_name] - Specific tenant to analyze
     * @param {number} [args.days=30] - Days of metrics to analyze
     * @returns {Promise<Object>} Result with run ID and status
     */
    return async function triggerPerformanceReport({ tenant_name, days = 30 }) {
        try {
            console.log(`Triggering performance report: tenant=${tenant_name || 'all'}, days=${days}`);

            const result = await orchestrationClient.triggerOrchestration({
                tenantName: tenant_name,
                days
            });

            return {
                success: true,
                runId: result.runId,
                message: `Performance analysis started successfully.`,
                details: {
                    runId: result.runId,
                    scope: tenant_name || 'all tenants',
                    analysisPeriod: `${days} days`,
                    estimatedDuration: '5-30 minutes depending on VM count',
                    note: 'You will receive email reports when the analysis is complete. You can ask me about the results once finished.'
                }
            };
        } catch (error) {
            console.error('Failed to trigger performance report:', error.message);

            return {
                success: false,
                error: error.message,
                suggestion: 'The orchestrator service may be unavailable. Please try again in a few minutes.'
            };
        }
    };
}

module.exports = createTriggerReportTool;
