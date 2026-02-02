#!/bin/bash
# =============================================================================
# Setup Azure Resources for AI Foundry Agent Bot
# =============================================================================
# This script creates the required Azure resources for the VM Performance Bot
# using Azure AI Foundry Agent Service and Azure Bot Service.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Existing Key Vault (vmperf-kv-18406)
#   - Existing Container Apps Environment
#
# Resources Created:
#   - Azure Bot Service (for Slack + Teams channels)
#   - App Registration (bot identity)
#   - Cosmos DB account (conversation state)
#   - Key Vault secrets
#
# Usage:
#   chmod +x setup-agent-resources.sh
#   ./setup-agent-resources.sh
# =============================================================================

set -e

# Configuration - Update these as needed
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
KEY_VAULT_NAME="vmperf-kv-18406"

# New resource names
BOT_NAME="vmperf-bot-service"
APP_REGISTRATION_NAME="vmperf-bot-app"
COSMOSDB_ACCOUNT_NAME="vmperf-conversations"
COSMOSDB_DATABASE_NAME="vmperf-bot"
COSMOSDB_CONTAINER_NAME="conversations"

# AI Foundry (manual setup required - script provides guidance)
AI_FOUNDRY_RESOURCE_GROUP="$RESOURCE_GROUP"

echo "=============================================="
echo "VM Performance Bot - Azure Resource Setup"
echo "=============================================="
echo ""
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Key Vault: $KEY_VAULT_NAME"
echo ""

# =============================================================================
# Step 1: Create App Registration for Bot
# =============================================================================
echo "Step 1: Creating App Registration for Bot..."

# Check if app registration already exists
EXISTING_APP=$(az ad app list --display-name "$APP_REGISTRATION_NAME" --query "[0].appId" -o tsv 2>/dev/null || echo "")

if [ -z "$EXISTING_APP" ]; then
    # Create new app registration
    APP_ID=$(az ad app create \
        --display-name "$APP_REGISTRATION_NAME" \
        --sign-in-audience AzureADMultipleOrgs \
        --query "appId" -o tsv)

    echo "Created App Registration: $APP_ID"

    # Create client secret
    APP_SECRET=$(az ad app credential reset \
        --id "$APP_ID" \
        --display-name "Bot Secret" \
        --query "password" -o tsv)

    echo "Created App Secret"
else
    APP_ID="$EXISTING_APP"
    echo "App Registration already exists: $APP_ID"
    echo "NOTE: You may need to manually create a new secret if needed"
    APP_SECRET=""
fi

# Get tenant ID
TENANT_ID=$(az account show --query "tenantId" -o tsv)
echo "Tenant ID: $TENANT_ID"

# =============================================================================
# Step 2: Create Azure Bot Service
# =============================================================================
echo ""
echo "Step 2: Creating Azure Bot Service..."

BOT_EXISTS=$(az bot show --name "$BOT_NAME" --resource-group "$RESOURCE_GROUP" --query "name" -o tsv 2>/dev/null || echo "")

if [ -z "$BOT_EXISTS" ]; then
    az bot create \
        --resource-group "$RESOURCE_GROUP" \
        --name "$BOT_NAME" \
        --kind "registration" \
        --sku "F0" \
        --appid "$APP_ID" \
        --app-type "MultiTenant" \
        --location "global"

    echo "Created Azure Bot Service: $BOT_NAME"
else
    echo "Azure Bot Service already exists: $BOT_NAME"
fi

# =============================================================================
# Step 3: Create Cosmos DB Account
# =============================================================================
echo ""
echo "Step 3: Creating Cosmos DB Account..."

COSMOSDB_EXISTS=$(az cosmosdb show --name "$COSMOSDB_ACCOUNT_NAME" --resource-group "$RESOURCE_GROUP" --query "name" -o tsv 2>/dev/null || echo "")

if [ -z "$COSMOSDB_EXISTS" ]; then
    az cosmosdb create \
        --name "$COSMOSDB_ACCOUNT_NAME" \
        --resource-group "$RESOURCE_GROUP" \
        --locations regionName="$LOCATION" failoverPriority=0 \
        --default-consistency-level "Session" \
        --enable-serverless

    echo "Created Cosmos DB Account: $COSMOSDB_ACCOUNT_NAME"
else
    echo "Cosmos DB Account already exists: $COSMOSDB_ACCOUNT_NAME"
fi

# Create database and container
echo "Creating Cosmos DB database and container..."

az cosmosdb sql database create \
    --account-name "$COSMOSDB_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --name "$COSMOSDB_DATABASE_NAME" \
    2>/dev/null || echo "Database already exists"

az cosmosdb sql container create \
    --account-name "$COSMOSDB_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --database-name "$COSMOSDB_DATABASE_NAME" \
    --name "$COSMOSDB_CONTAINER_NAME" \
    --partition-key-path "/partitionKey" \
    2>/dev/null || echo "Container already exists"

echo "Cosmos DB database and container configured"

