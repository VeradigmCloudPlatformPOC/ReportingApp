/**
 * @fileoverview Job Processor for Queue-Based Batch Processing
 *
 * Background job processor that:
 * - Polls Azure Storage Queue for batch jobs
 * - Executes KQL queries for each batch
 * - Saves results to Blob Storage
 * - Handles retries and dead-lettering
 *
 * @version v12
 */

const batchQueueService = require('../services/batchQueueService');
const batchStorageService = require('../services/batchStorageService');
const { processBatchFromQueue } = require('../services/metricsCollector');

/**
 * Job Processor class for queue-based batch execution.
 */
class JobProcessor {
    constructor(options = {}) {
        this.isRunning = false;
        this.activeWorkers = 0;
        this.maxConcurrentWorkers = options.maxConcurrentWorkers || 3;
        this.pollIntervalMs = options.pollIntervalMs || 5000; // 5 seconds
        this.idlePollIntervalMs = options.idlePollIntervalMs || 30000; // 30 seconds when idle
        this.pollTimer = null;
        this.stats = {
            batchesProcessed: 0,
            batchesFailed: 0,
            lastPollTime: null,
            startedAt: null
        };
    }

    /**
     * Start the job processor.
     * Begins polling the queue for batch jobs.
     */
    async start() {
        if (this.isRunning) {
            console.log('[JobProcessor] Already running');
            return;
        }

        this.isRunning = true;
        this.stats.startedAt = new Date().toISOString();
        console.log('[JobProcessor] Starting queue processor...');

        // Initialize queue service
        try {
            await batchQueueService.initializeQueueService();
            console.log('[JobProcessor] Queue service initialized');
        } catch (error) {
            console.error('[JobProcessor] Failed to initialize queue service:', error.message);
            this.isRunning = false;
            throw error;
        }

        // Start polling loop
        this.pollLoop();
        console.log('[JobProcessor] Queue processor started');
    }

    /**
     * Stop the job processor.
     * Waits for active workers to complete.
     */
    async stop() {
        console.log('[JobProcessor] Stopping...');
        this.isRunning = false;

        if (this.pollTimer) {
            clearTimeout(this.pollTimer);
            this.pollTimer = null;
        }

        // Wait for active workers to complete (max 60 seconds)
        const maxWait = 60000;
        const startWait = Date.now();

        while (this.activeWorkers > 0 && (Date.now() - startWait) < maxWait) {
            console.log(`[JobProcessor] Waiting for ${this.activeWorkers} active workers...`);
            await this.sleep(1000);
        }

        if (this.activeWorkers > 0) {
            console.warn(`[JobProcessor] Stopped with ${this.activeWorkers} workers still active`);
        } else {
            console.log('[JobProcessor] Stopped gracefully');
        }
    }

    /**
     * Main polling loop.
     * Polls the queue and spawns workers for received batches.
     */
    async pollLoop() {
        if (!this.isRunning) return;

        this.stats.lastPollTime = new Date().toISOString();

        try {
            // Calculate how many batches we can receive
            const availableSlots = this.maxConcurrentWorkers - this.activeWorkers;

            if (availableSlots > 0) {
                // Receive batches from queue
                const batches = await batchQueueService.receiveBatches(availableSlots);

                if (batches.length > 0) {
                    console.log(`[JobProcessor] Received ${batches.length} batches from queue`);

                    // Process batches concurrently
                    for (const batch of batches) {
                        this.processBatchAsync(batch);
                    }

                    // Poll again quickly if we found work
                    this.schedulePoll(this.pollIntervalMs);
                } else {
                    // No work found, poll less frequently
                    this.schedulePoll(this.idlePollIntervalMs);
                }
            } else {
                // All workers busy, wait for one to free up
                this.schedulePoll(this.pollIntervalMs);
            }

        } catch (error) {
            console.error('[JobProcessor] Poll error:', error.message);
            // Continue polling despite errors
            this.schedulePoll(this.pollIntervalMs);
        }
    }

    /**
     * Schedule the next poll.
     * @param {number} delayMs - Delay in milliseconds
     */
    schedulePoll(delayMs) {
        if (!this.isRunning) return;

        this.pollTimer = setTimeout(() => {
            this.pollLoop();
        }, delayMs);
    }

