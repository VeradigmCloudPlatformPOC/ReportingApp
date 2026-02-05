#!/bin/bash
# =============================================================================
# Deploy Resource Graph Service to Azure Container Apps
# =============================================================================
# This script deploys the Resource Graph Service (App 1) for VM inventory
# and discovery with 24-hour blob caching.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Secrets already configured in Key Vault
#
# Usage:
#   chmod +x deploy-resource-graph.sh
#   ./deploy-resource-graph.sh
# =============================================================================

set -e

# Configuration
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
KEY_VAULT_NAME="vmperf-kv-18406"
STORAGE_ACCOUNT_NAME="vmperfstore18406"

# Container App configuration
CONTAINER_APP_ENV_NAME="vmperf-env"
CONTAINER_APP_NAME="vmperf-resource-graph"
ACR_NAME="ca0bf4270c7eacr"
IMAGE_NAME="vmperf-resource-graph"
IMAGE_TAG="v11-node20"

echo "=============================================="
echo "Resource Graph Service - Deployment (App 1)"
echo "=============================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Key Vault: $KEY_VAULT_NAME"
echo "Storage Account: $STORAGE_ACCOUNT_NAME"
echo "Container Registry: $ACR_NAME"
echo "Image: $IMAGE_NAME:$IMAGE_TAG"
echo ""

# Step 1: Build and push container image using ACR Tasks
echo "Step 1: Building container image..."
cd "$(dirname "$0")/../resource-graph-service"

az acr build \
    --registry $ACR_NAME \
    --image $IMAGE_NAME:$IMAGE_TAG \
    --image $IMAGE_NAME:latest \
    --file Dockerfile \
    .

echo "✓ Container image built and pushed"

# Step 2: Ensure Container Apps Environment exists
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
        --target-port 3001 \
        --ingress external \
        --min-replicas 0 \
        --max-replicas 3 \
        --cpu 0.5 \
        --memory 1Gi \
        --env-vars \
            "KEY_VAULT_URL=https://$KEY_VAULT_NAME.vault.azure.net" \
            "STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME" \
            "PORT=3001"
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

# Step 6: Grant Storage Account access for blob caching
echo ""
echo "Step 6: Granting Storage Account access..."

# Get storage account resource ID
STORAGE_ID=$(az storage account show \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "id" -o tsv 2>/dev/null || echo "")

if [ -n "$STORAGE_ID" ]; then
    # Assign Storage Blob Data Contributor role
    az role assignment create \
        --role "Storage Blob Data Contributor" \
        --assignee-object-id $IDENTITY_PRINCIPAL_ID \
        --assignee-principal-type ServicePrincipal \
        --scope $STORAGE_ID 2>/dev/null || echo "Role assignment may already exist"
    echo "✓ Storage Blob Data Contributor role assigned"
else
    echo "⚠ Storage account not found - caching may not work"
fi

# Step 7: Get the app URL
echo ""
echo "Step 7: Getting deployment info..."

APP_URL=$(az containerapp show \
    --name $CONTAINER_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv)

echo ""
echo "=============================================="
echo "Deployment Complete!"
echo "=============================================="
echo ""
echo "Resource Graph Service URL: https://$APP_URL"
echo ""
echo "Endpoints:"
echo "  Health Check: https://$APP_URL/health"
echo "  VM Inventory: POST https://$APP_URL/api/resources/vms"
echo "  VM Search: POST https://$APP_URL/api/resources/search"
echo "  Summary: POST https://$APP_URL/api/resources/summary"
echo "  Subscriptions: GET https://$APP_URL/api/subscriptions"
echo "  Cross-Tenant: GET https://$APP_URL/api/resources/summary/cross-tenant"
echo "  Cache Stats: GET https://$APP_URL/api/cache/stats"
echo ""
echo "Test with:"
echo "  curl https://$APP_URL/health"
echo ""
