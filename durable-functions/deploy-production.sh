#!/bin/bash

# Azure Durable Functions Production Deployment Script
# Deploys to Zirconium subscription, Sai-Test-rg resource group

set -e

# Configuration
SUBSCRIPTION_ID="ffd7017b-28ed-4e90-a2ec-4a6958578f98"
RESOURCE_GROUP="Sai-Test-rg"
LOCATION="westus2"
FUNCTION_APP_NAME="vmperf-durable-func-$(date +%s | tail -c 6)"
STORAGE_ACCOUNT_NAME="vmperfstore$(date +%s | tail -c 6)"
APP_INSIGHTS_NAME="vmperf-insights-$(date +%s | tail -c 6)"
KEY_VAULT_NAME="vmperf-kv-$(date +%s | tail -c 6)"

# Credentials (will be stored in Key Vault)
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
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}VM Performance Durable Functions${NC}"
echo -e "${BLUE}Production Deployment${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e ""
echo -e "${YELLOW}Target:${NC}"
echo -e "  Subscription: Zirconium - Veradigm Sandbox"
echo -e "  Subscription ID: ${SUBSCRIPTION_ID}"
echo -e "  Resource Group: ${RESOURCE_GROUP}"
echo -e "  Location: ${LOCATION}"
echo -e ""

# Check Azure CLI
if ! command -v az &> /dev/null; then
    echo -e "${RED}❌ Azure CLI is not installed.${NC}"
    exit 1
fi

# Check login and subscription
echo -e "${YELLOW}[1/12] Checking Azure login...${NC}"
CURRENT_SUB=$(az account show --query id -o tsv 2>/dev/null || echo "")
if [ "$CURRENT_SUB" != "$SUBSCRIPTION_ID" ]; then
    echo -e "${RED}❌ Wrong subscription. Please run: az account set --subscription ${SUBSCRIPTION_ID}${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Logged in to correct subscription${NC}"

# Verify resource group
echo -e "${YELLOW}[2/12] Verifying resource group...${NC}"
if ! az group show --name $RESOURCE_GROUP &> /dev/null; then
    echo -e "${RED}❌ Resource group ${RESOURCE_GROUP} does not exist${NC}"
    exit 1
fi
echo -e "${GREEN}✓ Resource group exists${NC}"

# Create Key Vault
echo -e "${YELLOW}[3/12] Creating Key Vault: ${KEY_VAULT_NAME}...${NC}"
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
echo -e "${YELLOW}[4/12] Storing secrets in Key Vault...${NC}"

az keyvault secret set --vault-name $KEY_VAULT_NAME --name "SendGridApiKey" --value "$SENDGRID_API_KEY" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "OpenAIEndpoint" --value "$OPENAI_ENDPOINT" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "OpenAIApiKey" --value "$OPENAI_API_KEY" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsWorkspaceId" --value "$LOG_ANALYTICS_WORKSPACE_ID" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsClientId" --value "$LOG_ANALYTICS_CLIENT_ID" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsClientSecret" --value "$LOG_ANALYTICS_CLIENT_SECRET" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "LogAnalyticsTenantId" --value "$LOG_ANALYTICS_TENANT_ID" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "TargetSubscriptionId" --value "$TARGET_SUBSCRIPTION_ID" > /dev/null &
az keyvault secret set --vault-name $KEY_VAULT_NAME --name "EmailAddress" --value "$EMAIL_ADDRESS" > /dev/null &

wait
echo -e "${GREEN}✓ All 9 secrets stored in Key Vault${NC}"

# Create storage account
echo -e "${YELLOW}[5/12] Creating storage account: ${STORAGE_ACCOUNT_NAME}...${NC}"
az storage account create \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --sku Standard_LRS \
    --kind StorageV2 \
    --https-only true \
    --min-tls-version TLS1_2 \
    --allow-blob-public-access false \
    > /dev/null
echo -e "${GREEN}✓ Storage account created${NC}"

