/**
 * Simple Environment-based Secrets Provider
 *
 * Centralized secret management using environment variables.
 *
 * Usage:
 *   const openaiKey = await Secrets.get('OPENAI_API_KEY');
 *   const requiredKey = await Secrets.getRequired('DATABASE_URL');
 */

/**
 * Secrets Provider Interface
 */
interface SecretsProvider {
  get(key: string): Promise<string | undefined>;
  list(): Promise<string[]>;
}

/**
 * Environment-based secrets provider
 */
class EnvSecretsProvider implements SecretsProvider {
  async get(key: string): Promise<string | undefined> {
    return process.env[key];
  }

  async list(): Promise<string[]> {
    return Object.keys(process.env).filter((key) =>
      key.includes('KEY') || key.includes('JWT') || key.includes('TOKEN') || key.includes('SECRET'),
    );
  }
}

/**
 * Secrets manager
 */
class SecretsManager {
  private provider: SecretsProvider;

  constructor() {
    this.provider = new EnvSecretsProvider();
  }

  async get(key: string): Promise<string | undefined> {
    return this.provider.get(key);
  }

  async getRequired(key: string): Promise<string> {
    const value = await this.get(key);
    if (!value) {
      throw new Error(`Required secret not found: ${key}`);
    }
    return value;
  }

  async list(): Promise<string[]> {
    return this.provider.list();
  }

  // Convenience methods for common secrets
  async getOpenAIKey(): Promise<string | undefined> {
    return this.get('OPENAI_API_KEY');
  }

  async getChocoJwt(): Promise<string | undefined> {
    return this.get('CHOCO_JWT');
  }

  async getDatabaseUrl(): Promise<string | undefined> {
    return this.get('DATABASE_URL');
  }

  // Health check for secrets
  async healthCheck(): Promise<{ provider: string; keys: Record<string, boolean> }> {
    const provider = 'env';
    const keys = {
      openai: !!(await this.getOpenAIKey()),
      choco: !!(await this.getChocoJwt()),
      database: !!(await this.getDatabaseUrl()),
    };
    return { provider, keys };
  }

  // Assert required secrets are present (fail-fast in prod)
  async assert(requiredKeys: string[]): Promise<void> {
    const missing: string[] = [];
    for (const key of requiredKeys) {
      if (!(await this.get(key))) {
        missing.push(key);
      }
    }
    if (missing.length > 0) {
      throw new Error(`Required secrets missing: ${missing.join(', ')}`);
    }
  }
}

// Singleton instance
const secretsManager = new SecretsManager();

// Export convenience functions
export const Secrets = {
  get: (key: string) => secretsManager.get(key),
  getRequired: (key: string) => secretsManager.getRequired(key),
  list: () => secretsManager.list(),

  // Convenience methods
  getOpenAIKey: () => secretsManager.getOpenAIKey(),
  getChocoJwt: () => secretsManager.getChocoJwt(),
  getDatabaseUrl: () => secretsManager.getDatabaseUrl(),

  // Health and validation
  healthCheck: () => secretsManager.healthCheck(),
  assert: (keys: string[]) => secretsManager.assert(keys),
};
