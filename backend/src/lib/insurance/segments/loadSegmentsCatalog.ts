import { prisma } from '../../../core';
import { logger } from '../../../utils/logger';
import { SegmentsCatalogProd } from './types';
import fs from 'node:fs';
import path from 'node:path';

const log = logger.child('SegmentsCatalog');
const OVERRIDE_MEMORY_KEY = 'segmentsCatalog.prod.override';

type SegmentsCatalogOverrideRecord = {
  deleted?: boolean;
  catalog?: SegmentsCatalogProd;
  meta?: {
    notes?: string;
    updatedBy?: string;
  };
};

type SegmentsCatalogEffectiveSource = {
  // Back-compat: previously could fall back to file. Now DB is the only source-of-truth.
  source: 'db' | 'file';
  overrideUpdatedAt?: string;
  overrideMeta?: SegmentsCatalogOverrideRecord['meta'] | null;
};

let cachedProdOverride: SegmentsCatalogProd | null = null;
let cachedProdOverrideUpdatedAt: Date | null = null;
let cachedProdOverrideMeta: SegmentsCatalogOverrideRecord['meta'] | null = null;

function loadSegmentsCatalogProdFromRepoFile(): SegmentsCatalogProd | null {
  try {
    const p = path.resolve(__dirname, '../../../docs/Choco_Segments_Catalog.PROD.json');
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return sanitizeSegmentsCatalogProd(parsed);
  } catch {
    return null;
  }
}

function sanitizeSegmentsCatalogProd(catalog: any): SegmentsCatalogProd {
  if (!catalog || typeof catalog !== 'object') return catalog as SegmentsCatalogProd;

  // Packages are removed from the catalog model; strip legacy data if present.
  if ('packages' in catalog) delete catalog.packages;

  const normalizeDupKey = (s: string): string => String(s || '')
    .toLowerCase()
    .replace(/[״"'`’]/g, '')
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const uniqStringList = (values: unknown[], max = 220): string[] => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const v of values) {
      const raw = String(v ?? '').trim();
      if (!raw) continue;
      const key = normalizeDupKey(raw);
      if (!key) continue;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(raw);
      if (out.length >= max) break;
    }
    return out;
  };

  // Sanitize / migrate coverage keys.
  if (Array.isArray(catalog.segments)) {
    for (const seg of catalog.segments) {
      if (!seg || typeof seg !== 'object') continue;
      const cov = (seg as any).coverages;
      if (!cov || typeof cov !== 'object') continue;

      // Removed: bundled elsewhere (3rd party / employers liability).
      delete cov.legal_expenses;

      // Split legacy "contents" into "contents" + "stock" (default both together).
      if (typeof cov.contents === 'boolean' && typeof cov.stock !== 'boolean') cov.stock = cov.contents;
      if (typeof cov.stock === 'boolean' && typeof cov.contents !== 'boolean') cov.contents = cov.stock;
    }
  }

  if (Array.isArray(catalog.segments)) {
    for (const seg of catalog.segments) {
      if (!seg || typeof seg !== 'object') continue;
      const raw = (seg as any).keywords;
      if (raw === undefined || raw === null) continue;
      const arr = ((): string[] => {
        if (Array.isArray(raw)) return raw.map((x) => String(x ?? '').trim());
        if (typeof raw === 'string') return raw.split(/\r?\n|,|!/g).map((x) => String(x ?? '').trim());
        return [];
      })().filter(Boolean);
      if (!arr.length) {
        delete (seg as any).keywords;
        continue;
      }
      (seg as any).keywords = uniqStringList(arr, 220);
    }
  }

  // Duplicate handling was previously done here (auto-marking `duplicate_of` and merging data).
  // It was intended as a one-time migration. It is now DISABLED to keep DB as the single source-of-truth
  // and to prevent "surprising" changes on every load.

  return catalog as SegmentsCatalogProd;
}

/**
 * Cached accessor. Safe to call frequently from tools.
 */
