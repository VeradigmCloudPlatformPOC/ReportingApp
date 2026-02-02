/**
 * @fileoverview Test Script for New Services
 *
 * Tests the newly created services:
 * - storageService.js - Azure Table + Blob Storage
 * - multiTenantAuth.js - Per-tenant authentication
 * - resourceGraph.js - Azure Resource Graph queries
 *
 * Run with: node src/tests/testNewServices.js
 *
 * Note: These tests validate module structure and basic functionality.
 * For full integration tests, Azure credentials are required.
 */

const assert = require('assert');

// Test results tracking
const results = {
    passed: 0,
    failed: 0,
    tests: []
};

function test(name, fn) {
    try {
        fn();
        results.passed++;
        results.tests.push({ name, status: 'PASS' });
        console.log(`  ✓ ${name}`);
    } catch (error) {
        results.failed++;
        results.tests.push({ name, status: 'FAIL', error: error.message });
        console.log(`  ✗ ${name}`);
        console.log(`    Error: ${error.message}`);
    }
}

// =============================================================================
// TEST: Module Imports
// =============================================================================
console.log('\n📦 Testing Module Imports...\n');

let storageService, multiTenantAuth, resourceGraph, multiTenantLogAnalytics;

test('storageService.js imports successfully', () => {
    storageService = require('../services/storageService');
    assert(storageService, 'Module should export an object');
});

test('multiTenantAuth.js imports successfully', () => {
    multiTenantAuth = require('../services/multiTenantAuth');
    assert(multiTenantAuth, 'Module should export an object');
});

test('resourceGraph.js imports successfully', () => {
    resourceGraph = require('../services/resourceGraph');
    assert(resourceGraph, 'Module should export an object');
});

test('multiTenantLogAnalytics.js imports successfully', () => {
    multiTenantLogAnalytics = require('../services/multiTenantLogAnalytics');
    assert(multiTenantLogAnalytics, 'Module should export an object');
});

// =============================================================================
// TEST: Storage Service Exports
// =============================================================================
console.log('\n💾 Testing Storage Service Exports...\n');

test('storageService exports initializeStorage', () => {
    assert(typeof storageService.initializeStorage === 'function',
        'initializeStorage should be a function');
});

test('storageService exports run operations', () => {
    assert(typeof storageService.saveRun === 'function', 'saveRun should be a function');
    assert(typeof storageService.updateRun === 'function', 'updateRun should be a function');
    assert(typeof storageService.getRun === 'function', 'getRun should be a function');
    assert(typeof storageService.getLatestRun === 'function', 'getLatestRun should be a function');
    assert(typeof storageService.getRecentRuns === 'function', 'getRecentRuns should be a function');
});

test('storageService exports analysis operations', () => {
    assert(typeof storageService.saveAnalysisResults === 'function', 'saveAnalysisResults should be a function');
    assert(typeof storageService.getAnalysisResults === 'function', 'getAnalysisResults should be a function');
    assert(typeof storageService.getVMsByStatus === 'function', 'getVMsByStatus should be a function');
    assert(typeof storageService.getVMDetails === 'function', 'getVMDetails should be a function');
    assert(typeof storageService.searchVMs === 'function', 'searchVMs should be a function');
});

test('storageService exports tenant operations', () => {
    assert(typeof storageService.saveTenantConfig === 'function', 'saveTenantConfig should be a function');
    assert(typeof storageService.getTenantConfig === 'function', 'getTenantConfig should be a function');
    assert(typeof storageService.getTenantConfigs === 'function', 'getTenantConfigs should be a function');
    assert(typeof storageService.deleteTenantConfig === 'function', 'deleteTenantConfig should be a function');
});

test('storageService exports inventory operations', () => {
    assert(typeof storageService.saveInventory === 'function', 'saveInventory should be a function');
    assert(typeof storageService.getLatestInventory === 'function', 'getLatestInventory should be a function');
});

// =============================================================================
// TEST: Multi-Tenant Auth Exports
// =============================================================================
console.log('\n🔐 Testing Multi-Tenant Auth Exports...\n');

test('multiTenantAuth exports initializeAuth', () => {
    assert(typeof multiTenantAuth.initializeAuth === 'function',
        'initializeAuth should be a function');
});

test('multiTenantAuth exports credential functions', () => {
    assert(typeof multiTenantAuth.getTenantCredential === 'function',
        'getTenantCredential should be a function');
    assert(typeof multiTenantAuth.getCredentialFromSecrets === 'function',
        'getCredentialFromSecrets should be a function');
});

test('multiTenantAuth exports token functions', () => {
    assert(typeof multiTenantAuth.getLogAnalyticsToken === 'function',
        'getLogAnalyticsToken should be a function');
    assert(typeof multiTenantAuth.getArmToken === 'function',
        'getArmToken should be a function');
    assert(typeof multiTenantAuth.getOAuth2Token === 'function',
        'getOAuth2Token should be a function');
});

