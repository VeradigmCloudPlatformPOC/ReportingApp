/**
 * @fileoverview Multi-Tenant Authentication Service
 *
 * Provides authentication for multiple Azure AD tenants using service principals.
 * Supports credential caching and token refresh.
 *
 * @version v11-microservices
 */

const { ClientSecretCredential } = require('@azure/identity');
const axios = require('axios');
const { getSecret } = require('./keyVaultService');

// Credential cache by tenant ID
const credentialCache = new Map();

// Token cache with expiry
const tokenCache = new Map();
const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// Tenant configurations loaded from Key Vault
let tenantsConfig = [];
let defaultTenantId = null;

/**
 * Initialize multi-tenant authentication.
 *
 * @param {Object} secrets - Secrets loaded from Key Vault
 */
async function initializeAuth(secrets) {
    // Load tenant configurations
    if (secrets.tenants && Array.isArray(secrets.tenants)) {
        tenantsConfig = secrets.tenants;
        console.log(`[MultiTenantAuth] Loaded ${tenantsConfig.length} tenant configurations`);
    }

    // Set default tenant
    defaultTenantId = secrets.LogAnalyticsTenantId;

    // Add default tenant if not in config
    if (defaultTenantId && !tenantsConfig.find(t => t.tenantId === defaultTenantId)) {
        tenantsConfig.push({
            tenantId: defaultTenantId,
            name: 'Default',
            subscriptionIds: secrets.TargetSubscriptionId ? [secrets.TargetSubscriptionId] : [],
            clientId: secrets.LogAnalyticsClientId,
            clientSecretName: 'LogAnalyticsClientSecret',
            workspaceId: secrets.LogAnalyticsWorkspaceId
        });
    }

    console.log(`[MultiTenantAuth] Initialized with default tenant: ${defaultTenantId}`);
}

/**
 * Get tenant configuration by tenant ID or name.
 *
 * @param {string} tenantIdOrName - Tenant ID or friendly name
 * @returns {Object|null} Tenant configuration
 */
function getTenantConfig(tenantIdOrName) {
    if (!tenantIdOrName) {
        // Return default tenant
        return tenantsConfig.find(t => t.tenantId === defaultTenantId) || tenantsConfig[0];
    }

    // Try exact match on tenant ID
    let tenant = tenantsConfig.find(t => t.tenantId === tenantIdOrName);
    if (tenant) return tenant;

    // Try match on name (case-insensitive)
    const searchLower = tenantIdOrName.toLowerCase();
    tenant = tenantsConfig.find(t =>
        t.name?.toLowerCase() === searchLower ||
        t.name?.toLowerCase().includes(searchLower)
    );

    return tenant || null;
}

/**
 * Get all configured tenants.
 *
 * @returns {Array<Object>} Array of tenant configurations (without secrets)
 */
function getAllTenants() {
    return tenantsConfig.map(t => ({
        tenantId: t.tenantId,
        name: t.name,
        subscriptionIds: t.subscriptionIds,
        workspaceId: t.workspaceId
    }));
}

/**
 * Get ClientSecretCredential for a tenant.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<ClientSecretCredential>} Azure credential
 */
async function getTenantCredential(tenantConfig) {
    const cacheKey = tenantConfig.tenantId;

    // Check cache
    if (credentialCache.has(cacheKey)) {
        return credentialCache.get(cacheKey);
    }

    // Get client secret from Key Vault
    const clientSecret = await getSecret(tenantConfig.clientSecretName || 'LogAnalyticsClientSecret');

    // Create credential
    const credential = new ClientSecretCredential(
        tenantConfig.tenantId,
        tenantConfig.clientId,
        clientSecret
    );

    // Cache it
    credentialCache.set(cacheKey, credential);

    console.log(`[MultiTenantAuth] Created credential for tenant: ${tenantConfig.name || tenantConfig.tenantId}`);

    return credential;
}

/**
 * Get OAuth2 token for Azure Resource Manager.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<string>} Access token
 */
async function getArmToken(tenantConfig) {
    return getOAuth2Token(tenantConfig, 'https://management.azure.com/.default');
}

/**
 * Get OAuth2 token for Log Analytics.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @returns {Promise<string>} Access token
 */
async function getLogAnalyticsToken(tenantConfig) {
    return getOAuth2Token(tenantConfig, 'https://api.loganalytics.io/.default');
}

/**
 * Get OAuth2 token for a specific scope.
 *
 * @param {Object} tenantConfig - Tenant configuration
 * @param {string} scope - OAuth2 scope
 * @returns {Promise<string>} Access token
 */
async function getOAuth2Token(tenantConfig, scope) {
    const cacheKey = `${tenantConfig.tenantId}:${scope}`;

    // Check cache
    const cached = tokenCache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt - TOKEN_REFRESH_BUFFER_MS) {
        return cached.token;
    }

    // Get client secret
    const clientSecret = await getSecret(tenantConfig.clientSecretName || 'LogAnalyticsClientSecret');

    try {
        const response = await axios.post(
            `https://login.microsoftonline.com/${tenantConfig.tenantId}/oauth2/v2.0/token`,
            new URLSearchParams({
                grant_type: 'client_credentials',
                client_id: tenantConfig.clientId,
                client_secret: clientSecret,
                scope: scope
            }),
            {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                timeout: 30000
            }
        );

        const token = response.data.access_token;
        const expiresIn = response.data.expires_in || 3600;

        // Cache the token
        tokenCache.set(cacheKey, {
            token,
            expiresAt: Date.now() + (expiresIn * 1000)
        });

        return token;
    } catch (error) {
        console.error(`[MultiTenantAuth] Token acquisition failed for tenant ${tenantConfig.tenantId}:`, error.message);
        throw error;
    }
}

/**
 * Clear all caches.
 */
function clearCaches() {
    credentialCache.clear();
    tokenCache.clear();
    console.log('[MultiTenantAuth] Caches cleared');
}

/**
 * Find tenant by subscription ID.
 *
 * @param {string} subscriptionId - Azure subscription ID
 * @returns {Object|null} Tenant configuration
 */
function getTenantBySubscription(subscriptionId) {
    return tenantsConfig.find(t =>
        t.subscriptionIds?.includes(subscriptionId)
    ) || null;
}

module.exports = {
    initializeAuth,
    getTenantConfig,
    getAllTenants,
    getTenantCredential,
    getArmToken,
    getLogAnalyticsToken,
    getOAuth2Token,
    getTenantBySubscription,
    clearCaches
};
