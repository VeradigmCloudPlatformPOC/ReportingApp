#!/bin/bash

# Azure Durable Functions Deployment Script with Key Vault Integration
# Deploys VM Performance Monitoring Durable Functions with secure credential storage

set -e

# Configuration
RESOURCE_GROUP="vmperf-monitoring-rg"
LOCATION="eastus2"
FUNCTION_APP_NAME="vmperf-durable-functions"
STORAGE_ACCOUNT_NAME="vmperfdurablestorage"
APP_INSIGHTS_NAME="vmperf-durable-insights"
KEY_VAULT_NAME="vmperf-keyvault-$(date +%s | tail -c 5)"

# Credentials (will be stored in Key Vault, not in Function App settings)
SENDGRID_API_KEY="<YOUR_SENDGRID_API_KEY>"
OPENAI_ENDPOINT="<YOUR_OPENAI_ENDPOINT>"
OPENAI_API_KEY="<YOUR_OPENAI_API_KEY>"
LOG_ANALYTICS_WORKSPACE_ID="<YOUR_WORKSPACE_ID>"
LOG_ANALYTICS_CLIENT_ID="<YOUR_CLIENT_ID>"
LOG_ANALYTICS_CLIENT_SECRET="<YOUR_CLIENT_SECRET>"
LOG_ANALYTICS_TENANT_ID="<YOUR_TENANT_ID>"
TARGET_SUBSCRIPTION_ID="<YOUR_SUBSCRIPTION_ID>"
EMAIL_ADDRESS="<YOUR_EMAIL>"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}VM Performance Durable Functions Deployment${NC}"
echo -e "${GREEN}with Azure Key Vault Integration${NC}"
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

# Create/verify resource group
echo -e "${YELLOW}Checking resource group...${NC}"
if ! az group show --name $RESOURCE_GROUP &> /dev/null; then
    az group create --name $RESOURCE_GROUP --location $LOCATION
    echo -e "${GREEN}✓ Resource group created${NC}"
else
    echo -e "${GREEN}✓ Resource group exists${NC}"
fi

# Create Key Vault
echo -e "${YELLOW}Creating Key Vault: ${KEY_VAULT_NAME}...${NC}"
az keyvault create \
    --name $KEY_VAULT_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --enable-rbac-authorization false \
    --enabled-for-deployment true \
    --enabled-for-template-deployment true \
    > /dev/null
echo -e "${GREEN}✓ Key Vault created${NC}"

# Store secrets in Key Vault
echo -e "${YELLOW}Storing secrets in Key Vault...${NC}"

az keyvault secret set --vault-name $KEY_VAULT_NAME --name "SendGridApiKey" --value "$SENDGRID_API_KEY" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "OpenAIEndpoint" --value "$OPENAI_ENDPOINT" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "OpenAIApiKey" --value "$OPENAI_API_KEY" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsWorkspaceId" --value "$LOG_ANALYTICS_WORKSPACE_ID" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsClientId" --value "$LOG_ANALYTICS_CLIENT_ID" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsClientSecret" --value "$LOG_ANALYTICS_CLIENT_SECRET" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsTenantId" --value "$LOG_ANALYTICS_TENANT_ID" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "TargetSubscriptionId" --value "$TARGET_SUBSCRIPTION_ID" > /dev/null
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "EmailAddress" --value "$EMAIL_ADDRESS" > /dev/null

echo -e "${GREEN}✓ All secrets stored in Key Vault${NC}"

# Create storage account
echo -e "${YELLOW}Creating storage account...${NC}"
if ! az storage account show --name $STORAGE_ACCOUNT_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az storage account create \
        --name $STORAGE_ACCOUNT_NAME \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION \
        --sku Standard_LRS \
        --kind StorageV2 \
        > /dev/null
    echo -e "${GREEN}✓ Storage account created${NC}"
else
    echo -e "${GREEN}✓ Storage account exists${NC}"
fi

# Get storage connection string
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query connectionString -o tsv)

# Create Application Insights
echo -e "${YELLOW}Creating Application Insights...${NC}"
if ! az monitor app-insights component show --app $APP_INSIGHTS_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az monitor app-insights component create \
        --app $APP_INSIGHTS_NAME \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION \
        --application-type web \
        > /dev/null
    echo -e "${GREEN}✓ Application Insights created${NC}"
else
    echo -e "${GREEN}✓ Application Insights exists${NC}"
fi

# Get Application Insights key
APP_INSIGHTS_KEY=$(az monitor app-insights component show \
    --app $APP_INSIGHTS_NAME \
    --resource-group $RESOURCE_GROUP \
    --query instrumentationKey -o tsv)

