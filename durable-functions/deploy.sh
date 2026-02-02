#!/bin/bash

# Azure Durable Functions Deployment Script
# Deploys VM Performance Monitoring Durable Functions to Azure

set -e

# Configuration
RESOURCE_GROUP="vmperf-monitoring-rg"
LOCATION="eastus2"
FUNCTION_APP_NAME="vmperf-durable-functions"
STORAGE_ACCOUNT_NAME="vmperfdurablestorage"
APP_INSIGHTS_NAME="vmperf-durable-insights"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}VM Performance Durable Functions Deployment${NC}"
echo -e "${GREEN}========================================${NC}"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Azure CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if logged in
echo -e "${YELLOW}Checking Azure login status...${NC}"
az account show &> /dev/null || {
    echo -e "${RED}Not logged in to Azure. Please run 'az login' first.${NC}"
    exit 1
}

# Check if resource group exists
echo -e "${YELLOW}Checking resource group...${NC}"
if ! az group show --name $RESOURCE_GROUP &> /dev/null; then
    echo -e "${YELLOW}Resource group does not exist. Creating...${NC}"
    az group create --name $RESOURCE_GROUP --location $LOCATION
    echo -e "${GREEN}✓ Resource group created${NC}"
else
    echo -e "${GREEN}✓ Resource group exists${NC}"
fi

# Create storage account for Durable Functions
echo -e "${YELLOW}Creating storage account...${NC}"
if ! az storage account show --name $STORAGE_ACCOUNT_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az storage account create \
        --name $STORAGE_ACCOUNT_NAME \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION \
        --sku Standard_LRS \
        --kind StorageV2
    echo -e "${GREEN}✓ Storage account created${NC}"
else
    echo -e "${GREEN}✓ Storage account exists${NC}"
fi

# Get storage connection string
echo -e "${YELLOW}Getting storage connection string...${NC}"
STORAGE_CONNECTION_STRING=$(az storage account show-connection-string \
    --name $STORAGE_ACCOUNT_NAME \
    --resource-group $RESOURCE_GROUP \
    --query connectionString -o tsv)
echo -e "${GREEN}✓ Storage connection string retrieved${NC}"

# Create Application Insights
echo -e "${YELLOW}Creating Application Insights...${NC}"
if ! az monitor app-insights component show --app $APP_INSIGHTS_NAME --resource-group $RESOURCE_GROUP &> /dev/null; then
    az monitor app-insights component create \
        --app $APP_INSIGHTS_NAME \
        --resource-group $RESOURCE_GROUP \
        --location $LOCATION \
        --application-type web
    echo -e "${GREEN}✓ Application Insights created${NC}"
else
    echo -e "${GREEN}✓ Application Insights exists${NC}"
fi

# Get Application Insights instrumentation key
echo -e "${YELLOW}Getting Application Insights key...${NC}"
APP_INSIGHTS_KEY=$(az monitor app-insights component show \
    --app $APP_INSIGHTS_NAME \
    --resource-group $RESOURCE_GROUP \
    --query instrumentationKey -o tsv)
echo -e "${GREEN}✓ Application Insights key retrieved${NC}"

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
        --os-type Linux
    echo -e "${GREEN}✓ Function App created${NC}"
else
    echo -e "${GREEN}✓ Function App exists${NC}"
fi

# Configure Function App settings
echo -e "${YELLOW}Configuring Function App settings...${NC}"

# Read values from local.settings.json or prompt
echo -e "${YELLOW}Please provide the following configuration values:${NC}"
read -p "Azure Subscription ID: " AZURE_SUBSCRIPTION_ID
read -p "Azure Tenant ID: " AZURE_TENANT_ID
read -p "Azure Client ID: " AZURE_CLIENT_ID
read -sp "Azure Client Secret: " AZURE_CLIENT_SECRET
echo
read -p "Log Analytics Workspace ID: " LOG_ANALYTICS_WORKSPACE_ID
read -p "OpenAI Endpoint: " OPENAI_ENDPOINT
read -sp "OpenAI API Key: " OPENAI_API_KEY
echo
read -sp "SendGrid API Key: " SENDGRID_API_KEY
echo
read -p "SendGrid From Email: " SENDGRID_FROM_EMAIL
read -p "Technical Email Recipients (comma-separated): " TECHNICAL_EMAIL_TO
read -p "Executive Email Recipients (comma-separated): " EXECUTIVE_EMAIL_TO

az functionapp config appsettings set \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --settings \
    "AzureWebJobsStorage=$STORAGE_CONNECTION_STRING" \
    "APPINSIGHTS_INSTRUMENTATIONKEY=$APP_INSIGHTS_KEY" \
    "AZURE_SUBSCRIPTION_ID=$AZURE_SUBSCRIPTION_ID" \
    "AZURE_TENANT_ID=$AZURE_TENANT_ID" \
    "AZURE_CLIENT_ID=$AZURE_CLIENT_ID" \
    "AZURE_CLIENT_SECRET=$AZURE_CLIENT_SECRET" \
    "LOG_ANALYTICS_WORKSPACE_ID=$LOG_ANALYTICS_WORKSPACE_ID" \
    "OPENAI_ENDPOINT=$OPENAI_ENDPOINT" \
    "OPENAI_API_KEY=$OPENAI_API_KEY" \
    "SENDGRID_API_KEY=$SENDGRID_API_KEY" \
    "SENDGRID_FROM_EMAIL=$SENDGRID_FROM_EMAIL" \
    "TECHNICAL_EMAIL_TO=$TECHNICAL_EMAIL_TO" \
    "EXECUTIVE_EMAIL_TO=$EXECUTIVE_EMAIL_TO" \
    > /dev/null

echo -e "${GREEN}✓ Function App settings configured${NC}"

# Enable managed identity
echo -e "${YELLOW}Enabling managed identity...${NC}"
az functionapp identity assign \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    > /dev/null
echo -e "${GREEN}✓ Managed identity enabled${NC}"

# Deploy function code
echo -e "${YELLOW}Deploying function code...${NC}"
cd "$(dirname "$0")"
npm install --production
zip -r function.zip . -x "*.git*" -x "node_modules/*" -x ".env*"
az functionapp deployment source config-zip \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --src function.zip
rm function.zip
echo -e "${GREEN}✓ Function code deployed${NC}"

# Get function app URL
FUNCTION_URL=$(az functionapp show \
    --name $FUNCTION_APP_NAME \
    --resource-group $RESOURCE_GROUP \
    --query defaultHostName -o tsv)

echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment Complete!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Function App URL: https://${FUNCTION_URL}${NC}"
echo -e "${GREEN}Manual Trigger URL: https://${FUNCTION_URL}/api/orchestrators/VMPerformanceOrchestrator${NC}"
echo -e ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "1. Grant the Function App's managed identity permissions to:"
echo -e "   - Log Analytics Workspace (Log Analytics Reader)"
echo -e "   - Azure Subscriptions with VMs (Reader)"
echo -e "2. Test the function by triggering it manually"
echo -e "3. Check logs in Application Insights"
echo -e ""
echo -e "${YELLOW}To test manually:${NC}"
echo -e "curl -X POST https://${FUNCTION_URL}/api/orchestrators/VMPerformanceOrchestrator?code=<function-key>"
