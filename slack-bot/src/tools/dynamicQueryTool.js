/**
 * @fileoverview Dynamic Query Tool for AI Agent
 *
 * This tool allows the AI agent to execute dynamically generated KQL
 * and Resource Graph queries against Azure resources. The agent generates
 * queries based on user's natural language requests.
 *
 * Features:
 * - KQL query generation and execution for performance metrics
 * - Resource Graph query generation and execution for inventory
 * - Result synthesis into human-readable format
 * - Auto-detect delivery (Slack vs Email based on result size)
 *
 * @version v9-dynamic-queries
 * @author VM Performance Monitoring Team
 */

const {
    KQL_GENERATION_SYSTEM_PROMPT,
    RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT,
    RESULT_SYNTHESIS_SYSTEM_PROMPT,
    createKqlGenerationPrompt,
    createResourceGraphGenerationPrompt,
    createResultSynthesisPrompt,
    determineQueryType
} = require('../prompts/queryPrompts');

/**
 * Tool definition for execute_dynamic_query.
 * This is the main tool that handles both KQL and Resource Graph queries.
 */
const DYNAMIC_QUERY_TOOL_DEFINITION = {
    type: 'function',
    function: {
        name: 'execute_dynamic_query',
        description: `Execute a dynamic query against Azure resources based on user's natural language request.
Use this tool when the user asks questions about:
- VM performance metrics (CPU, memory, disk usage over time)
- VM inventory (list VMs, count by location, filter by tags)
- Resource configurations and status

The tool will:
1. Determine if this is a performance query (KQL) or inventory query (Resource Graph)
2. Generate the appropriate query
3. Execute it against Azure
4. Synthesize results into a readable format`,
        parameters: {
            type: 'object',
            properties: {
                user_request: {
                    type: 'string',
                    description: 'The user\'s natural language query about VMs or Azure resources'
                },
                query_type_hint: {
                    type: 'string',
                    enum: ['kql', 'resourcegraph', 'auto'],
                    description: 'Hint for query type: kql for performance/metrics, resourcegraph for inventory. Use auto to let the system decide.'
                },
                time_range_days: {
                    type: 'integer',
                    description: 'Time range in days for KQL queries (default: 7)',
                    default: 7
                },
                max_results: {
                    type: 'integer',
                    description: 'Maximum number of results to return (default: 50)',
                    default: 50
                }
            },
            required: ['user_request']
        }
    }
};

/**
 * Tool definition for generate_kql_query.
 * This tool only generates the query without executing it.
 */
const GENERATE_KQL_TOOL_DEFINITION = {
    type: 'function',
    function: {
        name: 'generate_kql_query',
        description: 'Generate a KQL query from a natural language request without executing it. Useful for previewing or explaining queries.',
        parameters: {
            type: 'object',
            properties: {
                user_request: {
                    type: 'string',
                    description: 'The user\'s natural language query about VM performance'
                },
                time_range_days: {
                    type: 'integer',
                    description: 'Time range in days (default: 7)',
                    default: 7
                }
            },
            required: ['user_request']
        }
    }
};

/**
 * Tool definition for generate_resourcegraph_query.
 */
const GENERATE_RESOURCEGRAPH_TOOL_DEFINITION = {
    type: 'function',
    function: {
        name: 'generate_resourcegraph_query',
        description: 'Generate an Azure Resource Graph query from a natural language request without executing it.',
        parameters: {
            type: 'object',
            properties: {
                user_request: {
                    type: 'string',
                    description: 'The user\'s natural language query about VM inventory'
                }
            },
            required: ['user_request']
        }
    }
};

/**
 * Create the execute_dynamic_query tool handler.
 *
 * @param {Object} orchestrationClient - Client for calling orchestrator APIs
 * @param {Object} aiClient - Client for calling Azure OpenAI
 * @returns {Function} Tool handler function
 */
