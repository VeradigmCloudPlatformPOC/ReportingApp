#!/bin/bash
# =============================================================================
# Deploy Orchestrator to Azure Container Apps
# =============================================================================
# This script deploys the VM Performance Orchestrator to Azure.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Secrets already configured in Key Vault
#
# Usage:
#   chmod +x deploy-orchestrator.sh
#   ./deploy-orchestrator.sh
# =============================================================================

set -e

# Configuration
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
KEY_VAULT_NAME="vmperf-kv-18406"

# Container App configuration
CONTAINER_APP_ENV_NAME="vmperf-env"
CONTAINER_APP_NAME="vmperf-orchestrator"
ACR_NAME="ca0bf4270c7eacr"
IMAGE_NAME="vmperf-orchestrator"
IMAGE_TAG="v2"

echo "=============================================="
echo "VM Performance Orchestrator - Deployment"
echo "=============================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Key Vault: $KEY_VAULT_NAME"
echo "Container Registry: $ACR_NAME"
echo ""

# Step 1: Build and push container image using ACR Tasks
echo "Step 1: Building container image..."
cd "$(dirname "$0")/../container-app"

az acr build \
    --registry $ACR_NAME \
    --image $IMAGE_NAME:$IMAGE_TAG \
    --image $IMAGE_NAME:latest \
    --file Dockerfile \
    .

echo "✓ Container image built and pushed"

# Step 2: Create Container Apps Environment (if not exists)
echo ""
echo "Step 2: Checking Container Apps Environment..."

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

# Step 3: Get ACR credentials
echo ""
echo "Step 3: Getting ACR credentials..."
ACR_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
ACR_USERNAME=$(az acr credential show --name $ACR_NAME --query username -o tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query "passwords[0].value" -o tsv)

# Step 4: Create/Update Container App
echo ""
echo "Step 4: Deploying Container App..."

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
        --target-port 3000 \
        --ingress external \
        --min-replicas 1 \
        --max-replicas 5 \
        --cpu 1 \
        --memory 2Gi \
        --env-vars \
            "KEY_VAULT_URL=https://$KEY_VAULT_NAME.vault.azure.net" \
            "STORAGE_CONNECTION_STRING=@secretref:storage-connection"
    echo "✓ Container App created"
else
    # Update existing Container App
    az containerapp update \
        --name $CONTAINER_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --image "$ACR_SERVER/$IMAGE_NAME:$IMAGE_TAG"
    echo "✓ Container App updated"
fi

# Step 5: Enable Managed Identity and grant Key Vault access
echo ""
echo "Step 5: Configuring Managed Identity..."

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

echo "✓ Managed Identity configured with Key Vault access"

# Step 6: Get the app URL
echo ""
echo "Step 6: Getting deployment info..."

APP_URL=$(az containerapp show \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo ""
echo "Orchestrator URL: https://$APP_URL"
echo ""
echo "Endpoints:"
echo "  Health Check: https://$APP_URL/health"
echo "  Orchestrate: POST https://$APP_URL/api/orchestrate"
echo "  Run Status: GET https://$APP_URL/api/runs/{runId}/status"
echo ""
