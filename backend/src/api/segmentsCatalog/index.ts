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

const SegmentsCatalogProdSchema = z.object({
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
  insurance_products: z.array(z.any()).optional(),
  segment_groups: z.array(z.any()),
  segments: z.array(z.any()),
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
  } catch (error: any) {
    const msg = String(error?.message || '');
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

    const body = { ...(req.body || {}) } as any;
    delete body.__meta;
    delete body.packages; // packages are deprecated/removed
    // Sanitize removed coverages keys (if older overrides still include them)
    if (Array.isArray(body.segments)) {
      for (const s of body.segments) {
        if (s?.coverages && typeof s.coverages === 'object') {
          delete s.coverages.legal_expenses;
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
      const updatedBy = typeof (req as any)?.admin?.username === 'string' ? (req as any).admin.username : undefined;
      return { ...(notes ? { notes } : {}), ...(updatedBy ? { updatedBy } : {}) };
    })();

    const { createdAt } = await persistSegmentsCatalogProdOverride({
      catalog: parsed.data as any,
      meta,
    });

    res.json({ ok: true, overrideUpdatedAt: createdAt.toISOString() });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to save segments catalog', message: error?.message });
  }
}, { protected: true });

registerRoute('delete', '/api/v1/segments-catalog/prod', async (req, res) => {
  try {
    const updatedBy = typeof (req as any)?.admin?.username === 'string' ? (req as any).admin.username : undefined;
    // DB-only mode: clearing means tombstoning the DB record.
    const { createdAt } = await persistSegmentsCatalogProdOverrideTombstone({
      meta: updatedBy ? { updatedBy, notes: 'Cleared segments catalog (tombstone)' } : { notes: 'Cleared segments catalog (tombstone)' },
    });
    res.json({ ok: true, overrideUpdatedAt: createdAt.toISOString() });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to clear segments catalog override', message: error?.message });
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
    const updatedBy = typeof (req as any)?.admin?.username === 'string' ? (req as any).admin.username : undefined;

    await importChocoProductsSegmentListCsvToDb();
    const latest = await getLatestChocoProductsSegmentListFromDb();
    const base = getSegmentsCatalogProd();

    const enriched = enrichSegmentsCatalog({
      baseCatalog: base,
      chocoProducts: latest?.rows || [],
    });

    const { createdAt } = await persistSegmentsCatalogProdOverride({
      catalog: enriched.catalog as any,
      meta: updatedBy ? { updatedBy, notes: 'Enriched from choco products CSV' } : { notes: 'Enriched from choco products CSV' },
    });

    res.json({
      ok: true,
      overrideUpdatedAt: createdAt.toISOString(),
      stats: enriched.stats,
    });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to enrich segments catalog', message: error?.message });
  }
}, { protected: true });

// Utility endpoint: refresh in-process cache from DB (useful during dev)
registerRoute('post', '/api/v1/segments-catalog/prod/reload', async (_req, res) => {
  try {
    await initSegmentsCatalogProdOverrideCache();
    res.json({ ok: true, ...getSegmentsCatalogProdEffectiveSource() });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to reload segments catalog override', message: error?.message });
  }
}, { protected: true });
