/**
 * @fileoverview Dynamic Query Executor Service
 *
 * This module executes validated dynamic KQL and Resource Graph queries.
 * It leverages existing authentication patterns and adds result formatting,
 * timeout management, and error handling.
 *
 * Features:
 * - KQL query execution against Log Analytics
 * - Resource Graph query execution
 * - Result limiting and pagination
 * - Execution timeout management
 * - Structured result formatting
 *
 * @version v9-dynamic-queries
 * @author VM Performance Monitoring Team
 */

const axios = require('axios');
const { ResourceGraphClient } = require('@azure/arm-resourcegraph');
const { ClientSecretCredential } = require('@azure/identity');
const { validateKqlQuery, validateResourceGraphQuery, validateExecutionOptions, createAuditLogEntry } = require('./queryValidation');

/**
 * Execute a dynamic KQL query against Log Analytics.
 *
 * @param {string} query - The KQL query to execute (will be validated)
 * @param {Object} secrets - Azure credentials from Key Vault
 * @param {Object} options - Execution options
 * @param {string} options.subscriptionId - Target subscription
 * @param {string} options.workspaceId - Log Analytics workspace ID
 * @param {string} options.tenantId - Azure AD tenant ID
 * @param {number} options.maxResults - Maximum results to return
 * @param {number} options.timeoutMs - Query timeout in milliseconds
 * @param {Object} context - Execution context for audit logging
 * @param {string} context.userId - User who initiated the query
 * @param {string} context.channel - Channel (slack, teams, api)
 * @returns {Promise<Object>} Query results
 */
async function executeDynamicKqlQuery(query, secrets, options = {}, context = {}) {
    const startTime = Date.now();

    // Validate the query
    const validation = validateKqlQuery(query);

    // Create audit log entry
    const auditEntry = createAuditLogEntry({
        query,
        queryType: 'kql',
        userId: context.userId || 'unknown',
        channel: context.channel || 'api',
        validationResult: validation
    });

    console.log(`[DynamicQuery] Audit: ${JSON.stringify(auditEntry)}`);

    if (!validation.valid) {
        return {
            success: false,
            error: 'QUERY_VALIDATION_FAILED',
            message: 'Query failed security validation',
            violations: validation.errors,
            warnings: validation.warnings,
            executionTimeMs: Date.now() - startTime
        };
    }

    // Validate and apply execution options
    const execOptions = validateExecutionOptions(options);

    // Get configuration
    const workspaceId = options.workspaceId || secrets.LogAnalyticsWorkspaceId;
    const clientId = secrets.LogAnalyticsClientId;
    const clientSecret = secrets.LogAnalyticsClientSecret;
    const tenantId = options.tenantId || secrets.LogAnalyticsTenantId;

    try {
        // Get OAuth token
        const tokenResponse = await axios.post(
            `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: clientId,
                client_secret: clientSecret,
                scope: 'https://api.loganalytics.io/.default'
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );

        const accessToken = tokenResponse.data.access_token;

        // Apply result limit to query if not already present
        let finalQuery = validation.sanitizedQuery;
        if (!finalQuery.toLowerCase().includes('| take ') &&
            !finalQuery.toLowerCase().includes('| limit ')) {
            finalQuery = `${finalQuery}\n| take ${execOptions.maxResults}`;
        }

        // Execute query
        const queryResponse = await axios.post(
            `https://api.loganalytics.io/v1/workspaces/${workspaceId}/query`,
            { query: finalQuery },
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                timeout: execOptions.timeoutMs
            }
        );

        // Parse results
        const results = parseLogAnalyticsResults(queryResponse.data);

        return {
            success: true,
            query: finalQuery,
            rowCount: results.length,
            columns: queryResponse.data.tables?.[0]?.columns?.map(c => c.name) || [],
            results: results.slice(0, execOptions.maxResults),
            truncated: results.length > execOptions.maxResults,
            warnings: validation.warnings,
            executionTimeMs: Date.now() - startTime
        };

    } catch (error) {
        console.error(`[DynamicQuery] KQL execution error:`, error.message);

        // Handle specific error types
        if (error.code === 'ECONNABORTED' || error.message.includes('timeout')) {
            return {
                success: false,
                error: 'QUERY_TIMEOUT',
                message: `Query execution timed out after ${execOptions.timeoutMs}ms`,
                executionTimeMs: Date.now() - startTime
            };
        }

        if (error.response?.status === 400) {
            return {
                success: false,
                error: 'QUERY_SYNTAX_ERROR',
                message: 'Query syntax error: ' + (error.response.data?.error?.message || 'Unknown syntax error'),
                details: error.response.data?.error,
                executionTimeMs: Date.now() - startTime
            };
        }

        if (error.response?.status === 429) {
            return {
                success: false,
                error: 'RATE_LIMIT',
                message: 'Query rate limit exceeded. Please try again later.',
                executionTimeMs: Date.now() - startTime
            };
        }

        return {
            success: false,
            error: 'QUERY_EXECUTION_FAILED',
            message: error.message,
            executionTimeMs: Date.now() - startTime
        };
    }
}

