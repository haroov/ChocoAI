import { prisma } from '../prisma';
import * as builtInFlows from '../../lib/flowEngine/builtInFlows';
import { validateFlowSchema } from '../../lib/flowEngine/schemas';
import { logger } from '../../utils/logger';

/**
 * Ensures built-in flows are seeded in the database.
 *
 * AUTOMATIC SYNC: This function now iterates over all exports in `builtInFlows/index.ts`.
 * To add a new flow, simply create the file and export it in `builtInFlows/index.ts`.
 * The system will automatically upsert it into the database on startup.
 */
export const ensureBuiltInFlows = async () => {
  // 1. Gather all schemas from the module exports
  // We look for objects that look like FlowSchemas (have slug, name, definition)
  const flowsToSync = Object.values(builtInFlows).filter((exportItem: any) => exportItem &&
      typeof exportItem === 'object' &&
      'slug' in exportItem &&
      'definition' in exportItem);

  logger.info(`[FlowSync] Found ${flowsToSync.length} built-in flows to sync.`);

  // Enforce a single defaultForNewUsers flow among built-ins to avoid ambiguous routing.
  // Preference order: welcome -> first encountered.
  const defaults = flowsToSync
    .map((s: any) => s as any)
    .filter((s) => s?.definition?.config?.defaultForNewUsers === true);
  if (defaults.length > 1) {
    const preferred = defaults.find((s) => s.slug === 'welcome') || defaults[0];
    logger.warn('[FlowSync] Multiple flows marked defaultForNewUsers; enforcing single default', {
      defaults: defaults.map((d) => d.slug),
      chosen: preferred.slug,
    });
    for (const s of flowsToSync as any[]) {
      if (s?.definition?.config && s.slug !== preferred.slug && s.definition.config.defaultForNewUsers === true) {
        s.definition.config.defaultForNewUsers = false;
      }
    }
  }

  // 2. Validate all flow schemas before saving
  for (const schema of flowsToSync) {
    const s = schema as any;
    const validation = validateFlowSchema(s);
    if (!validation.success) {
      logger.error(`Invalid flow schema for ${s.name} (${s.slug}):`, validation.error);
      throw new Error(`Invalid flow schema for ${s.name}: ${validation.error?.message}`);
    }
  }

  // 3. Register/Update all flows
  for (const schema of flowsToSync) {
    const s = schema as any;
    logger.info(`[FlowSync] Syncing flow: ${s.slug}`);

    await prisma.flow.upsert({
      where: { slug: s.slug },
      update: {
        name: s.name,
        slug: s.slug,
        version: s.version,
        description: s.description,
        definition: s.definition,
      },
      create: {
        name: s.name,
        slug: s.slug,
        version: s.version,
        description: s.description,
        definition: s.definition,
      },
    });
  }

  // Remove old flows (only if they have no messages referencing them)
  // First, set flowId to null for messages referencing old flows to avoid foreign key constraint
  const oldFlowSlugs: string[] = [];
  const oldFlows = await prisma.flow.findMany({
    where: { slug: { in: oldFlowSlugs } },
    select: { id: true },
  });

  if (oldFlows.length > 0) {
    const oldFlowIds = oldFlows.map((f) => f.id);
    // Set flowId to null for messages referencing old flows
    await prisma.message.updateMany({
      where: { flowId: { in: oldFlowIds } },
      data: { flowId: null },
    });
    // Now we can safely delete the old flows
    await prisma.flow.deleteMany({
      where: { id: { in: oldFlowIds } },
    });
  }
};
