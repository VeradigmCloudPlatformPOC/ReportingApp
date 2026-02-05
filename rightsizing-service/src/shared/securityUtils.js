/**
 * @fileoverview Security Utilities
 *
 * Centralized security functions for input sanitization and validation.
 * Prevents KQL injection, SSRF, and other common vulnerabilities.
 *
 * @version v11-microservices
 */

/**
 * Escape a string for safe use in KQL queries.
 * Handles all potentially dangerous characters.
 *
 * @param {string} input - Raw input string
 * @returns {string} Escaped string safe for KQL
 */
function escapeKqlString(input) {
    if (input === null || input === undefined) {
        return '';
    }

    // Convert to string if not already
    const str = String(input);

    // KQL string escaping rules:
    // - Double quotes need to be escaped with backslash
    // - Backslashes need to be escaped
    // - Single quotes are safe in double-quoted strings
    // - Remove/escape control characters
    return str
        .replace(/\\/g, '\\\\')           // Escape backslashes first
        .replace(/"/g, '\\"')             // Escape double quotes
        .replace(/\n/g, '\\n')            // Escape newlines
        .replace(/\r/g, '\\r')            // Escape carriage returns
        .replace(/\t/g, '\\t')            // Escape tabs
        .replace(/[\x00-\x1f\x7f]/g, ''); // Remove other control characters
}

/**
 * Escape an array of strings for use in KQL dynamic array.
 *
 * @param {Array<string>} items - Array of strings to escape
 * @returns {string} KQL dynamic array literal (e.g., '["item1", "item2"]')
 */
function escapeKqlArray(items) {
    if (!Array.isArray(items)) {
        return 'dynamic([])';
    }

    const escaped = items.map(item => `"${escapeKqlString(item)}"`);
    return `dynamic([${escaped.join(', ')}])`;
}

/**
 * Escape a VM name for KQL queries.
 * Additional validation for VM name format.
 *
 * @param {string} vmName - VM name to escape
 * @returns {string} Escaped VM name
 * @throws {Error} If VM name is invalid
 */
function escapeVmName(vmName) {
    if (!vmName || typeof vmName !== 'string') {
        throw new Error('Invalid VM name: must be a non-empty string');
    }

    // VM names should only contain alphanumeric, hyphen, underscore, period
    // Max length 64 characters for Azure VMs
    const sanitized = vmName.trim();

    if (sanitized.length === 0 || sanitized.length > 64) {
        throw new Error(`Invalid VM name length: ${sanitized.length} (must be 1-64)`);
    }

    // Check for valid VM name characters (relaxed to allow FQDNs)
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(sanitized)) {
        throw new Error(`Invalid VM name format: ${sanitized}`);
    }

    return escapeKqlString(sanitized);
}

/**
 * Validate and sanitize a time range in days.
 *
 * @param {number|string} days - Time range in days
 * @param {number} maxDays - Maximum allowed days (default: 90)
 * @returns {number} Validated time range
 * @throws {Error} If time range is invalid
 */
function validateTimeRange(days, maxDays = 90) {
    const numDays = parseInt(days, 10);

    if (isNaN(numDays) || numDays < 1 || numDays > maxDays) {
        throw new Error(`Invalid time range: must be between 1 and ${maxDays} days`);
    }

    return numDays;
}

/**
 * Allowed callback URL domains for SSRF prevention.
 * Only internal services and known safe domains are allowed.
 */
const ALLOWED_CALLBACK_DOMAINS = [
    'calmsand-17418731.westus2.azurecontainerapps.io',  // Azure Container Apps
    'slack.com',                                         // Slack webhooks
    'hooks.slack.com',                                   // Slack incoming webhooks
    'localhost',                                         // Local development
    '127.0.0.1'                                         // Local development
];

/**
 * Validate a callback URL to prevent SSRF attacks.
 *
 * @param {string} url - URL to validate
 * @returns {boolean} True if URL is safe
 */
function isValidCallbackUrl(url) {
    if (!url || typeof url !== 'string') {
        return false;
    }

    try {
        const parsed = new URL(url);

        // Only allow HTTPS (except for localhost)
        if (parsed.protocol !== 'https:' &&
            parsed.hostname !== 'localhost' &&
            parsed.hostname !== '127.0.0.1') {
            return false;
        }

        // Check against allowed domains
        const hostname = parsed.hostname.toLowerCase();

        for (const allowed of ALLOWED_CALLBACK_DOMAINS) {
            if (hostname === allowed || hostname.endsWith(`.${allowed}`)) {
                return true;
            }
        }

        return false;

    } catch (error) {
        return false;
    }
}

/**
 * Sanitize a callback URL, returning null if invalid.
 *
 * @param {string} url - URL to sanitize
 * @returns {string|null} Sanitized URL or null if invalid
 */
function sanitizeCallbackUrl(url) {
    if (!isValidCallbackUrl(url)) {
        return null;
    }

    try {
        const parsed = new URL(url);
        // Return normalized URL without credentials
        return `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search}`;
    } catch {
        return null;
    }
}

/**
 * Validate Azure subscription ID format.
 *
 * @param {string} subscriptionId - Subscription ID to validate
 * @returns {boolean} True if valid GUID format
 */
function isValidSubscriptionId(subscriptionId) {
    if (!subscriptionId || typeof subscriptionId !== 'string') {
        return false;
    }

    // Azure subscription ID is a GUID
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(subscriptionId);
}

/**
 * Validate Azure tenant ID format.
 *
 * @param {string} tenantId - Tenant ID to validate
 * @returns {boolean} True if valid GUID format
 */
function isValidTenantId(tenantId) {
    if (!tenantId || typeof tenantId !== 'string') {
        return false;
    }

    // Azure tenant ID is a GUID
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(tenantId);
}

/**
 * Validate Log Analytics workspace ID format.
 *
 * @param {string} workspaceId - Workspace ID to validate
 * @returns {boolean} True if valid GUID format
 */
function isValidWorkspaceId(workspaceId) {
    if (!workspaceId || typeof workspaceId !== 'string') {
        return false;
    }

    // Workspace ID is a GUID
    const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    return guidRegex.test(workspaceId);
}

module.exports = {
    escapeKqlString,
    escapeKqlArray,
    escapeVmName,
    validateTimeRange,
    isValidCallbackUrl,
    sanitizeCallbackUrl,
    isValidSubscriptionId,
    isValidTenantId,
    isValidWorkspaceId,
    ALLOWED_CALLBACK_DOMAINS
};
