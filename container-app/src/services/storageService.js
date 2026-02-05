/**
 * @fileoverview Azure Storage Service
 *
 * This module handles storage operations for the VM Performance Monitoring system:
 * - Azure Table Storage: Run metadata, tenant configurations, conversation state
 * - Azure Blob Storage: Analysis results (gzipped JSON)
 *
 * Storage Structure:
 * - Table 'runs': Run metadata with summary, status, timestamps
 * - Table 'tenants': Multi-tenant configuration
 * - Blob Container 'analysis-results': {runId}/results.json
 * - Blob Container 'inventory': {tenantId}/inventory.json
 *
 * @version v12-managed-identity
 * @author VM Performance Monitoring Team
 */

const { TableClient, TableServiceClient } = require('@azure/data-tables');
const { BlobServiceClient, BlobSASPermissions, generateBlobSASQueryParameters, StorageSharedKeyCredential } = require('@azure/storage-blob');
const { DefaultAzureCredential } = require('@azure/identity');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

// Storage clients (initialized on first use)
let tableServiceClient = null;
let blobServiceClient = null;
let runsTableClient = null;
let tenantsTableClient = null;
let analysisBlobContainer = null;
let inventoryBlobContainer = null;
let reportsBlobContainer = null;
let storageAccountName = null;
let storageAccountKey = null;
let credential = null;

/**
 * Initialize storage clients with managed identity (DefaultAzureCredential).
 * Falls back to connection string if provided for local development.
 *
 * @param {string} connectionStringOrAccountName - Azure Storage account name (for managed identity) or connection string (fallback)
 */
async function initializeStorage(connectionStringOrAccountName) {
    if (tableServiceClient && blobServiceClient) {
        return; // Already initialized
    }

    console.log('Initializing Azure Storage clients...');

    // Check if it's a connection string or account name
    const isConnectionString = connectionStringOrAccountName && connectionStringOrAccountName.includes('AccountKey=');

    if (isConnectionString) {
        // Legacy: Use connection string (for local development)
        console.log('Using connection string authentication (legacy mode)');

        // Extract account name and key from connection string for SAS generation
        const accountNameMatch = connectionStringOrAccountName.match(/AccountName=([^;]+)/);
        const accountKeyMatch = connectionStringOrAccountName.match(/AccountKey=([^;]+)/);
        if (accountNameMatch && accountKeyMatch) {
            storageAccountName = accountNameMatch[1];
            storageAccountKey = accountKeyMatch[1];
        }

        // Initialize Table Storage
        tableServiceClient = TableServiceClient.fromConnectionString(connectionStringOrAccountName);
        runsTableClient = TableClient.fromConnectionString(connectionStringOrAccountName, 'runs');
        tenantsTableClient = TableClient.fromConnectionString(connectionStringOrAccountName, 'tenants');

        // Initialize Blob Storage
        blobServiceClient = BlobServiceClient.fromConnectionString(connectionStringOrAccountName);
    } else {
        // Use managed identity (DefaultAzureCredential)
        storageAccountName = connectionStringOrAccountName || process.env.AZURE_STORAGE_ACCOUNT_NAME || 'vmperfstore18406';
        console.log(`Using managed identity authentication for storage account: ${storageAccountName}`);

        credential = new DefaultAzureCredential();

        const tableEndpoint = `https://${storageAccountName}.table.core.windows.net`;
        const blobEndpoint = `https://${storageAccountName}.blob.core.windows.net`;

        // Initialize Table Storage with managed identity
        tableServiceClient = new TableServiceClient(tableEndpoint, credential);
        runsTableClient = new TableClient(tableEndpoint, 'runs', credential);
        tenantsTableClient = new TableClient(tableEndpoint, 'tenants', credential);

        // Initialize Blob Storage with managed identity
        blobServiceClient = new BlobServiceClient(blobEndpoint, credential);
    }

    // Initialize blob containers
    analysisBlobContainer = blobServiceClient.getContainerClient('analysis-results');
    inventoryBlobContainer = blobServiceClient.getContainerClient('inventory');
    reportsBlobContainer = blobServiceClient.getContainerClient('reports');

    // Ensure tables and containers exist
    await Promise.all([
        runsTableClient.createTable().catch(err => {
            if (err.statusCode !== 409) throw err; // 409 = already exists
        }),
        tenantsTableClient.createTable().catch(err => {
            if (err.statusCode !== 409) throw err;
        }),
        analysisBlobContainer.createIfNotExists(),
        inventoryBlobContainer.createIfNotExists(),
        reportsBlobContainer.createIfNotExists()
    ]);

    console.log('Azure Storage initialized successfully');
}

