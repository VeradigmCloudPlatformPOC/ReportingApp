const { app } = require('@azure/functions');
const { ComputeManagementClient } = require('@azure/arm-compute');
const { ClientSecretCredential } = require('@azure/identity');

/**
 * Activity: Get VM Inventory Details (OS, SKU, Limits)
 */
app.activity('GetVMInventory', {
    handler: async (vm, context) => {
        const clientId = process.env.LOG_ANALYTICS_CLIENT_ID;
        const clientSecret = process.env.LOG_ANALYTICS_CLIENT_SECRET;
        const tenantId = process.env.LOG_ANALYTICS_TENANT_ID;
        const subscriptionId = vm.SubscriptionId;

        context.log(`Getting inventory for VM: ${vm.VMName}`);

        try {
            const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
            const computeClient = new ComputeManagementClient(credential, subscriptionId);

            // Extract VM name and resource group from resource ID
            const vmName = vm.VMName;
            const resourceGroup = vm.ResourceGroup;

            // Get VM details
            const vmDetails = await computeClient.virtualMachines.get(
                resourceGroup,
                vmName,
                { expand: 'instanceView' }
            );

            // Get VM size/SKU capabilities
            const location = vmDetails.location;
            const vmSize = vmDetails.hardwareProfile.vmSize;

            let skuDetails = null;
            try {
                const skus = await computeClient.resourceSkus.list();
                for await (const sku of skus) {
                    if (sku.resourceType === 'virtualMachines' &&
                        sku.name === vmSize &&
                        sku.locations.includes(location)) {
                        skuDetails = sku;
                        break;
                    }
                }
            } catch (skuError) {
                context.log.warn(`Could not fetch SKU details for ${vmSize}:`, skuError.message);
            }

            // Extract SKU capabilities
            const capabilities = {};
            if (skuDetails && skuDetails.capabilities) {
                skuDetails.capabilities.forEach(cap => {
                    capabilities[cap.name] = cap.value;
                });
            }

            // Get power state
            let powerState = 'unknown';
            if (vmDetails.instanceView && vmDetails.instanceView.statuses) {
                const powerStatus = vmDetails.instanceView.statuses.find(s =>
                    s.code && s.code.startsWith('PowerState/')
                );
                if (powerStatus) {
                    powerState = powerStatus.code.split('/')[1];
                }
            }

            // Enhanced VM data with inventory
            return {
                ...vm,
                vmSize: vmSize,
                osType: vmDetails.storageProfile?.osDisk?.osType || 'Unknown',
                osSku: vmDetails.storageProfile?.imageReference?.sku || 'Unknown',
                osVersion: vmDetails.storageProfile?.imageReference?.version || 'Unknown',
                osPublisher: vmDetails.storageProfile?.imageReference?.publisher || 'Unknown',
                osOffer: vmDetails.storageProfile?.imageReference?.offer || 'Unknown',
                location: location,
                provisioningState: vmDetails.provisioningState,
                powerState: powerState,
                vmId: vmDetails.vmId,
                tags: vmDetails.tags || {},

                // SKU Performance Limits
                vCPUs: parseInt(capabilities.vCPUs || capabilities.vCPUsAvailable || '0'),
                memoryGB: parseFloat(capabilities.MemoryGB || '0'),
                maxDataDisks: parseInt(capabilities.MaxDataDiskCount || '0'),
                maxIOPS: parseInt(capabilities.UncachedDiskIOPS || capabilities.CachedDiskIOPS || '0'),
                maxThroughputMBps: parseInt(capabilities.UncachedDiskBytesPerSecond || '0') / 1024 / 1024,
                maxNICs: parseInt(capabilities.MaxNetworkInterfaces || '0'),
                premiumIO: capabilities.PremiumIO === 'True',
                acceleratedNetworking: capabilities.AcceleratedNetworkingEnabled === 'True',

                // Additional details
                availabilitySet: vmDetails.availabilitySet?.id || null,
                zones: vmDetails.zones || []
            };

        } catch (error) {
            context.log.error(`Error getting inventory for VM ${vm.VMName}:`, error.message);

            // Return VM with partial data if inventory fetch fails
            return {
                ...vm,
                vmSize: 'Unknown',
                osType: 'Unknown',
                inventoryError: error.message
            };
        }
    }
});
