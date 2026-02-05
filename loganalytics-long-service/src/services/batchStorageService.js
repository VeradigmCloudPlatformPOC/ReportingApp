/**
 * @fileoverview Batch Storage Service for Azure Blob Storage
 *
 * Provides persistent storage for batch results with:
 * - 24-hour TTL for automatic cleanup
 * - Results stored as JSON with metadata
 * - Job aggregation from multiple batch blobs
 * - Support for audit/retry scenarios
 *
 * @version v12-managed-identity
 */

const { BlobServiceClient, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const { getSecret } = require('../shared/keyVaultService');

// Storage configuration
const STORAGE_CONFIG = {
    CONTAINER_NAME: 'batch-results',
    BLOB_TTL_HOURS: 24,
    MAX_BLOB_SIZE_MB: 50
};

// Environment variables for managed identity
const AZURE_STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME || 'vmperfstore18406';
const USE_MANAGED_IDENTITY_STORAGE = process.env.USE_MANAGED_IDENTITY_STORAGE === 'true';

let blobServiceClient = null;
let containerClient = null;

/**
 * Initialize the blob storage client.
 * Uses managed identity (DefaultAzureCredential) in production.
 * Falls back to connection string for local development.
 * @returns {Promise<void>}
 */
async function initializeStorageService() {
    if (blobServiceClient) return;

    try {
        if (USE_MANAGED_IDENTITY_STORAGE) {
            // Use managed identity with storage account name
            console.log(`[BatchStorageService] Using managed identity for account: ${AZURE_STORAGE_ACCOUNT_NAME}`);
            const credential = new DefaultAzureCredential();
            const blobEndpoint = `https://${AZURE_STORAGE_ACCOUNT_NAME}.blob.core.windows.net`;
            blobServiceClient = new BlobServiceClient(blobEndpoint, credential);
        } else {
            // Legacy: Use connection string from Key Vault
            const connectionString = await getSecret('StorageAccountConnectionString');
            blobServiceClient = BlobServiceClient.fromConnectionString(connectionString);
        }

        containerClient = blobServiceClient.getContainerClient(STORAGE_CONFIG.CONTAINER_NAME);

        // Create container if it doesn't exist
        await containerClient.createIfNotExists();

        console.log('[BatchStorageService] Storage service initialized');
    } catch (error) {
        console.error('[BatchStorageService] Failed to initialize:', error.message);
        throw error;
    }
}

/**
 * Save batch results to blob storage.
 *
 * @param {string} jobId - Unique job identifier
 * @param {number} batchIndex - Batch index within the job
 * @param {Array} results - Batch query results
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<Object>} Save result with blob URL
 */
async function saveBatchResults(jobId, batchIndex, results, metadata = {}) {
    await initializeStorageService();

    const blobName = `${jobId}/batch-${batchIndex}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const blobContent = {
        jobId,
        batchIndex,
        results,
        metadata: {
            ...metadata,
            savedAt: new Date().toISOString(),
            vmCount: results.length,
            expiresAt: new Date(Date.now() + STORAGE_CONFIG.BLOB_TTL_HOURS * 60 * 60 * 1000).toISOString()
        }
    };

    const content = JSON.stringify(blobContent, null, 2);

    await blockBlobClient.upload(content, content.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json'
        },
        metadata: {
            jobId,
            batchIndex: String(batchIndex),
            vmCount: String(results.length),
            createdAt: new Date().toISOString()
        }
    });

    console.log(`[BatchStorageService] Saved batch ${batchIndex} for job ${jobId} (${results.length} VMs)`);

    return {
        blobName,
        url: blockBlobClient.url,
        vmCount: results.length
    };
}

/**
 * Get batch results from blob storage.
 *
 * @param {string} jobId - Unique job identifier
 * @param {number} batchIndex - Batch index within the job
 * @returns {Promise<Object|null>} Batch results or null if not found
 */
async function getBatchResults(jobId, batchIndex) {
    await initializeStorageService();

    const blobName = `${jobId}/batch-${batchIndex}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    try {
        const downloadResponse = await blockBlobClient.download();
        const content = await streamToString(downloadResponse.readableStreamBody);
        return JSON.parse(content);
    } catch (error) {
        if (error.statusCode === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * List all batch blobs for a job.
 *
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<Array>} Array of batch blob info
 */
async function listJobBatches(jobId) {
    await initializeStorageService();

    const batches = [];
    const prefix = `${jobId}/`;

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        // Extract batch index from blob name
        const match = blob.name.match(/batch-(\d+)\.json$/);
        if (match) {
            batches.push({
                blobName: blob.name,
                batchIndex: parseInt(match[1], 10),
                contentLength: blob.properties.contentLength,
                createdOn: blob.properties.createdOn,
                metadata: blob.metadata
            });
        }
    }

    // Sort by batch index
    batches.sort((a, b) => a.batchIndex - b.batchIndex);

    return batches;
}

/**
 * Aggregate all batch results for a job.
 *
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<Object>} Aggregated results with metadata
 */
async function aggregateJobResults(jobId) {
    await initializeStorageService();

    const batches = await listJobBatches(jobId);

    if (batches.length === 0) {
        return {
            success: false,
            error: 'No batch results found for job'
        };
    }

    const allResults = [];
    const batchMetadata = [];
    let totalVMs = 0;
    let successfulBatches = 0;
    let failedBatches = 0;

    for (const batch of batches) {
        try {
            const batchData = await getBatchResults(jobId, batch.batchIndex);
            if (batchData && batchData.results) {
                allResults.push(...batchData.results);
                totalVMs += batchData.results.length;
                successfulBatches++;
                batchMetadata.push({
                    batchIndex: batch.batchIndex,
                    vmCount: batchData.results.length,
                    status: 'success'
                });
            }
        } catch (error) {
            failedBatches++;
            batchMetadata.push({
                batchIndex: batch.batchIndex,
                status: 'failed',
                error: error.message
            });
        }
    }

    console.log(`[BatchStorageService] Aggregated ${totalVMs} VMs from ${successfulBatches} batches`);

    return {
        success: true,
        jobId,
        results: allResults,
        summary: {
            totalVMs,
            totalBatches: batches.length,
            successfulBatches,
            failedBatches
        },
        batches: batchMetadata,
        aggregatedAt: new Date().toISOString()
    };
}

/**
 * Save job metadata/status.
 *
 * @param {string} jobId - Unique job identifier
 * @param {Object} status - Job status object
 * @returns {Promise<Object>} Save result
 */
async function saveJobStatus(jobId, status) {
    await initializeStorageService();

    const blobName = `${jobId}/job-status.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    const content = JSON.stringify({
        jobId,
        ...status,
        updatedAt: new Date().toISOString()
    }, null, 2);

    await blockBlobClient.upload(content, content.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json'
        }
    });

    return { blobName, url: blockBlobClient.url };
}

/**
 * Get job status.
 *
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<Object|null>} Job status or null
 */
async function getJobStatus(jobId) {
    await initializeStorageService();

    const blobName = `${jobId}/job-status.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    try {
        const downloadResponse = await blockBlobClient.download();
        const content = await streamToString(downloadResponse.readableStreamBody);
        return JSON.parse(content);
    } catch (error) {
        if (error.statusCode === 404) {
            return null;
        }
        throw error;
    }
}

/**
 * Delete all blobs for a job (cleanup after processing).
 *
 * @param {string} jobId - Unique job identifier
 * @returns {Promise<number>} Number of blobs deleted
 */
async function cleanupJobBlobs(jobId) {
    await initializeStorageService();

    let deletedCount = 0;
    const prefix = `${jobId}/`;

    for await (const blob of containerClient.listBlobsFlat({ prefix })) {
        const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
        await blockBlobClient.delete();
        deletedCount++;
    }

    console.log(`[BatchStorageService] Cleaned up ${deletedCount} blobs for job ${jobId}`);
    return deletedCount;
}

/**
 * Clean up expired blobs (older than TTL).
 * Should be called periodically or via Azure Function timer trigger.
 *
 * @returns {Promise<number>} Number of blobs deleted
 */
async function cleanupExpiredBlobs() {
    await initializeStorageService();

    const cutoffDate = new Date(Date.now() - STORAGE_CONFIG.BLOB_TTL_HOURS * 60 * 60 * 1000);
    let deletedCount = 0;

    for await (const blob of containerClient.listBlobsFlat()) {
        if (blob.properties.createdOn < cutoffDate) {
            const blockBlobClient = containerClient.getBlockBlobClient(blob.name);
            await blockBlobClient.delete();
            deletedCount++;
        }
    }

    if (deletedCount > 0) {
        console.log(`[BatchStorageService] Cleaned up ${deletedCount} expired blobs`);
    }

    return deletedCount;
}

/**
 * Get storage statistics.
 *
 * @returns {Promise<Object>} Storage statistics
 */
async function getStorageStats() {
    await initializeStorageService();

    let totalBlobs = 0;
    let totalSize = 0;
    const jobIds = new Set();

    for await (const blob of containerClient.listBlobsFlat()) {
        totalBlobs++;
        totalSize += blob.properties.contentLength || 0;

        // Extract job ID from blob name
        const parts = blob.name.split('/');
        if (parts.length > 1) {
            jobIds.add(parts[0]);
        }
    }

    return {
        containerName: STORAGE_CONFIG.CONTAINER_NAME,
        totalBlobs,
        totalSizeMB: (totalSize / (1024 * 1024)).toFixed(2),
        activeJobs: jobIds.size,
        ttlHours: STORAGE_CONFIG.BLOB_TTL_HOURS
    };
}

/**
 * Generate SAS URL for a batch result blob (for external access).
 *
 * @param {string} jobId - Unique job identifier
 * @param {number} batchIndex - Batch index
 * @param {number} expiryMinutes - URL expiry in minutes
 * @returns {Promise<string>} SAS URL
 */
async function generateBatchSasUrl(jobId, batchIndex, expiryMinutes = 60) {
    await initializeStorageService();

    const blobName = `${jobId}/batch-${batchIndex}.json`;
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);

    // Generate SAS token
    const expiryDate = new Date(Date.now() + expiryMinutes * 60 * 1000);

    const sasUrl = await blockBlobClient.generateSasUrl({
        permissions: 'r',  // Read only
        expiresOn: expiryDate
    });

    return sasUrl;
}

/**
 * Helper: Convert readable stream to string.
 */
async function streamToString(readableStream) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        readableStream.on('data', (data) => {
            chunks.push(data.toString());
        });
        readableStream.on('end', () => {
            resolve(chunks.join(''));
        });
        readableStream.on('error', reject);
    });
}

module.exports = {
    initializeStorageService,
    saveBatchResults,
    getBatchResults,
    listJobBatches,
    aggregateJobResults,
    saveJobStatus,
    getJobStatus,
    cleanupJobBlobs,
    cleanupExpiredBlobs,
    getStorageStats,
    generateBatchSasUrl,
    STORAGE_CONFIG
};
