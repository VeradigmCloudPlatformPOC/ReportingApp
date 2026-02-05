/**
 * @fileoverview Short-Term Log Analytics Service - Main Entry Point
 *
 * Express server for short-term KQL queries (≤10 days) with synchronous responses.
 *
 * @version v11-microservices
 */

const express = require('express');
const compression = require('compression');
const cors = require('cors');
const helmet = require('helmet');

const { initializeKeyVault, loadSecrets } = require('./shared/keyVaultService');
const { initializeAuth, getAllTenants } = require('./shared/multiTenantAuth');
const { MAX_DAYS, QUERY_TIMEOUT_MS, MAX_RESULTS } = require('./services/logAnalytics');
const queryRoutes = require('./routes/queryRoutes');

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(helmet());
app.use(cors());
app.use(compression());
app.use(express.json({ limit: '5mb' }));

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
        const tenants = getAllTenants();

        res.json({
            status: 'healthy',
            service: 'vmperf-la-short',
            version: 'v11-microservices',
            timestamp: new Date().toISOString(),
            limits: {
                maxDays: MAX_DAYS,
                queryTimeoutMs: QUERY_TIMEOUT_MS,
                maxResults: MAX_RESULTS
            },
            tenants: tenants.length
        });
    } catch (error) {
        res.status(503).json({
            status: 'unhealthy',
            error: error.message
        });
    }
});

// Mount API routes
app.use('/api/query', queryRoutes);
app.use('/api', queryRoutes); // Also mount for /metrics, /heartbeat, etc.

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
        console.log('[Startup] Initializing Short-Term Log Analytics Service...');
        console.log(`[Startup] Service limits: ${MAX_DAYS} days max, ${QUERY_TIMEOUT_MS}ms timeout`);

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

        // Start server
        app.listen(PORT, () => {
            console.log(`[Startup] Short-Term Log Analytics Service listening on port ${PORT}`);
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
