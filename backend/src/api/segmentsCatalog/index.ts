import { registerRoute } from '../../utils/routesRegistry';
import { z } from 'zod';
import {
  getSegmentsCatalogProd,
  getSegmentsCatalogProdEffectiveSource,
  initSegmentsCatalogProdOverrideCache,
  persistSegmentsCatalogProdOverride,
  persistSegmentsCatalogProdOverrideTombstone,
} from '../../lib/insurance/segments/loadSegmentsCatalog';
import { getLatestChocoProductsSegmentListFromDb, importChocoProductsSegmentListCsvToDb } from '../../lib/chocoProducts/importChocoProductsSegmentListCsv';
import { enrichSegmentsCatalog } from '../../lib/insurance/segments/enrichSegmentsCatalog';
import type { JsonObject } from '../../utils/json';
import { asJsonObject } from '../../utils/json';
import { JsonValueSchema } from '../../utils/zodJson';
import type { SegmentsCatalogInsuranceProduct, SegmentsCatalogProd } from '../../lib/insurance/segments/types';

const SegmentsCatalogInsuranceProductSchema: z.ZodType<SegmentsCatalogInsuranceProduct> = z.object({
  product_key: z.string().min(1),
  product_name_he: z.string().optional(),
  insurer_code: z.string().optional(),
  channel: z.string().optional(),
  notes_he: z.string().optional(),
}).passthrough();

const SegmentsCatalogSegmentGroupSchema = z.object({
  group_id: z.string().min(1),
  group_name_he: z.string().optional(),
  default_package_key: z.string().optional(),
  default_site_type_he: z.string().optional(),
}).passthrough();

const SegmentsCatalogSegmentSchema = z.object({
  segment_id: z.string().min(1),
  segment_group_id: z.string().min(1),
  segment_name_he: z.string().optional(),
  keywords: z.array(z.string()).optional(),
  choco_product_slugs: z.array(z.string()).optional(),
  coverages: z.record(z.boolean()).optional(),
  default_package_key: z.string().optional(),
  business_profile_defaults: z.record(JsonValueSchema).optional(),
}).passthrough();

const SegmentsCatalogProdSchema: z.ZodType<SegmentsCatalogProd> = z.object({
  catalog_id: z.string().min(1),
  catalog_version: z.string().min(1),
  environment: z.string().min(1),
  generated_at_iso: z.string().optional(),
  locale: z.string().optional(),
  currency: z.string().optional(),
  insurer: z.object({
    insurer_code: z.string().optional(),
    insurer_name_he: z.string().optional(),
  }).optional(),
  insurance_products: z.array(SegmentsCatalogInsuranceProductSchema).optional(),
  segment_groups: z.array(SegmentsCatalogSegmentGroupSchema),
  segments: z.array(SegmentsCatalogSegmentSchema),
}).passthrough();

