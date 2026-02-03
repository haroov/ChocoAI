/* eslint-disable no-console */
/**
 * Settings API
 * Tune speed & reliability without redeploys
 */

import { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../core';
import { DEFAULT_PROJECT_CONFIG, getProjectConfig } from '../../utils/getProjectConfig';
import { getRegisteredTools } from '../../lib/flowEngine/tools';

// ============================================================================
// Types & Schemas
// ============================================================================

const ModelsSchema = z.object({
  primary: z.string().min(1),
  fallback: z.string().min(1),
  timeoutMs: z.number().min(1000).max(20000),
  retries: z.number().min(0).max(3),
  stream: z.boolean(),
});

const FlowSchema = z.object({
  retry: z.object({
    tries: z.number().min(0).max(5),
    baseDelayMs: z.number().min(100).max(60000),
  }),
  schemaPath: z.string().optional(),
  useJsonSchema: z.boolean().default(false),
});

const FeaturesSchema = z.object({
  newRunner: z.boolean(),
  parallelSteps: z.boolean(),
  mockMode: z.boolean(),
  useFallbackForLongForm: z.boolean(),
  stepSleep: z.boolean(),
  stepBranch: z.boolean(),
  qaDashboard: z.boolean().default(false),
});

const SettingsPatchSchema = z.object({
  models: ModelsSchema.partial().optional(),
  flow: FlowSchema.partial().optional(),
  features: FeaturesSchema.partial().optional(),
});

type SettingsData = {
  id?: string;
  updatedAt?: Date;
  models: z.infer<typeof ModelsSchema>;
  flow: z.infer<typeof FlowSchema>;
  features: z.infer<typeof FeaturesSchema>;
};

type SettingsVersionData = {
  id: string;
  version: number;
  notes: string | null;
  createdAt: Date;
  createdBy: string | null;
  models: z.infer<typeof ModelsSchema>;
  flow: z.infer<typeof FlowSchema>;
  features: z.infer<typeof FeaturesSchema>;
};

// ============================================================================
// Defaults (DB > ENV > DEFAULTS precedence)
// ============================================================================

const DEFAULT_SETTINGS: SettingsData = {
  models: {
    primary: 'gpt-5.2',
    fallback: 'gpt-4o',
    timeoutMs: 8000,
    retries: 2,
    stream: true,
  },
  flow: {
    retry: {
      tries: 3,
      baseDelayMs: 1000,
    },
    schemaPath: 'src/schemas/flow-schema.json',
    useJsonSchema: false,
  },
  features: {
    newRunner: false,
    parallelSteps: false,
    mockMode: false,
    useFallbackForLongForm: false,
    stepSleep: false,
    stepBranch: false,
    qaDashboard: true,
  },
};

// ============================================================================
// Settings Repository
// ============================================================================

class SettingsRepository {
  private cache: { data: SettingsData | null; timestamp: number } = {
    data: null,
    timestamp: 0,
  };
  private readonly CACHE_TTL = 10000; // 10 seconds

  async getGlobal(): Promise<SettingsData | null> {
    try {
      const settings = await prisma.settings.findUnique({
        where: { id: 'global' },
        include: { currentVersion: true },
      });
      return settings?.currentVersion
        ? {
          id: settings.id,
          updatedAt: settings.updatedAt,
          models: settings.currentVersion.models as any,
          flow: settings.currentVersion.flow as any,
          features: settings.currentVersion.features as any,
        }
        : null;
    } catch (error) {
      console.error('Error getting settings:', error);
      return null;
    }
  }

  async upsertMerge(
    patch: Partial<SettingsData>,
    notes?: string,
  ): Promise<SettingsData> {
    const existing = await this.getGlobal();
    const merged = this.deepMerge(existing || DEFAULT_SETTINGS, patch);

    // Create a new version
    const newVersion = await prisma.settingsVersion.create({
      data: {
        settingsId: 'global',
        version: await this.getNextVersionNumber(),
        models: merged.models,
        flow: merged.flow,
        features: merged.features,
        notes: notes || 'Settings updated',
        createdBy: 'system', // TODO: Add user context
      },
    });

    // Update the settings to point to the new version
    const result = await prisma.settings.upsert({
      where: { id: 'global' },
      update: {
        currentVersionId: newVersion.id,
        updatedAt: new Date(),
      },
      create: {
        id: 'global',
        currentVersionId: newVersion.id,
      },
    });

    // Clear cache
    this.cache = { data: null, timestamp: 0 };

    return {
      id: result.id,
      updatedAt: result.updatedAt,
      models: newVersion.models as any,
      flow: newVersion.flow as any,
      features: newVersion.features as any,
    };
  }

  private async getNextVersionNumber(): Promise<number> {
    const latestVersion = await prisma.settingsVersion.findFirst({
      where: { settingsId: 'global' },
      orderBy: { version: 'desc' },
    });
    return (latestVersion?.version || 0) + 1;
  }

  async getVersionHistory(): Promise<SettingsVersionData[]> {
    try {
      const versions = await prisma.settingsVersion.findMany({
        where: { settingsId: 'global' },
        orderBy: { version: 'desc' },
      });
      return versions.map((v: any) => ({
        id: v.id,
        version: v.version,
        notes: v.notes,
        createdAt: v.createdAt,
        createdBy: v.createdBy,
        models: v.models as any,
        flow: v.flow as any,
        features: v.features as any,
      }));
    } catch (error) {
      console.error('Error getting version history:', error);
      return [];
    }
  }

  async revertToVersion(
    versionId: string,
    notes?: string,
  ): Promise<SettingsData> {
    try {
      const targetVersion = await prisma.settingsVersion.findUnique({
        where: { id: versionId },
      });

      if (!targetVersion) {
        throw new Error('Version not found');
      }

      // Create a new version with the reverted data
      const revertedVersion = await prisma.settingsVersion.create({
        data: {
          settingsId: 'global',
          version: await this.getNextVersionNumber(),
          models: targetVersion.models as any,
          flow: targetVersion.flow as any,
          features: targetVersion.features as any,
          notes: notes || `Reverted to version ${targetVersion.version}`,
          createdBy: 'system', // TODO: Add user context
        },
      });

      // Update the settings to point to the reverted version
      const result = await prisma.settings.update({
        where: { id: 'global' },
        data: {
          currentVersionId: revertedVersion.id,
          updatedAt: new Date(),
        },
      });

      // Clear cache
      this.cache = { data: null, timestamp: 0 };

      return {
        id: result.id,
        updatedAt: result.updatedAt,
        models: revertedVersion.models as any,
        flow: revertedVersion.flow as any,
        features: revertedVersion.features as any,
      };
    } catch (error) {
      console.error('Error reverting to version:', error);
      throw error;
    }
  }

  private deepMerge(target: any, source: any): any {
    const result = { ...target };
    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === 'object' &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(target[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }

  getCached(): SettingsData | null {
    const now = Date.now();
    if (this.cache.data && now - this.cache.timestamp < this.CACHE_TTL) {
      return this.cache.data;
    }
    return null;
  }

  setCache(data: SettingsData): void {
    this.cache = { data, timestamp: Date.now() };
  }
}

const settingsRepo = new SettingsRepository();

// Export for use in other modules
export { settingsRepo as settingsService };

// ============================================================================
// Effective Config Builder
// ============================================================================

function buildEffectiveConfig(dbSettings: SettingsData | null): SettingsData {
  const effective = { ...DEFAULT_SETTINGS };

  if (dbSettings) {
    // Deep merge DB settings over defaults
    effective.models = { ...effective.models, ...dbSettings.models };
    effective.flow = { ...effective.flow, ...dbSettings.flow };
    effective.features = { ...effective.features, ...dbSettings.features };
  }

  return effective;
}

// ============================================================================
// Validation
// ============================================================================

function validateSettingsPatch(
  body: any,
): { success: true; data: any } | { success: false; errors: string[] } {
  try {
    const result = SettingsPatchSchema.safeParse(body);
    if (result.success) {
      return { success: true, data: result.data };
    }
    const errors = result.error.errors.map(
      (err) => `${err.path.join('.')}: ${err.message}`,
    );
    return { success: false, errors };

  } catch (error) {
    return { success: false, errors: ['Invalid request format'] };
  }
}

// ============================================================================
// Health Service
// ============================================================================

async function getHealthStatus() {
  try {
    const response = await fetch('http://localhost:8080/health');
    const data = await response.json();

    return {
      openai: { status: data.services?.llm === 'connected' ? 'live' : 'down' },
      choco: { status: data.choco === 'ready' ? 'live' : 'down' },
    };
  } catch (error) {
    return {
      openai: { status: 'unknown' },
      choco: { status: 'unknown' },
    };
  }
}

// ============================================================================
// API Handlers
// ============================================================================

export async function getSettings(_req: Request, res: Response): Promise<void> {
  try {
    // Check cache first
    let settings = settingsRepo.getCached();

    if (!settings) {
      const dbSettings = await settingsRepo.getGlobal();
      settings = buildEffectiveConfig(dbSettings);
      settingsRepo.setCache(settings);
    }

    const connectivity = await getHealthStatus();

    res.json({
      ...settings,
      connectivity,
    });
  } catch (error: any) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      error: 'Failed to get settings',
      message: error.message,
    });
  }
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  try {
    const validation = validateSettingsPatch(req.body);

    if (!validation.success) {
      res.status(422).json({
        error: 'Validation failed',
        errors: validation.errors,
      });
      return;
    }

    await prisma.projectConfig.upsert({
      where: { id: 1 },
      update: req.body,
      create: {
        ...DEFAULT_PROJECT_CONFIG,
        ...req.body,
        id: 1,
      },
    });

    res.json({ success: true });
    // const updated = await settingsRepo.upsertMerge(validation.data);
    // const effective = buildEffectiveConfig(updated);
    // settingsRepo.setCache(effective);
    //
    // const connectivity = await getHealthStatus();
    //
    // res.json({
    //   ...effective,
    //   connectivity,
    // });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      error: 'Failed to update settings',
      message: error.message,
    });
  }
}

