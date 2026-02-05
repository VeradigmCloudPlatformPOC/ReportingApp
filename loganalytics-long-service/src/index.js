/**
 * @fileoverview Long-Term Log Analytics Service (App 3)
 *
 * Handles long-running KQL queries (>10 days), batched metrics collection,
 * and async job processing for large subscriptions.
 *
 * Features:
 * - Batched KQL queries for 30-day metrics
 * - Concurrent query execution with limits
 * - Azure Storage Queue for job management
 * - Progress tracking and notifications
 *
 * @version v11-microservices
 */

const express = require('express');
const { initializeKeyVault, loadSecrets: loadKeyVaultSecrets } = require('./shared/keyVaultService');
const { initializeAuth } = require('./shared/multiTenantAuth');
const metricsRoutes = require('./routes/metricsRoutes');
const jobRoutes = require('./routes/jobRoutes');
const { JobProcessor } = require('./jobs/jobProcessor');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3003;
const KEY_VAULT_URL = process.env.KEY_VAULT_URL || 'https://vmperf-kv-18406.vault.azure.net';

// Global secrets cache
let secrets = null;
let jobProcessor = null;

/**
 * Load secrets from Key Vault (same pattern as App 2).
 */
async function loadSecrets() {
    if (secrets) return secrets;

    console.log('[Startup] Loading secrets from Key Vault...');
    initializeKeyVault(KEY_VAULT_URL);

    // Use the standard loadSecrets from keyVaultService (same as App 2)
    secrets = await loadKeyVaultSecrets();

    // Add service URLs from environment
    secrets.resourceGraphServiceUrl = process.env.RESOURCE_GRAPH_SERVICE_URL;

    // Add logAnalytics object for backward compatibility with routes
    secrets.logAnalytics = {
        tenantId: secrets.LogAnalyticsTenantId,
        workspaceId: secrets.LogAnalyticsWorkspaceId,
        clientId: secrets.LogAnalyticsClientId
    };

    console.log('[Startup] Secrets loaded successfully');
    return secrets;
}

// Make secrets available to routes
app.use(async (req, res, next) => {
    try {
        req.secrets = await loadSecrets();
        next();
    } catch (error) {
        console.error('Failed to load secrets:', error.message);
        res.status(500).json({ error: 'Service configuration error' });
    }
});

// =============================================================================
// HEALTH CHECK
// =============================================================================
app.get('/health', async (req, res) => {
    const health = {
        status: 'healthy',
        service: 'loganalytics-long-service',
        version: 'v11-microservices',
        timestamp: new Date().toISOString()
    };

    try {
        const secrets = await loadSecrets();
        health.keyVault = 'connected';
        health.logAnalytics = secrets.logAnalytics?.workspaceId ? 'configured' : 'not configured';
        health.storage = secrets.storageConnectionString ? 'configured' : 'not configured';
        health.jobProcessor = jobProcessor?.isRunning ? 'running' : 'stopped';
        health.activeJobs = jobProcessor?.activeJobs || 0;
    } catch (error) {
        health.status = 'degraded';
        health.keyVault = 'disconnected';
        health.error = error.message;
    }

    res.json(health);
});

// =============================================================================
// API ROUTES
// =============================================================================
app.use('/api/metrics', metricsRoutes);
app.use('/api/jobs', jobRoutes);

// =============================================================================
// ERROR HANDLING
// =============================================================================
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        success: false,
        error: 'INTERNAL_ERROR',
        message: err.message
    });
});

// =============================================================================
// SERVER STARTUP
// =============================================================================
async function start() {
    try {
        // Pre-load secrets
        const secrets = await loadSecrets();

        // Initialize multi-tenant authentication with service principal credentials
        await initializeAuth(secrets);

        // Initialize job processor (optional - can run in background)
        if (secrets.storageConnectionString) {
            jobProcessor = new JobProcessor(secrets);
            // Start processing jobs in background
            jobProcessor.start().catch(err => {
                console.error('Job processor error:', err);
            });
        }

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n===========================================`);
            console.log(`Long-Term Log Analytics Service (App 3)`);
            console.log(`===========================================`);
            console.log(`Port: ${PORT}`);
            console.log(`Key Vault: ${KEY_VAULT_URL}`);
            console.log(`Log Analytics Workspace: ${secrets.logAnalytics?.workspaceId || 'not configured'}`);
            console.log(`\nEndpoints:`);
            console.log(`  GET  /health`);
            console.log(`  POST /api/metrics/collect`);
            console.log(`  POST /api/metrics/batch`);
            console.log(`  GET  /api/metrics/vm/:vmName`);
            console.log(`  POST /api/jobs/create`);
            console.log(`  GET  /api/jobs/:jobId`);
            console.log(`  GET  /api/jobs/:jobId/results`);
            console.log(`===========================================\n`);
        });
    } catch (error) {
        console.error('Failed to start service:', error);
        process.exit(1);
    }
}

start();

module.exports = { app, loadSecrets };
