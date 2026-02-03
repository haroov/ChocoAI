import 'dotenv/config';
import { z } from 'zod';
import { logger } from '../utils/logger';

const EnvironmentEnum = z.enum(['development', 'staging', 'production', 'test']);

const ConfigSchema = z.object({
  env: EnvironmentEnum.default('development'),
  port: z.coerce.number().default(8080),
  rootUrl: z.string().url(),
  auth: z.object({
    jwtSecret: z.string(),
    adminCookieName: z.string(),
    adminJwtTtl: z.string(),
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

if (parsed.data.env === 'production' && parsed.data.choco.baseUrl.includes('sandbox')) {
  throw new Error('Production environment requires explicit CHOCO_BASE_URL');
}

export const config = parsed.data;
export type AppConfig = typeof config;
