#!/usr/bin/env node
/**
 * @fileoverview Add Tenant Configuration to Azure Table Storage
 *
 * This script adds tenant configurations to the 'tenants' table in Azure Table Storage.
 * Tenant configurations are required for the bot to show available tenants and
 * for multi-tenant VM performance analysis.
 *
 * Usage:
 *   node add-tenant-config.js
 *
 * Prerequisites:
 *   - Azure CLI logged in (az login)
 *   - StorageConnectionString in Key Vault
 *   - KEY_VAULT_NAME environment variable (or uses default)
 *
 * @version v8-agent
 */

const { TableClient } = require('@azure/data-tables');
const { DefaultAzureCredential } = require('@azure/identity');
const { SecretClient } = require('@azure/keyvault-secrets');
const readline = require('readline');

const KEY_VAULT_NAME = process.env.KEY_VAULT_NAME || 'vmperf-kv-18406';
const KEY_VAULT_URL = `https://${KEY_VAULT_NAME}.vault.azure.net`;

/**
 * Prompt for user input.
 */
function prompt(question) {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    return new Promise((resolve) => {
        rl.question(question, (answer) => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/**
 * Get storage connection string from Key Vault.
 */
async function getStorageConnectionString() {
    console.log(`\nFetching StorageConnectionString from Key Vault: ${KEY_VAULT_NAME}...`);
    const credential = new DefaultAzureCredential();
    const client = new SecretClient(KEY_VAULT_URL, credential);
    const secret = await client.getSecret('StorageConnectionString');
    console.log('✓ Connection string retrieved');
    return secret.value;
}

/**
 * List existing tenants.
 */
async function listTenants(tableClient) {
    console.log('\n--- Existing Tenant Configurations ---');
    const tenants = [];

    for await (const entity of tableClient.listEntities({
        queryOptions: { filter: `PartitionKey eq 'config'` }
    })) {
        tenants.push(entity);
        const enabled = entity.enabled ? '✓' : '✗';
        const subs = JSON.parse(entity.subscriptionIds || '[]');
        console.log(`  ${enabled} ${entity.tenantName} (${entity.rowKey})`);
        console.log(`    Subscriptions: ${subs.length}`);
    }

    if (tenants.length === 0) {
        console.log('  (No tenants configured)');
    }

    return tenants;
}

/**
 * Add a new tenant configuration.
 */
async function addTenant(tableClient) {
    console.log('\n--- Add New Tenant Configuration ---\n');

    const tenantId = await prompt('Tenant ID (Azure AD GUID): ');
    if (!tenantId) {
        console.log('Tenant ID is required');
        return;
    }

    const tenantName = await prompt('Tenant Name (friendly name, e.g., "Production"): ');
    if (!tenantName) {
        console.log('Tenant Name is required');
        return;
    }

    const subscriptionsStr = await prompt('Subscription IDs (comma-separated): ');
    const subscriptionIds = subscriptionsStr
        ? subscriptionsStr.split(',').map(s => s.trim()).filter(s => s)
        : [];

    const enabledStr = await prompt('Enabled? (y/n, default: y): ');
    const enabled = enabledStr.toLowerCase() !== 'n';

    // Optional: Log Analytics workspace
    const workspaceId = await prompt('Log Analytics Workspace ID (optional, press Enter to skip): ');
    const logAnalyticsWorkspaces = workspaceId ? [{
        workspaceId,
        resourceGroup: await prompt('  Workspace Resource Group: '),
        subscriptionId: subscriptionIds[0] || ''
    }] : [];

    // Optional: Service Principal
    const spClientId = await prompt('Service Principal Client ID (optional, press Enter to skip): ');
    const servicePrincipal = spClientId ? {
        clientId: spClientId,
        secretName: `SP-${tenantName.replace(/\s+/g, '-')}-Secret`
    } : {};

    const entity = {
        partitionKey: 'config',
        rowKey: tenantId,
        tenantName,
        subscriptionIds: JSON.stringify(subscriptionIds),
        logAnalyticsWorkspaces: JSON.stringify(logAnalyticsWorkspaces),
        servicePrincipal: JSON.stringify(servicePrincipal),
        enabled,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };

    console.log('\n--- Tenant Configuration ---');
    console.log(JSON.stringify({
        tenantId,
        tenantName,
        subscriptionIds,
        logAnalyticsWorkspaces,
        servicePrincipal,
        enabled
    }, null, 2));

    const confirm = await prompt('\nSave this configuration? (y/n): ');
    if (confirm.toLowerCase() !== 'y') {
        console.log('Cancelled');
        return;
    }

    await tableClient.upsertEntity(entity);
    console.log(`\n✓ Tenant "${tenantName}" saved successfully!`);
}

/**
 * Delete a tenant configuration.
 */
async function deleteTenant(tableClient) {
    const tenantId = await prompt('\nTenant ID to delete: ');
    if (!tenantId) return;

    const confirm = await prompt(`Delete tenant ${tenantId}? (y/n): `);
    if (confirm.toLowerCase() !== 'y') {
        console.log('Cancelled');
        return;
    }

    try {
        await tableClient.deleteEntity('config', tenantId);
        console.log(`✓ Tenant ${tenantId} deleted`);
    } catch (error) {
        if (error.statusCode === 404) {
            console.log('Tenant not found');
        } else {
            throw error;
        }
    }
}

/**
 * Add sample tenants for testing.
 */
async function addSampleTenants(tableClient) {
    console.log('\n--- Adding Sample Tenants ---\n');

    const sampleTenants = [
        {
            tenantId: '21d8e422-7fd3-4634-8c8a-01dfde9a5502',
            tenantName: 'Veradigm Production',
            subscriptionIds: ['ffd7017b-28ed-4e90-a2ec-4a6958578f98'],
            enabled: true
        }
    ];

    for (const tenant of sampleTenants) {
        const entity = {
            partitionKey: 'config',
            rowKey: tenant.tenantId,
            tenantName: tenant.tenantName,
            subscriptionIds: JSON.stringify(tenant.subscriptionIds),
            logAnalyticsWorkspaces: JSON.stringify([]),
            servicePrincipal: JSON.stringify({}),
            enabled: tenant.enabled,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
        };

        await tableClient.upsertEntity(entity);
        console.log(`✓ Added: ${tenant.tenantName}`);
    }

    console.log('\nSample tenants added!');
}

/**
 * Main function.
 */
async function main() {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║     VM Performance Bot - Tenant Configuration Tool     ║');
    console.log('╚════════════════════════════════════════════════════════╝');

    try {
        // Get storage connection string
        const connectionString = await getStorageConnectionString();

        // Initialize table client
        const tableClient = TableClient.fromConnectionString(connectionString, 'tenants');

        // Ensure table exists
        await tableClient.createTable().catch(err => {
            if (err.statusCode !== 409) throw err;
        });
        console.log('✓ Connected to tenants table');

        // Main menu loop
        let running = true;
        while (running) {
            console.log('\n--- Menu ---');
            console.log('1. List tenants');
            console.log('2. Add tenant');
            console.log('3. Delete tenant');
            console.log('4. Add sample tenant (Veradigm)');
            console.log('5. Exit');

            const choice = await prompt('\nChoice (1-5): ');

            switch (choice) {
                case '1':
                    await listTenants(tableClient);
                    break;
                case '2':
                    await addTenant(tableClient);
                    break;
                case '3':
                    await deleteTenant(tableClient);
                    break;
                case '4':
                    await addSampleTenants(tableClient);
                    break;
                case '5':
                    running = false;
                    break;
                default:
                    console.log('Invalid choice');
            }
        }

        console.log('\nGoodbye!');

    } catch (error) {
        console.error('\n✗ Error:', error.message);
        process.exit(1);
    }
}

main();
