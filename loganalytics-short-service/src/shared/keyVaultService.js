/**
 * @fileoverview Key Vault Service
 *
 * Provides secure access to Azure Key Vault secrets with caching.
 * Used by all services in the resource-graph-service.
 *
 * @version v11-microservices
 */

const { SecretClient } = require('@azure/keyvault-secrets');
const { DefaultAzureCredential } = require('@azure/identity');

// Secret cache with TTL
const secretCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let secretClient = null;

/**
 * Initialize the Key Vault client.
 *
 * @param {string} vaultUrl - Key Vault URL (e.g., https://myvault.vault.azure.net)
 */
function initializeKeyVault(vaultUrl) {
    if (!vaultUrl) {
        throw new Error('KEY_VAULT_URL is required');
    }

    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(vaultUrl, credential);

    console.log(`[KeyVault] Initialized with vault: ${vaultUrl}`);
}

/**
 * Get a secret from Key Vault with caching.
 *
 * @param {string} secretName - Name of the secret
 * @returns {Promise<string>} Secret value
 */
async function getSecret(secretName) {
    if (!secretClient) {
        throw new Error('Key Vault client not initialized. Call initializeKeyVault() first.');
    }

    // Check cache
    const cached = secretCache.get(secretName);
    if (cached && Date.now() < cached.expiresAt) {
        return cached.value;
    }

    try {
        const secret = await secretClient.getSecret(secretName);

        // Cache the secret
        secretCache.set(secretName, {
            value: secret.value,
            expiresAt: Date.now() + CACHE_TTL_MS
        });

        return secret.value;
    } catch (error) {
        console.error(`[KeyVault] Failed to get secret '${secretName}':`, error.message);
        throw error;
    }
}

/**
 * Load all required secrets for the service.
 *
 * @returns {Promise<Object>} Object with all secrets
 */
async function loadSecrets() {
    const secretNames = [
        'LogAnalyticsClientId',
        'LogAnalyticsClientSecret',
        'LogAnalyticsTenantId',
        'LogAnalyticsWorkspaceId',
        'TargetSubscriptionId',
        'MultiTenantConfig'
    ];

    const secrets = {};

    for (const name of secretNames) {
        try {
            secrets[name] = await getSecret(name);
        } catch (error) {
            // Log but don't fail - some secrets might be optional
            console.warn(`[KeyVault] Optional secret '${name}' not found`);
            secrets[name] = null;
        }
    }

    // Parse MultiTenantConfig if it exists
    if (secrets.MultiTenantConfig) {
        try {
            secrets.tenants = JSON.parse(secrets.MultiTenantConfig);
        } catch (e) {
            console.error('[KeyVault] Failed to parse MultiTenantConfig:', e.message);
            secrets.tenants = [];
        }
    }

    return secrets;
}

/**
 * Clear the secret cache.
 */
function clearCache() {
    secretCache.clear();
    console.log('[KeyVault] Cache cleared');
}

module.exports = {
    initializeKeyVault,
    getSecret,
    loadSecrets,
    clearCache
};