/**
 * Execute a dynamic Resource Graph query.
 *
 * @param {string} query - The Resource Graph query to execute
 * @param {Object} secrets - Azure credentials
 * @param {Object} options - Execution options
 * @param {Array<string>} options.subscriptionIds - Subscriptions to query
 * @param {string} options.tenantId - Azure AD tenant ID
 * @param {number} options.maxResults - Maximum results to return
 * @param {Object} context - Execution context for audit logging
 * @returns {Promise<Object>} Query results
 */
async function executeDynamicResourceGraphQuery(query, secrets, options = {}, context = {}) {
    const startTime = Date.now();

    // Validate the query
    const validation = validateResourceGraphQuery(query);

    // Create audit log entry
    const auditEntry = createAuditLogEntry({
        query,
        queryType: 'resourcegraph',
        userId: context.userId || 'unknown',
        channel: context.channel || 'api',
        validationResult: validation
    });

    console.log(`[DynamicQuery] Audit: ${JSON.stringify(auditEntry)}`);

    if (!validation.valid) {
        return {
            success: false,
            error: 'QUERY_VALIDATION_FAILED',
            message: 'Query failed security validation',
            violations: validation.errors,
            warnings: validation.warnings,
            executionTimeMs: Date.now() - startTime
        };
    }

    // Validate and apply execution options
    const execOptions = validateExecutionOptions(options);

    // Get configuration
    const clientId = secrets.LogAnalyticsClientId;
    const clientSecret = secrets.LogAnalyticsClientSecret;
    const tenantId = options.tenantId || secrets.LogAnalyticsTenantId;
    const subscriptionIds = options.subscriptionIds || [secrets.TargetSubscriptionId];

    try {
        // Create credential
        const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);

        // Create Resource Graph client
        const client = new ResourceGraphClient(credential);

        // Apply result limit
        let finalQuery = validation.sanitizedQuery;
        if (!finalQuery.toLowerCase().includes('| take ') &&
            !finalQuery.toLowerCase().includes('| limit ')) {
            finalQuery = `${finalQuery}\n| take ${execOptions.maxResults}`;
        }

        // Execute query
        const response = await client.resources({
            subscriptions: subscriptionIds,
            query: finalQuery
        });

        const results = response.data || [];

        return {
            success: true,
            query: finalQuery,
            rowCount: response.totalRecords || results.length,
            results: results.slice(0, execOptions.maxResults),
            truncated: results.length > execOptions.maxResults,
            warnings: validation.warnings,
            executionTimeMs: Date.now() - startTime
        };

    } catch (error) {
        console.error(`[DynamicQuery] Resource Graph execution error:`, error.message);

        if (error.code === 'InvalidQuery') {
            return {
                success: false,
                error: 'QUERY_SYNTAX_ERROR',
                message: 'Query syntax error: ' + error.message,
                executionTimeMs: Date.now() - startTime
            };
        }

        return {
            success: false,
            error: 'QUERY_EXECUTION_FAILED',
            message: error.message,
            executionTimeMs: Date.now() - startTime
        };
    }
}

