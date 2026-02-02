/**
 * VM Metrics and Inventory Data Model
 */

class VMMetrics {
    constructor(data) {
        this.vmName = data.vmName || data.Computer;
        this.resourceId = data.resourceId || data._ResourceId;
        this.resourceGroup = data.resourceGroup || this.extractResourceGroup(this.resourceId);
        this.subscriptionId = data.subscriptionId || this.extractSubscriptionId(this.resourceId);

        // Performance Metrics
        this.metrics = {
            cpu: {
                max: parseFloat(data.CPU_Max) || 0,
                avg: parseFloat(data.CPU_Avg) || 0,
                p95: parseFloat(data.CPU_P95) || 0
            },
            memory: {
                max: parseFloat(data.Memory_Max) || 0,
                avg: parseFloat(data.Memory_Avg) || 0,
                p95: parseFloat(data.Memory_P95) || 0
            },
            diskIOPS: {
                max: parseFloat(data.DiskIOPS_Max) || 0,
                avg: parseFloat(data.DiskIOPS_Avg) || 0,
                p95: parseFloat(data.DiskIOPS_P95) || 0
            }
        };

        // VM Inventory Details
        this.inventory = {
            vmSize: data.vmSize || null,
            osType: data.osType || null,
            osSku: data.osSku || null,
            osVersion: data.osVersion || null,
            location: data.location || null,
            provisioningState: data.provisioningState || null,
            powerState: data.powerState || null,
            vmId: data.vmId || null
        };

        // SKU Performance Limits (will be populated)
        this.skuLimits = {
            vCPUs: data.vCPUs || null,
            memoryGB: data.memoryGB || null,
            maxDataDisks: data.maxDataDisks || null,
            maxIOPS: data.maxIOPS || null,
            maxThroughputMBps: data.maxThroughputMBps || null,
            maxNICs: data.maxNICs || null
        };

        // Cost Information
        this.cost = {
            currentMonthlyCost: data.currentMonthlyCost || null,
            currency: 'USD'
        };

        // Analysis metadata
        this.analysisPeriod = data.analysisPeriod || '7 days';
        this.analyzedAt = new Date().toISOString();
    }

    extractResourceGroup(resourceId) {
        if (!resourceId) return null;
        const parts = resourceId.split('/');
        const rgIndex = parts.indexOf('resourceGroups');
        return rgIndex >= 0 ? parts[rgIndex + 1] : null;
    }

    extractSubscriptionId(resourceId) {
        if (!resourceId) return null;
        const parts = resourceId.split('/');
        const subIndex = parts.indexOf('subscriptions');
        return subIndex >= 0 ? parts[subIndex + 1] : null;
    }

    isUnderutilized() {
        return this.metrics.cpu.p95 < 20 && this.metrics.memory.p95 < 30;
    }

    isOverutilized() {
        return this.metrics.cpu.p95 > 80 || this.metrics.memory.p95 > 85;
    }

    isOptimal() {
        const cpuOptimal = this.metrics.cpu.p95 >= 40 && this.metrics.cpu.p95 <= 70;
        const memOptimal = this.metrics.memory.p95 >= 50 && this.metrics.memory.p95 <= 75;
        return cpuOptimal && memOptimal;
    }

    getStatus() {
        if (this.isUnderutilized()) return 'UNDERUTILIZED';
        if (this.isOverutilized()) return 'OVERUTILIZED';
        if (this.isOptimal()) return 'OPTIMAL';
        return 'NEEDS_REVIEW';
    }

    toJSON() {
        return {
            vmName: this.vmName,
            resourceId: this.resourceId,
            resourceGroup: this.resourceGroup,
            subscriptionId: this.subscriptionId,
            metrics: this.metrics,
            inventory: this.inventory,
            skuLimits: this.skuLimits,
            cost: this.cost,
            status: this.getStatus(),
            analysisPeriod: this.analysisPeriod,
            analyzedAt: this.analyzedAt
        };
    }
}

module.exports = VMMetrics;