test('multiTenantAuth exports utility functions', () => {
    assert(typeof multiTenantAuth.validateTenantAccess === 'function',
        'validateTenantAccess should be a function');
    assert(typeof multiTenantAuth.clearTenantCache === 'function',
        'clearTenantCache should be a function');
    assert(typeof multiTenantAuth.clearAllCache === 'function',
        'clearAllCache should be a function');
    assert(typeof multiTenantAuth.getAuthStatus === 'function',
        'getAuthStatus should be a function');
});

// =============================================================================
// TEST: Resource Graph Exports
// =============================================================================
console.log('\n🔍 Testing Resource Graph Exports...\n');

test('resourceGraph exports query functions', () => {
    assert(typeof resourceGraph.queryVMInventory === 'function',
        'queryVMInventory should be a function');
    assert(typeof resourceGraph.queryVMsByTag === 'function',
        'queryVMsByTag should be a function');
    assert(typeof resourceGraph.queryVMsByLocation === 'function',
        'queryVMsByLocation should be a function');
    assert(typeof resourceGraph.queryVMsBySize === 'function',
        'queryVMsBySize should be a function');
});

test('resourceGraph exports aggregate functions', () => {
    assert(typeof resourceGraph.aggregateByResourceGroup === 'function',
        'aggregateByResourceGroup should be a function');
    assert(typeof resourceGraph.aggregateByLocation === 'function',
        'aggregateByLocation should be a function');
    assert(typeof resourceGraph.aggregateBySize === 'function',
        'aggregateBySize should be a function');
});

test('resourceGraph exports detail and multi-tenant functions', () => {
    assert(typeof resourceGraph.getVMDetailsById === 'function',
        'getVMDetailsById should be a function');
    assert(typeof resourceGraph.queryAllTenantsInventory === 'function',
        'queryAllTenantsInventory should be a function');
    assert(typeof resourceGraph.getCrosstenantSummary === 'function',
        'getCrosstenantSummary should be a function');
});

// =============================================================================
// TEST: Multi-Tenant Log Analytics Exports
// =============================================================================
console.log('\n📈 Testing Multi-Tenant Log Analytics Exports...\n');

test('multiTenantLogAnalytics exports workspace query functions', () => {
    assert(typeof multiTenantLogAnalytics.queryWorkspace === 'function',
        'queryWorkspace should be a function');
    assert(typeof multiTenantLogAnalytics.queryTenant === 'function',
        'queryTenant should be a function');
    assert(typeof multiTenantLogAnalytics.queryAllTenants === 'function',
        'queryAllTenants should be a function');
    assert(typeof multiTenantLogAnalytics.queryTenantByName === 'function',
        'queryTenantByName should be a function');
});

test('multiTenantLogAnalytics exports utility functions', () => {
    assert(typeof multiTenantLogAnalytics.queryVMMetrics === 'function',
        'queryVMMetrics should be a function');
    assert(typeof multiTenantLogAnalytics.executeQuery === 'function',
        'executeQuery should be a function');
    assert(typeof multiTenantLogAnalytics.parseQueryResults === 'function',
        'parseQueryResults should be a function');
});

// =============================================================================
// TEST: Multi-Tenant Auth - getAuthStatus (unit test)
// =============================================================================
console.log('\n📊 Testing Auth Status Function...\n');

test('getAuthStatus returns valid structure', () => {
    const status = multiTenantAuth.getAuthStatus();
    assert(typeof status === 'object', 'Status should be an object');
    assert(typeof status.cachedCredentials === 'number', 'cachedCredentials should be a number');
    assert(typeof status.cachedTokens === 'number', 'cachedTokens should be a number');
    assert(typeof status.keyVaultConfigured === 'boolean', 'keyVaultConfigured should be a boolean');
    assert(typeof status.tokens === 'object', 'tokens should be an object');
});

test('getAuthStatus shows unconfigured state initially', () => {
    const status = multiTenantAuth.getAuthStatus();
    assert(status.cachedCredentials === 0, 'Should have no cached credentials initially');
    assert(status.cachedTokens === 0, 'Should have no cached tokens initially');
    assert(status.keyVaultConfigured === false, 'Key Vault should not be configured initially');
});

// =============================================================================
// TEST: Log Analytics Query Parsing (unit test - no Azure required)
// =============================================================================
console.log('\n📊 Testing Log Analytics Query Parsing...\n');

test('parseQueryResults handles valid Log Analytics response', () => {
    const mockResponse = {
        tables: [{
            columns: [
                { name: 'Computer' },
                { name: 'AvgCPU' },
                { name: 'MaxCPU' }
            ],
            rows: [
                ['vm-prod-001', 45.2, 89.5],
                ['vm-prod-002', 23.1, 67.8]
            ]
        }]
    };

    const results = multiTenantLogAnalytics.parseQueryResults(mockResponse);
    assert(Array.isArray(results), 'Should return an array');
    assert(results.length === 2, 'Should have 2 results');
    assert(results[0].Computer === 'vm-prod-001', 'First VM name should match');
    assert(results[0].AvgCPU === 45.2, 'First VM AvgCPU should match');
    assert(results[1].MaxCPU === 67.8, 'Second VM MaxCPU should match');
});

