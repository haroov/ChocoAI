# Deployment Guide

Complete guide for deploying ChocoAI to production. This application is deployment-method agnostic and can be deployed to any containerized platform.

## Deployment Methods Supported

- **AWS App Runner** (recommended - easiest)
- **AWS ECS/ECR** with Fargate
- **Docker** (works anywhere)
- **Any Docker-compatible platform**

---

## Prerequisites

- Node.js 18+
- PostgreSQL database
- OpenAI API key
- Docker (for containerized deployment)

## Required Environment Variables

```env
# Core (Required)
DATABASE_URL=postgresql://username:password@host:port/database?sslmode=require
OPENAI_API_KEY=sk-your-openai-key
ROOT_URL=https://your-domain.com
NODE_ENV=production

# Authentication
JWT_SECRET=your-jwt-secret
ADMIN_COOKIE_NAME=admin_session
ADMIN_JWT_TTL=7d

# Choco Integration
CHOCO_CAPTCHA_TOKEN=your-captcha-token
CHOCO_JWT=your-choco-jwt (optional)
CHOCO_BASE_URL=https://api.chocoinsurance.com (optional)
CHOCO_DASHBOARD_BASE=https://dashboardapi.chocoinsurance.com (optional)

# LLM Configuration (optional, has defaults)
LLM_PROVIDER=openai (default)
LLM_MODEL=gpt-4o-mini (default)
LLM_TEMPERATURE=0.2 (default)

# Guidestar (for nonprofit lookup)
GUIDESTAR_USERNAME=your-username
GUIDESTAR_PASSWORD=your-password

# Charity API
CHARITY_API_KEY=your-api-key

# Email (optional, for error notifications)
SENDGRID_API_KEY=your-sendgrid-key
TECH_SUPPORT_EMAIL=uriel@facio.io (default)

# Environment
CHOCO_ENV=production|staging|development
```

---

## AWS App Runner Deployment (Recommended)

### Why AWS App Runner?

- ✅ Easiest to deploy - just point to Docker image or GitHub repo
- ✅ Automatic scaling based on traffic
- ✅ Pay per use pricing
- ✅ HTTPS included - automatic SSL certificates
- ✅ No server management - fully managed service
- ✅ Cost: ~$5-10/month for typical usage

### Prerequisites

- AWS account
- RDS PostgreSQL database (or existing PostgreSQL)
- Docker image in ECR or GitHub repository

### Step 1: Build and Push Docker Image to ECR

```bash
# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
REGION=us-east-1

# Create ECR repository
aws ecr create-repository --repository-name chocoai --region $REGION

# Login to ECR
aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin $AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com

# Build and tag the image
docker build -t chocoai:latest .
docker tag chocoai:latest $AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chocoai:latest

# Push the image
docker push $AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chocoai:latest
```

### Step 2: Create App Runner Service

**Option A: Using AWS Console**

1. Go to AWS App Runner Console: https://console.aws.amazon.com/apprunner/home
2. Click "Create service"
3. Choose "Container registry" → "Amazon ECR"
4. Select your image: `<ACCOUNT_ID>.dkr.ecr.us-east-1.amazonaws.com/chocoai:latest`
5. Configure:
   - **Port**: 8080
   - **Command**: (leave empty, Dockerfile CMD will be used)
   - **Environment variables**: (see Required Environment Variables above)
6. Set instance configuration (1 vCPU, 2 GB recommended)
7. Create and deploy

**Option B: Using AWS CLI**

```bash
aws apprunner create-service \
  --service-name chocoai \
  --source-configuration '{
    "ImageRepository": {
      "ImageIdentifier": "'$AWS_ACCOUNT_ID'.dkr.ecr.us-east-1.amazonaws.com/chocoai:latest",
      "ImageRepositoryType": "ECR",
      "ImageConfiguration": {
        "Port": "8080",
        "RuntimeEnvironmentVariables": {
          "NODE_ENV": "production",
          "DATABASE_URL": "your-database-url",
          "OPENAI_API_KEY": "your-key"
        }
      }
    },
    "AutoDeploymentsEnabled": true
  }' \
  --instance-configuration '{
    "Cpu": "1 vCPU",
    "Memory": "2 GB"
  }'
```

### Step 3: Configure Custom Domain (Optional)

