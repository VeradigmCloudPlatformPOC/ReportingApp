#!/bin/bash
# =============================================================================
# Deploy Long-Term Log Analytics Service to Azure Container Apps
# =============================================================================
# This script deploys the Long-Term Log Analytics Service (App 3) for
# metrics collection with >10 day time range, queue-based reliable processing.
#
# v12 Features:
#   - Azure Storage Queue for reliable batch processing
#   - Azure Blob Storage for results persistence (24hr TTL)
#   - Automatic retry on transient failures
#   - Dead-letter queue for failed batches
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Secrets already configured in Key Vault
#   - Storage queues created (batch-jobs, batch-jobs-deadletter)
#   - Blob container created (batch-results)
#
# Usage:
#   chmod +x deploy-la-long.sh
#   ./deploy-la-long.sh
# =============================================================================

set -e

# Configuration
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
KEY_VAULT_NAME="vmperf-kv-18406"
STORAGE_ACCOUNT_NAME="vmperfstore18406"

# Container App configuration
CONTAINER_APP_ENV_NAME="vmperf-env"
CONTAINER_APP_NAME="vmperf-la-long"
ACR_NAME="ca0bf4270c7eacr"
IMAGE_NAME="vmperf-la-long"
IMAGE_TAG="v12"

echo "=============================================="
echo "Long-Term Log Analytics Service - Deployment (App 3)"
echo "=============================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Key Vault: $KEY_VAULT_NAME"
echo "Storage Account: $STORAGE_ACCOUNT_NAME"
echo "Container Registry: $ACR_NAME"
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo ""

# Step 1: Verify Azure Storage resources exist
echo "Step 1: Verifying Azure Storage resources..."

QUEUE_EXISTS=$(az storage queue exists --name batch-jobs --account-name $STORAGE_ACCOUNT_NAME --auth-mode login --query "exists" -o tsv)
if [ "$QUEUE_EXISTS" != "true" ]; then
    echo "ERROR: Queue 'batch-jobs' does not exist. Please create it first."
    exit 1
fi

DLQ_EXISTS=$(az storage queue exists --name batch-jobs-deadletter --account-name $STORAGE_ACCOUNT_NAME --auth-mode login --query "exists" -o tsv)
if [ "$DLQ_EXISTS" != "true" ]; then
    echo "ERROR: Queue 'batch-jobs-deadletter' does not exist. Please create it first."
    exit 1
fi

CONTAINER_EXISTS=$(az storage container exists --name batch-results --account-name $STORAGE_ACCOUNT_NAME --auth-mode login --query "exists" -o tsv)
if [ "$CONTAINER_EXISTS" != "true" ]; then
    echo "ERROR: Blob container 'batch-results' does not exist. Please create it first."
    exit 1
fi

echo "✓ Azure Storage resources verified"

# Step 2: Build and push container image using ACR Tasks
echo ""
echo "Step 2: Building container image..."
cd "$(dirname "$0")/../loganalytics-long-service"

az acr build \
    --registry $ACR_NAME \
    --image $IMAGE_NAME:$IMAGE_TAG \
    --image $IMAGE_NAME:latest \
    --file Dockerfile \
    .

echo "✓ Container image built and pushed"

# Step 3: Ensure Container Apps Environment exists
echo ""
echo "Step 3: Checking Container Apps Environment..."

ENV_EXISTS=$(az containerapp env show \
    --name $CONTAINER_APP_ENV_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "name" -o tsv 2>/dev/null || echo "")

if [ -z "$ENV_EXISTS" ]; then
    az containerapp env create \
        --name $CONTAINER_APP_ENV_NAME \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION
    echo "✓ Container Apps Environment created"
else
    echo "✓ Container Apps Environment already exists"
fi

# Step 4: Get ACR credentials
echo ""
echo "Step 4: Getting ACR credentials..."
ACR_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)

# Step 5: Create/Update Container App
echo ""
echo "Step 5: Deploying Container App..."

APP_EXISTS=$(az containerapp show \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "name" -o tsv 2>/dev/null || echo "")

