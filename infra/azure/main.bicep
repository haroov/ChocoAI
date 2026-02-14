targetScope = 'subscription'

@description('Azure region for all resources.')
param location string = 'westeurope'

@description('Resource group name to create/use for ChocoAI.')
param resourceGroupName string = 'rg-chocoai-prod'

@description('Azure App Service Web App name (must be globally unique).')
param webAppName string = 'chocoai-prod'

@description('App Service plan name.')
param appServicePlanName string = 'asp-chocoai-prod'

@description('User-assigned managed identity name used for pulling images from ACR.')
param userAssignedIdentityName string = 'uami-chocoai-prod'

@description('Azure Container Registry name (lowercase, 5-50 chars). If empty, will be generated.')
param acrName string = ''

@description('Docker image repository name in ACR.')
param imageRepo string = 'chocoai'

@description('Docker image tag to deploy initially (pipeline will update later).')
param imageTag string = 'latest'

@description('App Service pricing tier (e.g. B1, P0v3).')
param appServiceSkuName string = 'B1'

var generatedAcrName = toLower('chocoai${uniqueString(subscription().id, resourceGroupName)}')
var acrFinalName = empty(acrName) ? generatedAcrName : toLower(acrName)

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-01-01-preview' = {
  scope: rg
  name: acrFinalName
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
  scope: rg
  name: userAssignedIdentityName
  location: location
}

resource plan 'Microsoft.Web/serverfarms@2023-01-01' = {
  scope: rg
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
  scope: rg
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
  scope: rg
  name: '${web.name}/web'
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
  scope: rg
  name: '${web.name}/appsettings'
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
  name: guid(acr.id, uami.properties.principalId, acrPullRoleDefinitionId)
  scope: acr
  properties: {
    principalId: uami.properties.principalId
    roleDefinitionId: acrPullRoleDefinitionId
    principalType: 'ServicePrincipal'
  }
}

output resourceGroup string = rg.name
output acrLoginServer string = acr.properties.loginServer
output webApp string = web.name
output managedIdentityClientId string = uami.properties.clientId

