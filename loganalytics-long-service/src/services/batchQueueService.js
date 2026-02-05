/**
 * @fileoverview Batch Queue Service for Azure Storage Queue
 *
 * Provides reliable batch job tracking with:
 * - Queue message management for batch jobs
 * - Automatic retry on failure (max 3 attempts)
 * - Dead-letter queue for failed batches
 * - Visibility timeout management
 *
 * @version v12
 */

const { QueueServiceClient } = require('@azure/storage-queue');
const { getSecret } = require('../shared/keyVaultService');

// Queue configuration
const QUEUE_CONFIG = {
    BATCH_JOBS_QUEUE: 'batch-jobs',
    DEAD_LETTER_QUEUE: 'batch-jobs-deadletter',
    VISIBILITY_TIMEOUT_SECONDS: 300,  // 5 min to process before retry
    MAX_DEQUEUE_COUNT: 3,             // Max retries before dead-letter
    MESSAGE_TTL_SECONDS: 604800       // 7 days max TTL
};

let queueServiceClient = null;
let batchJobsQueue = null;
let deadLetterQueue = null;

/**
 * Initialize the queue service client.
 * @returns {Promise<void>}
 */
async function initializeQueueService() {
    if (queueServiceClient) return;

    try {
        const connectionString = await getSecret('StorageAccountConnectionString');
        queueServiceClient = QueueServiceClient.fromConnectionString(connectionString);

        // Get queue clients
        batchJobsQueue = queueServiceClient.getQueueClient(QUEUE_CONFIG.BATCH_JOBS_QUEUE);
        deadLetterQueue = queueServiceClient.getQueueClient(QUEUE_CONFIG.DEAD_LETTER_QUEUE);

        // Create queues if they don't exist
        await batchJobsQueue.createIfNotExists();
        await deadLetterQueue.createIfNotExists();

        console.log('[BatchQueueService] Queue service initialized');
    } catch (error) {
        console.error('[BatchQueueService] Failed to initialize:', error.message);
        throw error;
    }
}

/**
 * Enqueue a batch job for processing.
 *
 * @param {Object} batchJob - Batch job details
 * @param {string} batchJob.jobId - Unique job identifier
 * @param {number} batchJob.batchIndex - Batch index within the job
 * @param {Array} batchJob.vmList - List of VMs in this batch
 * @param {string} batchJob.subscriptionId - Target subscription
 * @param {string} batchJob.tenantId - Tenant ID
 * @param {string} batchJob.workspaceId - Log Analytics workspace ID
 * @param {number} batchJob.timeRangeDays - Query time range
 * @returns {Promise<Object>} Enqueue result with messageId
 */
async function enqueueBatch(batchJob) {
    await initializeQueueService();

    const message = {
        ...batchJob,
        enqueuedAt: new Date().toISOString(),
        retryCount: 0
    };

    const messageText = Buffer.from(JSON.stringify(message)).toString('base64');

    const result = await batchJobsQueue.sendMessage(messageText, {
        visibilityTimeout: 0,  // Immediately visible
        messageTimeToLive: QUEUE_CONFIG.MESSAGE_TTL_SECONDS
    });

    console.log(`[BatchQueueService] Enqueued batch ${batchJob.batchIndex} for job ${batchJob.jobId}`);

    return {
        messageId: result.messageId,
        popReceipt: result.popReceipt,
        insertedOn: result.insertedOn
    };
}

/**
 * Enqueue multiple batches for a job.
 *
 * @param {string} jobId - Unique job identifier
 * @param {Array} batches - Array of batch configurations
 * @param {Object} jobConfig - Common job configuration
 * @returns {Promise<Object>} Result with batch count and message IDs
 */
async function enqueueAllBatches(jobId, batches, jobConfig) {
    await initializeQueueService();

    const results = [];

    for (const batch of batches) {
        const batchJob = {
            jobId,
            batchIndex: batch.index,
            vmList: batch.vms.map(vm => vm.vmName || vm.name),
            totalBatches: batches.length,
            ...jobConfig
        };

        const result = await enqueueBatch(batchJob);
        results.push(result);
    }

    console.log(`[BatchQueueService] Enqueued ${results.length} batches for job ${jobId}`);

    return {
        jobId,
        batchCount: results.length,
        messageIds: results.map(r => r.messageId)
    };
}

/**
 * Receive batch jobs for processing.
 *
 * @param {number} maxMessages - Maximum messages to receive (1-32)
 * @returns {Promise<Array>} Array of batch jobs
 */
async function receiveBatches(maxMessages = 3) {
    await initializeQueueService();

    const response = await batchJobsQueue.receiveMessages({
        numberOfMessages: Math.min(maxMessages, 32),
        visibilityTimeout: QUEUE_CONFIG.VISIBILITY_TIMEOUT_SECONDS
    });

    const batches = response.receivedMessageItems.map(msg => {
        const content = JSON.parse(Buffer.from(msg.messageText, 'base64').toString('utf-8'));
        return {
            ...content,
            messageId: msg.messageId,
            popReceipt: msg.popReceipt,
            dequeueCount: msg.dequeueCount
        };
    });

    if (batches.length > 0) {
        console.log(`[BatchQueueService] Received ${batches.length} batches for processing`);
    }

    return batches;
}

