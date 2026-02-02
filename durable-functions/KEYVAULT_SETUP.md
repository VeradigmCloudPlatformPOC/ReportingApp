# Azure Key Vault Integration Guide

This guide covers secure credential management using Azure Key Vault for the VM Performance Monitoring Durable Functions.

## Why Key Vault?

**Security Benefits:**
- ✅ Credentials never stored in code or config files
- ✅ Centralized secret management
- ✅ Automatic secret rotation support
- ✅ Access auditing and logging
- ✅ Managed identity authentication (no passwords)
- ✅ Compliance with security policies

**Without Key Vault:** Secrets visible in Function App configuration
**With Key Vault:** Function App only stores Key Vault references, secrets retrieved at runtime

## Credentials Stored in Key Vault

The following sensitive credentials are stored securely:

1. **SendGridApiKey** - SendGrid API key for email delivery
2. **OpenAIApiKey** - Azure OpenAI API key
3. **OpenAIEndpoint** - Azure OpenAI endpoint URL
4. **LogAnalyticsClientSecret** - Service principal secret for Log Analytics
5. **LogAnalyticsWorkspaceId** - Log Analytics workspace ID
6. **LogAnalyticsClientId** - Service principal client ID
7. **LogAnalyticsTenantId** - Azure tenant ID
8. **TargetSubscriptionId** - Target subscription for VM monitoring
9. **EmailAddress** - Email address for reports

## Deployment Options

### Option 1: Deploy Everything with Key Vault (Recommended)

Single script that creates all resources including Key Vault:

```bash
cd /Users/saigunaranjan/repo/ReportingApp/durable-functions
./deploy-with-keyvault.sh
```

This script:
1. Creates resource group
2. Creates Key Vault with unique name
3. Stores all secrets in Key Vault
4. Creates storage account
5. Creates Application Insights
6. Creates Function App
7. Enables managed identity
8. Grants Key Vault access to Function App
9. Configures Function App settings with Key Vault references
10. Deploys function code

**Advantages:**
- Complete secure setup in one step
- No manual configuration needed
- All credentials properly secured from the start

### Option 2: Add Key Vault to Existing Deployment

If you already deployed the Function App without Key Vault:

```bash
cd /Users/saigunaranjan/repo/ReportingApp/durable-functions
./setup-keyvault.sh
```

This script:
1. Creates Key Vault
2. Stores all secrets
3. Updates existing Function App to use Key Vault references

## How It Works

### Key Vault References

Instead of storing actual secrets, Function App settings contain Key Vault references:

```bash
# Without Key Vault (INSECURE)
SENDGRID_API_KEY=<YOUR_SENDGRID_API_KEY>

# With Key Vault (SECURE)
SENDGRID_API_KEY=@Microsoft.KeyVault(SecretUri=https://vmperf-keyvault-12345.vault.azure.net/secrets/SendGridApiKey/)
```

### Runtime Secret Retrieval

1. Function App starts
2. Sees Key Vault reference in settings
3. Uses managed identity to authenticate to Key Vault
4. Retrieves actual secret value
5. Uses secret in application code

**No passwords or keys needed for authentication!**

## Managed Identity

The Function App uses **System-Assigned Managed Identity** to access Key Vault:

```bash
# Enable managed identity
az functionapp identity assign \
    --name vmperf-durable-functions \
    --resource-group vmperf-monitoring-rg

# Grant Key Vault access
az keyvault set-policy \
    --name <vault-name> \
    --object-id <principal-id> \
    --secret-permissions get list
```

**Benefits:**
- No credentials to manage
- Automatic credential rotation
- Scoped permissions (only get/list secrets)
- Azure handles authentication

## Viewing Secrets

### List All Secrets

```bash
VAULT_NAME="vmperf-keyvault-12345"  # Use your vault name

az keyvault secret list --vault-name $VAULT_NAME --output table
```

### View Specific Secret

```bash
# View secret value
az keyvault secret show \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey \
    --query value -o tsv

# View secret metadata
az keyvault secret show \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey
```

### View Secret Versions

```bash
az keyvault secret list-versions \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey
```

## Updating Secrets

### Update a Secret

```bash
# Update SendGrid API key
az keyvault secret set \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey \
    --value "NEW_API_KEY_HERE"
```

**No Function App restart needed!** The new value will be used automatically.

### Secret Rotation

For automatic rotation (e.g., SendGrid key expires):

1. Update secret in Key Vault
2. Function App retrieves new value automatically
3. No code changes needed

## Access Control

### Grant Access to Another Application

```bash
# Get the application's managed identity principal ID
PRINCIPAL_ID=$(az functionapp identity show \
    --name <app-name> \
    --resource-group <resource-group> \
    --query principalId -o tsv)

# Grant Key Vault access
az keyvault set-policy \
    --name $VAULT_NAME \
    --object-id $PRINCIPAL_ID \
    --secret-permissions get list
```

### Grant Access to a User

```bash
# Get user's object ID
USER_OBJECT_ID=$(az ad user show \
    --id user@veradigm.com \
    --query objectId -o tsv)

# Grant access
az keyvault set-policy \
    --name $VAULT_NAME \
    --object-id $USER_OBJECT_ID \
    --secret-permissions get list set delete
```

### Revoke Access

```bash
az keyvault delete-policy \
    --name $VAULT_NAME \
    --object-id $PRINCIPAL_ID
```

## Auditing and Monitoring

### Enable Diagnostic Logging