# Get storage connection string
echo -e "${YELLOW}[6/12] Retrieving storage connection string...${NC}"
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query connectionString -o tsv)
echo -e "${GREEN}✓ Storage connection string retrieved${NC}"

# Create Application Insights
echo -e "${YELLOW}[7/12] Creating Application Insights: ${APP_INSIGHTS_NAME}...${NC}"
az monitor app-insights component create \
    --app $APP_INSIGHTS_NAME \
    --resource-group $RESOURCE_GROUP \
    --location $LOCATION \
    --application-type web \
    > /dev/null
echo -e "${GREEN}✓ Application Insights created${NC}"

# Get Application Insights key
echo -e "${YELLOW}[8/12] Retrieving Application Insights key...${NC}"
APP_INSIGHTS_KEY=$(az monitor app-insights component show \
    --app $APP_INSIGHTS_NAME \
    --resource-group $RESOURCE_GROUP \
    --query instrumentationKey -o tsv)
echo -e "${GREEN}✓ Application Insights key retrieved${NC}"

# Create Function App
echo -e "${YELLOW}[9/12] Creating Function App: ${FUNCTION_APP_NAME}...${NC}"
az functionapp create \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --storage-account $STORAGE_ACCOUNT_NAME \
    --consumption-plan-location $LOCATION \
    --runtime node \
    --runtime-version 20 \
    --functions-version 4 \
    --os-type Linux \
    --disable-app-insights false \
    > /dev/null
echo -e "${GREEN}✓ Function App created${NC}"

# Enable managed identity
echo -e "${YELLOW}[10/12] Enabling managed identity...${NC}"
az functionapp identity assign \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    > /dev/null

# Get managed identity principal ID
PRINCIPAL_ID=$(az functionapp identity show \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query principalId -o tsv)
echo -e "${GREEN}✓ Managed identity enabled (Principal ID: ${PRINCIPAL_ID})${NC}"

# Grant Key Vault access
echo -e "${YELLOW}[11/12] Granting Key Vault access to Function App...${NC}"
sleep 15  # Wait for identity propagation
az keyvault set-policy \
    --name $KEY_VAULT_NAME \
    --object-id $PRINCIPAL_ID \
    --secret-permissions get list \
    > /dev/null
echo -e "${GREEN}✓ Key Vault access granted${NC}"

# Configure Function App settings
echo -e "${YELLOW}[12/12] Configuring Function App settings with Key Vault references...${NC}"
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

# Get function app URL
FUNCTION_URL=$(az functionapp show \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query defaultHostName -o tsv)

echo -e ""
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✓ Infrastructure Deployment Complete!${NC}"
echo -e "${BLUE}========================================${NC}"
echo -e ""
echo -e "${GREEN}Resources Created:${NC}"
echo -e "  Function App: ${FUNCTION_APP_NAME}"
echo -e "  Key Vault: ${KEY_VAULT_NAME}"
echo -e "  Storage Account: ${STORAGE_ACCOUNT_NAME}"
echo -e "  Application Insights: ${APP_INSIGHTS_NAME}"
echo -e ""
echo -e "${GREEN}Function App URL:${NC} https://${FUNCTION_URL}"
echo -e ""
echo -e "${YELLOW}Next: Deploying function code...${NC}"
echo -e ""

# Save resource names for reference
cat > /tmp/vmperf-deployment.txt <<EOF
FUNCTION_APP_NAME=$FUNCTION_APP_NAME
KEY_VAULT_NAME=$KEY_VAULT_NAME
STORAGE_ACCOUNT_NAME=$STORAGE_ACCOUNT_NAME
APP_INSIGHTS_NAME=$APP_INSIGHTS_NAME
FUNCTION_URL=$FUNCTION_URL
PRINCIPAL_ID=$PRINCIPAL_ID
RESOURCE_GROUP=$RESOURCE_GROUP
SUBSCRIPTION_ID=$SUBSCRIPTION_ID
EOF

echo -e "${GREEN}Deployment details saved to: /tmp/vmperf-deployment.txt${NC}"
echo -e ""
