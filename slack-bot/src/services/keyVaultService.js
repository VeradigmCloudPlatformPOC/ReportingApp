/**
 * @fileoverview Key Vault Service
 *
 * Centralized service for retrieving secrets from Azure Key Vault.
 * All sensitive configuration is stored in Key Vault - no clear text credentials in code.
 *
 * Key Vault: vmperf-kv-18406
 * Expected Secrets:
 *   - StorageConnectionString
 *   - Slack-ClientId
 *   - Slack-ClientSecret
 *   - Slack-SigningSecret
 *   - Slack-BotToken (xoxb-...)
 *   - OpenAI-Endpoint
 *   - OpenAI-ApiKey
 *   - Bot-MicrosoftAppId (for Teams)
 *   - Bot-MicrosoftAppPassword (for Teams)
 *   - Bot-MicrosoftAppTenantId (for Teams)
 *   - AIFoundry-ProjectEndpoint
 *   - AIFoundry-AgentId
 *   - CosmosDB-ConnectionString
 *   - {TenantName}-ClientId (per-tenant)
 *   - {TenantName}-ClientSecret (per-tenant)
 *
 * @version v9-dynamic-queries
 * @author VM Performance Monitoring Team
 */

const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');

// Secret cache to avoid repeated Key Vault calls
const secretCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Key Vault client
let secretClient = null;
let keyVaultUrl = null;

// Secret name constants - must match Key Vault secret names exactly
const SECRET_NAMES = {
    STORAGE_CONNECTION_STRING: 'StorageConnectionString',
    SLACK_CLIENT_ID: 'Slack-ClientId',
    SLACK_CLIENT_SECRET: 'Slack-ClientSecret',
    SLACK_SIGNING_SECRET: 'Slack-SigningSecret',
    SLACK_BOT_TOKEN: 'Slack-BotToken',
    // Existing OpenAI secrets in vmperf-kv-18406
    OPENAI_ENDPOINT: 'OpenAIEndpoint',
    OPENAI_API_KEY: 'OpenAIApiKey',
    OPENAI_DEPLOYMENT_NAME: 'OpenAIDeploymentName',
    // Bot Framework credentials (for Teams)
    BOT_APP_ID: 'Bot-MicrosoftAppId',
    BOT_APP_PASSWORD: 'Bot-MicrosoftAppPassword',
    BOT_APP_TENANT_ID: 'Bot-MicrosoftAppTenantId',
    // Azure AI Foundry Agent Service
    AI_FOUNDRY_PROJECT_ENDPOINT: 'AIFoundry-ProjectEndpoint',
    AI_FOUNDRY_AGENT_ID: 'AIFoundry-AgentId',
    // Cosmos DB for conversation state
    COSMOSDB_CONNECTION_STRING: 'CosmosDB-ConnectionString'
};

/**
 * Initialize the Key Vault service.
 *
 * @param {string} kvUrl - Key Vault URL (e.g., https://vmperf-kv.vault.azure.net)
 */
function initializeKeyVault(kvUrl) {
    if (!kvUrl) {
        throw new Error('Key Vault URL is required. Set KEY_VAULT_URL environment variable.');
    }

    keyVaultUrl = kvUrl;
    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(kvUrl, credential);

    console.log(`Key Vault service initialized: ${kvUrl}`);
}

/**
 * Get a secret from Key Vault.
 *
 * @param {string} secretName - Name of the secret to retrieve
 * @param {boolean} useCache - Whether to use cached value (default: true)
 * @returns {Promise<string>} Secret value
 */
async function getSecret(secretName, useCache = true) {
    if (!secretClient) {
        throw new Error('Key Vault not initialized. Call initializeKeyVault() first.');
    }

    // Check cache
    if (useCache) {
        const cached = secretCache.get(secretName);
        if (cached && Date.now() < cached.expiresAt) {
            return cached.value;
        }
    }

    try {
        const secret = await secretClient.getSecret(secretName);
        const value = secret.value;

        // Cache the secret
        secretCache.set(secretName, {
            value,
            expiresAt: Date.now() + CACHE_TTL_MS
        });

        return value;
    } catch (error) {
        if (error.code === 'SecretNotFound') {
            throw new Error(`Secret not found in Key Vault: ${secretName}`);
        }
        throw error;
    }
}

/**
 * Get Storage Account connection string.
 *
 * @returns {Promise<string>} Connection string
 */
async function getStorageConnectionString() {
    return getSecret(SECRET_NAMES.STORAGE_CONNECTION_STRING);
}

/**
 * Get Slack credentials.
 *
 * @returns {Promise<Object>} Slack credentials object
 */