function createDynamicQueryTool(orchestrationClient, aiClient) {
    return async function executeDynamicQuery({
        user_request,
        query_type_hint = 'auto',
        time_range_days = 7,
        max_results = 50
    }, context = {}) {
        try {
            // Step 1: Determine query type
            let queryType = query_type_hint;
            if (queryType === 'auto') {
                queryType = determineQueryType(user_request);
                if (queryType === 'unknown') {
                    queryType = 'kql'; // Default to KQL for ambiguous requests
                }
            }

            console.log(`[DynamicQueryTool] Query type: ${queryType} for request: "${user_request.substring(0, 50)}..."`);

            // Step 2: Generate the query using AI
            let generatedQuery;
            if (queryType === 'kql') {
                generatedQuery = await generateKqlQuery(aiClient, user_request, {
                    subscriptionId: context.subscriptionId,
                    defaultDays: time_range_days
                });
            } else {
                generatedQuery = await generateResourceGraphQuery(aiClient, user_request, {
                    subscriptionId: context.subscriptionId
                });
            }

            // Check for generation errors
            if (generatedQuery.startsWith('ERROR:')) {
                return {
                    success: false,
                    error: 'QUERY_GENERATION_FAILED',
                    message: generatedQuery,
                    queryType
                };
            }

            console.log(`[DynamicQueryTool] Generated query:\n${generatedQuery}`);

            // Step 3: Execute the query
            let result;
            if (queryType === 'kql') {
                result = await orchestrationClient.executeDynamicKql(generatedQuery, {
                    maxResults: max_results,
                    userId: context.userId,
                    channel: context.channel,
                    // Pass subscription/tenant context for workspace lookup
                    subscriptionId: context.subscriptionId,
                    tenantId: context.tenantId
                });
            } else {
                result = await orchestrationClient.executeDynamicResourceGraph(generatedQuery, {
                    maxResults: max_results,
                    userId: context.userId,
                    channel: context.channel,
                    // Pass subscription/tenant context for Resource Graph scoping
                    subscriptionIds: context.subscriptionId ? [context.subscriptionId] : undefined,
                    tenantId: context.tenantId
                });
            }

            if (!result.success) {
                return {
                    success: false,
                    error: result.error,
                    message: result.message,
                    queryType,
                    generatedQuery
                };
            }

            // Step 4: Synthesize results
            const synthesis = await synthesizeResults(
                aiClient,
                user_request,
                queryType,
                result,
                context.channel || 'slack'
            );

            // Step 5: Determine delivery method based on result size
            const LARGE_RESULT_THRESHOLD = 50;
            const deliveryMethod = result.rowCount > LARGE_RESULT_THRESHOLD ? 'email' : 'slack';

            // Step 6: If large result set, send full results via email
            let emailSent = false;
            let emailError = null;
            if (deliveryMethod === 'email' && context.userEmail) {
                console.log(`[DynamicQueryTool] Large result set (${result.rowCount} rows) - sending email to ${context.userEmail}`);
                try {
                    const emailResult = await orchestrationClient.sendResultsEmail({
                        results: result,
                        originalQuery: generatedQuery,
                        queryType,
                        userEmail: context.userEmail,
                        userName: context.userName || context.userId || 'User',
                        synthesis
                    });
                    emailSent = emailResult.success;
                    if (!emailResult.success) {
                        emailError = emailResult.message;
                    }
                } catch (err) {
                    console.error('[DynamicQueryTool] Failed to send email:', err.message);
                    emailError = err.message;
                }
            } else if (deliveryMethod === 'email' && !context.userEmail) {
                console.warn('[DynamicQueryTool] Large result set but no user email provided - cannot send email');
                emailError = 'User email not available';
            }

            return {
                success: true,
                queryType,
                generatedQuery,
                rowCount: result.rowCount,
                deliveryMethod,
                emailSent,
                emailError,
                synthesis,
                results: result.results.slice(0, 20), // Include first 20 for Slack reference
                executionTimeMs: result.executionTimeMs,
                warnings: result.warnings
            };

        } catch (error) {
            console.error('[DynamicQueryTool] Error:', error);
            return {
                success: false,
                error: 'TOOL_EXECUTION_FAILED',
                message: error.message
            };
        }
    };
}

/**
 * Generate a KQL query using Azure OpenAI.
 *
 * @param {Object} aiClient - Azure OpenAI client
 * @param {string} userRequest - User's natural language request
 * @param {Object} context - Context including subscriptionId
 * @returns {Promise<string>} Generated KQL query
 */
