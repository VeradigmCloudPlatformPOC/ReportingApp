/**
 * @fileoverview Orchestration Client Service
 *
 * HTTP client with smart routing to microservices:
 * - App 1: Resource Graph Service (VM inventory, search, summary)
 * - App 2: Short-Term Log Analytics (KQL queries ≤10 days)
 * - App 3: Long-Term Log Analytics + AI (queries >10 days, reports)
 * - Legacy: Old orchestrator (for features not yet migrated)
 *
 * @version v11-microservices
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');

// Service URLs (set from environment or config)
let serviceUrls = {
    resourceGraph: null,    // App 1
    shortTermLA: null,      // App 2
    longTermLA: null,       // App 3
    orchestrator: null      // Legacy (fallback)
};

/**
 * Initialize the orchestration client services.
 *
 * @param {Object} config - Configuration object
 */
async function initializeServices(config) {
    serviceUrls = {
        resourceGraph: config.resourceGraphUrl || process.env.RESOURCE_GRAPH_SERVICE_URL,
        shortTermLA: config.shortTermLAUrl || process.env.SHORT_TERM_LA_SERVICE_URL,
        longTermLA: config.longTermLAUrl || process.env.LONG_TERM_LA_SERVICE_URL,
        orchestrator: config.orchestratorUrl || process.env.ORCHESTRATOR_URL
    };

    console.log('[OrchestrationClient] Initialized with services:');
    console.log(`  Resource Graph (App 1): ${serviceUrls.resourceGraph || 'not configured'}`);
    console.log(`  Short-Term LA (App 2): ${serviceUrls.shortTermLA || 'not configured'}`);
    console.log(`  Long-Term LA (App 3): ${serviceUrls.longTermLA || 'not configured'}`);
    console.log(`  Legacy Orchestrator: ${serviceUrls.orchestrator || 'not configured'}`);
}

class OrchestrationClient {
    /**
     * Create an OrchestrationClient instance.
     *
     * @param {string} baseUrl - Legacy orchestrator URL (for backward compatibility)
     */
    constructor(baseUrl) {
        // Legacy orchestrator URL
        this.baseUrl = baseUrl || serviceUrls.orchestrator || 'http://localhost:3000';

        // Create axios clients for each service
        this.clients = {
            resourceGraph: this._createClient(serviceUrls.resourceGraph, 30000),
            shortTermLA: this._createClient(serviceUrls.shortTermLA, 90000),
            longTermLA: this._createClient(serviceUrls.longTermLA, 120000),
            orchestrator: this._createClient(this.baseUrl, 60000)
        };
    }

    /**
     * Create an axios client instance.
     */
    _createClient(baseUrl, timeout) {
        if (!baseUrl) return null;
        return axios.create({
            baseURL: baseUrl,
            timeout,
            headers: { 'Content-Type': 'application/json' }
        });
    }

    /**
     * Get the appropriate client, falling back to orchestrator if service not available.
     */
    _getClient(serviceName) {
        const client = this.clients[serviceName];
        if (client) return client;
        console.warn(`[OrchestrationClient] ${serviceName} not configured, falling back to orchestrator`);
        return this.clients.orchestrator;
    }

    // =========================================================================
    // APP 1: RESOURCE GRAPH SERVICE
    // =========================================================================

