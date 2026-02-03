# ChocoAI - Conversational Intelligence Platform

An AI-powered conversational platform built with TypeScript, Node.js, and OpenAI GPT-4o. Features a sophisticated Flow Engine for managing multi-stage conversational flows, real-time streaming, and multi-channel integration (Web Widget, WhatsApp).

## 🚀 Quick Start

### Prerequisites
- **Node.js 20+** and **npm**
- **Docker Desktop** (recommended for PostgreSQL)
- **OpenAI API Key**
- **PostgreSQL** (via Docker or local installation)

### Installation

```bash
# Clone repository
git clone <repository-url>
cd chocoAI

# Install dependencies
npm install
cd backend && npm install
cd ../frontend && npm install
```

### Environment Setup

Create a root-level `.env` with the backend runtime configuration. The backend loads this file automatically when you run `npm run dev`:

```env
# Core app
ROOT_URL=http://localhost:8080
PORT=8080
NODE_ENV=development
JWT_SECRET=dev-secret
ADMIN_COOKIE_NAME=choco_admin_token
ADMIN_JWT_TTL=12h

# Database
DATABASE_URL=postgresql://chocoai:chocoai@localhost:55432/chocoai

# AI + Flow Engine
OPENAI_API_KEY=sk-your-key
LLM_PROVIDER=openai
LLM_MODEL=gpt-4o-mini


# Email / support (optional)
SENDGRID_API_KEY=sg-your-key
TECH_SUPPORT_EMAIL=you@example.com
```

Create `frontend/.env.local` so the Vite app knows how to brand itself:

```env
VITE_APP_NAME=ChocoAI
VITE_APP_LAUNCH_YEAR=2026
```

> **Heads up:** `GUIDESTAR_*`, `CHARITY_API_KEY`, and `CHOCO_CAPTCHA_TOKEN` are mandatory now that nonprofit lookup automatically routes between Israeli (Guidestar) and US (CharityAPI) registrations.

### Database Setup

```bash
# Start PostgreSQL & Adminer (one-time per shell)
./start-dev.sh   # or: docker compose -f docker-compose.dev.yml up -d postgres

# Generate Prisma client
cd backend
npm run db:generate

# Run database migrations
npm run migrate:deploy

# Seed initial data (optional)
npm run db:seed
```

**Troubleshooting:**
- If you get "Can't reach database server" errors, ensure Docker Desktop is running
- If you get index corruption errors, run: `npm run fix:database-index`
- To reset database (WARNING: deletes all data): `npm run db:reset`

### Start Development

```bash
# In one terminal (starts backend + frontend concurrently)
npm run dev

# ...or run each stack manually
npm run dev:backend   # starts Express + Flow Engine with nodemon
npm run dev:frontend  # starts the Vite dashboard on :5173
```

Access the application:
- **REST API / widget assets**: http://localhost:8080
- **Health Check**: http://localhost:8080/health
- **Widget Demo**: http://localhost:8080/web-widget/widget-demo.html
- **Conversation console**: http://localhost:5173 (lists conversations) and `/conversations/:conversationId` for drill-down

Admin access is seeded automatically—log in at http://localhost:8080/settings using:

```
username: admin
password: (set via ADMIN_SEED_PASSWORD; defaults to "admin")
```

Once logged in you can view streaming conversations, inspect API logs, and resend OTPs.

## 📚 Documentation

### For Developers
- **`LLMENGINEER.md`** - Guidelines for AI agents and LLMs working on this codebase
- **`backend/docs/`** - Architecture and technical documentation

### Key Concepts

#### Flow Engine
The Flow Engine manages conversational flows through predefined stages. Each flow:
- Collects data through stages
- Executes tools/actions at stage completion
- Handles errors gracefully
- Supports conditional progression

#### Tools System
Tools are executable functions that:
- Make API calls to external services
- Save data to the database
- Perform business logic
- Return results for flow continuation

#### Data Persistence
- **userData**: User-specific, flow-specific data (key-value pairs)
- **Memory**: Global/shared data (currencies, countries, reference data)
- Access via `flowHelpers.getUserData()` and `flowHelpers.setUserData()`