```bash
# Create Log Analytics workspace for auditing
az monitor log-analytics workspace create \
    --resource-group vmperf-monitoring-rg \
    --workspace-name vmperf-keyvault-logs

# Get workspace ID
WORKSPACE_ID=$(az monitor log-analytics workspace show \
    --resource-group vmperf-monitoring-rg \
    --workspace-name vmperf-keyvault-logs \
    --query id -o tsv)

# Enable diagnostic settings
az monitor diagnostic-settings create \
    --name KeyVaultDiagnostics \
    --resource /subscriptions/.../resourceGroups/vmperf-monitoring-rg/providers/Microsoft.KeyVault/vaults/$VAULT_NAME \
    --workspace $WORKSPACE_ID \
    --logs '[{"category":"AuditEvent","enabled":true}]' \
    --metrics '[{"category":"AllMetrics","enabled":true}]'
```

### Query Access Logs

```kql
AzureDiagnostics
| where ResourceProvider == "MICROSOFT.KEYVAULT"
| where OperationName == "SecretGet"
| project TimeGenerated, CallerIPAddress, identity_claim_appid_g, id_s
| order by TimeGenerated desc
```

### Alert on Unauthorized Access

```bash
az monitor metrics alert create \
    --name KeyVaultUnauthorizedAccess \
    --resource-group vmperf-monitoring-rg \
    --scopes /subscriptions/.../resourceGroups/vmperf-monitoring-rg/providers/Microsoft.KeyVault/vaults/$VAULT_NAME \
    --condition "total ServiceApiResult where ResultType = 'Unauthorized' > 0" \
    --description "Alert when unauthorized access attempts detected"
```

## Troubleshooting

### Function App Can't Access Key Vault

**Error:** `The user, group or application does not have secrets get permission`

**Solution:**
```bash
# Verify managed identity is enabled
az functionapp identity show \
    --name vmperf-durable-functions \
    --resource-group vmperf-monitoring-rg

# Grant access policy
az keyvault set-policy \
    --name $VAULT_NAME \
    --object-id <principal-id> \
    --secret-permissions get list
```

### Secret Not Found

**Error:** `Secret not found: SendGridApiKey`

**Solution:**
```bash
# Verify secret exists
az keyvault secret show \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey

# If missing, create it
az keyvault secret set \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey \
    --value "YOUR_API_KEY"
```

### Key Vault Reference Not Resolving

**Symptom:** Function App settings show `@Microsoft.KeyVault(...)` instead of secret value

**Check:**
1. Managed identity enabled
2. Access policy granted
3. Secret exists in Key Vault
4. Reference format is correct

**Test manually:**
```bash
# Get secret from Key Vault using managed identity
az keyvault secret show \
    --vault-name $VAULT_NAME \
    --name SendGridApiKey \
    --query value -o tsv
```

### Firewall Issues

If Key Vault has firewall enabled, allow Function App access:

```bash
# Allow Function App outbound IPs
az keyvault network-rule add \
    --vault-name $VAULT_NAME \
    --ip-address <function-app-ip>

# Or allow all Azure services (less secure)
az keyvault update \
    --name $VAULT_NAME \
    --bypass AzureServices
```

## Best Practices

### 1. Use Managed Identity

✅ **Do:** Use managed identity for all Azure resource access
❌ **Don't:** Store service principal credentials in Key Vault for Function App

### 2. Least Privilege Access

✅ **Do:** Grant only `get` and `list` permissions
❌ **Don't:** Grant `set`, `delete`, or `purge` unless required

### 3. Enable Soft Delete

```bash
az keyvault update \
    --name $VAULT_NAME \
    --enable-soft-delete true \
    --retention-days 90
```

Deleted secrets recoverable for 90 days.

### 4. Enable Purge Protection

```bash
az keyvault update \
    --name $VAULT_NAME \
    --enable-purge-protection true
```

Prevents permanent deletion of secrets.

### 5. Separate Key Vaults by Environment

- `vmperf-keyvault-dev`
- `vmperf-keyvault-staging`
- `vmperf-keyvault-prod`

Different secrets and access policies per environment.

### 6. Regular Secret Rotation

- **SendGrid API Key:** Rotate every 90 days
- **Service Principal Secret:** Rotate every 90 days
- **OpenAI API Key:** Rotate every 180 days

### 7. Monitor and Alert

- Enable diagnostic logging
- Alert on unauthorized access
- Review access logs weekly

## Migration Checklist

Migrating from insecure storage to Key Vault:

- [ ] Create Key Vault
- [ ] Store all secrets in Key Vault
- [ ] Enable managed identity on Function App
- [ ] Grant Key Vault access to managed identity
- [ ] Update Function App settings to use Key Vault references
- [ ] Test secret retrieval
- [ ] Remove secrets from old storage (config files, environment variables)
- [ ] Enable diagnostic logging
- [ ] Configure access alerts
- [ ] Document Key Vault name and location

## Resources

- [Azure Key Vault Documentation](https://docs.microsoft.com/azure/key-vault/)
- [Managed Identity Documentation](https://docs.microsoft.com/azure/active-directory/managed-identities-azure-resources/)
- [Key Vault References in App Service](https://docs.microsoft.com/azure/app-service/app-service-key-vault-references)
- [Key Vault Best Practices](https://docs.microsoft.com/azure/key-vault/general/best-practices)

## Support

For Key Vault issues:
1. Check troubleshooting section above
2. Review diagnostic logs in Application Insights
3. Verify access policies and permissions
4. Contact Azure support if needed
