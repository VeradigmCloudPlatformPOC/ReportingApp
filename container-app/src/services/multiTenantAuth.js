/**
 * @fileoverview Multi-Tenant Authentication Service
 *
 * This module handles authentication for multiple Azure AD tenants.
 * Each tenant has its own service principal credentials stored in Key Vault.
 *
 * Authentication Patterns:
 * - Per-tenant ClientSecretCredential for API access
 * - Bearer tokens for Log Analytics API
 * - Authenticated clients for Resource Graph
 *
 * Credential Naming Convention in Key Vault:
 * - {TenantName}-ClientId: Service principal client ID
 * - {TenantName}-ClientSecret: Service principal secret
 *
 * @version v7-slack-bot
 * @author VM Performance Monitoring Team
 */

const { ClientSecretCredential, DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');
const axios = require('axios');

// Cache for credentials and tokens
const credentialCache = new Map();
const tokenCache = new Map();

// Key Vault client (initialized on first use)
let secretClient = null;
let keyVaultUrl = null;

/**
 * Initialize the authentication service with Key Vault URL.
 *
 * @param {string} kvUrl - Key Vault URL (e.g., https://vmperf-kv.vault.azure.net)
 */
function initializeAuth(kvUrl) {
    keyVaultUrl = kvUrl;
    const credential = new DefaultAzureCredential();
    secretClient = new SecretClient(kvUrl, credential);
    console.log('Multi-tenant auth service initialized');
}

/**
 * Get credentials for a specific tenant.
 *
 * Uses cached credentials if available, otherwise retrieves from Key Vault.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} tenantConfig.tenantId - Azure AD tenant GUID
 * @param {string} tenantConfig.tenantName - Friendly tenant name
 * @param {Object} tenantConfig.servicePrincipal - SP credential references
 * @returns {Promise<ClientSecretCredential>} Azure credential object
 */
async function getTenantCredential(tenantConfig) {
    const cacheKey = tenantConfig.tenantId;

    if (credentialCache.has(cacheKey)) {
        return credentialCache.get(cacheKey);
    }

    // Get credentials from Key Vault
    const { clientId, secretName } = tenantConfig.servicePrincipal;

    // If clientId is a Key Vault reference, fetch it
    let actualClientId = clientId;
    if (clientId.startsWith('kv:')) {
        const clientIdSecretName = clientId.replace('kv:', '');
        const clientIdSecret = await secretClient.getSecret(clientIdSecretName);
        actualClientId = clientIdSecret.value;
    }

    // Get the client secret from Key Vault
    const clientSecretResponse = await secretClient.getSecret(secretName);
    const clientSecret = clientSecretResponse.value;

    // Create the credential
    const credential = new ClientSecretCredential(
        tenantConfig.tenantId,
        actualClientId,
        clientSecret
    );

    // Cache it
    credentialCache.set(cacheKey, credential);
    console.log(`  Credential cached for tenant: ${tenantConfig.tenantName}`);

    return credential;
}

/**
 * Get a bearer token for Log Analytics API.
 *
 * Tokens are cached and refreshed when expired.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<string>} Bearer token
 */
async function getLogAnalyticsToken(tenantConfig) {
    const cacheKey = `la-${tenantConfig.tenantId}`;
    const cached = tokenCache.get(cacheKey);

    // Check if token is still valid (5 minute buffer)
    if (cached && cached.expiresAt > Date.now() + 300000) {
        return cached.token;
    }

    const credential = await getTenantCredential(tenantConfig);

    // Get token for Log Analytics scope
    const tokenResponse = await credential.getToken('https://api.loganalytics.io/.default');

    // Cache the token
    tokenCache.set(cacheKey, {
        token: tokenResponse.token,
        expiresAt: tokenResponse.expiresOnTimestamp
    });

    return tokenResponse.token;
}

/**
 * Get a bearer token for Azure Resource Manager API.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<string>} Bearer token
 */
async function getArmToken(tenantConfig) {
    const cacheKey = `arm-${tenantConfig.tenantId}`;
    const cached = tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now() + 300000) {
        return cached.token;
    }

    const credential = await getTenantCredential(tenantConfig);
    const tokenResponse = await credential.getToken('https://management.azure.com/.default');

    tokenCache.set(cacheKey, {
        token: tokenResponse.token,
        expiresAt: tokenResponse.expiresOnTimestamp
    });

    return tokenResponse.token;
}