```bash
# Add custom domain
aws apprunner create-custom-domain-association \
  --service-arn "your-service-arn" \
  --domain-name "yourdomain.com" \
  --enable-www-subdomain

# Get DNS records to add to your DNS provider
aws apprunner describe-custom-domains --service-arn "your-service-arn"
```

### Step 4: Database Setup

The application automatically runs Prisma migrations on startup. Ensure your database is accessible from App Runner:

1. Configure RDS security group to allow connections from App Runner
2. Ensure `DATABASE_URL` is correctly formatted with SSL mode

### Step 5: Verify Deployment

```bash
# Health check
curl https://your-service-url.awsapprunner.com/health

# Should return:
{
  "status": "healthy",
  "db": "ready",
  "services": {
    "llm": "connected"
  }
}
```

---

## Docker Deployment

### Build

```bash
docker build -t chocoai:latest .
```

### Run

```bash
docker run -d \
  -p 8080:8080 \
  -e DATABASE_URL="postgresql://..." \
  -e OPENAI_API_KEY="sk-..." \
  -e ROOT_URL="https://..." \
  -e NODE_ENV="production" \
  chocoai:latest
```

### Using Docker Compose

```yaml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "8080:8080"
    environment:
      DATABASE_URL: postgresql://...
      OPENAI_API_KEY: sk-...
      ROOT_URL: https://...
      NODE_ENV: production
    depends_on:
      - postgres
  
  postgres:
    image: postgres:15
    environment:
      POSTGRES_DB: chocoai
      POSTGRES_USER: admin
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data

volumes:
  postgres_data:
```

---

## Database Migrations

Migrations run automatically on application startup using Prisma. The application will:

1. Check for pending migrations
2. Apply them automatically
3. Seed initial data (flows, admin users)

**Manual Migration (if needed):**

```bash
# Connect to your database and run
npx prisma migrate deploy
```

---

## Monitoring & Troubleshooting

### Health Check

```bash
curl https://your-domain.com/health
```

### View Logs

**AWS App Runner:**
- CloudWatch Logs: https://console.aws.amazon.com/cloudwatch/home#logsV2:log-groups
- App Runner Console: https://console.aws.amazon.com/apprunner/home

**Docker:**
```bash
docker logs <container-id>
```

### Common Issues

1. **Application doesn't start**
   - Check logs for configuration errors
   - Verify all required environment variables are set
   - Ensure DATABASE_URL is correct and accessible

2. **Database connection fails**
   - Check security groups/firewall rules
   - Verify SSL mode in connection string
   - Test connection manually

3. **Migrations fail**
   - Check database permissions
   - Verify DATABASE_URL format
   - Review Prisma schema for conflicts

---

## Cost Estimates

### AWS App Runner
- **CPU/Memory**: $0.007/vCPU/hour + $0.0008/GB/hour
- **Runtime**: ~$5-10/month for typical usage (1-2 instances, 24/7)

### Database (AWS RDS PostgreSQL)
- **db.t3.micro**: ~$15/month
- **Storage**: $0.115/GB/month

### ECR
- **Storage**: ~$0.10/month (minimal)

**Total Estimated Cost**: ~$20-30/month

---

## Security Best Practices

1. ✅ Use AWS Secrets Manager for sensitive environment variables
2. ✅ Enable HTTPS (automatic with App Runner)
3. ✅ Use IAM roles for service authentication
4. ✅ Enable CloudWatch logging and monitoring
5. ✅ Configure proper auto-scaling to control costs
6. ✅ Use SSL connections for database (sslmode=require)
7. ✅ Keep dependencies up to date

---

## Updating the Application

### AWS App Runner
- **Automatic**: If using GitHub source, push to repository
- **Manual**: Update ECR image and trigger deployment

```bash
# Build new image
docker build -t chocoai:latest .
docker tag chocoai:latest $AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chocoai:latest
docker push $AWS_ACCOUNT_ID.dkr.ecr.$REGION.amazonaws.com/chocoai:latest

# App Runner will auto-deploy if AutoDeploymentsEnabled is true
```

---

## Application Startup

The application entry point is `backend/src/app.ts` which:
1. Initializes Express server
2. Runs database migrations
3. Seeds initial data (flows, admins)
4. Starts listening on port 8080

**Start Command**: `node dist/app.js`

---

For more detailed architecture information, see [LLMENGINEER.md](./LLMENGINEER.md).

