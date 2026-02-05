/**
 * @fileoverview Metrics API Routes
 *
 * Endpoints for collecting and querying VM performance metrics.
 * v12: Added queue-based reliable collection endpoints.
 *
 * @version v12
 */

const express = require('express');
const router = express.Router();
const {
    collectMetrics,
    getVMMetrics,
    metricsMapToArray,
    // v12: Queue-based processing
    collectMetricsReliable,
    getReliableJobStatus,
    getReliableJobResults
} = require('../services/metricsCollector');
const batchQueueService = require('../services/batchQueueService');
const batchStorageService = require('../services/batchStorageService');
const { getJobProcessor } = require('../jobs/jobProcessor');

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

// ============================================================================
// v12: Queue-Based Reliable Collection Endpoints
// ============================================================================

/**
 * POST /api/metrics/collect/reliable
 *
 * Start a reliable metrics collection job using Azure Storage Queue.
 * Returns immediately with a jobId for tracking.
 */
router.post('/collect/reliable', async (req, res) => {
    const {
        subscriptionId,
        tenantId,
        timeRangeDays = 30
    } = req.body;

    if (!subscriptionId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_SUBSCRIPTION',
            message: 'subscriptionId is required'
        });
    }

    console.log(`[MetricsRoutes] Starting reliable collection for subscription ${subscriptionId}`);

    try {
        const secrets = req.secrets;

        const result = await collectMetricsReliable({
            subscriptionId,
            tenantId,
            timeRangeDays,
            workspaceId: secrets.logAnalytics?.workspaceId,
            resourceGraphServiceUrl: secrets.resourceGraphServiceUrl
        });

        if (!result.success) {
            return res.status(500).json({
                success: false,
                error: 'JOB_CREATION_FAILED',
                message: result.error
            });
        }

        res.json(result);

    } catch (error) {
        console.error('[MetricsRoutes] Reliable collection error:', error);
        res.status(500).json({
            success: false,
            error: 'INTERNAL_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/job/:jobId
 *
 * Get the status of a reliable collection job.
 */
router.get('/job/:jobId', async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_JOB_ID',
            message: 'jobId is required'
        });
    }

    try {
        const status = await getReliableJobStatus(jobId);
        res.json(status);

    } catch (error) {
        console.error('[MetricsRoutes] Job status error:', error);
        res.status(500).json({
            success: false,
            error: 'STATUS_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/job/:jobId/results
 *
 * Get the results of a completed reliable collection job.
 */
router.get('/job/:jobId/results', async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_JOB_ID',
            message: 'jobId is required'
        });
    }

    try {
        const results = await getReliableJobResults(jobId);

        if (!results.success) {
            return res.status(results.error === 'Job not found' ? 404 : 400).json(results);
        }

        // Convert Map to array for JSON serialization
        if (results.metrics instanceof Map) {
            results.metrics = metricsMapToArray(results.metrics);
        }

        res.json(results);

    } catch (error) {
        console.error('[MetricsRoutes] Job results error:', error);
        res.status(500).json({
            success: false,
            error: 'RESULTS_ERROR',
            message: error.message
        });
    }
});

/**
 * DELETE /api/metrics/job/:jobId
 *
 * Clean up a completed job's data.
 */
router.delete('/job/:jobId', async (req, res) => {
    const { jobId } = req.params;

    if (!jobId) {
        return res.status(400).json({
            success: false,
            error: 'MISSING_JOB_ID',
            message: 'jobId is required'
        });
    }

    try {
        const deletedCount = await batchStorageService.cleanupJobBlobs(jobId);

        res.json({
            success: true,
            jobId,
            deletedBlobs: deletedCount
        });

    } catch (error) {
        console.error('[MetricsRoutes] Job cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'CLEANUP_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/queue/stats
 *
 * Get queue and storage statistics.
 */
router.get('/queue/stats', async (req, res) => {
    try {
        const [queueStats, storageStats] = await Promise.all([
            batchQueueService.getQueueStats(),
            batchStorageService.getStorageStats()
        ]);

        const processor = getJobProcessor();
        const processorStatus = await processor.getStatus();

        res.json({
            success: true,
            queue: queueStats,
            storage: storageStats,
            processor: processorStatus
        });

    } catch (error) {
        console.error('[MetricsRoutes] Stats error:', error);
        res.status(500).json({
            success: false,
            error: 'STATS_ERROR',
            message: error.message
        });
    }
});

/**
 * GET /api/metrics/queue/deadletter
 *
 * Get batches in the dead-letter queue.
 */
router.get('/queue/deadletter', async (req, res) => {
    try {
        const deadLettered = await batchQueueService.getDeadLetteredBatches(20);

        res.json({
            success: true,
            count: deadLettered.length,
            batches: deadLettered
        });

    } catch (error) {
        console.error('[MetricsRoutes] Dead-letter error:', error);
        res.status(500).json({
            success: false,
            error: 'DEADLETTER_ERROR',
            message: error.message
        });
    }
});

/**
 * POST /api/metrics/queue/cleanup
 *
 * Run cleanup for expired blobs.
 */
router.post('/queue/cleanup', async (req, res) => {
    try {
        const processor = getJobProcessor();
        const deletedCount = await processor.runCleanup();

        res.json({
            success: true,
            deletedBlobs: deletedCount
        });

    } catch (error) {
        console.error('[MetricsRoutes] Cleanup error:', error);
        res.status(500).json({
            success: false,
            error: 'CLEANUP_ERROR',
            message: error.message
        });
    }
});

module.exports = router;
