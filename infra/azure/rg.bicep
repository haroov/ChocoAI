targetScope = 'resourceGroup'

@description('Azure region for all resources.')
param location string

@description('Azure App Service Web App name (must be globally unique).')
param webAppName string

@description('App Service plan name.')
param appServicePlanName string

@description('User-assigned managed identity name used for pulling images from ACR.')
param userAssignedIdentityName string

@description('Azure Container Registry name (lowercase, 5-50 chars).')
param acrName string

@description('Docker image repository name in ACR.')
param imageRepo string = 'chocoai'

@description('Docker image tag to deploy initially (pipeline will update later).')
param imageTag string = 'latest'

@description('App Service pricing tier (e.g. B1, P0v3).')
param appServiceSkuName string = 'B1'

resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  name: acrName
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
    publicNetworkAccess: 'Enabled'
  }
}

resource uami 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: userAssignedIdentityName
  location: location
}

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = {
  name: appServicePlanName
  location: location
  kind: 'linux'
  sku: {
    name: appServiceSkuName
    tier: 'Basic'
  }
  properties: {
    reserved: true
  }
}

resource web 'Microsoft.Web/sites@2023-01-01' = {
  name: webAppName
  location: location
  kind: 'app,linux,container'
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${uami.id}': {}
    }
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
  }
}

// Container + Managed Identity ACR auth
resource webConfig 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: web
  name: 'web'
  properties: {
    linuxFxVersion: 'DOCKER|${acr.properties.loginServer}/${imageRepo}:${imageTag}'
    alwaysOn: true

    // Pull from ACR using managed identity (no registry password in GitHub).
    acrUseManagedIdentityCreds: true
    // NOTE: This is the *clientId* of the user-assigned managed identity.
    acrUserManagedIdentityID: uami.properties.clientId

    // Health + logs
    http20Enabled: true
    ftpsState: 'Disabled'
    minTlsVersion: '1.2'
  }
}

resource appSettings 'Microsoft.Web/sites/config@2023-01-01' = {
  parent: web
  name: 'appsettings'
  properties: {
    NODE_ENV: 'production'
    PORT: '8080'
    WEBSITES_PORT: '8080'
    // App secrets must be set via CI (GitHub Secrets), not in IaC.
  }
}

// Grant AcrPull to the managed identity
var acrPullRoleDefinitionId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')

resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, uami.id, acrPullRoleDefinitionId)
  scope: acr
  properties: {
    principalId: uami.properties.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output webApp string = web.name
output managedIdentityClientId string = uami.properties.clientId