async function getSlackCredentials() {
    const [clientId, clientSecret, signingSecret] = await Promise.all([
        getSecret(SECRET_NAMES.SLACK_CLIENT_ID),
        getSecret(SECRET_NAMES.SLACK_CLIENT_SECRET),
        getSecret(SECRET_NAMES.SLACK_SIGNING_SECRET)
    ]);

    return {
        clientId,
        clientSecret,
        signingSecret
    };
}

/**
 * Get OpenAI credentials.
 *
 * @returns {Promise<Object>} OpenAI credentials object
 */
async function getOpenAICredentials() {
    const [endpoint, apiKey, deploymentName] = await Promise.all([
        getSecret(SECRET_NAMES.OPENAI_ENDPOINT),
        getSecret(SECRET_NAMES.OPENAI_API_KEY),
        getSecret(SECRET_NAMES.OPENAI_DEPLOYMENT_NAME).catch(() => 'gpt-4') // Default to gpt-4
    ]);

    return {
        endpoint,
        apiKey,
        deploymentName
    };
}

/**
 * Get Bot Framework credentials.
 *
 * @returns {Promise<Object>} Bot credentials object
 */
async function getBotCredentials() {
    const [appId, appPassword, tenantId] = await Promise.all([
        getSecret(SECRET_NAMES.BOT_APP_ID).catch(() => null),
        getSecret(SECRET_NAMES.BOT_APP_PASSWORD).catch(() => null),
        getSecret(SECRET_NAMES.BOT_APP_TENANT_ID).catch(() => null)
    ]);

    return {
        microsoftAppId: appId,
        microsoftAppPassword: appPassword,
        microsoftAppTenantId: tenantId
    };
}

/**
 * Get Azure AI Foundry Agent Service credentials.
 *
 * @returns {Promise<Object>} AI Foundry credentials object
 */
async function getAIFoundryCredentials() {
    const [projectEndpoint, agentId] = await Promise.all([
        getSecret(SECRET_NAMES.AI_FOUNDRY_PROJECT_ENDPOINT).catch(() => null),
        getSecret(SECRET_NAMES.AI_FOUNDRY_AGENT_ID).catch(() => null)
    ]);

    return {
        projectEndpoint,
        agentId
    };
}

/**
 * Get Cosmos DB connection string for conversation state.
 *
 * @returns {Promise<string|null>} Cosmos DB connection string
 */
async function getCosmosDBConnectionString() {
    return getSecret(SECRET_NAMES.COSMOSDB_CONNECTION_STRING).catch(() => null);
}

/**
 * Get tenant-specific credentials.
 *
 * @param {string} tenantName - Tenant name (used as prefix)
 * @returns {Promise<Object>} Tenant credentials
 */
async function getTenantCredentials(tenantName) {
    const clientIdSecretName = `${tenantName}-ClientId`;
    const clientSecretSecretName = `${tenantName}-ClientSecret`;

    const [clientId, clientSecret] = await Promise.all([
        getSecret(clientIdSecretName),
        getSecret(clientSecretSecretName)
    ]);

    return {
        clientId,
        clientSecret
    };
}

/**
 * Clear the secret cache.
 */
function clearCache() {
    secretCache.clear();
    console.log('Key Vault secret cache cleared');
}

/**
 * Get all required secrets for service initialization.
 *
 * @returns {Promise<Object>} All required secrets
 */
async function getAllSecrets() {
    const [storage, slack, openai, bot, aiFoundry, cosmosDb] = await Promise.all([
        getStorageConnectionString(),
        getSlackCredentials(),
        getOpenAICredentials(),
        getBotCredentials(),
        getAIFoundryCredentials(),
        getCosmosDBConnectionString()
    ]);

    return {
        storageConnectionString: storage,
        slack,
        openai,
        bot,
        aiFoundry,
        cosmosDb
    };
}

/**
 * Check if Key Vault is accessible and has required secrets.
 *
 * @returns {Promise<Object>} Health check result
 */
async function healthCheck() {
    const result = {
        keyVaultAccessible: false,
        secrets: {}
    };

    try {
        // Test Key Vault access
        await getSecret(SECRET_NAMES.STORAGE_CONNECTION_STRING, false);
        result.keyVaultAccessible = true;

        // Check each required secret
        const secretNames = Object.values(SECRET_NAMES);
        for (const name of secretNames) {
            try {
                await getSecret(name, false);
                result.secrets[name] = 'OK';
            } catch (error) {
                result.secrets[name] = error.message.includes('not found') ? 'NOT_FOUND' : 'ERROR';
            }
        }
    } catch (error) {
        result.error = error.message;
    }

    return result;
}

module.exports = {
    initializeKeyVault,
    getSecret,
    getStorageConnectionString,
    getSlackCredentials,
    getOpenAICredentials,
    getBotCredentials,
    getAIFoundryCredentials,
    getCosmosDBConnectionString,
    getTenantCredentials,
    getAllSecrets,
    clearCache,
    healthCheck,
    SECRET_NAMES
};