/**
 * Parse Log Analytics response into array of objects.
 *
 * @param {Object} data - Raw Log Analytics response
 * @returns {Array<Object>} Array of result objects
 */
function parseLogAnalyticsResults(data) {
    const tables = data.tables;
    if (!tables || tables.length === 0) {
        return [];
    }

    const columns = tables[0].columns.map(col => col.name);
    const rows = tables[0].rows || [];

    return rows.map(row => {
        const obj = {};
        columns.forEach((col, index) => {
            obj[col] = row[index];
        });
        return obj;
    });
}

/**
 * Format query results for display (Slack or Email).
 *
 * @param {Object} queryResult - Result from query execution
 * @param {string} format - Output format ('slack' or 'email')
 * @param {number} maxRows - Maximum rows to include in formatted output
 * @returns {string} Formatted output
 */
function formatQueryResults(queryResult, format = 'slack', maxRows = 20) {
    if (!queryResult.success) {
        if (format === 'slack') {
            return `*Error:* ${queryResult.error}\n${queryResult.message}`;
        }
        return `<p><strong>Error:</strong> ${queryResult.error}</p><p>${queryResult.message}</p>`;
    }

    const results = queryResult.results.slice(0, maxRows);
    const columns = queryResult.columns || Object.keys(results[0] || {});

    if (format === 'slack') {
        return formatForSlack(results, columns, queryResult);
    } else {
        return formatForEmail(results, columns, queryResult);
    }
}

/**
 * Format results for Slack display.
 */
function formatForSlack(results, columns, queryResult) {
    if (results.length === 0) {
        return '_No results found._';
    }

    let output = `*Found ${queryResult.rowCount} result(s)* (${queryResult.executionTimeMs}ms)\n\n`;

    // For small number of columns, use inline format
    if (columns.length <= 3) {
        results.forEach((row, i) => {
            const values = columns.map(col => `${col}: \`${row[col]}\``).join(' | ');
            output += `${i + 1}. ${values}\n`;
        });
    } else {
        // For more columns, use code block
        output += '```\n';
        output += columns.join('\t') + '\n';
        output += '-'.repeat(columns.length * 12) + '\n';
        results.forEach(row => {
            output += columns.map(col => String(row[col] ?? '')).join('\t') + '\n';
        });
        output += '```';
    }

    if (queryResult.truncated) {
        output += `\n_Results truncated. ${queryResult.rowCount - results.length} more rows available._`;
    }

    return output;
}

/**
 * Format results for Email (HTML).
 */
function formatForEmail(results, columns, queryResult) {
    if (results.length === 0) {
        return '<p><em>No results found.</em></p>';
    }

    let html = `<p><strong>Found ${queryResult.rowCount} result(s)</strong> (${queryResult.executionTimeMs}ms)</p>`;

    html += '<table border="1" cellpadding="5" cellspacing="0" style="border-collapse: collapse;">';
    html += '<thead><tr>';
    columns.forEach(col => {
        html += `<th style="background-color: #f0f0f0;">${escapeHtml(col)}</th>`;
    });
    html += '</tr></thead>';

    html += '<tbody>';
    results.forEach(row => {
        html += '<tr>';
        columns.forEach(col => {
            html += `<td>${escapeHtml(String(row[col] ?? ''))}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';

    if (queryResult.truncated) {
        html += `<p><em>Results truncated. ${queryResult.rowCount - results.length} more rows available.</em></p>`;
    }

    return html;
}

/**
 * Escape HTML special characters.
 */
function escapeHtml(text) {
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return text.replace(/[&<>"']/g, m => map[m]);
}

module.exports = {
    executeDynamicKqlQuery,
    executeDynamicResourceGraphQuery,
    formatQueryResults,
    parseLogAnalyticsResults
};
