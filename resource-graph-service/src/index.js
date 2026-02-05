/**
 * @fileoverview Resource Graph Service - Main Entry Point
 *
 * Express server for VM inventory and resource discovery.
 * Provides REST API with 24-hour blob caching and multi-tenant support.
 *
 * @version v11-microservices
 */

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');

const { initializeKeyVault, loadSecrets } = require('./shared/keyVaultService');
const { initializeAuth } = require('./shared/multiTenantAuth');
const { initializeCache, getCacheStats } = require('./services/cacheService');
const resourceRoutes = require('./routes/resourceRoutes');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '10mb' }));

// Request logging
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.path} - ${res.statusCode} (${duration}ms)`);
    });
    next();
});

// Health check endpoint
app.get('/health', async (req, res) => {
    try {
        const cacheStats = await getCacheStats();

        res.json({
            status: 'healthy',
            service: 'vmperf-resource-graph',
            version: 'v11-microservices',
            timestamp: new Date().toISOString(),
            cache: cacheStats
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Mount API routes
app.use('/api/resources', resourceRoutes);
app.use('/api', resourceRoutes); // Also mount at /api for /subscriptions, /tenants, /cache

// Error handling middleware
app.use((err, req, res, next) => {
    console.error('[Error]', err);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Not found',
        path: req.path
    });
});

/**
 * Initialize service and start server.
 */
async function startServer() {
    try {
        console.log('[Startup] Initializing Resource Graph Service...');

        // Initialize Key Vault
        const keyVaultUrl = process.env.KEY_VAULT_URL;
        if (!keyVaultUrl) {
            throw new Error('KEY_VAULT_URL environment variable is required');
        }
        initializeKeyVault(keyVaultUrl);

        // Load secrets
        console.log('[Startup] Loading secrets from Key Vault...');
        const secrets = await loadSecrets();

        // Initialize multi-tenant auth
        console.log('[Startup] Initializing multi-tenant authentication...');
        await initializeAuth(secrets);

        // Initialize cache
        const storageAccount = process.env.STORAGE_ACCOUNT_NAME || secrets.StorageAccountName;
        if (storageAccount) {
            console.log('[Startup] Initializing blob cache...');
            await initializeCache(storageAccount);
        } else {
            console.warn('[Startup] No storage account configured - caching disabled');
        }

        // Start server
        app.listen(PORT, () => {
            console.log(`[Startup] Resource Graph Service listening on port ${PORT}`);
            console.log(`[Startup] Health check: http://localhost:${PORT}/health`);
            console.log('[Startup] Ready to accept requests');
        });
    } catch (error) {
        console.error('[Startup] Failed to start server:', error);
        process.exit(1);
    }
}

// Handle graceful shutdown
process.on('SIGTERM', () => {
    console.log('[Shutdown] SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('[Shutdown] SIGINT received, shutting down gracefully...');
    process.exit(0);
});

// Start the server
startServer();