// =============================================================================
// RUN OPERATIONS
// =============================================================================

/**
 * Save a new run record to Table Storage.
 *
 * @param {Object} runData - Run metadata
 * @param {string} runData.runId - Unique run identifier
 * @param {string} runData.subscriptionId - Target subscription (or 'all' for multi-tenant)
 * @param {string} runData.tenantId - Tenant ID (optional, for multi-tenant)
 * @param {Object} runData.summary - Run summary statistics
 * @param {string} runData.status - Run status (IN_PROGRESS, COMPLETED, FAILED)
 * @param {string} runData.channelId - Slack channel ID (optional)
 * @param {string} runData.requestedBy - User who triggered the run (optional)
 * @returns {Promise<void>}
 */
async function saveRun(runData) {
    const entity = {
        partitionKey: runData.subscriptionId || 'all',
        rowKey: runData.runId,
        tenantId: runData.tenantId || null,
        status: runData.status,
        summary: JSON.stringify(runData.summary || {}),
        channelId: runData.channelId || null,
        requestedBy: runData.requestedBy || null,
        startTime: runData.startTime || new Date().toISOString(),
        endTime: runData.endTime || null,
        duration: runData.duration || null,
        vmCount: runData.summary?.totalVMs || 0,
        errorMessage: runData.errorMessage || null
    };

    await runsTableClient.upsertEntity(entity);
    console.log(`  Run ${runData.runId} saved to Table Storage`);
}

/**
 * Update an existing run record.
 *
 * @param {string} subscriptionId - Partition key
 * @param {string} runId - Row key
 * @param {Object} updates - Fields to update
 * @returns {Promise<void>}
 */
async function updateRun(subscriptionId, runId, updates) {
    const entity = {
        partitionKey: subscriptionId,
        rowKey: runId,
        ...updates
    };

    if (updates.summary) {
        entity.summary = JSON.stringify(updates.summary);
    }

    await runsTableClient.updateEntity(entity, 'Merge');
    console.log(`  Run ${runId} updated`);
}

/**
 * Get a specific run by ID.
 *
 * @param {string} subscriptionId - Partition key
 * @param {string} runId - Row key
 * @returns {Promise<Object|null>} Run record or null if not found
 */
async function getRun(subscriptionId, runId) {
    try {
        const entity = await runsTableClient.getEntity(subscriptionId, runId);
        return {
            ...entity,
            summary: JSON.parse(entity.summary || '{}')
        };
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

/**
 * Get the latest run for a subscription.
 *
 * @param {string} subscriptionId - Subscription ID (or 'all')
 * @returns {Promise<Object|null>} Latest run record or null
 */
async function getLatestRun(subscriptionId = 'all') {
    const runs = [];
    const queryFilter = `PartitionKey eq '${subscriptionId}'`;

    for await (const entity of runsTableClient.listEntities({
        queryOptions: { filter: queryFilter }
    })) {
        runs.push({
            ...entity,
            summary: JSON.parse(entity.summary || '{}')
        });
    }

    if (runs.length === 0) return null;

    // Sort by rowKey (runId contains timestamp) descending
    runs.sort((a, b) => b.rowKey.localeCompare(a.rowKey));
    return runs[0];
}

/**
 * Get recent runs (last N runs).
 *
 * @param {string} subscriptionId - Subscription ID (or 'all')
 * @param {number} limit - Maximum number of runs to return
 * @returns {Promise<Array>} Array of run records
 */
async function getRecentRuns(subscriptionId = 'all', limit = 10) {
    const runs = [];
    const queryFilter = `PartitionKey eq '${subscriptionId}'`;

    for await (const entity of runsTableClient.listEntities({
        queryOptions: { filter: queryFilter }
    })) {
        runs.push({
            ...entity,
            summary: JSON.parse(entity.summary || '{}')
        });
    }

    // Sort by rowKey descending and take limit
    runs.sort((a, b) => b.rowKey.localeCompare(a.rowKey));
    return runs.slice(0, limit);
}

// =============================================================================
// ANALYSIS RESULTS OPERATIONS (BLOB)
// =============================================================================

/**
 * Save analysis results to Blob Storage (gzipped).
 *
 * @param {string} runId - Run identifier
 * @param {Array} analyses - Array of VM analysis results
 * @returns {Promise<string>} Blob URL
 */
async function saveAnalysisResults(runId, analyses) {
    const blobName = `${runId}/results.json`;
    const blobClient = analysisBlobContainer.getBlockBlobClient(blobName);

    // Gzip the JSON data
    const jsonData = JSON.stringify(analyses, null, 2);
    const compressedData = await gzip(jsonData);

    // Upload with gzip content encoding
    await blobClient.upload(compressedData, compressedData.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json',
            blobContentEncoding: 'gzip'
        }
    });

    console.log(`  Analysis results saved to blob: ${blobName} (${(compressedData.length / 1024).toFixed(1)} KB gzipped)`);
    return blobClient.url;
}