if [ -z "$APP_EXISTS" ]; then
    # Create new Container App
    az containerapp create \
        --name $CONTAINER_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --environment $CONTAINER_APP_ENV_NAME \
        --image "$ACR_SERVER/$IMAGE_NAME:$IMAGE_TAG" \
        --registry-server $ACR_SERVER \
        --registry-username $ACR_USERNAME \
        --registry-password $ACR_PASSWORD \
        --target-port 3003 \
        --ingress external \
        --min-replicas 1 \
        --max-replicas 3 \
        --cpu 2.0 \
        --memory 4Gi \
        --env-vars \
            "KEY_VAULT_URL=https://$KEY_VAULT_NAME.vault.azure.net" \
            "PORT=3003" \
            "STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME" \
            "BATCH_QUEUE_NAME=batch-jobs" \
            "BATCH_DLQ_NAME=batch-jobs-deadletter" \
            "BATCH_CONTAINER_NAME=batch-results"
    echo "✓ Container App created"
else
    # Update existing Container App
    az containerapp update \
        --name $CONTAINER_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --image "$ACR_SERVER/$IMAGE_NAME:$IMAGE_TAG" \
        --set-env-vars \
            "STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME" \
            "BATCH_QUEUE_NAME=batch-jobs" \
            "BATCH_DLQ_NAME=batch-jobs-deadletter" \
            "BATCH_CONTAINER_NAME=batch-results"
    echo "✓ Container App updated"
fi

# Step 6: Enable Managed Identity and grant access
echo ""
echo "Step 6: Configuring Managed Identity..."

# Enable system-assigned managed identity
az containerapp identity assign \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --system-assigned

# Get the identity principal ID
IDENTITY_PRINCIPAL_ID=$(az containerapp show \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "identity.principalId" -o tsv)

# Grant Key Vault access
az keyvault set-policy \
    --name $KEY_VAULT_NAME \
    --object-id $IDENTITY_PRINCIPAL_ID \
    --secret-permissions get list

echo "✓ Key Vault access configured"

# Grant Storage access (Queue and Blob)
echo ""
echo "Step 7: Granting Storage access..."

# Get storage account resource ID
STORAGE_ACCOUNT_ID=$(az storage account show \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "id" -o tsv)

# Grant Storage Queue Data Contributor role
az role assignment create \
    --assignee $IDENTITY_PRINCIPAL_ID \
    --role "Storage Queue Data Contributor" \
    --scope $STORAGE_ACCOUNT_ID \
    2>/dev/null || echo "Role assignment may already exist"

# Grant Storage Blob Data Contributor role
az role assignment create \
    --assignee $IDENTITY_PRINCIPAL_ID \
    --role "Storage Blob Data Contributor" \
    --scope $STORAGE_ACCOUNT_ID \
    2>/dev/null || echo "Role assignment may already exist"

echo "✓ Storage access configured"

# Step 8: Get the app URL
echo ""
echo "Step 8: Getting deployment info..."

APP_URL=$(az containerapp show \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo ""
echo "Long-Term Log Analytics Service URL: https://$APP_URL"
echo ""
echo "Endpoints:"
echo "  Health Check: https://$APP_URL/health"
echo ""
echo "  Synchronous Collection:"
echo "    POST https://$APP_URL/api/metrics/collect"
echo "    POST https://$APP_URL/api/metrics/batch"
echo "    GET  https://$APP_URL/api/metrics/vm/{vmName}"
echo ""
echo "  v12 Queue-Based Reliable Collection:"
echo "    POST https://$APP_URL/api/metrics/collect/reliable"
echo "    GET  https://$APP_URL/api/metrics/job/{jobId}"
echo "    GET  https://$APP_URL/api/metrics/job/{jobId}/results"
echo "    DELETE https://$APP_URL/api/metrics/job/{jobId}"
echo ""
echo "  Queue Management:"
echo "    GET  https://$APP_URL/api/metrics/queue/stats"
echo "    GET  https://$APP_URL/api/metrics/queue/deadletter"
echo "    POST https://$APP_URL/api/metrics/queue/cleanup"
echo ""
echo "v12 Features:"
echo "  ✓ Azure Storage Queue for reliable batch processing"
echo "  ✓ Automatic retry (max 3 attempts)"
echo "  ✓ Dead-letter queue for failed batches"
echo "  ✓ 24-hour result retention in Blob Storage"
echo ""
echo "Test with:"
echo "  curl https://$APP_URL/health"
echo ""
