/**
 * @fileoverview Orchestration Client Service
 *
 * HTTP client for communicating with the vmperf-orchestrator container app.
 * Handles triggering analysis, fetching status, and querying results.
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');

let orchestratorUrl = null;

/**
 * Initialize the orchestration client services.
 *
 * @param {Object} config - Configuration object
 */
async function initializeServices(config) {
    orchestratorUrl = config.orchestratorUrl;
    console.log(`Orchestration client initialized: ${orchestratorUrl}`);
}

class OrchestrationClient {
    /**
     * Create an OrchestrationClient instance.
     *
     * @param {string} baseUrl - Orchestrator service URL
     */
    constructor(baseUrl) {
        this.baseUrl = baseUrl || orchestratorUrl || 'http://localhost:3000';
        this.client = axios.create({
            baseURL: this.baseUrl,
            timeout: 60000, // 60 seconds for most operations
            headers: {
                'Content-Type': 'application/json'
            }
        });
    }

    /**
     * Trigger a new orchestration run.
     *
     * @param {Object} options - Orchestration options
     * @param {string} options.channelId - Slack channel ID
     * @param {string} options.requestedBy - User who triggered the run
     * @param {string} options.requestedByEmail - Email of user who triggered (for reports)
     * @param {string} options.subscriptionId - Target subscription ID (overrides default)
     * @param {string} options.tenantName - Specific tenant to run for (optional)
     * @param {number} options.days - Number of days to analyze (default: 30)
     * @returns {Promise<string>} Run ID
     */
    async triggerOrchestration(options = {}) {
        try {
            // Use longer timeout for orchestration trigger (may take time to initialize)
            const response = await this.client.post('/api/orchestrate', {
                channelId: options.channelId,
                requestedBy: options.requestedBy,
                requestedByEmail: options.requestedByEmail,
                subscriptionId: options.subscriptionId,
                tenantId: options.tenantId,
                tenantName: options.tenantName,
                days: options.days || 30,
                callbackUrl: options.callbackUrl
            }, {
                timeout: 300000 // 5 minutes for orchestration trigger
            });

            return response.data;
        } catch (error) {
            console.error('Failed to trigger orchestration:', error.message);
            throw new Error(`Orchestration failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get status of a run.
     *
     * @param {string} runId - Run identifier
     * @returns {Promise<Object>} Run status with progress
     */
    async getRunStatus(runId) {
        try {
            const response = await this.client.get(`/api/runs/${runId}/status`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return { status: 'NOT_FOUND' };
            }
            throw error;
        }
    }

    /**
     * Get the latest run for a subscription.
     *
     * @param {string} subscriptionId - Subscription ID (or 'all')
     * @returns {Promise<Object|null>} Latest run or null
     */
    async getLatestRun(subscriptionId = 'all') {
        try {
            const response = await this.client.get(`/api/runs/latest`, {
                params: { subscriptionId }
            });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get VMs filtered by status from latest run.
     *
     * @param {string} status - Status to filter by (UNDERUTILIZED, OVERUTILIZED, OPTIMAL)
     * @param {string} subscriptionId - Optional subscription ID to filter by
     * @returns {Promise<Array>} Array of VM analyses
     */
    async getVMsByStatus(status, subscriptionId = null) {
        try {
            const params = subscriptionId ? { subscriptionId } : {};
            const response = await this.client.get(`/api/vms/status/${status}`, { params });
            return response.data;
        } catch (error) {
            console.error('Failed to get VMs by status:', error.message);
            throw error;
        }
    }

    /**
     * Get details for a specific VM.
     *
     * @param {string} vmName - VM name
     * @returns {Promise<Object|null>} VM details or null
     */
    async getVMDetails(vmName) {
        try {
            const response = await this.client.get(`/api/vms/${encodeURIComponent(vmName)}`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Search VMs by name pattern.
     *
     * @param {string} pattern - Search pattern
     * @returns {Promise<Array>} Matching VMs
     */
    async searchVMs(pattern) {
        try {
            const response = await this.client.get(`/api/vms/search`, {
                params: { q: pattern }
            });
            return response.data;
        } catch (error) {
            console.error('Failed to search VMs:', error.message);
            return [];
        }
    }

    /**
     * Get VM inventory with optional filters.
     *
     * @param {Object} filters - Inventory filters
     * @param {string} filters.tenantName - Filter by tenant
     * @param {string} filters.location - Filter by location
     * @param {Object} filters.tag - Filter by tag {key, value}
     * @param {string} filters.sizePattern - Filter by size pattern
     * @param {boolean} filters.includeNetwork - Include network details (Private IP, VNET/SNET)
     * @returns {Promise<Array>} VM inventory
     */
    async getInventory(filters = {}) {
        try {
            const response = await this.client.get(`/api/inventory`, {
                params: {
                    ...filters,
                    includeNetwork: filters.includeNetwork ? 'true' : undefined
                }
            });
            return response.data;
        } catch (error) {
            console.error('Failed to get inventory:', error.message);
            throw error;
        }
    }

    /**
     * Get tenant configurations.
     *
     * @param {boolean} enabledOnly - Only return enabled tenants
     * @returns {Promise<Array>} Tenant configurations
     */
    async getTenants(enabledOnly = true) {
        try {
            const response = await this.client.get(`/api/tenants`, {
                params: { enabledOnly }
            });
            return response.data;
        } catch (error) {
            console.error('Failed to get tenants:', error.message);
            throw error;
        }
    }

    /**
     * Get cross-tenant summary.
     *
     * @returns {Promise<Object>} Summary statistics
     */
    async getCrosstenantSummary() {
        try {
            const response = await this.client.get(`/api/summary`);
            return response.data;
        } catch (error) {
            console.error('Failed to get summary:', error.message);
            throw error;
        }
    }

    /**
     * Get all subscriptions across all tenants.
     *
     * @returns {Promise<Array>} Array of subscriptions with name, id, tenant info
     */
    async getSubscriptions() {
        try {
            const response = await this.client.get(`/api/subscriptions`);
            return response.data;
        } catch (error) {
            console.error('Failed to get subscriptions:', error.message);
            throw error;
        }
    }

    /**
     * Search subscriptions by name pattern.
     *
     * @param {string} query - Search query (subscription name)
     * @returns {Promise<Array>} Matching subscriptions
     */
    async searchSubscriptions(query) {
        try {
            const response = await this.client.get(`/api/subscriptions/search`, {
                params: { q: query }
            });
            return response.data;
        } catch (error) {
            console.error('Failed to search subscriptions:', error.message);
            return [];
        }
    }

    /**
     * Get report download links for the latest run.
     *
     * @param {string} subscriptionId - Optional subscription ID filter
     * @param {number} expiryHours - Hours until links expire (default 1, max 24)
     * @returns {Promise<Object>} Download links with runId and expiry info
     */
    async getReportDownloads(subscriptionId = null, expiryHours = 1) {
        try {
            const params = {};
            if (subscriptionId) params.subscriptionId = subscriptionId;
            if (expiryHours) params.expiryHours = Math.min(expiryHours, 24);

            const response = await this.client.get('/api/reports/latest/download', { params });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return { error: 'No reports found', downloads: null };
            }
            console.error('Failed to get report downloads:', error.message);
            throw error;
        }
    }

    /**
     * Get summary from the latest analysis run (not live inventory).
     * This returns VM counts from the most recent completed analysis.
     *
     * @param {string} subscriptionId - Optional subscription ID filter
     * @returns {Promise<Object>} Run summary with status breakdown
     */
    async getRunSummary(subscriptionId = null) {
        try {
            const params = subscriptionId ? { subscriptionId } : {};
            const response = await this.client.get('/api/runs/latest/summary', { params });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            console.error('Failed to get run summary:', error.message);
            throw error;
        }
    }

    /**
     * Health check.
     *
     * @returns {Promise<boolean>} True if service is healthy
     */
    async healthCheck() {
        try {
            const response = await this.client.get('/health');
            return response.data.status === 'healthy';
        } catch (error) {
            return false;
        }
    }

    // =========================================================================
    // DYNAMIC QUERY METHODS (v9)
    // =========================================================================

    /**
     * Execute a dynamic KQL query against Log Analytics.
     *
     * @param {string} query - KQL query to execute
     * @param {Object} options - Execution options
     * @param {string} options.subscriptionId - Target subscription
     * @param {string} options.workspaceId - Log Analytics workspace ID
     * @param {string} options.tenantId - Azure AD tenant ID
     * @param {number} options.maxResults - Maximum results (default: 1000)
     * @param {number} options.timeoutMs - Query timeout in ms (default: 60000)
     * @param {string} options.userId - User who initiated the query
     * @param {string} options.channel - Channel (slack, teams, api)
     * @returns {Promise<Object>} Query results
     */
    async executeDynamicKql(query, options = {}) {
        try {
            const response = await this.client.post('/api/query/dynamic-kql', {
                query,
                subscriptionId: options.subscriptionId,
                workspaceId: options.workspaceId,
                tenantId: options.tenantId,
                maxResults: options.maxResults || 1000,
                timeoutMs: options.timeoutMs || 60000,
                userId: options.userId,
                channel: options.channel || 'slack'
            }, {
                timeout: Math.min(options.timeoutMs || 60000, 300000) + 5000 // Query timeout + buffer
            });

            return response.data;
        } catch (error) {
            if (error.response?.data) {
                return error.response.data;
            }
            return {
                success: false,
                error: 'NETWORK_ERROR',
                message: error.message
            };
        }
    }

    /**
     * Execute a dynamic Resource Graph query.
     *
     * @param {string} query - Resource Graph query to execute
     * @param {Object} options - Execution options
     * @param {Array<string>} options.subscriptionIds - Subscriptions to query
     * @param {string} options.tenantId - Azure AD tenant ID
     * @param {number} options.maxResults - Maximum results (default: 1000)
     * @param {string} options.userId - User who initiated the query
     * @param {string} options.channel - Channel (slack, teams, api)
     * @returns {Promise<Object>} Query results
     */
    async executeDynamicResourceGraph(query, options = {}) {
        try {
            const response = await this.client.post('/api/query/dynamic-resourcegraph', {
                query,
                subscriptionIds: options.subscriptionIds,
                tenantId: options.tenantId,
                maxResults: options.maxResults || 1000,
                userId: options.userId,
                channel: options.channel || 'slack'
            }, {
                timeout: 65000 // 65 seconds
            });

            return response.data;
        } catch (error) {
            if (error.response?.data) {
                return error.response.data;
            }
            return {
                success: false,
                error: 'NETWORK_ERROR',
                message: error.message
            };
        }
    }

    /**
     * Format query results for a specific channel.
     *
     * @param {Object} results - Query results to format
     * @param {string} format - Output format ('slack' or 'email')
     * @param {number} maxRows - Maximum rows to include
     * @returns {Promise<Object>} Formatted result
     */
    async formatQueryResults(results, format = 'slack', maxRows = 20) {
        try {
            const response = await this.client.post('/api/query/format', {
                results,
                format,
                maxRows
            });
            return response.data;
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Send dynamic query results via email.
     * Used when results exceed the threshold for Slack display (>50 rows).
     *
     * @param {Object} options - Email options
     * @param {Object} options.results - Query results object
     * @param {string} options.originalQuery - The generated query
     * @param {string} options.queryType - 'kql' or 'resourcegraph'
     * @param {string} options.userEmail - Recipient email address
     * @param {string} options.userName - User's display name
     * @param {string} options.synthesis - AI-generated analysis summary
     * @returns {Promise<Object>} Send result
     */
    async sendResultsEmail(options) {
        try {
            const response = await this.client.post('/api/query/email-results', {
                results: options.results,
                originalQuery: options.originalQuery,
                queryType: options.queryType,
                userEmail: options.userEmail,
                userName: options.userName,
                synthesis: options.synthesis
            });
            return response.data;
        } catch (error) {
            console.error('Failed to send results email:', error.message);
            return {
                success: false,
                error: 'EMAIL_FAILED',
                message: error.message
            };
        }
    }
}

module.exports = { OrchestrationClient, initializeServices };