export async function getProjectSettings(_req: Request, res: Response): Promise<void> {
  try {
    const config = await getProjectConfig();

    res.json({
      ok: true,
      config,
    });
  } catch (error: any) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to get settings',
      message: error.message,
    });
  }
}

export async function updateProjectSettings(req: Request, res: Response): Promise<void> {
  try {
    const updates = req.body;

    // Whitelist allowed fields
    const allowedFields = [
      'llmProvider',
      'llmModel',
      'temperature',
      'systemPrompt',
      'backendMode',
      'chocoBaseUrl',
      'chocoApiKey',
      'rateLimitRps',
      'features',
    ];

    const filteredUpdates = Object.keys(updates)
      .filter((key) => allowedFields.includes(key))
      .reduce((obj, key) => {
        obj[key] = updates[key];
        return obj;
      }, {} as any);

    const config = await prisma.projectConfig.upsert({
      where: { id: 1 },
      update: updates,
      create: { ...DEFAULT_PROJECT_CONFIG, ...updates },
    });

    res.json({
      ok: true,
      config,
    });
  } catch (error: any) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      ok: false,
      error: 'Failed to update settings',
      message: error.message,
    });
  }
}

export async function getToolsList(_req: Request, res: Response): Promise<void> {
  try {
    const tools = getRegisteredTools();
    res.json({ ok: true, tools });
  } catch (error: any) {
    console.error('Error getting tools:', error);
    res.status(500).json({ ok: false, error: 'Failed to get tools', message: error?.message || 'Unknown error' });
  }
}
