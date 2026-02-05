/**
 * @fileoverview Resource Graph API Routes
 *
 * Defines all REST API endpoints for the Resource Graph Service.
 *
 * @version v11-microservices
 */

const express = require('express');
const router = express.Router();
const {
    queryVMInventory,
    queryVMInventoryWithNetwork,
    getVMDetails,
    aggregateByResourceGroup,
    aggregateByLocation,
    aggregateBySize,
    getCrossTenantSummary,
    searchVMs,
    refreshCache,
    querySQLVMInventory,
    queryCrossTenantSQLVMs
} = require('../services/resourceGraph');
const { getCacheStats } = require('../services/cacheService');
const { getAllTenants, getTenantBySubscription } = require('../shared/multiTenantAuth');

/**
 * POST /api/resources/vms
 * Get VM inventory with optional filters
 */
router.post('/vms', async (req, res) => {
    try {
        const {
            tenantId,
            subscriptionId,
            location,
            powerState,
            vmSize,
            tags,
            skipCache,
            includeNetwork
        } = req.body;

        let result;
        if (includeNetwork) {
            result = await queryVMInventoryWithNetwork({
                tenantId,
                subscriptionId,
                skipCache
            });
        } else {
            result = await queryVMInventory({
                tenantId,
                subscriptionId,
                location,
                powerState,
                vmSize,
                tags,
                skipCache
            });
        }

        res.json({
            success: true,
            ...result.data,
            cacheHit: result.cacheHit,
            cacheExpiry: result.cacheExpiry
        });
    } catch (error) {
        console.error('[API] /resources/vms error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/resources/vms/:vmId
 * Get single VM details by name or resource ID
 */
router.get('/vms/:vmId', async (req, res) => {
    try {
        const { vmId } = req.params;
        const { tenantId } = req.query;

        // Handle URL-encoded resource IDs
        const vmIdentifier = decodeURIComponent(vmId);

        const result = await getVMDetails(vmIdentifier, { tenantId });

        if (!result.found) {
            return res.status(404).json({
                success: false,
                error: 'VM not found',
                vmIdentifier
            });
        }

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('[API] /resources/vms/:vmId error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/resources/search
 * Search VMs by name pattern
 */
router.post('/search', async (req, res) => {
    try {
        const { pattern, tenantId, subscriptionId } = req.body;

        if (!pattern) {
            return res.status(400).json({
                success: false,
                error: 'Search pattern is required'
            });
        }

        const result = await searchVMs(pattern, { tenantId, subscriptionId });

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('[API] /resources/search error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/resources/sql-vms
 * Get SQL VM inventory with accurate CPU core counts
 * Identifies SQL VMs by OS image (publisher, offer, sku)
 */
router.post('/sql-vms', async (req, res) => {
    try {
        const { tenantId, subscriptionId, skipCache } = req.body;

        const result = await querySQLVMInventory({
            tenantId,
            subscriptionId,
            skipCache
        });

        res.json({
            success: true,
            ...result.data,
            cacheHit: result.cacheHit,
            cacheExpiry: result.cacheExpiry
        });
    } catch (error) {
        console.error('[API] /resources/sql-vms error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/resources/sql-vms/cross-tenant
 * Get SQL VM inventory across all configured tenants
 */
router.get('/sql-vms/cross-tenant', async (req, res) => {
    try {
        const { skipCache } = req.query;

        const result = await queryCrossTenantSQLVMs({
            skipCache: skipCache === 'true'
        });

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('[API] /resources/sql-vms/cross-tenant error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/resources/summary
 * Get aggregated summary (by-rg, by-location, by-size)
 */
router.post('/summary', async (req, res) => {
    try {
        const { tenantId, subscriptionId, groupBy } = req.body;
        const groupType = groupBy || 'resource-group';

        let result;
        switch (groupType) {
            case 'resource-group':
            case 'rg':
                result = await aggregateByResourceGroup({ tenantId, subscriptionId });
                break;
            case 'location':
            case 'region':
                result = await aggregateByLocation({ tenantId, subscriptionId });
                break;
            case 'size':
            case 'vmsize':
                result = await aggregateBySize({ tenantId, subscriptionId });
                break;
            default:
                return res.status(400).json({
                    success: false,
                    error: `Invalid groupBy value: ${groupType}. Use 'resource-group', 'location', or 'size'`
                });
        }

        res.json({
            success: true,
            groupBy: groupType,
            ...result.data,
            cacheHit: result.cacheHit,
            cacheExpiry: result.cacheExpiry
        });
    } catch (error) {
        console.error('[API] /resources/summary error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/resources/summary/cross-tenant
 * Get summary across all configured tenants
 */
router.get('/summary/cross-tenant', async (req, res) => {
    try {
        const result = await getCrossTenantSummary();

        res.json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('[API] /resources/summary/cross-tenant error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/subscriptions
 * List all subscriptions with names from Azure Resource Graph
 */
router.get('/subscriptions', async (req, res) => {
    try {
        const { getSubscriptionDetails } = require('../services/resourceGraph');
        const subscriptions = await getSubscriptionDetails();

        res.json({
            success: true,
            subscriptions,
            count: subscriptions.length
        });
    } catch (error) {
        console.error('[API] /subscriptions error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/subscriptions/search
 * Search subscriptions by name/ID (fuzzy match)
 */
router.get('/subscriptions/search', async (req, res) => {
    try {
        const { q } = req.query;
        const { getSubscriptionDetails } = require('../services/resourceGraph');
        const allSubscriptions = await getSubscriptionDetails();

        if (!q) {
            // Return all if no search query
            return res.json({ success: true, subscriptions: allSubscriptions });
        }

        // Fuzzy search on name, subscriptionId, tenantName
        const searchLower = q.toLowerCase();
        const matches = allSubscriptions.filter(sub => {
            return sub.name?.toLowerCase().includes(searchLower) ||
                   sub.subscriptionId?.toLowerCase().includes(searchLower) ||
                   sub.tenantName?.toLowerCase().includes(searchLower);
        }).map(sub => ({
            ...sub,
            matchedOn: sub.name?.toLowerCase().includes(searchLower) ? 'name' :
                       sub.subscriptionId?.toLowerCase().includes(searchLower) ? 'subscriptionId' :
                       'tenantName'
        }));

        res.json({
            success: true,
            subscriptions: matches,
            count: matches.length,
            query: q
        });
    } catch (error) {
        console.error('[API] /subscriptions/search error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/tenants
 * List all configured tenants
 */
router.get('/tenants', async (req, res) => {
    try {
        const tenants = getAllTenants();

        res.json({
            success: true,
            tenants,
            count: tenants.length
        });
    } catch (error) {
        console.error('[API] /tenants error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/cache/invalidate
 * Force refresh cached data
 */
router.post('/cache/invalidate', async (req, res) => {
    try {
        const { queryType } = req.body;

        if (!queryType) {
            return res.status(400).json({
                success: false,
                error: 'queryType is required (e.g., "inventory", "summary")'
            });
        }

        const deletedCount = await refreshCache(queryType);

        res.json({
            success: true,
            message: `Invalidated ${deletedCount} cache entries`,
            queryType,
            deletedCount
        });
    } catch (error) {
        console.error('[API] /cache/invalidate error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/cache/stats
 * Get cache statistics
 */
router.get('/cache/stats', async (req, res) => {
    try {
        const stats = await getCacheStats();

        res.json({
            success: true,
            ...stats
        });
    } catch (error) {
        console.error('[API] /cache/stats error:', error.message);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
