#!/bin/bash
# =============================================================================
# Deploy Slack Bot to Azure Container Apps
# =============================================================================
# This script deploys the VM Performance Bot to Azure Container Apps.
# The bot supports Slack and Microsoft Teams via Azure Bot Service
# with Azure AI Foundry Agent for conversational AI.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Docker installed (for local build) OR use ACR Tasks
#   - Run setup-agent-resources.sh first to create required resources
#   - Secrets already configured in Key Vault
#
# Usage:
#   chmod +x deploy-slack-bot.sh
#   ./deploy-slack-bot.sh
# =============================================================================

set -e

# Configuration
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
KEY_VAULT_NAME="vmperf-kv-18406"

# Container App configuration
CONTAINER_APP_ENV_NAME="vmperf-env"
CONTAINER_APP_NAME="vmperf-slack-bot"
ACR_NAME="ca0bf4270c7eacr"
IMAGE_NAME="vmperf-slack-bot"
IMAGE_TAG="v12"

echo "=============================================="
echo "VM Performance Slack Bot - Deployment"
echo "=============================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Key Vault: $KEY_VAULT_NAME"
echo "Container Registry: $ACR_NAME"
echo ""

# Step 1: Build and push container image using ACR Tasks
echo "Step 1: Building container image..."
cd "$(dirname "$0")/../slack-bot"

az acr build \
    --registry $ACR_NAME \
    --image $IMAGE_NAME:$IMAGE_TAG \
    --image $IMAGE_NAME:latest \
    --file Dockerfile \
    .

echo "✓ Container image built and pushed"

# Step 2: Create Container Apps Environment (if not exists)
echo ""
echo "Step 2: Creating Container Apps Environment..."

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

# Step 4: Get Service URLs (v11 microservices architecture)
echo ""
echo "Step 4: Getting Service URLs..."

# App 1: Resource Graph Service
RESOURCE_GRAPH_FQDN=$(az containerapp show \
    --name vmperf-resource-graph \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [ -n "$RESOURCE_GRAPH_FQDN" ]; then
    RESOURCE_GRAPH_SERVICE_URL="https://$RESOURCE_GRAPH_FQDN"
    echo "✓ Resource Graph (App 1): $RESOURCE_GRAPH_SERVICE_URL"
else
    echo "⚠ Resource Graph (App 1) not deployed"
    RESOURCE_GRAPH_SERVICE_URL=""
fi

# App 2: Short-Term Log Analytics Service
SHORT_TERM_LA_FQDN=$(az containerapp show \
    --name vmperf-la-short \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [ -n "$SHORT_TERM_LA_FQDN" ]; then
    SHORT_TERM_LA_SERVICE_URL="https://$SHORT_TERM_LA_FQDN"
    echo "✓ Short-Term LA (App 2): $SHORT_TERM_LA_SERVICE_URL"
else
    echo "⚠ Short-Term LA (App 2) not deployed"
    SHORT_TERM_LA_SERVICE_URL=""
fi

# App 3: Long-Term Log Analytics Service (optional)
LONG_TERM_LA_FQDN=$(az containerapp show \
    --name vmperf-la-long \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [ -n "$LONG_TERM_LA_FQDN" ]; then
    LONG_TERM_LA_SERVICE_URL="https://$LONG_TERM_LA_FQDN"
    echo "✓ Long-Term LA (App 3): $LONG_TERM_LA_SERVICE_URL"
else
    echo "⚠ Long-Term LA (App 3) not deployed"
    LONG_TERM_LA_SERVICE_URL=""
fi

# Legacy Orchestrator (fallback)
ORCHESTRATOR_FQDN=$(az containerapp show \
    --name vmperf-orchestrator \
    --resource-group $RESOURCE_GROUP \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [ -n "$ORCHESTRATOR_FQDN" ]; then
    ORCHESTRATOR_URL="https://$ORCHESTRATOR_FQDN"
    echo "✓ Legacy Orchestrator: $ORCHESTRATOR_URL"
else
    echo "⚠ Legacy Orchestrator not deployed (some features may not work)"
    ORCHESTRATOR_URL=""
fi

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
        --target-port 3978 \
        --ingress external \
        --min-replicas 1 \
        --max-replicas 3 \
        --cpu 1.0 \
        --memory 2Gi \
        --env-vars \
            "KEY_VAULT_URL=https://$KEY_VAULT_NAME.vault.azure.net" \
            "ORCHESTRATOR_URL=$ORCHESTRATOR_URL" \
            "RESOURCE_GRAPH_SERVICE_URL=$RESOURCE_GRAPH_SERVICE_URL" \
            "SHORT_TERM_LA_SERVICE_URL=$SHORT_TERM_LA_SERVICE_URL" \
            "LONG_TERM_LA_SERVICE_URL=$LONG_TERM_LA_SERVICE_URL"
    echo "✓ Container App created"
else
    # Update existing Container App with new image and environment variables
    az containerapp update \
        --name $CONTAINER_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --image "$ACR_SERVER/$IMAGE_NAME:$IMAGE_TAG" \
        --set-env-vars \
            "KEY_VAULT_URL=https://$KEY_VAULT_NAME.vault.azure.net" \
            "ORCHESTRATOR_URL=$ORCHESTRATOR_URL" \
            "RESOURCE_GRAPH_SERVICE_URL=$RESOURCE_GRAPH_SERVICE_URL" \
            "SHORT_TERM_LA_SERVICE_URL=$SHORT_TERM_LA_SERVICE_URL" \
            "LONG_TERM_LA_SERVICE_URL=$LONG_TERM_LA_SERVICE_URL"
    echo "✓ Container App updated"
fi

# Step 6: Enable Managed Identity and grant Key Vault access
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

echo "✓ Managed Identity configured with Key Vault access"

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
echo "Container App URL: https://$APP_URL"
echo ""
echo "Endpoints:"
echo "  Health Check: https://$APP_URL/health"
echo "  Slack Commands: https://$APP_URL/api/slack/commands"
echo "  Slack Interactions: https://$APP_URL/api/slack/interactions"
echo ""
echo "Next Steps:"
echo "  1. Configure Slack App with these URLs:"
echo "     - Slash Commands: https://$APP_URL/api/slack/commands"
echo "     - Interactivity: https://$APP_URL/api/slack/interactions"
echo ""
echo "  2. Test health check:"
echo "     curl https://$APP_URL/health"
echo ""
