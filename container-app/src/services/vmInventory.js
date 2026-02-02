const { DefaultAzureCredential } = require('@azure/identity');
const { ComputeManagementClient } = require('@azure/arm-compute');

/**
 * Get VM Inventory details from Azure Compute API
 */
async function getVMInventory(vmData, secrets) {
    const subscriptionId = secrets.TargetSubscriptionId;

    try {
        // Parse resource ID to get VM details
        const resourceIdParts = vmData.ResourceId.split('/');
        const resourceGroup = resourceIdParts[4];
        const vmName = resourceIdParts[8];

        const credential = new DefaultAzureCredential();
        const computeClient = new ComputeManagementClient(credential, subscriptionId);

        // Get VM details
        const vm = await computeClient.virtualMachines.get(resourceGroup, vmName, { expand: 'instanceView' });

        // Get VM size details
        let skuDetails = {};
        try {
            const vmSizes = computeClient.virtualMachineSizes.list(vm.location);
            for await (const size of vmSizes) {
                if (size.name === vm.hardwareProfile.vmSize) {
                    skuDetails = {
                        vCPUs: size.numberOfCores,
                        memoryGB: size.memoryInMB / 1024,
                        maxDataDisks: size.maxDataDiskCount,
                        osDiskSizeGB: size.osDiskSizeInMB / 1024
                    };
                    break;
                }
            }
        } catch (err) {
            console.log(`  Warning: Could not get SKU details for ${vmName}: ${err.message}`);
        }

        // Extract power state
        let powerState = 'Unknown';
        if (vm.instanceView?.statuses) {
            const powerStatus = vm.instanceView.statuses.find(s => s.code?.startsWith('PowerState/'));
            if (powerStatus) {
                powerState = powerStatus.displayStatus || powerStatus.code.replace('PowerState/', '');
            }
        }

        return {
            ...vmData,
            inventory: {
                vmSize: vm.hardwareProfile?.vmSize || 'Unknown',
                osType: vm.storageProfile?.osDisk?.osType || 'Unknown',
                osSku: vm.storageProfile?.imageReference?.sku || 'Unknown',
                osPublisher: vm.storageProfile?.imageReference?.publisher || 'Unknown',
                osOffer: vm.storageProfile?.imageReference?.offer || 'Unknown',
                osVersion: vm.storageProfile?.imageReference?.version || 'Unknown',
                location: vm.location || 'Unknown',
                provisioningState: vm.provisioningState || 'Unknown',
                powerState: powerState,
                vmId: vm.vmId || 'Unknown',
                tags: vm.tags || {},
                availabilitySet: vm.availabilitySet?.id ? vm.availabilitySet.id.split('/').pop() : null,
                zones: vm.zones || []
            },
            skuLimits: skuDetails
        };

    } catch (error) {
        console.log(`  Warning: Could not get inventory for ${vmData.VMName}: ${error.message}`);
        return {
            ...vmData,
            inventory: {
                vmSize: 'Unknown',
                osType: 'Unknown',
                error: error.message
            },
            skuLimits: {}
        };
    }
}

module.exports = { getVMInventory };