## 🧪 Testing

```bash
# Run all tests
npm test

# Specific test suites
npm run test:unit          # Unit tests
npm run test:integration   # Integration tests
npm run test:e2e          # End-to-end tests

# Choco API Integration Tests (requires CHOCO_CAPTCHA_TOKEN)
cd backend
npm run test:choco-tools

# Coverage report
npm run test:coverage
```

## 🛠️ Development Scripts

### Database Utilities
```bash
npm run db:generate        # Generate Prisma client
npm run db:migrate        # Create new migration
npm run db:reset          # Reset database (WARNING: deletes data)
npm run fix:database-index # Fix corrupted database indexes
```

### Validation
```bash
npm run validate:tool-data # Validate tool data persistence
```

### Linting
```bash
npm run lint              # Check for issues
npm run lint:fix          # Auto-fix issues
```

## 🏗️ Architecture

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Flow Engine** | `backend/src/lib/flowEngine/` | Orchestrates conversational flows |
| **Tools** | `backend/src/lib/flowEngine/tools/` | Executable actions for flows |
| **Web Widget** | `backend/src/static/web-widget/` | Embeddable chat interface |
| **WhatsApp Handler** | `backend/src/api/whatsapp/` | WhatsApp integration |
| **Database** | `backend/prisma/` | Prisma schema and migrations |

### Project Structure

```
chocoAI/
├── backend/              # Backend API and Flow Engine
│   ├── src/
│   │   ├── lib/flowEngine/  # Flow Engine core
│   │   ├── api/             # API routes
│   │   └── static/          # Static assets
│   └── prisma/             # Database schema
├── frontend/            # Frontend application
├── LLMENGINEER.md       # AI agent guidelines
└── README.md            # This file
```

## 🔒 Security & Best Practices

### Authentication
- **Service-to-Service**: Uses `CHOCO_CAPTCHA_TOKEN` for initial API calls
- **User Authentication**: JWT tokens stored in `userData` after login
- **API Security**: JWT-based authentication for protected endpoints

### Data Handling
- Always validate input data
- Use parameterized queries (Prisma handles this)
- Sanitize user input before saving
- Store sensitive data securely

### Error Handling
- Tools should return structured errors
- Use error handling configuration in flows
- Log errors appropriately
- Never expose sensitive information in error messages

## 🚢 Production Deployment

### Environment Variables

```env
# Required
DATABASE_URL=postgresql://username:password@your-rds-endpoint:5432/chocoai
OPENAI_API_KEY=sk-your-openai-key
CHOCO_DASHBOARD_BASE=https://dashboardapi.chocoinsurance.com
CHOCO_CAPTCHA_TOKEN=your_captcha_token

# Optional
TWILIO_ACCOUNT_SID=ACyour-twilio-sid
TWILIO_AUTH_TOKEN=your-twilio-token
SENDGRID_API_KEY=your-sendgrid-key
NODE_ENV=production
PORT=8080
```

### Docker Deployment

```bash
# Build production image
docker build -f Dockerfile -t chocoai:latest .

# Run with environment variables
docker run -d \
  --name chocoai \
  -p 8080:8080 \
  --env-file .env \
  chocoai:latest
```

## 📖 API Reference

### Core Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/agent/chat-simple` | POST | Main conversation endpoint |
| `/api/agent/chat-stream` | GET | Real-time streaming |
| `/api/v1/whatsapp/webhook` | POST/GET | WhatsApp integration |
| `/health` | GET | System health check |

## 🤝 Contributing

1. Read `LLMENGINEER.md` for coding guidelines
2. Follow TypeScript and linting standards
3. Add tests for new features
4. Update documentation as needed

## 📄 License

This project is licensed under the MIT License.

## 🆘 Support

- **Documentation**: See `LLMENGINEER.md` and `backend/docs/`
- **Issues**: Report bugs via GitHub Issues
- **Questions**: Contact the development team

---

**Built with ❤️ for intelligent conversational experiences**