/**
 * Get analysis results from Blob Storage.
 *
 * @param {string} runId - Run identifier
 * @returns {Promise<Array|null>} Array of VM analyses or null if not found
 */
async function getAnalysisResults(runId) {
    const blobName = `${runId}/results.json`;
    const blobClient = analysisBlobContainer.getBlockBlobClient(blobName);

    try {
        const downloadResponse = await blobClient.download(0);
        const chunks = [];

        for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);

        // Check if gzipped and decompress
        let jsonData;
        if (downloadResponse.contentEncoding === 'gzip' || buffer[0] === 0x1f) {
            const decompressed = await gunzip(buffer);
            jsonData = decompressed.toString('utf-8');
        } else {
            jsonData = buffer.toString('utf-8');
        }

        return JSON.parse(jsonData);
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

/**
 * Get VMs filtered by status from analysis results.
 *
 * @param {string} runId - Run identifier
 * @param {string} status - Status to filter by (UNDERUTILIZED, OVERUTILIZED, OPTIMAL, NEEDS_REVIEW)
 * @returns {Promise<Array>} Filtered VM analyses
 */
async function getVMsByStatus(runId, status) {
    const analyses = await getAnalysisResults(runId);
    if (!analyses) return [];

    return analyses.filter(a => a.analysis?.status === status);
}

/**
 * Get details for a specific VM from analysis results.
 *
 * @param {string} runId - Run identifier
 * @param {string} vmName - VM name to find
 * @returns {Promise<Object|null>} VM analysis or null if not found
 */
async function getVMDetails(runId, vmName) {
    const analyses = await getAnalysisResults(runId);
    if (!analyses) return null;

    return analyses.find(a =>
        (a.vmData?.VMName || a.VMName)?.toLowerCase() === vmName.toLowerCase()
    ) || null;
}

/**
 * Search VMs by name pattern.
 *
 * @param {string} runId - Run identifier
 * @param {string} pattern - Search pattern (case-insensitive contains)
 * @returns {Promise<Array>} Matching VM analyses
 */
async function searchVMs(runId, pattern) {
    const analyses = await getAnalysisResults(runId);
    if (!analyses) return [];

    const lowerPattern = pattern.toLowerCase();
    return analyses.filter(a => {
        const vmName = (a.vmData?.VMName || a.VMName || '').toLowerCase();
        return vmName.includes(lowerPattern);
    });
}

// =============================================================================
// TENANT CONFIGURATION OPERATIONS
// =============================================================================

/**
 * Save or update a tenant configuration.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} tenantConfig.tenantId - Azure AD tenant GUID
 * @param {string} tenantConfig.tenantName - Friendly name (e.g., "Production")
 * @param {Array} tenantConfig.subscriptionIds - Array of subscription IDs
 * @param {Array} tenantConfig.logAnalyticsWorkspaces - Array of workspace configs
 * @param {Object} tenantConfig.servicePrincipal - SP credentials reference
 * @param {boolean} tenantConfig.enabled - Whether tenant is active
 * @returns {Promise<void>}
 */
async function saveTenantConfig(tenantConfig) {
    const entity = {
        partitionKey: 'config',
        rowKey: tenantConfig.tenantId,
        tenantName: tenantConfig.tenantName,
        subscriptionIds: JSON.stringify(tenantConfig.subscriptionIds || []),
        logAnalyticsWorkspaces: JSON.stringify(tenantConfig.logAnalyticsWorkspaces || []),
        servicePrincipal: JSON.stringify(tenantConfig.servicePrincipal || {}),
        enabled: tenantConfig.enabled !== false,
        createdAt: tenantConfig.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    await tenantsTableClient.upsertEntity(entity);
    console.log(`  Tenant config saved: ${tenantConfig.tenantName} (${tenantConfig.tenantId})`);
}

/**
 * Get a specific tenant configuration.
 *
 * @param {string} tenantId - Tenant ID (Azure AD GUID)
 * @returns {Promise<Object|null>} Tenant config or null if not found
 */
async function getTenantConfig(tenantId) {
    try {
        const entity = await tenantsTableClient.getEntity('config', tenantId);
        return parseTenantEntity(entity);
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

/**
 * Get all tenant configurations.
 *
 * @param {boolean} enabledOnly - If true, only return enabled tenants
 * @returns {Promise<Array>} Array of tenant configs
 */
async function getTenantConfigs(enabledOnly = true) {
    const tenants = [];

    for await (const entity of tenantsTableClient.listEntities({
        queryOptions: { filter: `PartitionKey eq 'config'` }
    })) {
        const tenant = parseTenantEntity(entity);
        if (!enabledOnly || tenant.enabled) {
            tenants.push(tenant);
        }
    }

    return tenants;
}

/**
 * Delete a tenant configuration.
 *
 * @param {string} tenantId - Tenant ID to delete
 * @returns {Promise<void>}
 */
async function deleteTenantConfig(tenantId) {
    await tenantsTableClient.deleteEntity('config', tenantId);
    console.log(`  Tenant config deleted: ${tenantId}`);
}

/**
 * Parse tenant entity from Table Storage format.
 *
 * @param {Object} entity - Raw table entity
 * @returns {Object} Parsed tenant config
 */
function parseTenantEntity(entity) {
    return {
        tenantId: entity.rowKey,
        tenantName: entity.tenantName,
        subscriptionIds: JSON.parse(entity.subscriptionIds || '[]'),
        logAnalyticsWorkspaces: JSON.parse(entity.logAnalyticsWorkspaces || '[]'),
        servicePrincipal: JSON.parse(entity.servicePrincipal || '{}'),
        enabled: entity.enabled,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt
    };
}

// =============================================================================
// INVENTORY OPERATIONS (BLOB)
// =============================================================================

/**
 * Save inventory snapshot to Blob Storage.
 *
 * @param {string} tenantId - Tenant ID (or 'all')
 * @param {Array} inventory - Array of VM inventory records
 * @returns {Promise<string>} Blob URL
 */
async function saveInventory(tenantId, inventory) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blobName = `${tenantId}/${timestamp}.json`;
    const blobClient = inventoryBlobContainer.getBlockBlobClient(blobName);

    const jsonData = JSON.stringify(inventory, null, 2);
    const compressedData = await gzip(jsonData);

    await blobClient.upload(compressedData, compressedData.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json',
            blobContentEncoding: 'gzip'
        }
    });

    // Also save as 'latest.json' for quick access
    const latestBlobClient = inventoryBlobContainer.getBlockBlobClient(`${tenantId}/latest.json`);
    await latestBlobClient.upload(compressedData, compressedData.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json',
            blobContentEncoding: 'gzip'
        }
    });

    console.log(`  Inventory saved for tenant ${tenantId}: ${inventory.length} VMs`);
    return blobClient.url;
}

