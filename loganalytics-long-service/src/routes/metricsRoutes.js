/**
 * @fileoverview Metrics API Routes
 *
 * Endpoints for collecting and querying VM performance metrics.
 */

const express = require('express');
const router = express.Router();
const {
    collectMetrics,
    getVMMetrics,
    metricsMapToArray
} = require('../services/metricsCollector');

/**
 * POST /api/metrics/collect
 *
 * Collect metrics for all VMs in a subscription.
 * This is a synchronous operation - use /api/jobs/create for async.
 */
router.post('/collect', async (req, res) => {
    const startTime = Date.now();
    const {
        subscriptionId,
        tenantId,
        timeRangeDays = 30,
        maxVMs
    } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_SUBSCRIPTION',
            message: 'subscriptionId is required'
        });
    }

    console.log(`[MetricsRoutes] Collecting metrics for subscription ${subscriptionId}`);

    try {
        const secrets = req.secrets;

        const result = await collectMetrics({
            subscriptionId,
            tenantId,
            timeRangeDays,
            workspaceId: secrets.logAnalytics?.workspaceId,
            resourceGraphServiceUrl: secrets.resourceGraphServiceUrl,
            maxVMs
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'COLLECTION_FAILED',
                message: result.error
            });
        }

        const executionTimeMs = Date.now() - startTime;

        // Convert Map to array for JSON response
        const metricsArray = metricsMapToArray(result.metrics);

        res.json({
            success: true,
            subscriptionId,
            timeRangeDays,
            vmCount: result.vmCount,
            metricsCount: result.metricsCount,
            inventory: result.inventory,
            metrics: metricsArray,
            executionTimeMs
        });

    } catch (error) {
        console.error('[MetricsRoutes] Error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/metrics/batch
 *
 * Collect metrics for a specific list of VMs (by name).
 */
router.post('/batch', async (req, res) => {
    const startTime = Date.now();
    const {
        vmNames,
        tenantId,
        timeRangeDays = 30
    } = req.body;

    if (!vmNames || !Array.isArray(vmNames) || vmNames.length === 0) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_VM_NAMES',
            message: 'vmNames array is required'
        });
    }

    console.log(`[MetricsRoutes] Collecting metrics for ${vmNames.length} VMs`);

    try {
        const secrets = req.secrets;
        const workspaceId = secrets.logAnalytics?.workspaceId;

        if (!workspaceId) {
            return res.status(500).json({
                success: false,
                error: 'NO_WORKSPACE',
                message: 'Log Analytics workspace not configured'
            });
        }

        // Create pseudo-inventory for batch collection
        const inventory = vmNames.map(name => ({ vmName: name, name }));

        const { collectBatchedMetrics, metricsMapToArray } = require('../services/metricsCollector');
        const subscriptionId = req.body.subscriptionId || null;
        const metricsMap = await collectBatchedMetrics(inventory, timeRangeDays, workspaceId, null, tenantId, subscriptionId);

        const executionTimeMs = Date.now() - startTime;

        res.json({
            success: true,
            timeRangeDays,
            vmCount: vmNames.length,
            metricsCount: metricsMap.size,
            metrics: metricsMapToArray(metricsMap),
            executionTimeMs
        });

    } catch (error) {
        console.error('[MetricsRoutes] Batch error:', error);
        res.status(500).json({
            success: false,
            error: 'BATCH_FAILED',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/vm/:vmName
 *
 * Get metrics for a single VM.
 */
router.get('/vm/:vmName', async (req, res) => {
    const { vmName } = req.params;
    const timeRangeDays = parseInt(req.query.days) || 30;
    const tenantId = req.query.tenantId || null;

    if (!vmName) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_VM_NAME',
            message: 'VM name is required'
        });
    }

    console.log(`[MetricsRoutes] Getting metrics for VM: ${vmName}`);

    try {
        const secrets = req.secrets;
        const workspaceId = secrets.logAnalytics?.workspaceId;

        if (!workspaceId) {
            return res.status(500).json({
                success: false,
                error: 'NO_WORKSPACE',
                message: 'Log Analytics workspace not configured'
            });
        }

        const subscriptionId = req.query.subscriptionId || null;
        const metrics = await getVMMetrics(vmName, workspaceId, timeRangeDays, tenantId, subscriptionId);

        if (!metrics) {
            return res.status(404).json({
                success: false,
                error: 'VM_NOT_FOUND',
                message: `No metrics found for VM: ${vmName}`
            });
        }

        res.json({
            success: true,
            vmName,
            timeRangeDays,
            metrics
        });

    } catch (error) {
        console.error('[MetricsRoutes] VM metrics error:', error);
        res.status(500).json({
            success: false,
            error: 'QUERY_FAILED',
            message: error.message
        });
    }
});

module.exports = router;
