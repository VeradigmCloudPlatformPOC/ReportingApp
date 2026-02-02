/**
 * @fileoverview Tool Registry and Registration
 *
 * Registers all available tools with the Agent Service.
 * Tools are functions that the AI agent can call to interact
 * with the VM Performance orchestrator APIs.
 *
 * @version v9-dynamic-queries
 */

const createTriggerReportTool = require('./triggerReportTool');
const createQueryVMsByStatusTool = require('./queryVMsByStatusTool');
const createSearchVMsTool = require('./searchVMsTool');
const createInvestigateVMTool = require('./investigateVMTool');
const createQueryInventoryTool = require('./queryInventoryTool');
const createCrossTenantSummaryTool = require('./crossTenantSummaryTool');
const {
    DYNAMIC_QUERY_TOOL_DEFINITION,
    GENERATE_KQL_TOOL_DEFINITION,
    GENERATE_RESOURCEGRAPH_TOOL_DEFINITION,
    createDynamicQueryTool,
    createGenerateKqlTool,
    createGenerateResourceGraphTool
} = require('./dynamicQueryTool');

/**
 * Register all tools with the agent service.
 *
 * @param {AgentService} agentService - The agent service instance
 * @param {Object} orchestrationClient - The orchestration client for API calls
 * @param {Object} aiClient - Optional Azure OpenAI client for dynamic query generation
 */
function registerAllTools(agentService, orchestrationClient, aiClient = null) {
    // Trigger Performance Report Tool
    agentService.registerToolHandler(
        'trigger_performance_report',
        createTriggerReportTool(orchestrationClient)
    );

    // Query VMs by Status Tool
    agentService.registerToolHandler(
        'query_vms_by_status',
        createQueryVMsByStatusTool(orchestrationClient)
    );

    // Search VMs Tool
    agentService.registerToolHandler(
        'search_vms',
        createSearchVMsTool(orchestrationClient)
    );

    // Investigate VM Tool
    agentService.registerToolHandler(
        'investigate_vm',
        createInvestigateVMTool(orchestrationClient)
    );

    // Query Inventory Tool
    agentService.registerToolHandler(
        'query_inventory',
        createQueryInventoryTool(orchestrationClient)
    );

    // Cross-Tenant Summary Tool
    agentService.registerToolHandler(
        'get_cross_tenant_summary',
        createCrossTenantSummaryTool(orchestrationClient)
    );

    // Dynamic Query Tools (require AI client for query generation)
    if (aiClient) {
        // Main dynamic query tool - handles both KQL and Resource Graph
        agentService.registerToolHandler(
            'execute_dynamic_query',
            createDynamicQueryTool(orchestrationClient, aiClient)
        );

        // KQL query generation only (no execution)
        agentService.registerToolHandler(
            'generate_kql_query',
            createGenerateKqlTool(aiClient)
        );

        // Resource Graph query generation only (no execution)
        agentService.registerToolHandler(
            'generate_resourcegraph_query',
            createGenerateResourceGraphTool(aiClient)
        );

        console.log('Dynamic query tools registered (AI-powered query generation enabled)');
    } else {
        console.warn('Dynamic query tools NOT registered - AI client not provided');
    }

    console.log('All agent tools registered successfully');
}

/**
 * Get tool definitions for AI Foundry agent configuration.
 * These definitions should match what's configured in the AI Foundry portal.
 *
 * @returns {Array} Array of tool definitions in OpenAI function format
 */
function getToolDefinitions() {
    return [
        {
            type: 'function',
            function: {
                name: 'trigger_performance_report',
                description: 'Trigger a new VM performance analysis report. The report will analyze all VMs across configured tenants and identify optimization opportunities. This is a long-running operation that may take several minutes.',
                parameters: {
                    type: 'object',
                    properties: {
                        tenant_name: {
                            type: 'string',
                            description: 'Optional: specific tenant to analyze. If not provided, analyzes all tenants.'
                        },
                        days: {
                            type: 'integer',
                            description: 'Number of days of metrics to analyze (default: 30)',
                            default: 30
                        }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'query_vms_by_status',
                description: 'Get VMs filtered by their performance status from the most recent analysis. Returns VM details including current size, metrics, and recommendations.',
                parameters: {
                    type: 'object',
                    properties: {
                        status: {
                            type: 'string',
                            enum: ['UNDERUTILIZED', 'OVERUTILIZED', 'OPTIMAL', 'NEEDS_REVIEW'],
                            description: 'The performance status to filter by'
                        },
                        limit: {
                            type: 'integer',
                            description: 'Maximum number of VMs to return (default: 10)',
                            default: 10
                        }
                    },
                    required: ['status']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'search_vms',
                description: 'Search for VMs by name pattern from the most recent analysis. Returns matching VMs with their performance status and recommendations.',
                parameters: {
                    type: 'object',
                    properties: {
                        pattern: {
                            type: 'string',
                            description: 'Search pattern (e.g., "prod", "vm-db-", "app-server"). Case-insensitive partial match.'
                        }
                    },
                    required: ['pattern']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'investigate_vm',
                description: 'Get detailed investigation of why a specific VM is flagged with its current status. Provides comprehensive metrics, AI analysis, and specific recommendations.',
                parameters: {
                    type: 'object',
                    properties: {
                        vm_name: {
                            type: 'string',
                            description: 'The exact name of the VM to investigate'
                        }
                    },
                    required: ['vm_name']
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'query_inventory',
                description: 'Query the current VM inventory from Azure Resource Graph. Returns VMs with their configuration (size, location, tags) but not performance metrics.',
                parameters: {
                    type: 'object',
                    properties: {
                        tenant_name: {
                            type: 'string',
                            description: 'Filter by tenant name'
                        },
                        location: {
                            type: 'string',
                            description: 'Filter by Azure region (e.g., westus2, eastus, centralus)'
                        },
                        tag_key: {
                            type: 'string',
                            description: 'Filter by tag key (requires tag_value)'
                        },
                        tag_value: {
                            type: 'string',
                            description: 'Filter by tag value (requires tag_key)'
                        },
                        size_pattern: {
                            type: 'string',
                            description: 'Filter by VM size pattern (e.g., "Standard_D", "Standard_E", "B-series")'
                        }
                    }
                }
            }
        },
        {
            type: 'function',
            function: {
                name: 'get_cross_tenant_summary',
                description: 'Get a summary of VM performance across all configured tenants. Shows VM counts, utilization breakdown, and potential optimization opportunities.',
                parameters: {
                    type: 'object',
                    properties: {}
                }
            }
        },
        // Dynamic Query Tools (v9)
        DYNAMIC_QUERY_TOOL_DEFINITION,
        GENERATE_KQL_TOOL_DEFINITION,
        GENERATE_RESOURCEGRAPH_TOOL_DEFINITION
    ];
}

module.exports = {
    registerAllTools,
    getToolDefinitions
};