# Get Cosmos DB connection string
COSMOSDB_CONNECTION_STRING=$(az cosmosdb keys list \
    --name "$COSMOSDB_ACCOUNT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --type connection-strings \
    --query "connectionStrings[0].connectionString" -o tsv)

# =============================================================================
# Step 4: Store Secrets in Key Vault
# =============================================================================
echo ""
echo "Step 4: Storing secrets in Key Vault..."

# Bot credentials
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "Bot-MicrosoftAppId" \
    --value "$APP_ID" \
    --output none
echo "  - Bot-MicrosoftAppId: stored"

if [ -n "$APP_SECRET" ]; then
    az keyvault secret set \
        --vault-name "$KEY_VAULT_NAME" \
        --name "Bot-MicrosoftAppPassword" \
        --value "$APP_SECRET" \
        --output none
    echo "  - Bot-MicrosoftAppPassword: stored"
else
    echo "  - Bot-MicrosoftAppPassword: (skipped - create manually if needed)"
fi

az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "Bot-MicrosoftAppTenantId" \
    --value "$TENANT_ID" \
    --output none
echo "  - Bot-MicrosoftAppTenantId: stored"

# Cosmos DB
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "CosmosDB-ConnectionString" \
    --value "$COSMOSDB_CONNECTION_STRING" \
    --output none
echo "  - CosmosDB-ConnectionString: stored"

# =============================================================================
# Step 5: Get Container App URL for Bot Messaging Endpoint
# =============================================================================
echo ""
echo "Step 5: Getting Container App URL..."

CONTAINER_APP_URL=$(az containerapp show \
    --name "vmperf-slack-bot" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.configuration.ingress.fqdn" -o tsv 2>/dev/null || echo "")

if [ -n "$CONTAINER_APP_URL" ]; then
    MESSAGING_ENDPOINT="https://$CONTAINER_APP_URL/api/messages"
    echo "Messaging Endpoint: $MESSAGING_ENDPOINT"

    # Update bot messaging endpoint
    az bot update \
        --resource-group "$RESOURCE_GROUP" \
        --name "$BOT_NAME" \
        --endpoint "$MESSAGING_ENDPOINT" \
        --output none 2>/dev/null || echo "NOTE: Update messaging endpoint manually in Azure Portal"
else
    echo "Container App not found. Deploy the bot first, then update the messaging endpoint."
fi

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "=============================================="
echo "Resource Setup Complete!"
echo "=============================================="
echo ""
echo "Created Resources:"
echo "  - App Registration: $APP_REGISTRATION_NAME (ID: $APP_ID)"
echo "  - Azure Bot Service: $BOT_NAME"
echo "  - Cosmos DB Account: $COSMOSDB_ACCOUNT_NAME"
echo "    - Database: $COSMOSDB_DATABASE_NAME"
echo "    - Container: $COSMOSDB_CONTAINER_NAME"
echo ""
echo "Key Vault Secrets Added:"
echo "  - Bot-MicrosoftAppId"
echo "  - Bot-MicrosoftAppPassword"
echo "  - Bot-MicrosoftAppTenantId"
echo "  - CosmosDB-ConnectionString"
echo ""
echo "=============================================="
echo "MANUAL STEPS REQUIRED:"
echo "=============================================="
echo ""
echo "1. Add Slack Bot Token to Key Vault:"
echo "   a. Go to api.slack.com/apps and select your existing Slack app"
echo "   b. Go to 'OAuth & Permissions'"
echo "   c. Copy the 'Bot User OAuth Token' (xoxb-...)"
echo "   d. Add to Key Vault:"
echo "      az keyvault secret set --vault-name $KEY_VAULT_NAME --name Slack-BotToken --value 'xoxb-your-token'"
echo ""
echo "2. Configure Slack App Event Subscriptions:"
echo "   a. Go to api.slack.com/apps > your app > Event Subscriptions"
echo "   b. Enable Events and set Request URL to:"
echo "      https://<your-container-app-url>/api/slack/events"
echo "   c. Subscribe to bot events:"
echo "      - message.channels (messages in public channels)"
echo "      - message.im (direct messages)"
echo "      - app_mention (when @mentioned)"
echo ""
echo "3. Configure Slack App Interactivity:"
echo "   a. Go to api.slack.com/apps > your app > Interactivity & Shortcuts"
echo "   b. Enable Interactivity and set Request URL to:"
echo "      https://<your-container-app-url>/api/slack/interactions"
echo ""
echo "4. Configure Azure AI Foundry Agent:"
echo "   a. Go to Azure AI Foundry portal (https://ai.azure.com)"
echo "   b. Create or select a project"
echo "   c. Go to Agents and create a new agent"
echo "   d. Configure the agent with the system prompt and tools"
echo "   e. Note the Project Endpoint and Agent ID"
echo "   f. Add secrets to Key Vault:"
echo "      az keyvault secret set --vault-name $KEY_VAULT_NAME --name AIFoundry-ProjectEndpoint --value '<your-endpoint>'"
echo "      az keyvault secret set --vault-name $KEY_VAULT_NAME --name AIFoundry-AgentId --value '<your-agent-id>'"
echo ""
echo "5. (Optional) Configure Microsoft Teams via Azure Bot Service:"
echo "   a. Go to Azure Portal > Bot Service > $BOT_NAME > Channels"
echo "   b. Click 'Microsoft Teams' to enable"
echo "   c. Update Bot messaging endpoint to:"
echo "      https://<your-container-app-url>/api/messages"
echo ""
echo "6. Deploy the updated Slack Bot container:"
echo "   ./deploy-slack-bot.sh"
echo ""