export function getSegmentsCatalogProd(): SegmentsCatalogProd {
  if (cachedProdOverride) return cachedProdOverride;
  // Dev-safety fallback: allow local/dev to work before DB seeding.
  const allowFileFallback = String(process.env.SEGMENTS_CATALOG_ALLOW_FILE_FALLBACK ?? '').toLowerCase() === 'true'
    || String(process.env.NODE_ENV || '').toLowerCase() !== 'production';
  if (allowFileFallback) {
    const fileCatalog = loadSegmentsCatalogProdFromRepoFile();
    if (fileCatalog) {
      setSegmentsCatalogProdOverride(fileCatalog, { updatedAt: new Date(), meta: { notes: 'repo-file fallback' } });
      // setSegmentsCatalogProdOverride() sets cachedProdOverride synchronously, but TS cannot narrow across the call.
      return cachedProdOverride!;
    }
  }
  throw new Error(
    'Segments catalog is not initialized in DB. ' +
    `Expected a row in Postgres (table "memories") with key="${OVERRIDE_MEMORY_KEY}". ` +
    'Seed it via PUT /api/v1/segments-catalog/prod (admin UI) before using segment resolution.',
  );
}

export function getSegmentsCatalogProdEffectiveSource(): SegmentsCatalogEffectiveSource {
  if (cachedProdOverride) {
    return {
      source: 'db',
      overrideUpdatedAt: cachedProdOverrideUpdatedAt?.toISOString(),
      overrideMeta: cachedProdOverrideMeta ?? null,
    };
  }
  return { source: 'db', overrideMeta: null };
}

export function setSegmentsCatalogProdOverride(
  catalog: SegmentsCatalogProd,
  options?: { updatedAt?: Date; meta?: SegmentsCatalogOverrideRecord['meta'] | null },
): void {
  cachedProdOverride = sanitizeSegmentsCatalogProd(catalog as any);
  cachedProdOverrideUpdatedAt = options?.updatedAt ?? new Date();
  cachedProdOverrideMeta = options?.meta ?? null;
  log.info('Segments catalog override applied in-memory', {
    updatedAt: cachedProdOverrideUpdatedAt.toISOString(),
  });
}

export function clearSegmentsCatalogProdOverride(): void {
  cachedProdOverride = null;
  cachedProdOverrideUpdatedAt = null;
  cachedProdOverrideMeta = null;
  log.info('Segments catalog override cleared in-memory');
}

export async function initSegmentsCatalogProdOverrideCache(): Promise<void> {
  try {
    const row = await prisma.memory.findFirst({
      where: { key: OVERRIDE_MEMORY_KEY },
      orderBy: { createdAt: 'desc' },
    });
    if (!row) {
      // DB is the only source-of-truth. If missing, we keep the cache empty and require seeding via API.
      clearSegmentsCatalogProdOverride();
      log.error('Segments catalog not found in DB. Seed it via PUT /api/v1/segments-catalog/prod', {
        key: OVERRIDE_MEMORY_KEY,
      });
      return;
    }

    const value = (row as any).value as unknown;
    const record = (value && typeof value === 'object') ? (value as SegmentsCatalogOverrideRecord) : null;

    if (!record || record.deleted) {
      clearSegmentsCatalogProdOverride();
      return;
    }

    if (!record.catalog || typeof record.catalog !== 'object') {
      log.warn('Segments catalog override row missing catalog; ignoring', { id: (row as any).id });
      clearSegmentsCatalogProdOverride();
      return;
    }

    setSegmentsCatalogProdOverride(record.catalog, { updatedAt: row.createdAt, meta: record.meta ?? null });
  } catch (err) {
    // DB is the only source-of-truth. If init fails, keep cache empty.
    log.error('Failed to init segments catalog override cache from DB', {
      error: err instanceof Error ? err.message : String(err),
    });
    clearSegmentsCatalogProdOverride();
  }
}

export async function persistSegmentsCatalogProdOverride(params: {
  catalog: SegmentsCatalogProd;
  meta?: SegmentsCatalogOverrideRecord['meta'];
}): Promise<{ createdAt: Date }> {
  sanitizeSegmentsCatalogProd(params.catalog as any);
  const created = await prisma.memory.create({
    data: {
      scope: 'system',
      key: OVERRIDE_MEMORY_KEY,
      value: {
        catalog: params.catalog,
        meta: params.meta || {},
      } as any,
    },
    select: { createdAt: true },
  });
  setSegmentsCatalogProdOverride(params.catalog, { updatedAt: created.createdAt, meta: params.meta ?? null });
  return created;
}

export async function persistSegmentsCatalogProdOverrideTombstone(params?: {
  meta?: SegmentsCatalogOverrideRecord['meta'];
}): Promise<{ createdAt: Date }> {
  const created = await prisma.memory.create({
    data: {
      scope: 'system',
      key: OVERRIDE_MEMORY_KEY,
      value: {
        deleted: true,
        meta: params?.meta || {},
      } as any,
    },
    select: { createdAt: true },
  });
  clearSegmentsCatalogProdOverride();
  return created;
}