registerRoute('get', '/api/v1/segments-catalog/prod', async (_req, res) => {
  try {
    const sourceInfo = getSegmentsCatalogProdEffectiveSource();
    const catalog = getSegmentsCatalogProd();

    res.json({
      ok: true,
      catalog,
      ...sourceInfo,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isMissing = /not initialized in db/i.test(msg) || /not found in db/i.test(msg);
    res.status(isMissing ? 404 : 500).json({ ok: false, error: 'Failed to get segments catalog', message: msg });
  }
}, { protected: true });

registerRoute('put', '/api/v1/segments-catalog/prod', async (req, res) => {
  try {
    // Prevent accidental overwrites from stale tabs / concurrent editors.
    // Client may send __meta.baseOverrideUpdatedAt from the last GET response.
    const baseOverrideUpdatedAt = typeof req.body?.__meta?.baseOverrideUpdatedAt === 'string'
      ? String(req.body.__meta.baseOverrideUpdatedAt).trim()
      : '';
    if (baseOverrideUpdatedAt) {
      const cur = getSegmentsCatalogProdEffectiveSource();
      const curUpdatedAt = String(cur.overrideUpdatedAt || '').trim();
      if (curUpdatedAt && curUpdatedAt !== baseOverrideUpdatedAt) {
        return res.status(409).json({
          ok: false,
          error: 'Conflict',
          message: 'Segments catalog was updated by someone else. Please reload and try again.',
          currentOverrideUpdatedAt: curUpdatedAt,
        });
      }
    }

    const body = { ...(req.body || {}) } as JsonObject;
    delete body.__meta;
    delete body.packages; // packages are deprecated/removed
    // Sanitize removed coverages keys (if older overrides still include them)
    {
      const segmentsVal = (body as Record<string, unknown>).segments;
      if (Array.isArray(segmentsVal)) {
        for (const seg of segmentsVal) {
          const s = asJsonObject(seg);
          if (!s) continue;
          const cov = asJsonObject((s as Record<string, unknown>).coverages);
          if (!cov) continue;
          delete (cov as Record<string, unknown>)['legal_expenses'];
        }
      }
    }

    const parsed = SegmentsCatalogProdSchema.safeParse(body);
    if (!parsed.success) {
      return res.status(422).json({
        ok: false,
        error: 'Validation failed',
        details: parsed.error.errors.map((e) => `${e.path.join('.')}: ${e.message}`),
      });
    }

    const meta = (() => {
      const notes = typeof req.body?.__meta?.notes === 'string' ? req.body.__meta.notes.trim() : undefined;
      const updatedBy = req.admin?.username;
      return { ...(notes ? { notes } : {}), ...(updatedBy ? { updatedBy } : {}) };
    })();

    const { createdAt } = await persistSegmentsCatalogProdOverride({
      catalog: parsed.data,
      meta,
    });

    res.json({ ok: true, overrideUpdatedAt: createdAt.toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to save segments catalog', message: error instanceof Error ? error.message : String(error) });
  }
}, { protected: true });

registerRoute('delete', '/api/v1/segments-catalog/prod', async (req, res) => {
  try {
    const updatedBy = req.admin?.username;
    // DB-only mode: clearing means tombstoning the DB record.
    const { createdAt } = await persistSegmentsCatalogProdOverrideTombstone({
      meta: updatedBy ? { updatedBy, notes: 'Cleared segments catalog (tombstone)' } : { notes: 'Cleared segments catalog (tombstone)' },
    });
    res.json({ ok: true, overrideUpdatedAt: createdAt.toISOString() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to clear segments catalog override', message: error instanceof Error ? error.message : String(error) });
  }
}, { protected: true });

/**
 * Utility endpoint: import Choco products CSV + enrich segments catalog.
 * - Reads `backend/docs/choco products - segement_list.csv`
 * - Stores parsed rows in DB (Memory)
 * - Enriches the current DB catalog with per-segment coverages and product slugs
 * - Persists a DB override WITHOUT packages (DB-only source-of-truth)
 */
registerRoute('post', '/api/v1/segments-catalog/prod/enrich', async (req, res) => {
  try {
    const updatedBy = req.admin?.username;

    await importChocoProductsSegmentListCsvToDb();
    const latest = await getLatestChocoProductsSegmentListFromDb();
    const base = getSegmentsCatalogProd();

    const enriched = enrichSegmentsCatalog({
      baseCatalog: base,
      chocoProducts: latest?.rows || [],
    });

    const { createdAt } = await persistSegmentsCatalogProdOverride({
      catalog: enriched.catalog,
      meta: updatedBy ? { updatedBy, notes: 'Enriched from choco products CSV' } : { notes: 'Enriched from choco products CSV' },
    });

    res.json({
      ok: true,
      overrideUpdatedAt: createdAt.toISOString(),
      stats: enriched.stats,
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to enrich segments catalog', message: error instanceof Error ? error.message : String(error) });
  }
}, { protected: true });

// Utility endpoint: refresh in-process cache from DB (useful during dev)
registerRoute('post', '/api/v1/segments-catalog/prod/reload', async (_req, res) => {
  try {
    await initSegmentsCatalogProdOverrideCache();
    res.json({ ok: true, ...getSegmentsCatalogProdEffectiveSource() });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Failed to reload segments catalog override', message: error instanceof Error ? error.message : String(error) });
  }
}, { protected: true });
