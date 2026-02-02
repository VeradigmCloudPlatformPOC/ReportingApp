#!/bin/bash
# Deployment script for VM Performance Monitoring Solution

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== VM Performance Monitoring Solution Deployment ===${NC}\n"

# Check if Azure CLI is installed
if ! command -v az &> /dev/null; then
    echo -e "${RED}Azure CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if logged in to Azure
echo "Checking Azure login status..."
if ! az account show &> /dev/null; then
    echo -e "${YELLOW}Not logged in to Azure. Logging in...${NC}"
    az login
fi

# Variables - Update these or pass as environment variables
RESOURCE_GROUP="${RESOURCE_GROUP:-vmperf-monitoring-rg}"
LOCATION="${LOCATION:-eastus}"
DEPLOYMENT_NAME="vmperf-deployment-$(date +%Y%m%d-%H%M%S)"

echo -e "\n${GREEN}Deployment Configuration:${NC}"
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo "Deployment Name: $DEPLOYMENT_NAME"

# Prompt for confirmation
read -p "Continue with deployment? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled."
    exit 0
fi

# Create resource group if it doesn't exist
echo -e "\n${GREEN}Checking resource group...${NC}"
if ! az group show --name "$RESOURCE_GROUP" &> /dev/null; then
    echo "Creating resource group: $RESOURCE_GROUP"
    az group create --name "$RESOURCE_GROUP" --location "$LOCATION"
else
    echo "Resource group already exists: $RESOURCE_GROUP"
fi

# Validate Bicep template
echo -e "\n${GREEN}Validating Bicep template...${NC}"
az deployment group validate \
    --resource-group "$RESOURCE_GROUP" \
    --template-file main.bicep \
    --parameters parameters.json

if [ $? -ne 0 ]; then
    echo -e "${RED}Template validation failed!${NC}"
    exit 1
fi

echo -e "${GREEN}Template validation successful!${NC}"

# Deploy the solution
echo -e "\n${GREEN}Starting deployment...${NC}"
az deployment group create \
    --name "$DEPLOYMENT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --template-file main.bicep \
    --parameters parameters.json \
    --verbose

if [ $? -ne 0 ]; then
    echo -e "${RED}Deployment failed!${NC}"
    exit 1
fi

echo -e "\n${GREEN}Deployment successful!${NC}"

# Get outputs
echo -e "\n${GREEN}Retrieving deployment outputs...${NC}"
LOGIC_APP_NAME=$(az deployment group show \
    --name "$DEPLOYMENT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.outputs.logicAppName.value" \
    --output tsv)

STORAGE_ACCOUNT_NAME=$(az deployment group show \
    --name "$DEPLOYMENT_NAME" \
    --resource-group "$RESOURCE_GROUP" \
    --query "properties.outputs.storageAccountName.value" \
    --output tsv)

echo -e "\n${GREEN}=== Deployment Complete ===${NC}"
echo "Logic App Name: $LOGIC_APP_NAME"
echo "Storage Account: $STORAGE_ACCOUNT_NAME"

# Post-deployment steps
echo -e "\n${YELLOW}=== Post-Deployment Steps ===${NC}"
echo "1. Configure Office 365 connection authentication in Azure Portal"
echo "2. Configure Azure Monitor Logs connection authentication"
echo "3. Update the Logic App workflow with the full definition from logic-app-definition.json"
echo "4. Test the Logic App manually before waiting for the scheduled run"
echo ""
echo -e "${GREEN}Portal Link:${NC}"
echo "https://portal.azure.com/#resource/subscriptions/$(az account show --query id -o tsv)/resourceGroups/$RESOURCE_GROUP/providers/Microsoft.Logic/workflows/$LOGIC_APP_NAME"

echo -e "\n${GREEN}Done!${NC}"
