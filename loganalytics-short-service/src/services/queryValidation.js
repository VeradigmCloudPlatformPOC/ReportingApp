/**
 * @fileoverview Query Validation Service - Short-Term
 *
 * Validates KQL queries for security and enforces the 10-day time limit.
 *
 * @version v11-microservices
 */

const { MAX_DAYS } = require('./logAnalytics');

/**
 * Allowed KQL tables for performance monitoring.
 */
const ALLOWED_KQL_TABLES = [
    'Perf',           // Performance metrics
    'Heartbeat',      // VM availability
    'Event',          // Windows event logs
    'Syslog',         // Linux system logs
    'VMProcess',      // Process-level data
    'VMConnection',   // Network connection data
    'VMBoundPort'     // Port binding data
];

/**
 * Dangerous KQL patterns to block.
 */
const DANGEROUS_PATTERNS = [
    { pattern: /\.delete\b/i, description: 'delete operation' },
    { pattern: /\.set\s+/i, description: 'set operation' },
    { pattern: /\.append\s+/i, description: 'append operation' },
    { pattern: /\.ingest\s+/i, description: 'ingest operation' },
    { pattern: /\.create\s+/i, description: 'create operation' },
    { pattern: /\.alter\s+/i, description: 'alter operation' },
    { pattern: /\.drop\s+/i, description: 'drop operation' },
    { pattern: /\.execute\s+/i, description: 'execute plugin' },
    { pattern: /external_data\s*\(/i, description: 'external data access' },
    { pattern: /materialize\s*\(/i, description: 'materialize' },
    { pattern: /\bunion\s+\*/i, description: 'unrestricted union' }
];

/**
 * Validate a KQL query for the short-term service.
 *
 * @param {string} query - KQL query to validate
 * @param {Object} options - Validation options
 * @returns {Object} Validation result
 */
function validateKqlQuery(query, options = {}) {
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
    if (query.length > 10000) {
        return {
            valid: false,
            errors: ['Query exceeds maximum length of 10,000 characters'],
            warnings: [],
            sanitizedQuery: null
        };
    }

    // Remove comments for analysis
    const queryClean = query
        .replace(/\/\*[\s\S]*?\*\//g, ' ')
        .replace(/\/\/[^\r\n]*/g, ' ')
        .replace(/--[^\r\n]*/g, ' ');

    // Check for dangerous patterns
    for (const { pattern, description } of DANGEROUS_PATTERNS) {
        if (pattern.test(queryClean)) {
            errors.push(`Dangerous operation detected: ${description}`);
        }
    }

    // Validate table reference
    const tableMatch = queryClean.trim().match(/^\s*(\w+)\s*(?:\||$)/m);
    if (tableMatch) {
        const tableName = tableMatch[1];
        if (!tableName.toLowerCase().startsWith('let') &&
            !ALLOWED_KQL_TABLES.map(t => t.toLowerCase()).includes(tableName.toLowerCase())) {
            errors.push(`Table '${tableName}' is not allowed. Allowed: ${ALLOWED_KQL_TABLES.join(', ')}`);
        }
    }

    // Validate time range (must be ≤10 days)
    const timeValidation = validateTimeRange(query);
    if (!timeValidation.valid) {
        errors.push(timeValidation.message);
    }

    // Check for time filter
    const hasTimeFilter = /TimeGenerated|_TimeReceived/i.test(queryClean) &&
                         /ago\s*\(|between\s*\(|datetime\s*\(/i.test(queryClean);
    if (!hasTimeFilter) {
        warnings.push('Query should include a time filter (TimeGenerated) for better performance');
    }

    // Check for multiple statements
    const withoutStrings = queryClean.replace(/'[^']*'/g, '');
    if (/;/.test(withoutStrings)) {
        errors.push('Multiple statements detected. Only single queries are allowed.');
    }

    // Sanitize
    let sanitizedQuery = null;
    if (errors.length === 0) {
        sanitizedQuery = query
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/[^\r\n]*/g, '')
            .replace(/--[^\r\n]*/g, '')
            .trim();
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings,
        sanitizedQuery,
        timeRange: timeValidation
    };
}

/**
 * Validate that query time range is within 10 days.
 */
function validateTimeRange(query) {
    const agoPattern = /ago\s*\(\s*(\d+)\s*([dhms])\s*\)/gi;
    let match;
    let maxDays = 0;

    while ((match = agoPattern.exec(query)) !== null) {
        const value = parseInt(match[1]);
        const unit = match[2].toLowerCase();

        let days;
        switch (unit) {
            case 'd': days = value; break;
            case 'h': days = value / 24; break;
            case 'm': days = value / (24 * 60); break;
            case 's': days = value / (24 * 60 * 60); break;
            default: days = 0;
        }
        maxDays = Math.max(maxDays, days);
    }

    const isValid = maxDays <= MAX_DAYS || maxDays === 0;

    return {
        valid: isValid,
        maxDays: maxDays || null,
        limit: MAX_DAYS,
        message: isValid
            ? null
            : `Query time range (${maxDays.toFixed(1)} days) exceeds limit of ${MAX_DAYS} days. Use the long-term analysis service for queries >10 days.`
    };
}

/**
 * Escape a value for safe use in KQL.
 */
function escapeKqlValue(value) {
    if (value === null || value === undefined) return '';
    return String(value)
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "''");
}

/**
 * Create audit log entry.
 */
function createAuditLogEntry(params) {
    const { query, userId, channel, validationResult } = params;

    let hash = 0;
    for (let i = 0; i < query.length; i++) {
        const char = query.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }

    return {
        timestamp: new Date().toISOString(),
        queryHash: Math.abs(hash).toString(16),
        queryLength: query.length,
        userId,
        channel,
        valid: validationResult.valid,
        errors: validationResult.errors || [],
        warnings: validationResult.warnings || []
    };
}

module.exports = {
    validateKqlQuery,
    validateTimeRange,
    escapeKqlValue,
    createAuditLogEntry,
    ALLOWED_KQL_TABLES,
    MAX_DAYS
};
