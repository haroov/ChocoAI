# ChocoAI Frontend

This Vite + React app powers the internal dashboard for ChocoAI:

- Inspect and replay conversations (`/conversations/:conversationId`)
- Stream assistant/user messages in real time
- Trigger manual actions (OTP resend, login transitions)

The app expects the backend running at `http://localhost:8080` so it can call `/api/v1/**` endpoints through the built-in Vite proxy.

## Prerequisites

- Node.js 20+
- Backend server running locally (`npm run dev:backend` or `npm run dev` from the repo root)
- Root `.env` configured (see `/README.md`)

## Setup

```bash
cd frontend
npm install
```

Create a `frontend/.env.local` file so the UI can display the correct branding:

```env
VITE_APP_NAME=ChocoAI
VITE_APP_LAUNCH_YEAR=2026
```

You can add additional `VITE_*` variables if you introduce new configuration points—Vite exposes anything prefixed with `VITE_` to the client bundle.

## Development

```bash
npm run dev
```

- Opens on http://localhost:5173
- Proxies API calls starting with `/api` to http://localhost:8080 (configured in `vite.config.ts`)
- Hot Module Reloading is enabled out of the box

The quickest loop is:

1. `./start-dev.sh` (from the repo root) to start Dockerized Postgres
2. `npm run dev` (root) to launch backend + frontend concurrently
3. Browse to http://localhost:5173/conversations to view sessions created in the widget/WhatsApp simulators

## Testing & Linting

```bash
npm run lint       # eslint + tsconfig checks
npm run build      # production build (outputs to dist/)
npm run preview    # serve the production bundle locally
```

The frontend reuses Tailwind, HeroUI, and Framer Motion already installed in `package.json`; no extra tooling is required beyond the commands above.

## Troubleshooting

- **API 401s** – Log into the backend admin UI (http://localhost:8080/settings) with the seeded `admin/(ADMIN_SEED_PASSWORD, defaults to "admin")` credentials, then reload the frontend so it picks up the session cookie.
- **CORS/Proxy errors** – Ensure the backend dev server is on port 8080. The Vite dev server proxies `/api` to that port; if you change it, update `vite.config.ts`.
- **Missing env vars** – Vite fails to compile if `VITE_APP_NAME` or `VITE_APP_LAUNCH_YEAR` are undefined. Double-check `.env.local`.

Happy hacking!