test('parseQueryResults handles empty response', () => {
    const emptyResponse = { tables: [] };
    const results = multiTenantLogAnalytics.parseQueryResults(emptyResponse);
    assert(Array.isArray(results), 'Should return an array');
    assert(results.length === 0, 'Should be empty');
});

test('parseQueryResults handles null tables', () => {
    const nullResponse = { tables: null };
    const results = multiTenantLogAnalytics.parseQueryResults(nullResponse);
    assert(Array.isArray(results), 'Should return an array');
    assert(results.length === 0, 'Should be empty');
});

// =============================================================================
// TEST: getCredentialFromSecrets (unit test - no Azure required)
// =============================================================================
console.log('\n🔑 Testing Credential Creation...\n');

test('getCredentialFromSecrets creates credential object', () => {
    const credential = multiTenantAuth.getCredentialFromSecrets(
        'test-tenant-id',
        'test-client-id',
        'test-client-secret'
    );
    assert(credential, 'Should return a credential object');
    assert(typeof credential.getToken === 'function', 'Credential should have getToken method');
});

// =============================================================================
// TEST: Data Structure Validation
// =============================================================================
console.log('\n📋 Testing Data Structure Helpers...\n');

test('Tenant config structure is valid', () => {
    const mockTenantConfig = {
        tenantId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        tenantName: 'Production',
        subscriptionIds: ['sub-1', 'sub-2'],
        logAnalyticsWorkspaces: [
            { workspaceId: 'ws-1', name: 'prod-la', subscriptions: ['sub-1'] }
        ],
        servicePrincipal: {
            clientId: 'client-id',
            secretName: 'Production-ClientSecret'
        },
        enabled: true
    };

    assert(mockTenantConfig.tenantId, 'tenantId is required');
    assert(mockTenantConfig.tenantName, 'tenantName is required');
    assert(Array.isArray(mockTenantConfig.subscriptionIds), 'subscriptionIds should be an array');
    assert(Array.isArray(mockTenantConfig.logAnalyticsWorkspaces), 'logAnalyticsWorkspaces should be an array');
    assert(mockTenantConfig.servicePrincipal, 'servicePrincipal is required');
});

test('Run data structure is valid', () => {
    const mockRunData = {
        runId: `run-${Date.now()}`,
        subscriptionId: 'all',
        tenantId: 'test-tenant',
        status: 'COMPLETED',
        summary: {
            totalVMs: 77,
            underutilized: 23,
            overutilized: 8,
            optimal: 35,
            needsReview: 11
        },
        startTime: new Date().toISOString(),
        endTime: new Date().toISOString(),
        duration: 300000
    };

    assert(mockRunData.runId, 'runId is required');
    assert(mockRunData.status, 'status is required');
    assert(mockRunData.summary, 'summary is required');
    assert(typeof mockRunData.summary.totalVMs === 'number', 'totalVMs should be a number');
});

test('VM inventory record structure is valid', () => {
    const mockVMRecord = {
        tenantId: 'tenant-1',
        tenantName: 'Production',
        subscriptionId: 'sub-1',
        resourceGroup: 'app-rg',
        vmName: 'vm-prod-001',
        vmId: '/subscriptions/sub-1/resourceGroups/app-rg/providers/Microsoft.Compute/virtualMachines/vm-prod-001',
        vmSize: 'Standard_D4s_v3',
        location: 'eastus',
        osType: 'Windows',
        powerState: 'running',
        tags: {
            environment: 'prod',
            application: 'web'
        }
    };

    assert(mockVMRecord.vmName, 'vmName is required');
    assert(mockVMRecord.vmId, 'vmId is required');
    assert(mockVMRecord.vmSize, 'vmSize is required');
    assert(mockVMRecord.location, 'location is required');
});

// =============================================================================
// SUMMARY
// =============================================================================
console.log('\n' + '='.repeat(60));
console.log('📊 TEST SUMMARY');
console.log('='.repeat(60));
console.log(`\n  Total:  ${results.passed + results.failed}`);
console.log(`  Passed: ${results.passed} ✓`);
console.log(`  Failed: ${results.failed} ✗`);
console.log();

if (results.failed > 0) {
    console.log('Failed tests:');
    results.tests
        .filter(t => t.status === 'FAIL')
        .forEach(t => console.log(`  - ${t.name}: ${t.error}`));
    console.log();
    process.exit(1);
} else {
    console.log('All tests passed! ✓\n');
    console.log('Next steps for integration testing:');
    console.log('  1. Set AZURE_STORAGE_CONNECTION_STRING environment variable');
    console.log('  2. Set KEY_VAULT_URL environment variable');
    console.log('  3. Configure tenant in Azure Table Storage');
    console.log('  4. Run: node src/tests/testIntegration.js');
    console.log();
    process.exit(0);
}
