declare global {
  namespace NodeJS {
    interface ProcessEnv {
      JWT_SECRET: string;
      DATABASE_URL: string;
      OPENAI_API_KEY: string;
      LLM_PROVIDER: string;
      CHOCO_ENV: 'development' | 'staging' | 'production' | 'test';
      CHOCO_BASE_URL: string;
      CHOCO_DASHBOARD_BASE: string;
      CHOCO_CAPTCHA_TOKEN: string;
      CHOCO_JWT: string;
      CHOCO_TIMEOUT_MS: string;
      PORT: string;
      HOST: string;
      NODE_ENV: 'development' | 'staging' | 'production' | 'test';
      ROOT_URL: string;
      TWILIO_ACCOUNT_SID: string;
      TWILIO_AUTH_TOKEN: string;
      TWILIO_WHATSAPP_NUMBER: string;
      ADMIN_COOKIE_NAME: string;
      ADMIN_JWT_TTL: string;
      GUIDESTAR_USERNAME: string;
      GUIDESTAR_PASSWORD: string;
      MAILGUN_API_KEY: string;
      MAILGUN_DOMAIN: string;
      MAILGUN_FROM_EMAIL: string;
      MAILGUN_WEBHOOK_URL: string;
      EMAIL_RETRY_ATTEMPTS: string;
      EMAIL_RETRY_DELAY: string;
    }
  }
}

export { };
