/**
 * @fileoverview Cache Service with Azure Blob Storage
 *
 * Provides 24-hour caching for Resource Graph query results using Azure Blob Storage.
 * Uses container 'resource-snapshots' with automatic TTL management.
 *
 * @version v11-microservices
 */

const { BlobServiceClient } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

const CONTAINER_NAME = 'resource-snapshots';
const CACHE_TTL_HOURS = 24;

let containerClient = null;

/**
 * Initialize the cache service.
 *
 * @param {string} storageAccountName - Azure Storage account name
 */
async function initializeCache(storageAccountName) {
    if (!storageAccountName) {
        console.warn('[CacheService] No storage account configured - caching disabled');
        return;
    }

    try {
        const credential = new DefaultAzureCredential();
        const blobServiceClient = new BlobServiceClient(
            `https://${storageAccountName}.blob.core.windows.net`,
            credential
        );

        containerClient = blobServiceClient.getContainerClient(CONTAINER_NAME);

        // Ensure container exists
        await containerClient.createIfNotExists();

        console.log(`[CacheService] Initialized with container: ${CONTAINER_NAME}`);
    } catch (error) {
        console.error('[CacheService] Failed to initialize:', error.message);
        containerClient = null;
    }
}

/**
 * Generate a cache key from query parameters.
 *
 * @param {string} queryType - Type of query (e.g., 'inventory', 'summary')
 * @param {Object} params - Query parameters
 * @returns {string} Cache key (blob name)
 */
function generateCacheKey(queryType, params) {
    // Create a deterministic key from parameters
    const sortedParams = Object.keys(params)
        .sort()
        .map(k => `${k}=${params[k]}`)
        .join('&');

    const hash = require('crypto')
        .createHash('md5')
        .update(sortedParams)
        .digest('hex')
        .substring(0, 12);

    return `${queryType}/${hash}.json.gz`;
}

/**
 * Get cached data if available and not expired.
 *
 * @param {string} cacheKey - Cache key (blob name)
 * @returns {Promise<Object|null>} Cached data or null
 */
async function getFromCache(cacheKey) {
    if (!containerClient) {
        return null;
    }

    try {
        const blobClient = containerClient.getBlobClient(cacheKey);

        // Check if blob exists
        const exists = await blobClient.exists();
        if (!exists) {
            return null;
        }

        // Check blob properties for TTL
        const properties = await blobClient.getProperties();
        const createdAt = properties.createdOn || properties.lastModified;
        const ageHours = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60);

        if (ageHours > CACHE_TTL_HOURS) {
            console.log(`[CacheService] Cache expired for: ${cacheKey} (${ageHours.toFixed(1)}h old)`);
            // Delete expired blob asynchronously
            blobClient.delete().catch(() => {});
            return null;
        }

        // Download and decompress
        const downloadResponse = await blobClient.download();
        const chunks = [];
        for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(chunk);
        }
        const compressedData = Buffer.concat(chunks);
        const decompressed = await gunzip(compressedData);
        const data = JSON.parse(decompressed.toString());

        console.log(`[CacheService] Cache hit for: ${cacheKey} (${ageHours.toFixed(1)}h old)`);

        return {
            data,
            cacheHit: true,
            cacheAge: ageHours,
            cacheExpiry: new Date(createdAt.getTime() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString()
        };
    } catch (error) {
        if (error.statusCode === 404) {
            return null;
        }
        console.error(`[CacheService] Cache read error for ${cacheKey}:`, error.message);
        return null;
    }
}

/**
 * Store data in cache.
 *
 * @param {string} cacheKey - Cache key (blob name)
 * @param {Object} data - Data to cache
 * @returns {Promise<boolean>} Success status
 */
async function setInCache(cacheKey, data) {
    if (!containerClient) {
        return false;
    }

    try {
        // Compress data
        const jsonString = JSON.stringify(data);
        const compressed = await gzip(jsonString);

        // Upload to blob
        const blockBlobClient = containerClient.getBlockBlobClient(cacheKey);
        await blockBlobClient.upload(compressed, compressed.length, {
            blobHTTPHeaders: {
                blobContentType: 'application/json',
                blobContentEncoding: 'gzip'
            },
            metadata: {
                cachedAt: new Date().toISOString(),
                originalSize: jsonString.length.toString(),
                compressedSize: compressed.length.toString()
            }
        });

        console.log(`[CacheService] Cached: ${cacheKey} (${(compressed.length / 1024).toFixed(1)} KB)`);
        return true;
    } catch (error) {
        console.error(`[CacheService] Cache write error for ${cacheKey}:`, error.message);
        return false;
    }
}

