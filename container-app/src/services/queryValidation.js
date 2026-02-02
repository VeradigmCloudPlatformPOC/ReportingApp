/**
 * @fileoverview Query Validation Service
 *
 * This module provides comprehensive validation for AI-generated KQL and
 * Resource Graph queries before execution. It implements multiple security
 * layers to prevent injection attacks and dangerous operations.
 *
 * Security Controls:
 * - Table whitelist enforcement
 * - Dangerous operation blocking
 * - Injection pattern detection
 * - Comment stripping and sanitization
 * - Multi-statement prevention
 *
 * @version v9-dynamic-queries
 * @author VM Performance Monitoring Team
 */

/**
 * Allowed KQL tables for performance monitoring queries.
 * Only these tables can be queried through the dynamic query endpoint.
 */
const ALLOWED_KQL_TABLES = [
    'Perf',
    'Heartbeat',
    'AzureDiagnostics',
    'InsightsMetrics',
    'VMProcess',
    'VMConnection',
    'VMBoundPort',
    'Event',
    'Syslog',
    'AzureMetrics'
];

/**
 * Dangerous KQL operations that could modify data or execute code.
 * These patterns are blocked regardless of context.
 */
const DANGEROUS_KQL_PATTERNS = [
    { pattern: /\.delete\b/i, description: 'delete operation' },
    { pattern: /\.set\s+/i, description: 'set operation' },
    { pattern: /\.append\s+/i, description: 'append operation' },
    { pattern: /\.ingest\s+/i, description: 'ingest operation' },
    { pattern: /\.create\s+/i, description: 'create operation' },
    { pattern: /\.alter\s+/i, description: 'alter operation' },
    { pattern: /\.drop\s+/i, description: 'drop operation' },
    { pattern: /\.execute\s+/i, description: 'execute plugin (code execution)' },
    { pattern: /external_data\s*\(/i, description: 'external data access' },
    { pattern: /\.set-or-append\s+/i, description: 'set-or-append operation' },
    { pattern: /\.set-or-replace\s+/i, description: 'set-or-replace operation' },
    { pattern: /materialize\s*\(/i, description: 'materialize (resource intensive)' },
    { pattern: /\bunion\s+\*/i, description: 'unrestricted union (security risk)' }
];

/**
 * Patterns that may indicate injection attempts.
 * These generate warnings but may not block the query.
 */
const INJECTION_PATTERNS = [
    { pattern: /'\s*;\s*/g, description: 'quote followed by semicolon' },
    { pattern: /'\s*\|\s*union\s/i, description: 'quote followed by union' },
    { pattern: /\bunion\s+\*/i, description: 'unrestricted union' },
    { pattern: /\bprint\s+/i, description: 'print command' },
    { pattern: /toscalar\s*\([^)]*getschema/i, description: 'schema exfiltration' },
    { pattern: /;\s*\w+\s*\|/i, description: 'multiple statements' }
];

/**
 * Allowed Resource Graph resource types.
 */
const ALLOWED_RESOURCE_TYPES = [
    'microsoft.compute/virtualmachines',
    'microsoft.compute/virtualmachinescalesets',
    'microsoft.compute/disks',
    'microsoft.network/networkinterfaces',
    'microsoft.network/publicipaddresses',
    'microsoft.network/virtualnetworks',
    'microsoft.storage/storageaccounts',
    'microsoft.resources/subscriptions',
    'microsoft.resources/resourcegroups'
];

/**
 * Validates a KQL query for security and correctness.
 *
 * @param {string} query - The KQL query to validate
 * @param {Object} options - Validation options
 * @param {boolean} options.requireTimeFilter - Require time filter (default: true)
 * @param {number} options.maxQueryLength - Maximum query length (default: 10000)
 * @returns {Object} Validation result
 * @returns {boolean} result.valid - Whether the query passed validation
 * @returns {Array} result.errors - Array of error messages
 * @returns {Array} result.warnings - Array of warning messages
 * @returns {string|null} result.sanitizedQuery - Sanitized query or null if invalid
 */
function validateKqlQuery(query, options = {}) {
    const {
        requireTimeFilter = true,
        maxQueryLength = 10000
    } = options;

    const errors = [];
    const warnings = [];

    // Check for empty query
    if (!query || query.trim().length === 0) {
        return {
            valid: false,
            errors: ['Query is empty'],
            warnings: [],
            sanitizedQuery: null
        };
    }

    // Check query length
    if (query.length > maxQueryLength) {
        return {
            valid: false,
            errors: [`Query exceeds maximum length of ${maxQueryLength} characters`],
            warnings: [],
            sanitizedQuery: null
        };
    }

    // Remove comments for analysis (but keep for sanitized output)
    const queryWithoutComments = query
        .replace(/\/\*[\s\S]*?\*\//g, ' ')  // Block comments
        .replace(/\/\/[^\r\n]*/g, ' ');      // Line comments

    // Check for dangerous patterns
    for (const { pattern, description } of DANGEROUS_KQL_PATTERNS) {
        if (pattern.test(queryWithoutComments)) {
            errors.push(`Dangerous operation detected: ${description}`);
        }
    }

    // Check for injection patterns
    for (const { pattern, description } of INJECTION_PATTERNS) {
        if (pattern.test(queryWithoutComments)) {
            warnings.push(`Potential injection pattern: ${description}`);
        }
    }

    // Validate table reference (first table in query)
    const tableMatch = queryWithoutComments.trim().match(/^\s*(\w+)\s*(?:\||$)/m);
    if (tableMatch) {
        const tableName = tableMatch[1];
        // Skip if it's a let statement or other non-table identifier
        if (!tableName.toLowerCase().startsWith('let') &&
            !ALLOWED_KQL_TABLES.map(t => t.toLowerCase()).includes(tableName.toLowerCase())) {
            errors.push(`Table '${tableName}' is not in the allowed list. Allowed tables: ${ALLOWED_KQL_TABLES.join(', ')}`);
        }
    }

    // Check for time filter if required
    if (requireTimeFilter) {
        const hasTimeFilter = /TimeGenerated|_TimeReceived|timestamp/i.test(queryWithoutComments) &&
                             /ago\s*\(|between\s*\(|datetime\s*\(/i.test(queryWithoutComments);
        if (!hasTimeFilter) {
            warnings.push('Query does not appear to include a time filter. This may result in slow execution or excessive data.');
        }
    }

    // Check for multiple statements (semicolons outside of strings)
    const semicolonCount = (queryWithoutComments.match(/;/g) || []).length;
    if (semicolonCount > 0) {
        // Check if semicolons are within string literals
        const stringPattern = /'[^']*'/g;
        const withoutStrings = queryWithoutComments.replace(stringPattern, '');
        if (/;/.test(withoutStrings)) {
            errors.push('Multiple statements detected. Only single queries are allowed.');
        }
    }

    // Sanitize the query
    let sanitizedQuery = null;
    if (errors.length === 0) {
        sanitizedQuery = query
            .replace(/\/\*[\s\S]*?\*\//g, '')  // Remove block comments
            .replace(/\/\/[^\r\n]*/g, '')       // Remove line comments
            .replace(/--[^\r\n]*/g, '')         // Remove SQL-style comments
            .trim();
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        sanitizedQuery
    };
}

/**
 * Validates a Resource Graph query for security.
 *
 * @param {string} query - The Resource Graph query to validate
 * @param {Object} options - Validation options
 * @param {number} options.maxQueryLength - Maximum query length (default: 5000)
 * @returns {Object} Validation result
 */
function validateResourceGraphQuery(query, options = {}) {
    const {
        maxQueryLength = 5000
    } = options;

    const errors = [];
    const warnings = [];

    // Check for empty query
    if (!query || query.trim().length === 0) {
        return {
            valid: false,
            errors: ['Query is empty'],
            warnings: [],
            sanitizedQuery: null
        };
    }

    // Check query length
    if (query.length > maxQueryLength) {
        return {
            valid: false,
            errors: [`Query exceeds maximum length of ${maxQueryLength} characters`],
            warnings: [],
            sanitizedQuery: null
        };
    }

    // Remove comments for analysis
    const queryWithoutComments = query
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\r\n]*/g, ' ');

    // Resource Graph is read-only by design, but check for suspicious patterns
    const dangerousPatterns = [
        { pattern: /\bupdate\s+/i, description: 'update operation' },
        { pattern: /\bdelete\s+/i, description: 'delete operation' },
        { pattern: /\binsert\s+/i, description: 'insert operation' },
        { pattern: /\bmodify\s+/i, description: 'modify operation' }
    ];

    for (const { pattern, description } of dangerousPatterns) {
        if (pattern.test(queryWithoutComments)) {
            errors.push(`Dangerous operation detected: ${description}`);
        }
    }

    const suspiciousPatterns = [
        { pattern: /;\s*\w+/i, description: 'multiple statements' },
        { pattern: /union\s+\*/i, description: 'unrestricted union' }
    ];

    for (const { pattern, description } of suspiciousPatterns) {
        if (pattern.test(queryWithoutComments)) {
            warnings.push(`Suspicious pattern: ${description}`);
        }
    }

    // Validate that query starts with Resources or similar
    const validStarts = ['resources', 'resourcecontainers', 'advisorresources', 'alertsmanagementresources'];
    const queryStart = queryWithoutComments.trim().split(/\s+/)[0].toLowerCase();
    if (!validStarts.includes(queryStart)) {
        errors.push(`Query must start with a valid resource table (Resources, ResourceContainers, etc.)`);
    }

    // Sanitize
    let sanitizedQuery = null;
    if (errors.length === 0) {
        sanitizedQuery = query
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\r\n]*/g, '')
            .trim();
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        sanitizedQuery
    };
}

/**
 * Escapes a value for safe use in KQL queries.
 * Prevents injection through user-provided values.
 *
 * @param {string} value - The value to escape
 * @returns {string} Escaped value safe for KQL
 */
function escapeKqlValue(value) {
    if (value === null || value === undefined) {
        return '';
    }
    // Escape single quotes and backslashes
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "''");
}

/**
 * Creates an audit log entry for a query execution.
 *
 * @param {Object} params - Audit parameters
 * @param {string} params.query - The query being executed
 * @param {string} params.queryType - 'kql' or 'resourcegraph'
 * @param {string} params.userId - User who initiated the query
 * @param {string} params.channel - Channel (slack, teams, api)
 * @param {Object} params.validationResult - Result of query validation
 * @returns {Object} Audit log entry
 */
function createAuditLogEntry(params) {
    const { query, queryType, userId, channel, validationResult } = params;

    return {
        timestamp: new Date().toISOString(),
        query: query, // Include full query for audit
        queryType,
        queryHash: hashQuery(query),
        queryLength: query.length,
        userId,
        channel,
        validationResult: {
            valid: validationResult.valid,
            errors: validationResult.errors || [],
            warnings: validationResult.warnings || []
        }
    };
}

/**
 * Creates a simple hash of a query for audit logging.
 * Not cryptographically secure, just for identification.
 *
 * @param {string} query - The query to hash
 * @returns {string} Simple hash of the query
 */
function hashQuery(query) {
    let hash = 0;
    for (let i = 0; i < query.length; i++) {
        const char = query.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash).toString(16);
}

/**
 * Validates query execution options.
 *
 * @param {Object} options - Execution options
 * @param {number} options.maxResults - Maximum results to return
 * @param {number} options.timeoutMs - Query timeout in milliseconds
 * @returns {Object} Validated options with defaults applied
 */
function validateExecutionOptions(options = {}) {
    const MAX_RESULTS_LIMIT = 10000;
    const MAX_TIMEOUT_MS = 300000; // 5 minutes
    const DEFAULT_MAX_RESULTS = 1000;
    const DEFAULT_TIMEOUT_MS = 60000; // 1 minute

    return {
        maxResults: Math.min(
            options.maxResults || DEFAULT_MAX_RESULTS,
            MAX_RESULTS_LIMIT
        ),
        timeoutMs: Math.min(
            options.timeoutMs || DEFAULT_TIMEOUT_MS,
            MAX_TIMEOUT_MS
        )
    };
}

module.exports = {
    validateKqlQuery,
    validateResourceGraphQuery,
    escapeKqlValue,
    createAuditLogEntry,
    validateExecutionOptions,
    ALLOWED_KQL_TABLES,
    ALLOWED_RESOURCE_TYPES
};
