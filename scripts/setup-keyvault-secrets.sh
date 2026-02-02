#!/bin/bash
# =============================================================================
# Key Vault Secret Setup Script
# =============================================================================
# This script stores required secrets in Azure Key Vault.
# Run this ONCE to configure secrets, then delete or secure this file.
#
# Prerequisites:
#   - Azure CLI installed and logged in (az login)
#   - Access to the Key Vault
#
# Usage:
#   chmod +x setup-keyvault-secrets.sh
#   ./setup-keyvault-secrets.sh
# =============================================================================

set -e

# Configuration
KEY_VAULT_NAME="vmperf-kv-18406"
STORAGE_ACCOUNT_NAME="saitestrg88fe"

echo "=============================================="
echo "VM Performance Monitoring - Key Vault Setup"
echo "=============================================="
echo ""
echo "Key Vault: $KEY_VAULT_NAME"
echo ""

# Get Storage Account connection string
echo "Fetching Storage Account connection string..."
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
    --name "$STORAGE_ACCOUNT_NAME" \
    --query connectionString \
    --output tsv)

if [ -z "$STORAGE_CONNECTION_STRING" ]; then
    echo "ERROR: Could not retrieve storage connection string"
    echo "Make sure you have access to storage account: $STORAGE_ACCOUNT_NAME"
    exit 1
fi

echo "Storage connection string retrieved successfully"

# Store Storage Connection String
echo ""
echo "Storing StorageConnectionString in Key Vault..."
az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "StorageConnectionString" \
    --value "$STORAGE_CONNECTION_STRING" \
    --output none

echo "✓ StorageConnectionString stored"

# Prompt for Slack credentials (don't echo to terminal)
echo ""
echo "=============================================="
echo "Slack Credentials"
echo "=============================================="
echo "Enter Slack credentials (input will be hidden):"
echo ""

read -s -p "Slack Client ID: " SLACK_CLIENT_ID
echo ""
read -s -p "Slack Client Secret: " SLACK_CLIENT_SECRET
echo ""
read -s -p "Slack Signing Secret: " SLACK_SIGNING_SECRET
echo ""

# Store Slack secrets
echo ""
echo "Storing Slack secrets in Key Vault..."

az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "Slack-ClientId" \
    --value "$SLACK_CLIENT_ID" \
    --output none
echo "✓ Slack-ClientId stored"

az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "Slack-ClientSecret" \
    --value "$SLACK_CLIENT_SECRET" \
    --output none
echo "✓ Slack-ClientSecret stored"

az keyvault secret set \
    --vault-name "$KEY_VAULT_NAME" \
    --name "Slack-SigningSecret" \
    --value "$SLACK_SIGNING_SECRET" \
    --output none
echo "✓ Slack-SigningSecret stored"

# Clear variables from memory
unset SLACK_CLIENT_ID
unset SLACK_CLIENT_SECRET
unset SLACK_SIGNING_SECRET
unset STORAGE_CONNECTION_STRING

echo ""
echo "=============================================="
echo "Setup Complete!"
echo "=============================================="
echo ""
echo "Secrets stored in Key Vault '$KEY_VAULT_NAME':"
echo "  - StorageConnectionString"
echo "  - Slack-ClientId"
echo "  - Slack-ClientSecret"
echo "  - Slack-SigningSecret"
echo ""
echo "Existing secrets expected:"
echo "  - OpenAI-Endpoint (GPT 5.1)"
echo "  - OpenAI-ApiKey (GPT 5.1)"
echo ""
echo "IMPORTANT: Delete this script or move to a secure location!"
echo ""