    /**
     * Get VM inventory with optional filters.
     * Routes to: App 1 (Resource Graph Service)
     */
    async getInventory(filters = {}) {
        const client = this._getClient('resourceGraph');
        if (!client) {
            throw new Error('No service configured for inventory');
        }

        try {
            // Try new App 1 endpoint
            if (this.clients.resourceGraph) {
                const response = await this.clients.resourceGraph.post('/api/resources/vms', {
                    tenantId: filters.tenantName,
                    subscriptionId: filters.subscriptionId,
                    location: filters.location,
                    includeNetwork: filters.includeNetwork
                });
                return response.data;
            }
            // Fallback to legacy
            const response = await this.clients.orchestrator.get('/api/inventory', {
                params: { ...filters, includeNetwork: filters.includeNetwork ? 'true' : undefined }
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getInventory error:', error.message);
            throw error;
        }
    }

    /**
     * Search VMs by name pattern.
     * Routes to: App 1 (Resource Graph Service)
     */
    async searchVMs(pattern) {
        try {
            if (this.clients.resourceGraph) {
                const response = await this.clients.resourceGraph.post('/api/resources/search', {
                    pattern
                });
                return response.data;
            }
            // Fallback to legacy
            const response = await this.clients.orchestrator.get('/api/vms/search', {
                params: { q: pattern }
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] searchVMs error:', error.message);
            return { vms: [], rowCount: 0 };
        }
    }

    /**
     * Get cross-tenant summary.
     * Routes to: App 1 (Resource Graph Service)
     */
    async getCrosstenantSummary() {
        try {
            if (this.clients.resourceGraph) {
                const response = await this.clients.resourceGraph.get('/api/resources/summary/cross-tenant');
                return response.data;
            }
            // Fallback to legacy
            const response = await this.clients.orchestrator.get('/api/summary');
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getCrosstenantSummary error:', error.message);
            throw error;
        }
    }

    /**
     * Get summary grouped by location, resource group, or size.
     * Routes to: App 1 (Resource Graph Service)
     */
    async getSummary(groupBy = 'location', filters = {}) {
        try {
            if (this.clients.resourceGraph) {
                const response = await this.clients.resourceGraph.post('/api/resources/summary', {
                    groupBy,
                    tenantId: filters.tenantId,
                    subscriptionId: filters.subscriptionId
                });
                return response.data;
            }
            // Fallback to legacy
            const response = await this.clients.orchestrator.get('/api/summary');
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getSummary error:', error.message);
            throw error;
        }
    }

    /**
     * Get all subscriptions across all tenants.
     * Routes to: Legacy Orchestrator (has complete tenant config)
     * TODO: Move to App 1 once tenant config is migrated
     */
    async getSubscriptions() {
        try {
            // Use legacy orchestrator for subscriptions (has full tenant config)
            const response = await this.clients.orchestrator.get('/api/subscriptions');
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getSubscriptions error:', error.message);
            throw error;
        }
    }

    /**
     * Search subscriptions by name pattern.
     * Routes to: Legacy Orchestrator (has complete tenant config)
     */
    async searchSubscriptions(query) {
        try {
            // Use legacy orchestrator for subscription search (has full tenant config)
            const response = await this.clients.orchestrator.get('/api/subscriptions/search', {
                params: { q: query }
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] searchSubscriptions error:', error.message);
            return { subscriptions: [] };
        }
    }

    /**
     * Get tenants.
     * Routes to: App 1 (Resource Graph Service)
     */
    async getTenants(enabledOnly = true) {
        try {
            if (this.clients.resourceGraph) {
                const response = await this.clients.resourceGraph.get('/api/tenants');
                return response.data;
            }
            // Fallback to legacy
            const response = await this.clients.orchestrator.get('/api/tenants', {
                params: { enabledOnly }
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getTenants error:', error.message);
            throw error;
        }
    }

    // =========================================================================
    // APP 2: SHORT-TERM LOG ANALYTICS SERVICE (≤10 days)
    // =========================================================================

    /**
     * Execute a dynamic KQL query.
     * Routes to: App 2 for ≤10 days, App 3 for >10 days
     */
    async executeDynamicKql(query, options = {}) {
        try {
            // Check query time range to determine routing
            const daysMatch = query.match(/ago\s*\(\s*(\d+)\s*d\s*\)/i);
            const queryDays = daysMatch ? parseInt(daysMatch[1]) : 7;

            // Route to App 2 for short queries (≤10 days)
            if (queryDays <= 10 && this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.post('/api/query/kql', {
                    query,
                    options: {
                        tenantId: options.tenantId,
                        subscriptionId: options.subscriptionId,
                        workspaceId: options.workspaceId,
                        maxResults: options.maxResults || 1000
                    },
                    format: 'json'
                }, {
                    headers: {
                        'X-User-Id': options.userId || 'unknown',
                        'X-Channel': options.channel || 'slack'
                    }
                });
                return response.data;
            }

            // Route to App 3 for long queries (>10 days) - if available
            if (this.clients.longTermLA) {
                // TODO: Implement when App 3 is ready
                console.log('[OrchestrationClient] Long-term query - routing to App 3 (not yet implemented)');
            }

            // Fallback to legacy orchestrator
            const response = await this.clients.orchestrator.post('/api/query/dynamic-kql', {
                query,
                subscriptionId: options.subscriptionId,
                workspaceId: options.workspaceId,
                tenantId: options.tenantId,
                maxResults: options.maxResults || 1000,
                timeoutMs: options.timeoutMs || 60000,
                userId: options.userId,
                channel: options.channel || 'slack'
            }, {
                timeout: Math.min(options.timeoutMs || 60000, 300000) + 5000
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
     * Get VM performance metrics.
     * Routes to: App 2 (Short-Term Log Analytics)
     */
    async getVMMetrics(vmName, days = 7, options = {}) {
        try {
            if (this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.get(`/api/metrics/vm/${encodeURIComponent(vmName)}`, {
                    params: {
                        days: Math.min(days, 10),
                        tenantId: options.tenantId,
                        subscriptionId: options.subscriptionId
                    }
                });
                return response.data;
            }
            // No fallback for this new endpoint
            return { success: false, error: 'Short-term LA service not configured' };
        } catch (error) {
            console.error('[OrchestrationClient] getVMMetrics error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get VMs with high resource usage.
     * Routes to: App 2 (Short-Term Log Analytics)
     */
    async getHighUsageVMs(metric = 'cpu', threshold = 80, days = 7, options = {}) {
        try {
            if (this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.get('/api/metrics/high-usage', {
                    params: {
                        metric,
                        threshold,
                        days: Math.min(days, 10),
                        tenantId: options.tenantId,
                        subscriptionId: options.subscriptionId
                    }
                });
                return response.data;
            }
            // No fallback for this new endpoint
            return { success: false, error: 'Short-term LA service not configured' };
        } catch (error) {
            console.error('[OrchestrationClient] getHighUsageVMs error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get VM heartbeat/availability data.
     * Routes to: App 2 (Short-Term Log Analytics)
     */
    async getHeartbeat(hours = 24, options = {}) {
        try {
            if (this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.get('/api/heartbeat', {
                    params: {
                        hours: Math.min(hours, 240), // Max 10 days
                        tenantId: options.tenantId
                    }
                });
                return response.data;
            }
            return { success: false, error: 'Short-term LA service not configured' };
        } catch (error) {
            console.error('[OrchestrationClient] getHeartbeat error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Validate a KQL query without executing.
     * Routes to: App 2 (Short-Term Log Analytics)
     */
    async validateKqlQuery(query) {
        try {
            if (this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.post('/api/query/validate', { query });
                return response.data;
            }
            // No validation in legacy - assume valid
            return { valid: true, errors: [], warnings: [] };
        } catch (error) {
            console.error('[OrchestrationClient] validateKqlQuery error:', error.message);
            return { valid: false, errors: [error.message], warnings: [] };
        }
    }

    // =========================================================================
    // LEGACY ORCHESTRATOR METHODS (for features not yet migrated)
    // =========================================================================

    /**
     * Trigger a new orchestration run.
     * Routes to: Legacy Orchestrator (will be App 3)
     */
    async triggerOrchestration(options = {}) {
        try {
            const response = await this.clients.orchestrator.post('/api/orchestrate', {
                channelId: options.channelId,
                requestedBy: options.requestedBy,
                requestedByEmail: options.requestedByEmail,
                subscriptionId: options.subscriptionId,
                tenantId: options.tenantId,
                tenantName: options.tenantName,
                days: options.days || 30,
                callbackUrl: options.callbackUrl
            }, {
                timeout: 300000
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] triggerOrchestration error:', error.message);
            throw new Error(`Orchestration failed: ${error.response?.data?.message || error.message}`);
        }
    }

    /**
     * Get status of a run.
     */
    async getRunStatus(runId) {
        try {
            const response = await this.clients.orchestrator.get(`/api/runs/${runId}/status`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return { status: 'NOT_FOUND' };
            }
            throw error;
        }
    }

    /**
     * Get the latest run.
     */
    async getLatestRun(subscriptionId = 'all') {
        try {
            const response = await this.clients.orchestrator.get('/api/runs/latest', {
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
     */
    async getVMsByStatus(status, subscriptionId = null) {
        try {
            const params = subscriptionId ? { subscriptionId } : {};
            const response = await this.clients.orchestrator.get(`/api/vms/status/${status}`, { params });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] getVMsByStatus error:', error.message);
            throw error;
        }
    }

    /**
     * Get details for a specific VM (from analysis).
     */
    async getVMDetails(vmName) {
        try {
            const response = await this.clients.orchestrator.get(`/api/vms/${encodeURIComponent(vmName)}`);
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Get report download links.
     */
    async getReportDownloads(subscriptionId = null, expiryHours = 1) {
        try {
            const params = {};
            if (subscriptionId) params.subscriptionId = subscriptionId;
            if (expiryHours) params.expiryHours = Math.min(expiryHours, 24);

            const response = await this.clients.orchestrator.get('/api/reports/latest/download', { params });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return { error: 'No reports found', downloads: null };
            }
            throw error;
        }
    }

    /**
     * Get run summary.
     */
    async getRunSummary(subscriptionId = null) {
        try {
            const params = subscriptionId ? { subscriptionId } : {};
            const response = await this.clients.orchestrator.get('/api/runs/latest/summary', { params });
            return response.data;
        } catch (error) {
            if (error.response?.status === 404) {
                return null;
            }
            throw error;
        }
    }

    /**
     * Execute a dynamic Resource Graph query.
     */
    async executeDynamicResourceGraph(query, options = {}) {
        try {
            const response = await this.clients.orchestrator.post('/api/query/dynamic-resourcegraph', {
                query,
                subscriptionIds: options.subscriptionIds,
                tenantId: options.tenantId,
                maxResults: options.maxResults || 1000,
                userId: options.userId,
                channel: options.channel || 'slack'
            }, {
                timeout: 65000
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
     * Format query results.
     */
    async formatQueryResults(results, format = 'slack', maxRows = 20) {
        try {
            // Try App 2 first for formatting
            if (this.clients.shortTermLA) {
                const response = await this.clients.shortTermLA.post('/api/format', {
                    results,
                    format,
                    maxRows
                });
                return response.data;
            }
            // Fallback to orchestrator
            const response = await this.clients.orchestrator.post('/api/query/format', {
                results,
                format,
                maxRows
            });
            return response.data;
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    /**
     * Send query results via email.
     */
    async sendResultsEmail(options) {
        try {
            const response = await this.clients.orchestrator.post('/api/query/email-results', {
                results: options.results,
                originalQuery: options.originalQuery,
                queryType: options.queryType,
                userEmail: options.userEmail,
                userName: options.userName,
                synthesis: options.synthesis
            });
            return response.data;
        } catch (error) {
            console.error('[OrchestrationClient] sendResultsEmail error:', error.message);
            return { success: false, error: 'EMAIL_FAILED', message: error.message };
        }
    }

    /**
     * Health check for all services.
     */
    async healthCheck() {
        const results = {
            resourceGraph: false,
            shortTermLA: false,
            longTermLA: false,
            orchestrator: false
        };

        const checks = Object.entries(this.clients).map(async ([name, client]) => {
            if (!client) return;
            try {
                const response = await client.get('/health', { timeout: 5000 });
                results[name] = response.data?.status === 'healthy';
            } catch {
                results[name] = false;
            }
        });

        await Promise.all(checks);
        return results;
    }
}

module.exports = { OrchestrationClient, initializeServices };
