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

## One-time Azure setup (OIDC)

In Azure (Entra ID):

1. Create an **App Registration** dedicated to this repo.
2. Create a **Federated Credential** for GitHub Actions:
   - **Issuer**: `https://token.actions.githubusercontent.com`
   - **Subject (branch main)**: `repo:<OWNER>/<REPO>:ref:refs/heads/main`
   - **Audience**: `api://AzureADTokenExchange`
3. Assign RBAC roles to the app’s **service principal**:
   - **Subscription scope**: `Contributor`
   - **If provisioning fails on role assignment** (`Microsoft.Authorization/roleAssignments/write`): also grant `User Access Administrator` (or use an Owner to provision once).

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

- `AZURE_LOCATION` (e.g. `israelcentral`)
- `AZURE_RESOURCE_GROUP` (e.g. `rg-chocoai-prod`)
- `AZURE_WEBAPP_NAME` (e.g. `chocoai-<suffix>` created by provisioning workflow output)
- `AZURE_ACR_NAME` (e.g. `chocoai<suffix>` created by provisioning workflow output)

## Provision (one-time)

Run the workflow **"Azure - Provision"** manually from GitHub Actions.
It will create the resource group, ACR, identity, and App Service.

After it finishes, copy the deployment outputs and set repo **Variables**:

- `AZURE_WEBAPP_NAME` (from output `webApp`)
- `AZURE_ACR_NAME` (ACR resource name; output includes `acrLoginServer` for reference)

## Deploy (on push)

On every push to `main`, the **"Azure - Deploy"** workflow will:

1. Build backend (`backend/dist`)
2. Build and push a Docker image to ACR
3. Point the Web App to the new image tag
4. Set App Settings from GitHub Secrets

