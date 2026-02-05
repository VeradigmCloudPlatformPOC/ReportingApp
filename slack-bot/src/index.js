/**
 * @fileoverview VM Performance Multi-Channel Bot - Main Entry Point
 *
 * This is the main entry point for the VM Performance Bot using
 * direct Slack integration and Azure Bot Service for Teams.
 *
 * Features:
 * - Natural language conversations via Azure AI Foundry Agent
 * - Direct Slack Events API integration (existing Slack app)
 * - Microsoft Teams support via Azure Bot Service
 * - Multi-turn conversation with context memory
 * - Tool-based integration with VM Performance Orchestrator
 *
 * Architecture:
 * - Express server with dual endpoints
 * - Direct Slack Events API handling (no Azure Bot Service for Slack)
 * - Azure Bot Service for Teams channel only
 * - Azure AI Foundry Agent for NLU and conversation
 * - Cosmos DB for conversation state
 *
 * @version v8-agent
 * @author VM Performance Monitoring Team
 */

const express = require('express');
const crypto = require('crypto');
const {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication
} = require('botbuilder');
const { VMPerfBot } = require('./bot/vmPerfBot');
const { initializeServices } = require('./services/orchestrationClient');
const {
    initializeKeyVault,
    getAllSecrets,
    healthCheck: kvHealthCheck
} = require('./services/keyVaultService');

// Configuration - non-sensitive values from environment
const config = {
    port: process.env.PORT || 3978,
    keyVaultUrl: process.env.KEY_VAULT_URL || 'https://vmperf-kv-18406.vault.azure.net',
    orchestratorUrl: process.env.ORCHESTRATOR_URL || 'http://localhost:3000',

    // Microservices URLs (v11 architecture)
    resourceGraphUrl: process.env.RESOURCE_GRAPH_SERVICE_URL || 'https://vmperf-resource-graph.calmsand-17418731.westus2.azurecontainerapps.io',
    shortTermLAUrl: process.env.SHORT_TERM_LA_SERVICE_URL || 'https://vmperf-la-short.calmsand-17418731.westus2.azurecontainerapps.io',
    longTermLAUrl: process.env.LONG_TERM_LA_SERVICE_URL || null, // App 3 not yet deployed

    // Sensitive values loaded from Key Vault at startup
    microsoftAppId: null,
    microsoftAppPassword: null,
    microsoftAppTenantId: null,
    storageConnectionString: null,

    // AI Foundry Agent configuration
    aiFoundry: {
        projectEndpoint: null,
        agentId: null
    },

    // Cosmos DB for conversation state
    cosmosDb: {
        connectionString: null,
        database: 'vmperf-bot',
        container: 'conversations'
    },

    // Slack credentials (for signature verification)
    slack: null,

    // OpenAI (fallback for non-agent mode)
    openai: null
};

/**
 * Load all secrets from Key Vault.
 * All sensitive configuration MUST come from Key Vault.
 */