/**
 * Get credentials using client ID and secret from request (for legacy support).
 *
 * @param {string} tenantId - Azure AD tenant ID
 * @param {string} clientId - Service principal client ID
 * @param {string} clientSecret - Service principal secret
 * @returns {ClientSecretCredential} Azure credential object
 */
function getCredentialFromSecrets(tenantId, clientId, clientSecret) {
    return new ClientSecretCredential(tenantId, clientId, clientSecret);
}

/**
 * Get OAuth2 token using client credentials flow (for Log Analytics).
 *
 * This is used for direct API calls to Log Analytics when not using SDK.
 *
 * @param {string} tenantId - Azure AD tenant ID
 * @param {string} clientId - Service principal client ID
 * @param {string} clientSecret - Service principal secret
 * @returns {Promise<string>} Access token
 */
async function getOAuth2Token(tenantId, clientId, clientSecret) {
    const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

    const response = await axios.post(tokenUrl, new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: 'https://api.loganalytics.io/.default'
    }), {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    return response.data.access_token;
}

/**
 * Validate that a tenant configuration has valid credentials.
 *
 * Tests authentication by attempting to get a token.
 *
 * @param {Object} tenantConfig - Tenant configuration to validate
 * @returns {Promise<Object>} Validation result with success status and details
 */
async function validateTenantAccess(tenantConfig) {
    const result = {
        tenantId: tenantConfig.tenantId,
        tenantName: tenantConfig.tenantName,
        success: false,
        errors: [],
        checks: {
            keyVaultAccess: false,
            logAnalyticsAccess: false,
            resourceGraphAccess: false
        }
    };

    try {
        // Check Key Vault access (get credentials)
        await getTenantCredential(tenantConfig);
        result.checks.keyVaultAccess = true;

        // Check Log Analytics token
        await getLogAnalyticsToken(tenantConfig);
        result.checks.logAnalyticsAccess = true;

        // Check ARM token (for Resource Graph)
        await getArmToken(tenantConfig);
        result.checks.resourceGraphAccess = true;

        result.success = true;
    } catch (error) {
        result.errors.push(error.message);
    }

    return result;
}

/**
 * Clear cached credentials and tokens for a tenant.
 *
 * Use this when credentials are rotated or tenant config changes.
 *
 * @param {string} tenantId - Tenant ID to clear from cache
 */
function clearTenantCache(tenantId) {
    credentialCache.delete(tenantId);
    tokenCache.delete(`la-${tenantId}`);
    tokenCache.delete(`arm-${tenantId}`);
    console.log(`  Cleared credential cache for tenant: ${tenantId}`);
}

/**
 * Clear all cached credentials and tokens.
 */
function clearAllCache() {
    credentialCache.clear();
    tokenCache.clear();
    console.log('  Cleared all credential caches');
}

/**
 * Get authentication status summary.
 *
 * @returns {Object} Summary of cached credentials and tokens
 */
function getAuthStatus() {
    const tokenStatus = {};

    for (const [key, value] of tokenCache.entries()) {
        tokenStatus[key] = {
            expiresIn: Math.max(0, Math.round((value.expiresAt - Date.now()) / 1000 / 60)),
            isValid: value.expiresAt > Date.now()
        };
    }

    return {
        cachedCredentials: credentialCache.size,
        cachedTokens: tokenCache.size,
        keyVaultConfigured: !!secretClient,
        tokens: tokenStatus
    };
}

module.exports = {
    initializeAuth,
    getTenantCredential,
    getLogAnalyticsToken,
    getArmToken,
    getCredentialFromSecrets,
    getOAuth2Token,
    validateTenantAccess,
    clearTenantCache,
    clearAllCache,
    getAuthStatus
};