/**
 * Mark a batch as completed (delete from queue).
 *
 * @param {string} messageId - Queue message ID
 * @param {string} popReceipt - Message pop receipt
 * @returns {Promise<void>}
 */
async function completeBatch(messageId, popReceipt) {
    await initializeQueueService();

    await batchJobsQueue.deleteMessage(messageId, popReceipt);
    console.log(`[BatchQueueService] Completed batch (messageId: ${messageId})`);
}

/**
 * Move a failed batch to dead-letter queue.
 *
 * @param {Object} batchJob - The failed batch job
 * @param {string} errorMessage - Error description
 * @returns {Promise<void>}
 */
async function deadLetterBatch(batchJob, errorMessage) {
    await initializeQueueService();

    const deadLetterMessage = {
        ...batchJob,
        failedAt: new Date().toISOString(),
        error: errorMessage
    };

    const messageText = Buffer.from(JSON.stringify(deadLetterMessage)).toString('base64');
    await deadLetterQueue.sendMessage(messageText);

    // Delete from main queue
    if (batchJob.messageId && batchJob.popReceipt) {
        await batchJobsQueue.deleteMessage(batchJob.messageId, batchJob.popReceipt);
    }

    console.log(`[BatchQueueService] Moved batch ${batchJob.batchIndex} to dead-letter queue`);
}

/**
 * Check if a batch should be retried or dead-lettered.
 *
 * @param {Object} batchJob - Batch job with dequeueCount
 * @returns {boolean} True if should retry, false if should dead-letter
 */
function shouldRetry(batchJob) {
    return batchJob.dequeueCount < QUEUE_CONFIG.MAX_DEQUEUE_COUNT;
}

/**
 * Update message visibility to delay reprocessing (for retry backoff).
 *
 * @param {string} messageId - Queue message ID
 * @param {string} popReceipt - Message pop receipt
 * @param {number} delaySeconds - Visibility delay in seconds
 * @returns {Promise<Object>} Updated pop receipt
 */
async function updateVisibility(messageId, popReceipt, delaySeconds) {
    await initializeQueueService();

    const result = await batchJobsQueue.updateMessage(
        messageId,
        popReceipt,
        '',  // Keep same message content
        delaySeconds
    );

    console.log(`[BatchQueueService] Updated visibility for ${messageId}, delay: ${delaySeconds}s`);

    return {
        popReceipt: result.popReceipt
    };
}

/**
 * Get queue statistics.
 *
 * @returns {Promise<Object>} Queue statistics
 */
async function getQueueStats() {
    await initializeQueueService();

    const [mainProps, dlqProps] = await Promise.all([
        batchJobsQueue.getProperties(),
        deadLetterQueue.getProperties()
    ]);

    return {
        batchJobsQueue: {
            approximateMessagesCount: mainProps.approximateMessagesCount
        },
        deadLetterQueue: {
            approximateMessagesCount: dlqProps.approximateMessagesCount
        }
    };
}

/**
 * Peek at messages without removing them (for monitoring).
 *
 * @param {number} maxMessages - Maximum messages to peek
 * @returns {Promise<Array>} Array of peeked messages
 */
async function peekBatches(maxMessages = 10) {
    await initializeQueueService();

    const response = await batchJobsQueue.peekMessages({
        numberOfMessages: Math.min(maxMessages, 32)
    });

    return response.peekedMessageItems.map(msg => {
        const content = JSON.parse(Buffer.from(msg.messageText, 'base64').toString('utf-8'));
        return {
            ...content,
            messageId: msg.messageId
        };
    });
}

/**
 * Get batches from dead-letter queue.
 *
 * @param {number} maxMessages - Maximum messages to receive
 * @returns {Promise<Array>} Array of dead-lettered batches
 */
async function getDeadLetteredBatches(maxMessages = 10) {
    await initializeQueueService();

    const response = await deadLetterQueue.receiveMessages({
        numberOfMessages: Math.min(maxMessages, 32),
        visibilityTimeout: 60
    });

    return response.receivedMessageItems.map(msg => {
        const content = JSON.parse(Buffer.from(msg.messageText, 'base64').toString('utf-8'));
        return {
            ...content,
            messageId: msg.messageId,
            popReceipt: msg.popReceipt
        };
    });
}

/**
 * Clear the dead-letter queue (after reviewing/processing).
 *
 * @returns {Promise<number>} Number of messages cleared
 */
async function clearDeadLetterQueue() {
    await initializeQueueService();

    await deadLetterQueue.clearMessages();
    console.log('[BatchQueueService] Cleared dead-letter queue');
}

module.exports = {
    initializeQueueService,
    enqueueBatch,
    enqueueAllBatches,
    receiveBatches,
    completeBatch,
    deadLetterBatch,
    shouldRetry,
    updateVisibility,
    getQueueStats,
    peekBatches,
    getDeadLetteredBatches,
    clearDeadLetterQueue,
    QUEUE_CONFIG
};