async function loadSecretsFromKeyVault() {
    console.log('Loading secrets from Key Vault...');

    initializeKeyVault(config.keyVaultUrl);

    const secrets = await getAllSecrets();

    // Bot Framework credentials
    config.microsoftAppId = secrets.bot?.microsoftAppId;
    config.microsoftAppPassword = secrets.bot?.microsoftAppPassword;
    config.microsoftAppTenantId = secrets.bot?.microsoftAppTenantId;

    // Storage
    config.storageConnectionString = secrets.storageConnectionString;

    // AI Foundry Agent
    if (secrets.aiFoundry) {
        config.aiFoundry.projectEndpoint = secrets.aiFoundry.projectEndpoint;
        config.aiFoundry.agentId = secrets.aiFoundry.agentId;
    }

    // Cosmos DB (may use storage connection or separate)
    if (secrets.cosmosDb?.connectionString) {
        config.cosmosDb.connectionString = secrets.cosmosDb.connectionString;
    }

    // Slack (for signature verification and direct API)
    config.slack = secrets.slack;

    // OpenAI (fallback)
    config.openai = secrets.openai;

    console.log('Secrets loaded successfully from Key Vault');
    console.log(`  Bot Framework: ${config.microsoftAppId ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`  AI Foundry Agent: ${config.aiFoundry?.agentId ? 'CONFIGURED' : 'NOT CONFIGURED'}`);
    console.log(`  Cosmos DB: ${config.cosmosDb?.connectionString ? 'CONFIGURED' : 'NOT CONFIGURED (using in-memory)'}`);
}

/**
 * Verify Slack request signature.
 * Prevents unauthorized requests from being processed.
 */
function verifySlackSignature(req, signingSecret) {
    const signature = req.headers['x-slack-signature'];
    const timestamp = req.headers['x-slack-request-timestamp'];

    if (!signature || !timestamp) {
        return false;
    }

    // Check timestamp is within 5 minutes
    const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
    if (parseInt(timestamp) < fiveMinutesAgo) {
        return false;
    }

    // Compute expected signature
    const sigBasestring = `v0:${timestamp}:${req.rawBody}`;
    const mySignature = 'v0=' + crypto
        .createHmac('sha256', signingSecret)
        .update(sigBasestring)
        .digest('hex');

    // Constant-time comparison
    return crypto.timingSafeEqual(
        Buffer.from(mySignature),
        Buffer.from(signature)
    );
}

// Bot and adapter are created in start() after loading secrets
let bot = null;
let adapter = null;

// Create Express server
const app = express();

// Raw body parser for Slack signature verification
app.use(express.json({
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

app.use(express.urlencoded({
    extended: true,
    verify: (req, res, buf) => {
        req.rawBody = buf.toString();
    }
}));

// =============================================================================
// HEALTH CHECK ENDPOINT
// =============================================================================
app.get('/health', async (req, res) => {
    const kvHealth = await kvHealthCheck().catch(() => ({ error: 'Key Vault check failed' }));

    // Get bot health if initialized
    let botHealth = { bot: 'not initialized' };
    if (bot) {
        try {
            botHealth = await bot.healthCheck();
        } catch (error) {
            botHealth = { bot: 'error', error: error.message };
        }
    }

    res.json({
        status: 'healthy',
        version: 'v11-microservices',
        timestamp: new Date().toISOString(),
        keyVault: kvHealth.keyVaultAccessible ? 'connected' : 'disconnected',
        botFramework: adapter ? 'configured' : 'not configured',
        aiFoundryAgent: config.aiFoundry?.agentId ? 'configured' : 'not configured',
        services: {
            resourceGraph: config.resourceGraphUrl || 'not configured',
            shortTermLA: config.shortTermLAUrl || 'not configured',
            longTermLA: config.longTermLAUrl || 'not configured',
            legacyOrchestrator: config.orchestratorUrl
        },
        ...botHealth
    });
});

// =============================================================================
// BOT FRAMEWORK MESSAGING ENDPOINT
// =============================================================================
// This is the primary endpoint for all Bot Framework channels (Slack, Teams)
app.post('/api/messages', async (req, res) => {
    if (!adapter || !bot) {
        return res.status(503).json({
            error: 'Bot not initialized',
            message: 'The bot is still starting up. Please try again.'
        });
    }

    try {
        await adapter.process(req, res, (context) => bot.run(context));
    } catch (error) {
        console.error('Error processing message:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================================================
// SLACK EVENTS API ENDPOINT (direct Slack integration)
// =============================================================================
// This endpoint receives events from the existing Slack app directly
// without going through Azure Bot Service
app.post('/api/slack/events', async (req, res) => {
    const body = req.body;

    // Handle URL verification challenge FIRST (before signature check)
    // This is safe since the challenge is a random string from Slack
    if (body.type === 'url_verification') {
        console.log('Slack URL verification challenge received');
        return res.json({ challenge: body.challenge });
    }

    // Verify Slack request signature for all other events
    if (config.slack?.signingSecret) {
        if (!verifySlackSignature(req, config.slack.signingSecret)) {
            console.warn('Invalid Slack signature - rejecting event');
            return res.status(401).send('Invalid signature');
        }
    }

    // Acknowledge immediately to prevent Slack retries
    res.status(200).send();

    // Handle events
    if (body.type === 'event_callback') {
        const event = body.event;
        const teamId = body.team_id;

        // Skip bot messages to prevent loops
        if (event.bot_id || event.subtype === 'bot_message') {
            return;
        }

        console.log(`Slack event received: ${event.type} from team ${teamId}`);

        // Handle message events
        if (event.type === 'message' || event.type === 'app_mention') {
            if (bot) {
                try {
                    await bot.handleSlackEvent(event, teamId, config.slack);
                } catch (error) {
                    console.error('Error handling Slack event:', error);
                }
            }
        }
    }
});

// =============================================================================
// SLACK INTERACTIONS ENDPOINT (for Block Kit button clicks)
// =============================================================================
app.post('/api/slack/interactions', async (req, res) => {
    // Verify Slack request signature if configured
    if (config.slack?.signingSecret) {
        if (!verifySlackSignature(req, config.slack.signingSecret)) {
            console.warn('Invalid Slack signature - rejecting interaction');
            return res.status(401).send('Invalid signature');
        }
    }

    // Slack sends interactions as URL-encoded JSON in 'payload' field
    let payload;
    try {
        payload = JSON.parse(req.body.payload || '{}');
    } catch (error) {
        return res.status(400).json({ error: 'Invalid payload' });
    }

    console.log('Slack interaction received:', payload.type);

    // Acknowledge immediately
    res.status(200).send();

    // Process interaction
    if (bot) {
        try {
            await bot.handleSlackInteraction(payload, config.slack);
        } catch (error) {
            console.error('Error handling Slack interaction:', error);
        }
    }
});

// =============================================================================
// START SERVER
// =============================================================================
async function start() {
    console.log('\n===========================================');
    console.log('VM Performance Multi-Channel Bot - Starting');
    console.log('===========================================\n');

    // Load all secrets from Key Vault (REQUIRED)
    await loadSecretsFromKeyVault();

    // Initialize services with secrets from Key Vault
    await initializeServices(config);

    // Create bot with loaded configuration
    bot = new VMPerfBot(config);

    // Create Bot Framework adapter (required for channel integration)
    if (config.microsoftAppId && config.microsoftAppPassword) {
        const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
            MicrosoftAppId: config.microsoftAppId,
            MicrosoftAppPassword: config.microsoftAppPassword,
            MicrosoftAppTenantId: config.microsoftAppTenantId || ''
        });

        adapter = new CloudAdapter(botFrameworkAuthentication);

        // Error handler for unhandled errors
        adapter.onTurnError = async (context, error) => {
            console.error(`[onTurnError] unhandled error: ${error}`);
            console.error(error.stack);

            // Send user-friendly error message
            try {
                await context.sendActivity(
                    'Sorry, something went wrong. Please try again later.'
                );
            } catch (sendError) {
                console.error('Failed to send error message:', sendError);
            }
        };

        console.log('Bot Framework adapter configured');
    } else {
        console.warn('Bot Framework credentials not configured - bot will not respond to messages');
        console.warn('Please configure Bot-MicrosoftAppId and Bot-MicrosoftAppPassword in Key Vault');
    }

    // Start Express server
    app.listen(config.port, () => {
        console.log(`\nVM Performance Multi-Channel Bot started`);
        console.log(`  Port: ${config.port}`);
        console.log(`  Key Vault: ${config.keyVaultUrl}`);
        console.log(`  Version: v11-microservices`);
        console.log(`\nMicroservices:`);
        console.log(`  Resource Graph (App 1): ${config.resourceGraphUrl || 'NOT CONFIGURED'}`);
        console.log(`  Short-Term LA (App 2): ${config.shortTermLAUrl || 'NOT CONFIGURED'}`);
        console.log(`  Long-Term LA (App 3): ${config.longTermLAUrl || 'NOT CONFIGURED'}`);
        console.log(`  Legacy Orchestrator: ${config.orchestratorUrl}`);
        console.log(`\nIntegrations:`);
        console.log(`  Bot Framework: ${adapter ? 'ENABLED' : 'DISABLED'}`);
        console.log(`  AI Foundry Agent: ${config.aiFoundry?.agentId ? 'ENABLED' : 'DISABLED (fallback mode)'}`);
        console.log(`  Cosmos DB State: ${config.cosmosDb?.connectionString ? 'ENABLED' : 'IN-MEMORY'}`);
        console.log(`\nEndpoints:`);
        console.log(`  Health check:       GET  /health`);
        console.log(`  Slack events:       POST /api/slack/events`);
        console.log(`  Slack interactions: POST /api/slack/interactions`);
        console.log(`  Teams messages:     POST /api/messages\n`);
        console.log(`\nSlack App Configuration:`);
        console.log(`  Event Subscriptions URL: https://<your-domain>/api/slack/events`);
        console.log(`  Interactivity URL:       https://<your-domain>/api/slack/interactions`);
        console.log(`  Required Events: message.channels, message.im, app_mention\n`);
    });
}

// Start the bot
start().catch(error => {
    console.error('Failed to start bot:', error);
    console.error('Ensure KEY_VAULT_URL is set and secrets are configured.');
    process.exit(1);
});