    /**
     * Process a batch asynchronously.
     * @param {Object} batch - Batch job from queue
     */
    async processBatchAsync(batch) {
        this.activeWorkers++;

        try {
            console.log(`[JobProcessor] Processing batch ${batch.batchIndex} for job ${batch.jobId}`);

            const result = await processBatchFromQueue(batch);

            if (result.success) {
                this.stats.batchesProcessed++;
                console.log(`[JobProcessor] Batch ${batch.batchIndex} completed (${result.vmCount} VMs)`);
            } else {
                this.stats.batchesFailed++;
                console.log(`[JobProcessor] Batch ${batch.batchIndex} failed: ${result.error}`);
            }

        } catch (error) {
            this.stats.batchesFailed++;
            console.error(`[JobProcessor] Batch ${batch.batchIndex} error:`, error.message);

            // Try to handle the failure gracefully
            try {
                if (batchQueueService.shouldRetry(batch)) {
                    console.log(`[JobProcessor] Batch ${batch.batchIndex} will be retried`);
                } else {
                    await batchQueueService.deadLetterBatch(batch, error.message);
                    console.log(`[JobProcessor] Batch ${batch.batchIndex} moved to dead-letter queue`);
                }
            } catch (dlqError) {
                console.error('[JobProcessor] Failed to handle batch failure:', dlqError.message);
            }
        } finally {
            this.activeWorkers--;
        }
    }

    /**
     * Get processor status and statistics.
     * @returns {Object} Status object
     */
    async getStatus() {
        let queueStats = null;
        let storageStats = null;

        try {
            queueStats = await batchQueueService.getQueueStats();
        } catch (error) {
            queueStats = { error: error.message };
        }

        try {
            storageStats = await batchStorageService.getStorageStats();
        } catch (error) {
            storageStats = { error: error.message };
        }

        return {
            isRunning: this.isRunning,
            activeWorkers: this.activeWorkers,
            maxConcurrentWorkers: this.maxConcurrentWorkers,
            pollIntervalMs: this.pollIntervalMs,
            stats: this.stats,
            queue: queueStats,
            storage: storageStats
        };
    }

    /**
     * Get detailed job status.
     * @param {string} jobId - Job identifier
     * @returns {Promise<Object>} Job status
     */
    async getJobStatus(jobId) {
        return await batchStorageService.getJobStatus(jobId);
    }

    /**
     * Get job results.
     * @param {string} jobId - Job identifier
     * @returns {Promise<Object>} Job results
     */
    async getJobResults(jobId) {
        const status = await batchStorageService.getJobStatus(jobId);

        if (!status) {
            return { success: false, error: 'Job not found' };
        }

        if (status.status !== 'COMPLETED') {
            return {
                success: false,
                error: `Job not completed (status: ${status.status})`,
                status
            };
        }

        return await batchStorageService.aggregateJobResults(jobId);
    }

    /**
     * Clean up old job data.
     * @param {string} jobId - Job identifier to clean up
     * @returns {Promise<number>} Number of blobs deleted
     */
    async cleanupJob(jobId) {
        return await batchStorageService.cleanupJobBlobs(jobId);
    }

    /**
     * Run cleanup for expired blobs.
     * Should be called periodically.
     */
    async runCleanup() {
        console.log('[JobProcessor] Running cleanup for expired blobs...');
        const deleted = await batchStorageService.cleanupExpiredBlobs();
        console.log(`[JobProcessor] Cleaned up ${deleted} expired blobs`);
        return deleted;
    }

    /**
     * Sleep helper.
     * @param {number} ms - Milliseconds to sleep
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// Singleton instance for the application
let processorInstance = null;

/**
 * Get or create the job processor instance.
 * @param {Object} options - Processor options
 * @returns {JobProcessor} Processor instance
 */
function getJobProcessor(options = {}) {
    if (!processorInstance) {
        processorInstance = new JobProcessor(options);
    }
    return processorInstance;
}

module.exports = {
    JobProcessor,
    getJobProcessor
};