async function generateKqlQuery(aiClient, userRequest, context = {}) {
    const userPrompt = createKqlGenerationPrompt(userRequest, context);

    const response = await aiClient.chat.completions.create({
        model: aiClient.deploymentName || 'gpt-4',
        messages: [
            { role: 'system', content: KQL_GENERATION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1000,
        temperature: 0.3 // Lower temperature for more consistent query generation
    });

    return response.choices[0]?.message?.content?.trim() || 'ERROR: No query generated';
}

/**
 * Generate a Resource Graph query using Azure OpenAI.
 *
 * @param {Object} aiClient - Azure OpenAI client
 * @param {string} userRequest - User's natural language request
 * @param {Object} context - Context including subscriptionId
 * @returns {Promise<string>} Generated Resource Graph query
 */
async function generateResourceGraphQuery(aiClient, userRequest, context = {}) {
    const userPrompt = createResourceGraphGenerationPrompt(userRequest, context);

    const response = await aiClient.chat.completions.create({
        model: aiClient.deploymentName || 'gpt-4',
        messages: [
            { role: 'system', content: RESOURCE_GRAPH_GENERATION_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1000,
        temperature: 0.3
    });

    return response.choices[0]?.message?.content?.trim() || 'ERROR: No query generated';
}

/**
 * Synthesize query results into human-readable format.
 *
 * @param {Object} aiClient - Azure OpenAI client
 * @param {string} originalRequest - User's original request
 * @param {string} queryType - 'kql' or 'resourcegraph'
 * @param {Object} results - Query results
 * @param {string} channelType - 'slack' or 'email'
 * @returns {Promise<string>} Synthesized response
 */
async function synthesizeResults(aiClient, originalRequest, queryType, results, channelType = 'slack') {
    // If no results, return a simple message
    if (!results.results || results.results.length === 0) {
        return 'No results found for your query.';
    }

    const userPrompt = createResultSynthesisPrompt(originalRequest, queryType, results, channelType);

    const response = await aiClient.chat.completions.create({
        model: aiClient.deploymentName || 'gpt-4',
        messages: [
            { role: 'system', content: RESULT_SYNTHESIS_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
        ],
        max_completion_tokens: 1500,
        temperature: 0.5
    });

    return response.choices[0]?.message?.content?.trim() || formatFallbackSynthesis(results);
}

/**
 * Fallback synthesis when AI synthesis fails.
 *
 * @param {Object} results - Query results
 * @returns {string} Simple formatted response
 */
function formatFallbackSynthesis(results) {
    if (!results.results || results.results.length === 0) {
        return '_No results found._';
    }

    let output = `*Found ${results.rowCount} result(s)*\n\n`;

    const columns = results.columns || Object.keys(results.results[0]);
    const displayResults = results.results.slice(0, 10);

    displayResults.forEach((row, i) => {
        const values = columns.slice(0, 3).map(col => `${col}: \`${row[col]}\``).join(' | ');
        output += `${i + 1}. ${values}\n`;
    });

    if (results.rowCount > 10) {
        output += `\n_...and ${results.rowCount - 10} more results._`;
    }

    return output;
}

/**
 * Create tool handler for generate_kql_query (generation only, no execution).
 */
function createGenerateKqlTool(aiClient) {
    return async function generateKql({ user_request, time_range_days = 7 }, context = {}) {
        try {
            const query = await generateKqlQuery(aiClient, user_request, {
                subscriptionId: context.subscriptionId,
                defaultDays: time_range_days
            });

            return {
                success: !query.startsWith('ERROR:'),
                query,
                queryType: 'kql'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    };
}

/**
 * Create tool handler for generate_resourcegraph_query (generation only).
 */
function createGenerateResourceGraphTool(aiClient) {
    return async function generateResourceGraph({ user_request }, context = {}) {
        try {
            const query = await generateResourceGraphQuery(aiClient, user_request, {
                subscriptionId: context.subscriptionId
            });

            return {
                success: !query.startsWith('ERROR:'),
                query,
                queryType: 'resourcegraph'
            };
        } catch (error) {
            return {
                success: false,
                error: error.message
            };
        }
    };
}

module.exports = {
    DYNAMIC_QUERY_TOOL_DEFINITION,
    GENERATE_KQL_TOOL_DEFINITION,
    GENERATE_RESOURCEGRAPH_TOOL_DEFINITION,
    createDynamicQueryTool,
    createGenerateKqlTool,
    createGenerateResourceGraphTool,
    generateKqlQuery,
    generateResourceGraphQuery,
    synthesizeResults,
    determineQueryType
};
