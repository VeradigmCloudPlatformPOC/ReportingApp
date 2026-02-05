/**
 * @fileoverview Job API Routes
 *
 * Endpoints for managing async metrics collection jobs.
 */

const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const {
    sanitizeCallbackUrl,
    isValidSubscriptionId
} = require('../shared/securityUtils');

// In-memory job store (can be replaced with Azure Table Storage)
const jobStore = new Map();

/**
 * POST /api/jobs/create
 *
 * Create an async metrics collection job.
 * Returns immediately with a job ID for polling.
 */
router.post('/create', async (req, res) => {
    const {
        subscriptionId,
        tenantId,
        subscriptionName,
        timeRangeDays = 30,
        slackUserId,
        slackChannelId,
        callbackUrl
    } = req.body;

    // Validate subscription ID format
    if (!subscriptionId || !isValidSubscriptionId(subscriptionId)) {
        return res.status(400).json({
            success: false,
            error: 'INVALID_SUBSCRIPTION',
            message: 'subscriptionId is required and must be a valid GUID'
        });
    }

    // Validate and sanitize callback URL to prevent SSRF
    const sanitizedCallbackUrl = callbackUrl ? sanitizeCallbackUrl(callbackUrl) : null;
    if (callbackUrl && !sanitizedCallbackUrl) {
        console.warn(`[JobRoutes] Rejected invalid callback URL: ${callbackUrl}`);
    }

    const jobId = `job-${Date.now()}-${uuidv4().substring(0, 8)}`;

    const job = {
        jobId,
        status: 'PENDING',
        subscriptionId,
        tenantId,
        subscriptionName,
        timeRangeDays,
        slackUserId,
        slackChannelId,
        callbackUrl: sanitizedCallbackUrl,  // Use sanitized URL
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        progress: {
            phase: 'queued',
            message: 'Job queued for processing'
        },
        result: null,
        error: null
    };

    jobStore.set(jobId, job);

    console.log(`[JobRoutes] Created job ${jobId} for subscription ${subscriptionId}`);

    // Start job processing asynchronously
    processJob(jobId, req.secrets).catch(err => {
        console.error(`[JobRoutes] Job ${jobId} failed:`, err);
        const job = jobStore.get(jobId);
        if (job) {
            job.status = 'FAILED';
            job.error = err.message;
            job.updatedAt = new Date().toISOString();
        }
    });

    res.status(202).json({
        success: true,
        jobId,
        status: 'PENDING',
        message: 'Job created and queued for processing',
        pollUrl: `/api/jobs/${jobId}`
    });
});

/**
 * GET /api/jobs/:jobId
 *
 * Get job status and progress.
 */
router.get('/:jobId', (req, res) => {
    const { jobId } = req.params;
    const job = jobStore.get(jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'JOB_NOT_FOUND',
            message: `Job not found: ${jobId}`
        });
    }

    res.json({
        success: true,
        ...job,
        // Don't include full results in status check
        result: job.result ? { available: true, vmCount: job.result.vmCount } : null
    });
});

/**
 * GET /api/jobs/:jobId/results
 *
 * Get full job results (only when completed).
 */
router.get('/:jobId/results', (req, res) => {
    const { jobId } = req.params;
    const job = jobStore.get(jobId);

    if (!job) {
        return res.status(404).json({
            success: false,
            error: 'JOB_NOT_FOUND',
            message: `Job not found: ${jobId}`
        });
    }

    if (job.status !== 'COMPLETED') {
        return res.status(400).json({
            success: false,
            error: 'JOB_NOT_COMPLETE',
            message: `Job is ${job.status}. Results only available when COMPLETED.`,
            status: job.status
        });
    }

    res.json({
        success: true,
        jobId,
        completedAt: job.updatedAt,
        ...job.result
    });
});

/**
 * GET /api/jobs
 *
 * List recent jobs.
 */
router.get('/', (req, res) => {
    const jobs = [];
    for (const [jobId, job] of jobStore) {
        jobs.push({
            jobId,
            status: job.status,
            subscriptionId: job.subscriptionId,
            subscriptionName: job.subscriptionName,
            createdAt: job.createdAt,
            updatedAt: job.updatedAt,
            progress: job.progress
        });
    }

    // Sort by creation time, newest first
    jobs.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    res.json({
        success: true,
        count: jobs.length,
        jobs: jobs.slice(0, 50) // Limit to 50 most recent
    });
});

/**
 * Process a job asynchronously.
 */
async function processJob(jobId, secrets) {
    const job = jobStore.get(jobId);
    if (!job) return;

    job.status = 'IN_PROGRESS';
    job.updatedAt = new Date().toISOString();

    try {
        const { collectMetrics, metricsMapToArray } = require('../services/metricsCollector');

        // Update progress callback
        const progressCallback = (progress) => {
            job.progress = progress;
            job.updatedAt = new Date().toISOString();
        };

        progressCallback({ phase: 'starting', message: 'Job started' });

        const result = await collectMetrics({
            subscriptionId: job.subscriptionId,
            tenantId: job.tenantId,
            timeRangeDays: job.timeRangeDays,
            workspaceId: secrets.logAnalytics?.workspaceId,
            resourceGraphServiceUrl: secrets.resourceGraphServiceUrl,
            progressCallback
        });

        if (!result.success) {
            throw new Error(result.error);
        }

        // Store results
        job.status = 'COMPLETED';
        job.result = {
            vmCount: result.vmCount,
            metricsCount: result.metricsCount,
            timeRangeDays: result.timeRangeDays,
            inventory: result.inventory,
            metrics: metricsMapToArray(result.metrics)
        };
        job.progress = { phase: 'completed', message: 'Job completed successfully' };
        job.updatedAt = new Date().toISOString();

        console.log(`[JobRoutes] Job ${jobId} completed: ${result.vmCount} VMs, ${result.metricsCount} metrics`);

        // Send callback if configured
        if (job.callbackUrl) {
            try {
                const axios = require('axios');
                await axios.post(job.callbackUrl, {
                    jobId,
                    status: 'COMPLETED',
                    vmCount: result.vmCount,
                    metricsCount: result.metricsCount
                });
            } catch (callbackErr) {
                console.error(`[JobRoutes] Callback failed for job ${jobId}:`, callbackErr.message);
            }
        }

    } catch (error) {
        job.status = 'FAILED';
        job.error = error.message;
        job.progress = { phase: 'failed', message: error.message };
        job.updatedAt = new Date().toISOString();
        console.error(`[JobRoutes] Job ${jobId} failed:`, error.message);
    }
}

module.exports = router;
