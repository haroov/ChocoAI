targetScope = 'subscription'

@description('Azure region for all resources.')
param location string = 'israelcentral'

@description('Resource group name to create/use for ChocoAI.')
param resourceGroupName string = 'rg-chocoai-prod'

@description('Azure App Service Web App name (must be globally unique). If empty, will be generated.')
param webAppName string = ''

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
var webAppFinalName = empty(webAppName)
  ? toLower('chocoai-${uniqueString(subscription().id, resourceGroupName)}')
  : toLower(webAppName)

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: resourceGroupName
  location: location
}

module rgResources './rg.bicep' = {
  name: 'chocoai-rg-resources'
  scope: rg
  params: {
    location: location
    webAppName: webAppFinalName
    appServicePlanName: appServicePlanName
    userAssignedIdentityName: userAssignedIdentityName
    acrName: acrFinalName
    imageRepo: imageRepo
    imageTag: imageTag
    appServiceSkuName: appServiceSkuName
  }
}

output resourceGroup string = rg.name
output acrName string = rgResources.outputs.acrName
output acrLoginServer string = rgResources.outputs.acrLoginServer
output webApp string = rgResources.outputs.webApp
output managedIdentityClientId string = rgResources.outputs.managedIdentityClientId

