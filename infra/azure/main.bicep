@description('Azure region, e.g. israelcentral')
param location string = resourceGroup().location

@description('Web App name (must be globally unique)')
param webAppName string

@description('ACR name (must be globally unique, lowercase, 5-50 chars)')
param acrName string

@description('Key Vault name (globally unique, 3-24 chars)')
param keyVaultName string

@description('App Service Plan name')
param planName string = 'asp-${webAppName}'

@description('Image repo name in ACR')
param imageRepo string = 'chocoai'

var linuxFxVersion = 'DOCKER|${acrName}.azurecr.io/${imageRepo}:latest'

// App Service Plan (Linux)
resource plan 'Microsoft.Web/serverfarms@2022-09-01' = {
  name: planName
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    size: 'B1'
    capacity: 1
  }
  kind: 'linux'
  properties: {
    reserved: true
  }
}

// ACR
resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: acrName
  location: location
  sku: { name: 'Basic' }
  properties: {
    adminUserEnabled: false
  }
}

// Web App (Linux container) + System-assigned identity
resource web 'Microsoft.Web/sites@2022-09-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: linuxFxVersion
      alwaysOn: true
      ftpsState: 'Disabled'
      appSettings: [
        { name: 'NODE_ENV', value: 'production' }
        { name: 'PORT', value: '8080' }
        { name: 'WEBSITES_PORT', value: '8080' }
        // Secrets will be set later as KeyVault references from workflow
      ]
    }
  }
}

// Key Vault (RBAC mode)
resource kv 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    sku: {
      name: 'standard'
      family: 'A'
    }
    enabledForTemplateDeployment: true
    publicNetworkAccess: 'Enabled'
  }
}

// AcrPull to WebApp MI
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, web.id, 'AcrPull')
  scope: acr
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d') // AcrPull
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// (optional) Allow WebApp MI to read KeyVault secrets via RBAC role "Key Vault Secrets User"
resource kvSecretsUser 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(kv.id, web.id, 'KVSecretsUser')
  scope: kv
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '4633458b-17de-408a-b874-0445c86b69e6') // Key Vault Secrets User
    principalId: web.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

output acrLoginServer string = acr.properties.loginServer
output webAppNameOut string = web.name
output keyVaultNameOut string = kv.name
