# Azure CI/CD (ChocoAI)

This folder contains the Azure infrastructure template used by GitHub Actions to create and deploy **ChocoAI** into Azure.

## What it creates

- Resource Group
- Azure Container Registry (ACR)
- User-assigned Managed Identity (UAMI)
- App Service Plan (Linux)
- App Service Web App (Linux **container**) pulling from ACR via **Managed Identity** (`acrUseManagedIdentityCreds`)

## Required GitHub Secrets (OIDC)

Configure GitHub → Repo → Settings → Secrets and variables → Actions → **Secrets**:

- `AZURE_CLIENT_ID`
- `AZURE_TENANT_ID`
- `AZURE_SUBSCRIPTION_ID`

These are used by `azure/login` with **OpenID Connect** (no client secret).

## Required GitHub Secrets (runtime)

Add at least the required app runtime secrets:

- `DATABASE_URL`
- `OPENAI_API_KEY`
- `JWT_SECRET`
- `ROOT_URL`

Optional (if used):

- `GOOGLE_MAPS_API_KEY`
- `SENDGRID_API_KEY`
- `GUIDESTAR_USERNAME`
- `GUIDESTAR_PASSWORD`

## Required GitHub Variables

Configure GitHub → Repo → Settings → Secrets and variables → Actions → **Variables**:

- `AZURE_LOCATION` (e.g. `westeurope`)
- `AZURE_RESOURCE_GROUP` (e.g. `rg-chocoai-prod`)
- `AZURE_WEBAPP_NAME` (e.g. `chocoai-prod`)
- `AZURE_ACR_NAME` (e.g. `chocoai<suffix>` created by provisioning workflow output)

## Provision (one-time)

Run the workflow **"Azure - Provision"** manually from GitHub Actions.
It will create the resource group, ACR, identity, and App Service.

## Deploy (on push)

On every push to `main`, the **"Azure - Deploy"** workflow will:

1. Build backend (`backend/dist`)
2. Build and push a Docker image to ACR
3. Point the Web App to the new image tag
4. Set App Settings from GitHub Secrets