/**
 * Get latest inventory for a tenant.
 *
 * @param {string} tenantId - Tenant ID (or 'all')
 * @returns {Promise<Array|null>} Array of VM inventory records or null
 */
async function getLatestInventory(tenantId) {
    const blobName = `${tenantId}/latest.json`;
    const blobClient = inventoryBlobContainer.getBlockBlobClient(blobName);

    try {
        const downloadResponse = await blobClient.download(0);
        const chunks = [];

        for await (const chunk of downloadResponse.readableStreamBody) {
            chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        const decompressed = await gunzip(buffer);
        return JSON.parse(decompressed.toString('utf-8'));
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

// =============================================================================
// CROSS-PARTITION RUN QUERIES
// =============================================================================

/**
 * Get the latest run across ALL partitions.
 * This queries all runs regardless of subscription partition key.
 *
 * @param {number} maxResults - Maximum results to scan (default 100)
 * @returns {Promise<Object|null>} Latest run record or null if none found
 */
async function getLatestRunAcrossAllPartitions(maxResults = 100) {
    const runs = [];
    let count = 0;

    // Query without partition filter to get all runs
    for await (const entity of runsTableClient.listEntities()) {
        runs.push({
            ...entity,
            summary: JSON.parse(entity.summary || '{}')
        });
        count++;
        if (count >= maxResults) break;
    }

    if (runs.length === 0) return null;

    // Sort by rowKey (runId contains timestamp) descending
    runs.sort((a, b) => b.rowKey.localeCompare(a.rowKey));
    return runs[0];
}

/**
 * Get recent runs across ALL partitions.
 *
 * @param {number} limit - Maximum number of runs to return
 * @returns {Promise<Array>} Array of run records sorted by most recent first
 */
async function getRecentRunsAcrossAllPartitions(limit = 10) {
    const runs = [];

    // Query without partition filter
    for await (const entity of runsTableClient.listEntities()) {
        runs.push({
            ...entity,
            summary: JSON.parse(entity.summary || '{}')
        });
    }

    // Sort by rowKey descending and take limit
    runs.sort((a, b) => b.rowKey.localeCompare(a.rowKey));
    return runs.slice(0, limit);
}

// =============================================================================
// REPORT STORAGE WITH SAS TOKENS
// =============================================================================

/**
 * Save an HTML report to Blob Storage.
 *
 * @param {string} runId - Run identifier
 * @param {string} reportType - Type of report ('technical' or 'executive')
 * @param {string} htmlContent - HTML content of the report
 * @param {Object} metadata - Optional metadata (subscriptionId, tenantName, etc.)
 * @returns {Promise<string>} Blob name (path) for the saved report
 */
async function saveReportToBlob(runId, reportType, htmlContent, metadata = {}) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const blobName = `${runId}/${reportType}-report.html`;
    const blobClient = reportsBlobContainer.getBlockBlobClient(blobName);

    // Compress the HTML
    const compressedData = await gzip(htmlContent);

    // Upload with metadata for tracking
    await blobClient.upload(compressedData, compressedData.length, {
        blobHTTPHeaders: {
            blobContentType: 'text/html',
            blobContentEncoding: 'gzip'
        },
        metadata: {
            runId,
            reportType,
            subscriptionId: metadata.subscriptionId || '',
            tenantName: metadata.tenantName || '',
            generatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 days
        }
    });

    console.log(`  Report saved to blob: ${blobName} (${(compressedData.length / 1024).toFixed(1)} KB gzipped)`);
    return blobName;
}

/**
 * Generate a SAS URL for downloading a report.
 * Uses User Delegation SAS with managed identity, or falls back to shared key.
 *
 * @param {string} runId - Run identifier
 * @param {string} reportType - Type of report ('technical' or 'executive')
 * @param {number} expiryHours - Hours until SAS expires (default 1 hour)
 * @returns {Promise<Object>} Object with url, expiresAt, and success status
 */
async function generateReportSasUrl(runId, reportType, expiryHours = 1) {
    const blobName = `${runId}/${reportType}-report.html`;
    const blobClient = reportsBlobContainer.getBlockBlobClient(blobName);

    // Check if blob exists
    const exists = await blobClient.exists();
    if (!exists) {
        return {
            success: false,
            error: `Report not found: ${blobName}`,
            url: null,
            expiresAt: null
        };
    }

    // Get blob metadata to check if within 7-day window
    const properties = await blobClient.getProperties();
    const expiresAtStr = properties.metadata?.expiresAt;
    if (expiresAtStr) {
        const expiresAt = new Date(expiresAtStr);
        if (expiresAt < new Date()) {
            return {
                success: false,
                error: 'Report has expired (older than 7 days)',
                url: null,
                expiresAt: null
            };
        }
    }

    // Generate SAS token
    const expiresOn = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const startsOn = new Date(Date.now() - 5 * 60 * 1000); // 5 minutes ago (clock skew)

    let sasUrl;

    if (storageAccountKey) {
        // Use shared key credential for SAS signing (legacy/local dev)
        const sharedKeyCredential = new StorageSharedKeyCredential(storageAccountName, storageAccountKey);

        const sasQueryParams = generateBlobSASQueryParameters({
            containerName: 'reports',
            blobName: blobName,
            permissions: BlobSASPermissions.parse('r'),
            startsOn: startsOn,
            expiresOn: expiresOn,
            contentType: 'text/html',
            contentDisposition: `attachment; filename="${reportType}-report-${runId}.html"`,
            version: '2022-11-02'
        }, sharedKeyCredential);

        sasUrl = `${blobClient.url}?${sasQueryParams.toString()}`;
    } else if (credential) {
        // Use User Delegation SAS with managed identity
        const { generateBlobSASQueryParameters: genSas, BlobSASPermissions: SASPerms } = require('@azure/storage-blob');

        // Get user delegation key (valid for up to 7 days)
        const userDelegationKey = await blobServiceClient.getUserDelegationKey(startsOn, expiresOn);

        const sasQueryParams = genSas({
            containerName: 'reports',
            blobName: blobName,
            permissions: SASPerms.parse('r'),
            startsOn: startsOn,
            expiresOn: expiresOn,
            contentType: 'text/html',
            contentDisposition: `attachment; filename="${reportType}-report-${runId}.html"`,
            version: '2022-11-02'
        }, userDelegationKey, storageAccountName);

        sasUrl = `${blobClient.url}?${sasQueryParams.toString()}`;
    } else {
        return {
            success: false,
            error: 'No credential available for SAS generation',
            url: null,
            expiresAt: null
        };
    }

    return {
        success: true,
        url: sasUrl,
        expiresAt: expiresOn.toISOString(),
        reportType,
        runId
    };
}

/**
 * Save raw JSON analysis data to blob storage for download.
 *
 * @param {string} runId - Run identifier
 * @param {Array} analysisData - Raw VM analysis data
 * @param {Object} metadata - Additional metadata
 * @returns {Promise<string>} Blob name
 */
async function saveJsonDataToBlob(runId, analysisData, metadata = {}) {
    const blobName = `${runId}/raw-data.json`;
    const blobClient = reportsBlobContainer.getBlockBlobClient(blobName);

    // Create JSON with metadata header
    const jsonData = JSON.stringify({
        runId,
        generatedAt: new Date().toISOString(),
        subscriptionId: metadata.subscriptionId || '',
        tenantName: metadata.tenantName || '',
        vmCount: analysisData.length,
        data: analysisData
    }, null, 2);

    // Compress the JSON
    const compressedData = await gzip(jsonData);

    // Upload with metadata
    await blobClient.upload(compressedData, compressedData.length, {
        blobHTTPHeaders: {
            blobContentType: 'application/json',
            blobContentEncoding: 'gzip'
        },
        metadata: {
            runId,
            dataType: 'raw-analysis',
            subscriptionId: metadata.subscriptionId || '',
            tenantName: metadata.tenantName || '',
            generatedAt: new Date().toISOString(),
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        }
    });

    console.log(`  Raw JSON data saved to blob: ${blobName} (${(compressedData.length / 1024).toFixed(1)} KB gzipped)`);
    return blobName;
}

/**
 * Generate a SAS URL for downloading raw JSON data.
 * Uses User Delegation SAS with managed identity, or falls back to shared key.
 *
 * @param {string} runId - Run identifier
 * @param {number} expiryHours - Hours until SAS expires (default 1 hour)
 * @returns {Promise<Object>} Object with url, expiresAt, and success status
 */
async function generateJsonSasUrl(runId, expiryHours = 1) {
    const blobName = `${runId}/raw-data.json`;
    const blobClient = reportsBlobContainer.getBlockBlobClient(blobName);

    // Check if blob exists
    const exists = await blobClient.exists();
    if (!exists) {
        return {
            success: false,
            error: `Raw data not found: ${blobName}`,
            url: null,
            expiresAt: null
        };
    }

    // Generate SAS token
    const expiresOn = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const startsOn = new Date(Date.now() - 5 * 60 * 1000);

    let sasUrl;

    if (storageAccountKey) {
        // Use shared key credential for SAS signing (legacy/local dev)
        const sharedKeyCredential = new StorageSharedKeyCredential(storageAccountName, storageAccountKey);

        const sasQueryParams = generateBlobSASQueryParameters({
            containerName: 'reports',
            blobName: blobName,
            permissions: BlobSASPermissions.parse('r'),
            startsOn: startsOn,
            expiresOn: expiresOn,
            contentType: 'application/json',
            contentDisposition: `attachment; filename="vm-analysis-${runId}.json"`,
            version: '2022-11-02'
        }, sharedKeyCredential);

        sasUrl = `${blobClient.url}?${sasQueryParams.toString()}`;
    } else if (credential) {
        // Use User Delegation SAS with managed identity
        const userDelegationKey = await blobServiceClient.getUserDelegationKey(startsOn, expiresOn);

        const sasQueryParams = generateBlobSASQueryParameters({
            containerName: 'reports',
            blobName: blobName,
            permissions: BlobSASPermissions.parse('r'),
            startsOn: startsOn,
            expiresOn: expiresOn,
            contentType: 'application/json',
            contentDisposition: `attachment; filename="vm-analysis-${runId}.json"`,
            version: '2022-11-02'
        }, userDelegationKey, storageAccountName);

        sasUrl = `${blobClient.url}?${sasQueryParams.toString()}`;
    } else {
        return {
            success: false,
            error: 'No credential available for SAS generation',
            url: null,
            expiresAt: null
        };
    }

    return {
        success: true,
        url: sasUrl,
        expiresAt: expiresOn.toISOString(),
        dataType: 'raw-json',
        runId
    };
}

/**
 * Get report metadata without downloading content.
 *
 * @param {string} runId - Run identifier
 * @param {string} reportType - Type of report ('technical' or 'executive')
 * @returns {Promise<Object|null>} Report metadata or null if not found
 */
async function getReportMetadata(runId, reportType) {
    const blobName = `${runId}/${reportType}-report.html`;
    const blobClient = reportsBlobContainer.getBlockBlobClient(blobName);

    try {
        const properties = await blobClient.getProperties();
        return {
            runId,
            reportType,
            blobName,
            contentLength: properties.contentLength,
            generatedAt: properties.metadata?.generatedAt,
            expiresAt: properties.metadata?.expiresAt,
            subscriptionId: properties.metadata?.subscriptionId,
            tenantName: properties.metadata?.tenantName,
            lastModified: properties.lastModified
        };
    } catch (err) {
        if (err.statusCode === 404) return null;
        throw err;
    }
}

/**
 * List all reports for a run.
 *
 * @param {string} runId - Run identifier
 * @returns {Promise<Array>} Array of report metadata objects
 */
async function listReportsForRun(runId) {
    const reports = [];
    const prefix = `${runId}/`;

    for await (const blob of reportsBlobContainer.listBlobsFlat({ prefix })) {
        if (blob.name.endsWith('-report.html')) {
            const reportType = blob.name.includes('technical') ? 'technical' : 'executive';
            reports.push({
                runId,
                reportType,
                blobName: blob.name,
                contentLength: blob.properties.contentLength,
                lastModified: blob.properties.lastModified
            });
        }
    }

    return reports;
}

module.exports = {
    initializeStorage,
    // Run operations
    saveRun,
    updateRun,
    getRun,
    getLatestRun,
    getRecentRuns,
    getLatestRunAcrossAllPartitions,
    getRecentRunsAcrossAllPartitions,
    // Analysis results operations
    saveAnalysisResults,
    getAnalysisResults,
    getVMsByStatus,
    getVMDetails,
    searchVMs,
    // Tenant configuration operations
    saveTenantConfig,
    getTenantConfig,
    getTenantConfigs,
    deleteTenantConfig,
    // Inventory operations
    saveInventory,
    getLatestInventory,
    // Report operations with SAS
    saveReportToBlob,
    generateReportSasUrl,
    getReportMetadata,
    listReportsForRun,
    // Raw JSON data operations
    saveJsonDataToBlob,
    generateJsonSasUrl
};