/**
 * Delete a specific cache entry.
 *
 * @param {string} cacheKey - Cache key to delete
 * @returns {Promise<boolean>} Success status
 */
async function invalidateCache(cacheKey) {
    if (!containerClient) {
        return false;
    }

    try {
        const blobClient = containerClient.getBlobClient(cacheKey);
        await blobClient.deleteIfExists();
        console.log(`[CacheService] Invalidated: ${cacheKey}`);
        return true;
    } catch (error) {
        console.error(`[CacheService] Cache invalidation error:`, error.message);
        return false;
    }
}

/**
 * Delete all cache entries matching a prefix.
 *
 * @param {string} prefix - Prefix to match (e.g., 'inventory/')
 * @returns {Promise<number>} Number of entries deleted
 */
async function invalidateCacheByPrefix(prefix) {
    if (!containerClient) {
        return 0;
    }

    let deletedCount = 0;

    try {
        for await (const blob of containerClient.listBlobsFlat({ prefix })) {
            const blobClient = containerClient.getBlobClient(blob.name);
            await blobClient.deleteIfExists();
            deletedCount++;
        }
        console.log(`[CacheService] Invalidated ${deletedCount} entries with prefix: ${prefix}`);
    } catch (error) {
        console.error(`[CacheService] Bulk invalidation error:`, error.message);
    }

    return deletedCount;
}

/**
 * Get cache statistics.
 *
 * @returns {Promise<Object>} Cache statistics
 */
async function getCacheStats() {
    if (!containerClient) {
        return { enabled: false };
    }

    let totalBlobs = 0;
    let totalSize = 0;
    let oldestBlob = null;
    let newestBlob = null;

    try {
        for await (const blob of containerClient.listBlobsFlat({ includeMetadata: true })) {
            totalBlobs++;
            totalSize += blob.properties.contentLength || 0;

            const createdAt = blob.properties.createdOn || blob.properties.lastModified;
            if (!oldestBlob || createdAt < oldestBlob) {
                oldestBlob = createdAt;
            }
            if (!newestBlob || createdAt > newestBlob) {
                newestBlob = createdAt;
            }
        }

        return {
            enabled: true,
            container: CONTAINER_NAME,
            ttlHours: CACHE_TTL_HOURS,
            totalEntries: totalBlobs,
            totalSizeKB: (totalSize / 1024).toFixed(1),
            oldestEntry: oldestBlob?.toISOString() || null,
            newestEntry: newestBlob?.toISOString() || null
        };
    } catch (error) {
        console.error('[CacheService] Stats error:', error.message);
        return { enabled: true, error: error.message };
    }
}

/**
 * Helper to wrap a query function with caching.
 *
 * @param {string} queryType - Query type for cache key
 * @param {Object} params - Query parameters
 * @param {Function} queryFn - Async function that performs the actual query
 * @returns {Promise<Object>} Query result with cache metadata
 */
async function withCache(queryType, params, queryFn) {
    const cacheKey = generateCacheKey(queryType, params);

    // Try cache first
    const cached = await getFromCache(cacheKey);
    if (cached) {
        return cached;
    }

    // Execute query
    const data = await queryFn();

    // Cache the result (async, don't wait)
    setInCache(cacheKey, data).catch(err =>
        console.error('[CacheService] Background cache write failed:', err.message)
    );

    return {
        data,
        cacheHit: false,
        cacheExpiry: new Date(Date.now() + CACHE_TTL_HOURS * 60 * 60 * 1000).toISOString()
    };
}

module.exports = {
    initializeCache,
    generateCacheKey,
    getFromCache,
    setInCache,
    invalidateCache,
    invalidateCacheByPrefix,
    getCacheStats,
    withCache
};
