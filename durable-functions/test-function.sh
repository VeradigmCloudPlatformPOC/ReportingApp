#!/bin/bash

# Test VM Performance Durable Functions

FUNCTION_APP="vmperf-durable-func-18406"
RESOURCE_GROUP="Sai-Test-rg"

echo "Testing VM Performance Durable Functions"
echo "========================================="
echo ""

# Get function key
echo "Getting function key..."
FUNCTION_KEY=$(az functionapp keys list \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --query "functionKeys.default" -o tsv)

if [ -z "$FUNCTION_KEY" ]; then
    echo "Error: Could not retrieve function key"
    exit 1
fi

echo "Function key retrieved: ${FUNCTION_KEY:0:10}..."
echo ""

# Try different endpoints
echo "Attempting to trigger function..."
echo ""

# Try HTTP trigger with orchestrator route
echo "Method 1: HTTP trigger (orchestrators/VMPerformanceOrchestrator)"
RESPONSE=$(curl -X POST \
  "https://${FUNCTION_APP}.azurewebsites.net/api/orchestrators/VMPerformanceOrchestrator?code=${FUNCTION_KEY}" \
  -H "Content-Type: application/json" \
  -s -w "\nHTTP_STATUS:%{http_code}")

HTTP_CODE=$(echo "$RESPONSE" | grep "HTTP_STATUS" | cut -d: -f2)
BODY=$(echo "$RESPONSE" | grep -v "HTTP_STATUS")

echo "Status Code: $HTTP_CODE"

if [ "$HTTP_CODE" == "202" ] || [ "$HTTP_CODE" == "200" ]; then
    echo "✅ Success! Orchestration started"
    echo "Response:"
    echo "$BODY" | jq . 2>/dev/null || echo "$BODY"

    # Extract status query URI
    STATUS_URI=$(echo "$BODY" | jq -r '.statusQueryGetUri' 2>/dev/null)

    if [ "$STATUS_URI" != "null" ] && [ -n "$STATUS_URI" ]; then
        echo ""
        echo "Checking orchestration status..."
        sleep 3
        curl "$STATUS_URI" -s | jq .
    fi
else
    echo "❌ Failed with status $HTTP_CODE"
    echo "Response: $BODY"
fi

echo ""
echo "Method 2: Invoke via Azure CLI"
az functionapp function invoke \
  --name $FUNCTION_APP \
  --resource-group $RESOURCE_GROUP \
  --function-name httpTrigger 2>&1 | head -20

echo ""
echo "========================================="
echo ""
echo "To view logs, run:"
echo "  az portal navigate-to-resource --resource-id /subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Web/sites/${FUNCTION_APP}"
echo ""
echo "Or check Application Insights:"
echo "  https://portal.azure.com/#resource/subscriptions/ffd7017b-28ed-4e90-a2ec-4a6958578f98/resourceGroups/${RESOURCE_GROUP}/providers/microsoft.insights/components/vmperf-insights-18406/logs"
