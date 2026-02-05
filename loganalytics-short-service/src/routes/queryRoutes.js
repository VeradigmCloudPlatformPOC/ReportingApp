/**
 * @fileoverview Query API Routes - Short-Term Log Analytics Service
 *
 * REST API endpoints for KQL query execution with ≤10 day time range.
 *
 * @version v11-microservices
 */

const express = require('express');
const router = express.Router();
const {
    executeKqlQuery,
    queryVMMetrics,
    queryHighUsageVMs,
    queryHeartbeat,
    MAX_DAYS
} = require('../services/logAnalytics');
const { validateKqlQuery, createAuditLogEntry } = require('../services/queryValidation');
const { formatForSlack, formatForEmail, formatAsCsv, formatAsJson } = require('../services/resultFormatter');

/**
 * POST /api/query/kql
 * Execute a validated KQL query (max 10 days)
 */
router.post('/kql', async (req, res) => {
    try {
        const { query, options = {}, format = 'json' } = req.body;
        const userId = req.headers['x-user-id'] || 'unknown';
        const channel = req.headers['x-channel'] || 'api';

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_QUERY',
                message: 'Query is required'
            });
        }

        // Validate query
        const validation = validateKqlQuery(query);

        // Log audit entry
        const auditEntry = createAuditLogEntry({
            query,
            userId,
            channel,
            validationResult: validation
        });
        console.log(`[Query] Audit: ${JSON.stringify(auditEntry)}`);

        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: 'VALIDATION_FAILED',
                message: 'Query failed validation',
                errors: validation.errors,
                warnings: validation.warnings
            });
        }

        // Execute query
        const result = await executeKqlQuery(validation.sanitizedQuery, options);

        // Format response based on requested format
        let formattedResult;
        switch (format.toLowerCase()) {
            case 'slack':
                formattedResult = {
                    success: result.success,
                    formatted: formatForSlack(result),
                    rowCount: result.rowCount,
                    executionTimeMs: result.executionTimeMs
                };
                break;
            case 'html':
            case 'email':
                formattedResult = {
                    success: result.success,
                    formatted: formatForEmail(result),
                    rowCount: result.rowCount,
                    executionTimeMs: result.executionTimeMs
                };
                break;
            case 'csv':
                formattedResult = {
                    success: result.success,
                    formatted: formatAsCsv(result),
                    rowCount: result.rowCount,
                    executionTimeMs: result.executionTimeMs
                };
                break;
            default:
                formattedResult = result;
        }

        res.json(formattedResult);

    } catch (error) {
        console.error('[API] /query/kql error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/query/validate
 * Validate a KQL query without execution
 */
router.post('/validate', async (req, res) => {
    try {
        const { query } = req.body;

        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_QUERY',
                message: 'Query is required'
            });
        }

        const validation = validateKqlQuery(query);

        res.json({
            success: true,
            valid: validation.valid,
            errors: validation.errors,
            warnings: validation.warnings,
            timeRange: validation.timeRange,
            sanitizedQuery: validation.sanitizedQuery
        });

    } catch (error) {
        console.error('[API] /query/validate error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/vm/:vmName
 * Get performance metrics for a specific VM
 */
router.get('/metrics/vm/:vmName', async (req, res) => {
    try {
        const { vmName } = req.params;
        const { days = 7, tenantId, subscriptionId } = req.query;

        const queryDays = Math.min(parseInt(days) || 7, MAX_DAYS);

        const result = await queryVMMetrics({
            vmName,
            days: queryDays,
            tenantId,
            subscriptionId
        });

        if (!result.success) {
            return res.status(500).json(result);
        }

        // Extract metrics from first result
        const metrics = result.results?.[0] || null;

        res.json({
            success: true,
            vmName,
            days: queryDays,
            metrics,
            hasData: metrics !== null,
            executionTimeMs: result.executionTimeMs
        });

    } catch (error) {
        console.error('[API] /metrics/vm/:vmName error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/high-usage
 * Get VMs with high resource usage
 */
router.get('/metrics/high-usage', async (req, res) => {
    try {
        const {
            metric = 'cpu',
            threshold = 80,
            days = 7,
            tenantId,
            subscriptionId
        } = req.query;

        const queryDays = Math.min(parseInt(days) || 7, MAX_DAYS);
        const usageThreshold = Math.min(Math.max(parseInt(threshold) || 80, 1), 100);

        const result = await queryHighUsageVMs({
            metric,
            threshold: usageThreshold,
            days: queryDays,
            tenantId,
            subscriptionId
        });

        res.json({
            ...result,
            parameters: {
                metric,
                threshold: usageThreshold,
                days: queryDays
            }
        });

    } catch (error) {
        console.error('[API] /metrics/high-usage error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/heartbeat
 * Get VM heartbeat/availability data
 */
router.get('/heartbeat', async (req, res) => {
    try {
        const { hours = 24, tenantId } = req.query;

        const queryHours = Math.min(parseInt(hours) || 24, MAX_DAYS * 24);

        const result = await queryHeartbeat({
            hours: queryHours,
            tenantId
        });

        res.json({
            ...result,
            parameters: {
                hours: queryHours
            }
        });

    } catch (error) {
        console.error('[API] /heartbeat error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/format
 * Format results for display (Slack, email, CSV)
 */
router.post('/format', async (req, res) => {
    try {
        const { results, format = 'slack', maxRows = 20 } = req.body;

        if (!results) {
            return res.status(400).json({
                success: false,
                error: 'MISSING_RESULTS',
                message: 'Results object is required'
            });
        }

        let formatted;
        switch (format.toLowerCase()) {
            case 'slack':
                formatted = formatForSlack(results, maxRows);
                break;
            case 'html':
            case 'email':
                formatted = formatForEmail(results, maxRows);
                break;
            case 'csv':
                formatted = formatAsCsv(results);
                break;
            case 'json':
                formatted = formatAsJson(results);
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: 'INVALID_FORMAT',
                    message: `Invalid format: ${format}. Use: slack, html, email, csv, or json`
                });
        }

        res.json({
            success: true,
            format,
            formatted
        });

    } catch (error) {
        console.error('[API] /format error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/limits
 * Get service limits
 */
router.get('/limits', (req, res) => {
    res.json({
        success: true,
        limits: {
            maxDays: MAX_DAYS,
            maxResults: 1000,
            queryTimeoutMs: 60000,
            maxQueryLength: 10000
        },
        message: `This service handles queries up to ${MAX_DAYS} days. For longer periods, use the long-term analysis service.`
    });
});

module.exports = router;
