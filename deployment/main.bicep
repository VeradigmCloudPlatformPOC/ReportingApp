// Main Bicep template for VM Performance Monitoring Solution
// Deploys: Logic App, AI Foundry connections, Log Analytics, Storage Account

@description('Location for all resources')
param location string = resourceGroup().location

@description('Name prefix for resources')
param resourcePrefix string = 'vmperf'

@description('Log Analytics Workspace Resource ID')
param logAnalyticsWorkspaceId string

@description('AI Foundry Endpoint URL')
param aiFoundryEndpoint string

@description('AI Foundry API Key')
@secure()
param aiFoundryApiKey string

@description('Technical team email recipients (comma-separated)')
param technicalEmailRecipients string = 'devops@company.com'

@description('Executive email recipients (comma-separated)')
param executiveEmailRecipients string = 'leadership@company.com'

@description('Schedule - Day of week to run (Monday, Tuesday, etc.)')
param scheduleDayOfWeek string = 'Monday'

@description('Schedule - Hour to run (0-23 UTC)')
param scheduleHour int = 8

@description('Tags to apply to all resources')
param tags object = {
  Environment: 'Production'
  Solution: 'VM-Performance-Monitoring'
  ManagedBy: 'Bicep'
}

// Variables
var logicAppName = '${resourcePrefix}-logic-app'
var storageAccountName = '${resourcePrefix}${uniqueString(resourceGroup().id)}'
var office365ConnectionName = '${resourcePrefix}-office365-connection'
var azureMonitorConnectionName = '${resourcePrefix}-azmonitor-connection'

// Storage Account for report archives - Commented out due to org policy requirements
// Will be created manually if needed
// resource storageAccount 'Microsoft.Storage/storageAccounts@2023-01-01' = {
//   name: storageAccountName
//   location: location
//   tags: tags
//   sku: {
//     name: 'Standard_LRS'
//   }
//   kind: 'StorageV2'
//   properties: {
//     accessTier: 'Hot'
//     minimumTlsVersion: 'TLS1_2'
//     supportsHttpsTrafficOnly: true
//     allowBlobPublicAccess: false
//   }
// }

// Blob container for reports
// resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-01-01' = {
//   parent: storageAccount
//   name: 'default'
// }

// resource reportsContainer 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-01-01' = {
//   parent: blobService
//   name: 'vm-reports'
//   properties: {
//     publicAccess: 'None'
//   }
// }

// Office 365 API Connection
resource office365Connection 'Microsoft.Web/connections@2016-06-01' = {
  name: office365ConnectionName
  location: location
  tags: tags
  properties: {
    displayName: 'Office 365 Outlook'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'office365')
    }
    parameterValues: {}
  }
}

// Azure Monitor Logs API Connection
resource azureMonitorConnection 'Microsoft.Web/connections@2016-06-01' = {
  name: azureMonitorConnectionName
  location: location
  tags: tags
  properties: {
    displayName: 'Azure Monitor Logs'
    api: {
      id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'azuremonitorlogs')
    }
    parameterValues: {}
  }
}

// Logic App
resource logicApp 'Microsoft.Logic/workflows@2019-05-01' = {
  name: logicAppName
  location: location
  tags: tags
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    state: 'Enabled'
    definition: {
      '$schema': 'https://schema.management.azure.com/providers/Microsoft.Logic/schemas/2016-06-01/workflowdefinition.json#'
      contentVersion: '1.0.0.0'
      parameters: {
        '$connections': {
          defaultValue: {}
          type: 'Object'
        }
        logAnalyticsWorkspaceId: {
          defaultValue: logAnalyticsWorkspaceId
          type: 'String'
        }
        aiFoundryEndpoint: {
          defaultValue: aiFoundryEndpoint
          type: 'String'
        }
        aiFoundryApiKey: {
          defaultValue: aiFoundryApiKey
          type: 'SecureString'
        }
        technicalEmailRecipients: {
          defaultValue: technicalEmailRecipients
          type: 'String'
        }
        executiveEmailRecipients: {
          defaultValue: executiveEmailRecipients
          type: 'String'
        }
        storageAccountName: {
          defaultValue: storageAccountName
          type: 'String'
        }
      }
      triggers: {
        Recurrence: {
          recurrence: {
            frequency: 'Week'
            interval: 1
            schedule: {
              hours: [scheduleHour]
              minutes: [0]
              weekDays: [scheduleDayOfWeek]
            }
            timeZone: 'UTC'
          }
          type: 'Recurrence'
        }
      }
      actions: {
        // Workflow actions will be loaded from logic-app-definition.json
        // This is simplified for the Bicep template
        Initialize_Variables: {
          type: 'InitializeVariable'
          inputs: {
            variables: [
              {
                name: 'ReportDate'
                type: 'string'
                value: '@{formatDateTime(utcNow(), \'yyyy-MM-dd\')}'
              }
            ]
          }
        }
      }
    }
    parameters: {
      '$connections': {
        value: {
          office365: {
            connectionId: office365Connection.id
            connectionName: office365ConnectionName
            id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'office365')
          }
          azuremonitorlogs: {
            connectionId: azureMonitorConnection.id
            connectionName: azureMonitorConnectionName
            id: subscriptionResourceId('Microsoft.Web/locations/managedApis', location, 'azuremonitorlogs')
          }
        }
      }
    }
  }
}

// Role assignment for Logic App to read from Log Analytics
// Commented out - will be granted manually due to permissions
// resource logAnalyticsReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
//   name: guid(logicApp.id, 'Log Analytics Reader')
//   scope: resourceGroup()
//   properties: {
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '73c42c96-874c-492b-b04d-ab87d138a893') // Log Analytics Reader
//     principalId: logicApp.identity.principalId
//     principalType: 'ServicePrincipal'
//   }
// }

// Role assignment for Logic App to read VM information
// Commented out - will be granted manually due to permissions
// resource vmReaderRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
//   name: guid(logicApp.id, 'Virtual Machine Reader')
//   scope: resourceGroup()
//   properties: {
//     roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'acdd72a7-3385-48ef-bd42-f606fba81ae7') // Reader
//     principalId: logicApp.identity.principalId
//     principalType: 'ServicePrincipal'
//   }
// }

// Outputs
output logicAppName string = logicApp.name
output logicAppId string = logicApp.id
// output storageAccountName string = storageAccount.name
// output storageAccountId string = storageAccount.id
output logicAppIdentityPrincipalId string = logicApp.identity.principalId
