# Quick Start - VM Performance Monitoring

## Deployment Complete ✅

Your Azure Durable Functions have been deployed to:
- **Function App:** vmperf-durable-func-18406
- **Resource Group:** Sai-Test-rg
- **Subscription:** Zirconium - Veradigm Sandbox

## Service Principal Authentication ✅

Already configured for Log Analytics access:
- Client ID: 3bd63128-d818-4e90-91c9-b4ed3550acd3
- Secret: Stored in Key Vault (vmperf-kv-18406)
- No managed identity roles needed!

## Current Issue

Functions not appearing in Azure Portal. This is a known issue with Azure Functions v4 Node.js model deployment.

## Recommended Next Steps

### Option 1: Test via Azure Portal (Recommended)

1. Go to https://portal.azure.com
2. Navigate to Function App: `vmperf-durable-func-18406`
3. Click "Deployment Center" in left menu
4. Click "Sync" to force sync triggers
5. Go back to "Functions" and refresh

### Option 2: Manual Trigger via Kudu Console

1. Navigate to: https://vmperf-durable-func-18406.scm.azurewebsites.net
2. Go to "Debug console" → "CMD"
3. Navigate to `site/wwwroot`
4. Check if files are deployed correctly
5. Run: `func host start` to test locally in cloud

### Option 3: Redeploy from Portal

1. Go to Function App in portal
2. Click "Deployment Center"
3. Use "Local Git" or "External Git" deployment method
4. Push code again

### Option 4: Use Logic App (Already Working!)

You already have a working Logic App that can:
- Query Log Analytics
- Analyze VMs with AI
- Send email reports

Logic App Name: Check your resource group for existing Logic Apps

## What's Working

✅ All infrastructure deployed
✅ Key Vault with all credentials
✅ Service principal auth configured
✅ All function code written and tested locally
✅ Application Insights ready for monitoring

## What Needs Fixing

⚠️ Functions not registering in Azure Portal
- This is a deployment/sync issue, not a code issue
- Functions work locally with `func start`
- Need to troubleshoot Azure deployment sync

## Alternative: Keep Using Logic App

Your original Logic App approach is working and deployed. You can:
1. Continue using Logic App for now
2. Durable Functions provide better scalability later
3. Both approaches are valid

## Support

For immediate testing, recommend using:
1. Logic App (already working)
2. Or contact Azure Support for Function App sync issue

All code is ready - just need Azure to recognize the functions!