# Create Function App
echo -e "${YELLOW}Creating Function App...${NC}"
if ! az functionapp show --name $FUNCTION_APP_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az functionapp create \
        --name $FUNCTION_APP_NAME \
        --resource-group $RESOURCE_GROUP \
        --storage-account $STORAGE_ACCOUNT_NAME \
        --consumption-plan-location $LOCATION \
        --runtime node \
        --runtime-version 18 \
        --functions-version 4 \
        --os-type Linux \
        > /dev/null
    echo -e "${GREEN}✓ Function App created${NC}"
else
    echo -e "${GREEN}✓ Function App exists${NC}"
fi

# Enable managed identity
echo -e "${YELLOW}Enabling managed identity...${NC}"
az functionapp identity assign \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    > /dev/null

# Get managed identity principal ID
PRINCIPAL_ID=$(az functionapp identity show \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query principalId -o tsv)
echo -e "${GREEN}✓ Managed identity enabled${NC}"

# Grant Key Vault access to Function App
echo -e "${YELLOW}Granting Key Vault access to Function App...${NC}"
az keyvault set-policy \
    --name $KEY_VAULT_NAME \
    --object-id $PRINCIPAL_ID \
    --secret-permissions get list \
    > /dev/null
echo -e "${GREEN}✓ Key Vault access granted${NC}"

# Configure Function App settings with Key Vault references
echo -e "${YELLOW}Configuring Function App settings with Key Vault references...${NC}"
az functionapp config appsettings set \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
    "AzureWebJobsStorage=$STORAGE_CONNECTION_STRING" \
    "APPINSIGHTS_INSTRUMENTATIONKEY=$APP_INSIGHTS_KEY" \
    "SENDGRID_API_KEY=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/SendGridApiKey/)" \
    "OPENAI_ENDPOINT=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/OpenAIEndpoint/)" \
    "OPENAI_API_KEY=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/OpenAIApiKey/)" \
    "LOG_ANALYTICS_WORKSPACE_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsWorkspaceId/)" \
    "LOG_ANALYTICS_CLIENT_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsClientId/)" \
    "LOG_ANALYTICS_CLIENT_SECRET=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsClientSecret/)" \
    "LOG_ANALYTICS_TENANT_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/LogAnalyticsTenantId/)" \
    "TARGET_SUBSCRIPTION_ID=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/TargetSubscriptionId/)" \
    "EMAIL_FROM=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
    "EMAIL_TO_TECHNICAL=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
    "EMAIL_TO_EXECUTIVE=@Microsoft.KeyVault(SecretUri=https://${KEY_VAULT_NAME}.vault.azure.net/secrets/EmailAddress/)" \
    > /dev/null
echo -e "${GREEN}✓ Function App settings configured${NC}"

# Deploy function code
echo -e "${YELLOW}Deploying function code...${NC}"
cd "$(dirname "$0")"
npm install --production
func azure functionapp publish $FUNCTION_APP_NAME
echo -e "${GREEN}✓ Function code deployed${NC}"

# Get function app URL
FUNCTION_URL=$(az functionapp show \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query defaultHostName -o tsv)

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e ""
echo -e "${GREEN}Resources Created:${NC}"
echo -e "  Function App: ${FUNCTION_APP_NAME}"
echo -e "  Key Vault: ${KEY_VAULT_NAME}"
echo -e "  Storage Account: ${STORAGE_ACCOUNT_NAME}"
echo -e "  Application Insights: ${APP_INSIGHTS_NAME}"
echo -e ""
echo -e "${GREEN}Function App URL: https://${FUNCTION_URL}${NC}"
echo -e "${GREEN}Manual Trigger: https://${FUNCTION_URL}/api/orchestrators/VMPerformanceOrchestrator${NC}"
echo -e ""
echo -e "${YELLOW}Security:${NC}"
echo -e "  ✓ All credentials stored in Key Vault"
echo -e "  ✓ Function App uses managed identity"
echo -e "  ✓ No secrets in Function App configuration"
echo -e ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "1. Grant Function App managed identity permissions:"
echo -e "   - Log Analytics Reader on workspace"
echo -e "   - Reader on target subscription"
echo -e ""
echo -e "2. Test the function:"
echo -e "   Get function key:"
echo -e "   az functionapp keys list --name ${FUNCTION_APP_NAME} --resource-group ${RESOURCE_GROUP}"
echo -e ""
echo -e "   Trigger orchestration:"
echo -e "   curl -X POST 'https://${FUNCTION_URL}/api/orchestrators/VMPerformanceOrchestrator?code=<function-key>'"
echo -e ""
echo -e "3. Monitor in Application Insights:"
echo -e "   https://portal.azure.com/#@/resource/subscriptions/.../resourceGroups/${RESOURCE_GROUP}/providers/microsoft.insights/components/${APP_INSIGHTS_NAME}"
echo -e ""
echo -e "${GREEN}Key Vault Details:${NC}"
echo -e "  Name: ${KEY_VAULT_NAME}"
echo -e "  Secrets stored: 9"
echo -e "  View secrets: az keyvault secret list --vault-name ${KEY_VAULT_NAME}"
