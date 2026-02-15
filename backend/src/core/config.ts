import 'dotenv/config';
import { z } from 'zod';
import { logger } from '../utils/logger';

const EnvironmentEnum = z.enum(['development', 'staging', 'production', 'test']);
const isDev = (process.env.CHOCO_ENV ?? 'development') === 'development';

// Dev defaults so `npm run dev` works even when `backend/.env` is empty/missing.
const DEV_DEFAULTS = {
  ROOT_URL: 'http://localhost:8080',
  JWT_SECRET: 'dev-jwt-secret-change-me',
  ADMIN_COOKIE_NAME: 'chocoai_admin',
  ADMIN_JWT_TTL: '30d',
} as const;

const ConfigSchema = z.object({
  env: EnvironmentEnum.default('development'),
  port: z.coerce.number().default(8080),
  rootUrl: z.string().url().default(DEV_DEFAULTS.ROOT_URL),
  auth: z.object({
    jwtSecret: z.string().default(DEV_DEFAULTS.JWT_SECRET),
    adminCookieName: z.string().default(DEV_DEFAULTS.ADMIN_COOKIE_NAME),
    adminJwtTtl: z.string().default(DEV_DEFAULTS.ADMIN_JWT_TTL),
  }),
  choco: z.object({
    baseUrl: z.string().url().default('https://sandbox-api.chocoinsurance.com'),
    dashboardBaseUrl: z.string().url().default('https://dashboardapi.chocoinsurance.com'),
    jwt: z.string().optional(),
    captchaToken: z.string().default('demo-token'),
    requestTimeoutMs: z.number().default(10_000),
  }),
  llm: z.object({
    provider: z.string().default('openai'),
    model: z.string().default('gpt-5.2'),
    temperature: z.number().min(0).max(2).default(0.2),
  }),
  guidestar: z.object({
    username: z.string().default(''),
    password: z.string().default(''),
  }),
  charityApiKey: z.string().default(''),
  email: z.object({
    sendgridApiKey: z.string().optional(),
    techSupportEmail: z.string().default('uriel@facio.io'),
    retryAttempts: z.coerce.number().int().min(0).default(3),
    retryDelayMs: z.coerce.number().int().min(0).default(1000),
    mailgun: z.object({
      apiKey: z.string().optional(),
      domain: z.string().optional(),
      fromEmail: z.string().optional(),
      webhookUrl: z.string().url().optional(),
    }),
  }),
});

const rawConfig = {
  env: process.env.CHOCO_ENV,
  port: process.env.PORT,
  rootUrl: process.env.ROOT_URL,
  auth: {
    jwtSecret: process.env.JWT_SECRET,
    adminCookieName: process.env.ADMIN_COOKIE_NAME,
    adminJwtTtl: process.env.ADMIN_JWT_TTL,
  },
  choco: {
    baseUrl: process.env.CHOCO_BASE_URL,
    dashboardBaseUrl: process.env.CHOCO_DASHBOARD_BASE,
    jwt: process.env.CHOCO_JWT,
    captchaToken: process.env.CHOCO_CAPTCHA_TOKEN,
    requestTimeoutMs: process.env.CHOCO_TIMEOUT_MS ? Number(process.env.CHOCO_TIMEOUT_MS) : undefined,
  },
  llm: {
    provider: process.env.LLM_PROVIDER,
    model: process.env.LLM_MODEL,
    temperature: process.env.LLM_TEMPERATURE ? Number(process.env.LLM_TEMPERATURE) : undefined,
  },
  guidestar: {
    username: process.env.GUIDESTAR_USERNAME,
    password: process.env.GUIDESTAR_PASSWORD,
  },
  charityApiKey: process.env.CHARITY_API_KEY,
  email: {
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    techSupportEmail: process.env.TECH_SUPPORT_EMAIL || 'uriel@facio.io',
    retryAttempts: process.env.EMAIL_RETRY_ATTEMPTS ? Number(process.env.EMAIL_RETRY_ATTEMPTS) : undefined,
    retryDelayMs: process.env.EMAIL_RETRY_DELAY ? Number(process.env.EMAIL_RETRY_DELAY) : undefined,
    mailgun: {
      apiKey: process.env.MAILGUN_API_KEY,
      domain: process.env.MAILGUN_DOMAIN,
      fromEmail: process.env.MAILGUN_FROM_EMAIL,
      webhookUrl: process.env.MAILGUN_WEBHOOK_URL,
    },
  },
};

const parsed = ConfigSchema.safeParse(rawConfig);

if (!parsed.success) {
  logger.error('Invalid configuration', parsed.error.format());
  throw new Error('Configuration validation failed');
}

// In non-dev environments, require these values explicitly.
if (parsed.data.env !== 'development') {
  const missing: string[] = [];
  if (!process.env.ROOT_URL) missing.push('ROOT_URL');
  if (!process.env.JWT_SECRET) missing.push('JWT_SECRET');
  if (!process.env.ADMIN_COOKIE_NAME) missing.push('ADMIN_COOKIE_NAME');
  if (!process.env.ADMIN_JWT_TTL) missing.push('ADMIN_JWT_TTL');
  if (missing.length) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }
}

// Warn if running dev with defaults (fine for local, not for production).
if (parsed.data.env === 'development') {
  if (!process.env.ROOT_URL) logger.warn(`ROOT_URL not set; using ${DEV_DEFAULTS.ROOT_URL}`);
  if (!process.env.JWT_SECRET) logger.warn('JWT_SECRET not set; using a dev default (do not use in production)');
  if (!process.env.ADMIN_COOKIE_NAME) logger.warn(`ADMIN_COOKIE_NAME not set; using ${DEV_DEFAULTS.ADMIN_COOKIE_NAME}`);
  if (!process.env.ADMIN_JWT_TTL) logger.warn(`ADMIN_JWT_TTL not set; using ${DEV_DEFAULTS.ADMIN_JWT_TTL}`);
}

if (parsed.data.env === 'production' && parsed.data.choco.baseUrl.includes('sandbox')) {
  throw new Error('Production environment requires explicit CHOCO_BASE_URL');
}

export const config = parsed.data;
export type AppConfig = typeof config;
