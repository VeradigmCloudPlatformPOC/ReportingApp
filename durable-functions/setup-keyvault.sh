#!/bin/bash

# Azure Key Vault Setup Script
# Creates Key Vault and stores all sensitive credentials securely

set -e

# Configuration
RESOURCE_GROUP="vmperf-monitoring-rg"
LOCATION="eastus2"
KEY_VAULT_NAME="vmperf-keyvault-$(date +%s | tail -c 5)"  # Unique name
FUNCTION_APP_NAME="vmperf-durable-functions"

# Credentials
SENDGRID_API_KEY="<YOUR_SENDGRID_API_KEY>"
OPENAI_ENDPOINT="<YOUR_OPENAI_ENDPOINT>"
OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>"
LOG_ANALYTICS_CLIENT_SECRET="<YOUR_CLIENT_SECRET>"
EMAIL_ADDRESS="<YOUR_EMAIL>"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Azure Key Vault Setup${NC}"
echo -e "${GREEN}========================================${NC}"

# Check Azure CLI
if ! command -v az &> /dev/null; then
    echo -e "${RED}Azure CLI is not installed.${NC}"
    exit 1
fi

# Check login
echo -e "${YELLOW}Checking Azure login...${NC}"
az account show &> /dev/null || {
    echo -e "${RED}Not logged in. Run 'az login' first.${NC}"
    exit 1
}
echo -e "${GREEN}✓ Logged in${NC}"

# Create Key Vault
echo -e "${YELLOW}Creating Key Vault: ${KEY_VAULT_NAME}...${NC}"
az keyvault create \
    --name $KEY_VAULT_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --enable-rbac-authorization false \
    --enabled-for-deployment true \
    --enabled-for-template-deployment true
echo -e "${GREEN}✓ Key Vault created${NC}"

# Store secrets
echo -e "${YELLOW}Storing secrets in Key Vault...${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "SendGridApiKey" \
    --value "$SENDGRID_API_KEY" \
    > /dev/null
echo -e "${GREEN}✓ SendGrid API Key stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "OpenAIEndpoint" \
    --value "$OPENAI_ENDPOINT" \
    > /dev/null
echo -e "${GREEN}✓ OpenAI Endpoint stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "OpenAIApiKey" \
    --value "$OPENAI_API_KEY" \
    > /dev/null
echo -e "${GREEN}✓ OpenAI API Key stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "LogAnalyticsClientSecret" \
    --value "$LOG_ANALYTICS_CLIENT_SECRET" \
    > /dev/null
echo -e "${GREEN}✓ Log Analytics Client Secret stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "EmailAddress" \
    --value "$EMAIL_ADDRESS" \
    > /dev/null
echo -e "${GREEN}✓ Email Address stored${NC}"

# Non-sensitive configuration values
az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "LogAnalyticsWorkspaceId" \
    --value "aa7bf3ad-b626-49f8-96bf-16276c3df7fc" \
    > /dev/null
echo -e "${GREEN}✓ Log Analytics Workspace ID stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "LogAnalyticsClientId" \
    --value "3bd63128-d818-4e90-91c9-b4ed3550acd3" \
    > /dev/null
echo -e "${GREEN}✓ Log Analytics Client ID stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "LogAnalyticsTenantId" \
    --value "21d8e422-7fd3-4634-8c8a-01dfde9a5502" \
    > /dev/null
echo -e "${GREEN}✓ Log Analytics Tenant ID stored${NC}"

az keyvault secret set \
    --vault-name $KEY_VAULT_NAME \
    --name "TargetSubscriptionId" \
    --value "45cc9718-d2ec-48c8-b490-df358d934895" \
    > /dev/null
echo -e "${GREEN}✓ Target Subscription ID stored${NC}"

# Get Function App managed identity (if exists)
echo -e "${YELLOW}Checking for Function App...${NC}"
if az functionapp show --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    echo -e "${YELLOW}Function App exists. Granting Key Vault access...${NC}"

    # Enable managed identity if not already enabled
    az functionapp identity assign \
        --name $FUNCTION_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        > /dev/null

    # Get managed identity principal ID
    PRINCIPAL_ID=$(az functionapp identity show \
        --name $FUNCTION_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --query principalId -o tsv)

    # Grant access to Key Vault
    az keyvault set-policy \
        --name $KEY_VAULT_NAME \
        --object-id $PRINCIPAL_ID \
        --secret-permissions get list \
        > /dev/null

    echo -e "${GREEN}✓ Function App granted Key Vault access${NC}"

    # Update Function App settings to use Key Vault references
    echo -e "${YELLOW}Updating Function App settings to use Key Vault...${NC}"

    az functionapp config appsettings set \
        --name $FUNCTION_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --settings \
        "SENDGRID_API_KEY=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/SendGridApiKey/)" \
        "OPENAI_ENDPOINT=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/OpenAIEndpoint/)" \
        "OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/OpenAIApiKey/)" \
        "LOG_ANALYTICS_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsClientSecret/)" \
        "EMAIL_FROM=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
        "EMAIL_TO_TECHNICAL=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
        "EMAIL_TO_EXECUTIVE=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
        "LOG_ANALYTICS_WORKSPACE_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsWorkspaceId/)" \
        "LOG_ANALYTICS_CLIENT_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsClientId/)" \
        "LOG_ANALYTICS_TENANT_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsTenantId/)" \
        "TARGET_SUBSCRIPTION_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/TargetSubscriptionId/)" \
        > /dev/null

    echo -e "${GREEN}✓ Function App settings updated with Key Vault references${NC}"
else
    echo -e "${YELLOW}Function App not found. Will grant access after deployment.${NC}"
fi

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Key Vault Setup Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Key Vault Name: ${KEY_VAULT_NAME}${NC}"
echo -e "${GREEN}Location: ${LOCATION}${NC}"
echo -e ""
echo -e "${YELLOW}Secrets stored:${NC}"
echo -e "  - SendGridApiKey"
echo -e "  - OpenAIEndpoint"
echo -e "  - OpenAIApiKey"
echo -e "  - LogAnalyticsClientSecret"
echo -e "  - EmailAddress"
echo -e "  - LogAnalyticsWorkspaceId"
echo -e "  - LogAnalyticsClientId"
echo -e "  - LogAnalyticsTenantId"
echo -e "  - TargetSubscriptionId"
echo -e ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "1. Credentials are now securely stored in Key Vault"
echo -e "2. Function App will automatically retrieve secrets at runtime"
echo -e "3. No sensitive data in Function App configuration"
echo -e ""
echo -e "${YELLOW}To view secrets:${NC}"
echo -e "az keyvault secret show --vault-name ${KEY_VAULT_NAME} --name SendGridApiKey"
echo -e ""
echo -e "${YELLOW}To grant another app access:${NC}"
echo -e "az keyvault set-policy --name ${KEY_VAULT_NAME} --object-id <principal-id> --secret-permissions get list"
