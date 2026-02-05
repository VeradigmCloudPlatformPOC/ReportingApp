/**
 * @fileoverview VM Right-Sizing Recommendation Service
 *
 * App 4 in the VMPerf microservices architecture.
 * Provides AI-powered right-sizing recommendations with:
 * - High-level summary via Slack
 * - Detailed report via email (fetched from Slack profile)
 *
 * @version v11-microservices
 */

const express = require('express');
const { initializeKeyVault, getAllSecrets } = require('./shared/keyVaultService');
const rightsizingRoutes = require('./routes/rightsizingRoutes');

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 3004;
const KEY_VAULT_URL = process.env.KEY_VAULT_URL || 'https://vmperf-kv-18406.vault.azure.net';

// Global secrets cache
let secrets = null;

/**
 * Load secrets from Key Vault and transform to expected format.
 */
async function loadSecrets() {
    if (secrets) return secrets;

    console.log('Loading secrets from Key Vault...');
    initializeKeyVault(KEY_VAULT_URL);
    const rawSecrets = await getAllSecrets();

    // Transform to format expected by routes
    secrets = {
        // Slack
        slackBotToken: rawSecrets.slack?.botToken || await getSlackBotToken(),
        // OpenAI
        openAiEndpoint: rawSecrets.openai?.endpoint,
        openAiKey: rawSecrets.openai?.apiKey,
        openAiDeployment: rawSecrets.openai?.deploymentName || 'gpt-4',
        // SendGrid - load separately
        sendGridApiKey: await getSendGridApiKey(),
        // Log Analytics
        logAnalyticsTenantId: process.env.LOG_ANALYTICS_TENANT_ID,
        logAnalyticsWorkspaceId: process.env.LOG_ANALYTICS_WORKSPACE_ID,
        // Service URLs (must be configured via environment variables in production)
        resourceGraphServiceUrl: process.env.RESOURCE_GRAPH_SERVICE_URL,
        logAnalyticsServiceUrl: process.env.SHORT_TERM_LA_SERVICE_URL,
        longTermLaServiceUrl: process.env.LONG_TERM_LA_SERVICE_URL,
        // Raw secrets for backward compatibility
        ...rawSecrets
    };

    console.log('Secrets loaded successfully');
    return secrets;
}

/**
 * Get Slack Bot Token from Key Vault.
 */
async function getSlackBotToken() {
    try {
        const { getSecret } = require('./shared/keyVaultService');
        return await getSecret('Slack-BotToken');
    } catch (e) {
        console.warn('Slack-BotToken not found in Key Vault');
        return null;
    }
}

/**
 * Get SendGrid API Key from Key Vault.
 */
async function getSendGridApiKey() {
    try {
        const { getSecret } = require('./shared/keyVaultService');
        return await getSecret('SendGrid-ApiKey');
    } catch (e) {
        console.warn('SendGrid-ApiKey not found in Key Vault');
        return null;
    }
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
        service: 'rightsizing-service',
        version: 'v11-microservices',
        timestamp: new Date().toISOString()
    };

    try {
        const secrets = await loadSecrets();
        health.keyVault = 'connected';
        health.openai = secrets.openAiEndpoint ? 'configured' : 'not configured';
        health.slack = secrets.slackBotToken ? 'configured' : 'not configured';
        health.sendGrid = secrets.sendGridApiKey ? 'configured' : 'not configured';
        health.dependencies = {
            app3_longTermLA: secrets.longTermLaServiceUrl || 'not configured',
            app1_resourceGraph: secrets.resourceGraphServiceUrl || 'not configured'
        };
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
app.use('/api/rightsizing', rightsizingRoutes);

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
        await loadSecrets();

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n===========================================`);
            console.log(`VM Right-Sizing Service (App 4)`);
            console.log(`===========================================`);
            console.log(`Port: ${PORT}`);
            console.log(`Key Vault: ${KEY_VAULT_URL}`);
            console.log(`\nEndpoints:`);
            console.log(`  GET  /health`);
            console.log(`  POST /api/rightsizing/analyze`);
            console.log(`  POST /api/rightsizing/quick`);
            console.log(`  POST /api/rightsizing/from-metrics`);
            console.log(`\nDependencies:`);
            console.log(`  App 3 (Long-Term LA): ${process.env.LONG_TERM_LA_SERVICE_URL || 'default'}`);
            console.log(`===========================================\n`);
        });
    } catch (error) {
        console.error('Failed to start service:', error);
        process.exit(1);
    }
}

start();

module.exports = { app, loadSecrets };
