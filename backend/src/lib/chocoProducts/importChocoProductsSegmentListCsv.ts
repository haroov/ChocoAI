import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'csv-parse/sync';
import { prisma } from '../../core';
import { logger } from '../../utils/logger';

const log = logger.child('ChocoProductsCSV');

export const CHOCO_PRODUCTS_SEGMENT_LIST_MEMORY_KEY = 'chocoProducts.segment_list.v1';

function firstExistingPath(candidates: string[], relativePaths: string[]): string | null {
  for (const base of candidates) {
    for (const rel of relativePaths) {
      const p = path.join(base, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function getRepoCandidates(): string[] {
  const cwd = process.cwd();
  return [
    cwd,
    path.join(cwd, '..'),
    path.join(cwd, '..', '..'),
  ];
}

export type ChocoProductSegmentListRow = {
  id: number;
  product_name?: string;
  insured?: string;
  slug_name?: string;
  is_active?: boolean;
  keywords_source?: string[];
  keywords?: string[];

  // Coverage booleans (subset)
  professional_indemnity_coverage?: boolean;
  medical_malpractice_coverage?: boolean;
  product_liability_coverage?: boolean;
  employers_liability_coverage?: boolean;
  third_party_liability_coverage?: boolean;
  commercial_dwelling_coverage?: boolean;
  commercial_content_coverage?: boolean;
  legal_expenses_coverage?: boolean;
};

function normalizeHeader(h: string): string {
  const norm = String(h ?? '')
    .replace(/\r/g, '')
    .replace(/\n/g, '_')
    .replace(/[:/\\]/g, '_')
    .replace(/[^\w]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
  // The CSV's first header cell is literally "," (quoted comma) → normalizes to empty.
  // Treat it as the row ID column (avoid colliding with any real "id" columns).
  return norm || 'row_id';
}

function coerceBoolean(v: unknown): boolean | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (['true', 't', 'yes', 'y', '1'].includes(s)) return true;
  if (['false', 'f', 'no', 'n', '0'].includes(s)) return false;
  // Google Sheets exports often use TRUE/FALSE without quotes
  if (s === 'true') return true;
  if (s === 'false') return false;
  return undefined;
}

function coerceNumber(v: unknown): number | undefined {
  const s = String(v ?? '').trim();
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function coerceStringArray(v: unknown): string[] | undefined {
  if (v === undefined || v === null) return undefined;
  if (Array.isArray(v)) {
    const arr = v.map((x) => String(x ?? '').trim()).filter(Boolean);
    return arr.length ? arr : undefined;
  }
  const s = String(v ?? '').trim();
  if (!s) return undefined;

  const parts = (s.includes('!') ? s.split('!') : (s.includes(',') ? s.split(',') : [s]))
    .map((x) => String(x ?? '').trim())
    .filter(Boolean);
  return parts.length ? parts : undefined;
}

function looksLikeTypeRow(rec: Record<string, unknown>): boolean {
  // The file includes a row of column types ("number", "boolean", "rich_text_raw", ...)
  // We'll detect by a few known tokens.
  const values = Object.values(rec).map((v) => String(v ?? '').trim().toLowerCase()).filter(Boolean);
  const tokens = new Set(values);
  return tokens.has('boolean') && tokens.has('number') && (tokens.has('rich_text_raw') || tokens.has('rich text'));
}

export function parseChocoProductsSegmentListCsv(params: { absolutePath: string }): ChocoProductSegmentListRow[] {
  const p = params.absolutePath;
  const raw = fs.readFileSync(p, 'utf8');

  const parsedRows = parse(raw, {
    bom: true,
    relax_quotes: true,
    relax_column_count: true,
    skip_empty_lines: true,
    trim: true,
  }) as unknown[][];

  const headerRow = Array.isArray(parsedRows[0]) ? (parsedRows[0] as string[]) : [];
  const normHeaders: string[] = [];
  const used = new Map<string, number>();
  for (const h of headerRow) {
    let key = normalizeHeader(String(h ?? ''));
    const n = (used.get(key) || 0) + 1;
    used.set(key, n);
    if (n > 1) key = `${key}_${n}`;
    normHeaders.push(key);
  }

  const records: Record<string, unknown>[] = [];
  for (let i = 1; i < parsedRows.length; i += 1) {
    const r = parsedRows[i];
    if (!Array.isArray(r)) continue;
    const rec: Record<string, unknown> = {};
    for (let c = 0; c < normHeaders.length; c += 1) {
      rec[normHeaders[c]] = r[c];
    }
    records.push(rec);
  }

  const filtered = records.filter((r) => !looksLikeTypeRow(r));

  const out: ChocoProductSegmentListRow[] = [];
  for (const r of filtered) {
    const id = coerceNumber((r as any).row_id ?? (r as any).number ?? (r as any).id ?? (r as any).idx);
    if (!id) continue;

    out.push({
      id,
      product_name: String((r as any).product_name ?? '').trim() || undefined,
      insured: String((r as any).insured ?? '').trim() || undefined,
      slug_name: String((r as any).slug_name ?? (r as any).slug_name_ ?? '').trim() || undefined,
      is_active: coerceBoolean((r as any).is_active),
      keywords_source: coerceStringArray((r as any).keywords_source),
      keywords: coerceStringArray((r as any).keywords),

      professional_indemnity_coverage: coerceBoolean((r as any).professional_indemnity_coverage),
      medical_malpractice_coverage: coerceBoolean((r as any).medical_malpractice_coverage),
      product_liability_coverage: coerceBoolean((r as any).product_liability_coverage),
      employers_liability_coverage: coerceBoolean((r as any).employers_liability_coverage),
      third_party_liability_coverage: coerceBoolean((r as any).third_party_liability_coverage),
      commercial_dwelling_coverage: coerceBoolean((r as any).commercial_dwelling_coverage),
      commercial_content_coverage: coerceBoolean((r as any).commercial_content_coverage),
      legal_expenses_coverage: coerceBoolean((r as any).legal_expenses_coverage),
    });
  }

  return out;
}

export async function importChocoProductsSegmentListCsvToDb(params?: { absolutePath?: string }) {
  const absolutePath = (() => {
    if (params?.absolutePath) return params.absolutePath;
    const candidates = getRepoCandidates();
    const p = firstExistingPath(candidates, [
      path.join('backend', 'docs', 'choco products - segement_list.csv'),
      path.join('docs', 'choco products - segement_list.csv'), // when cwd already in backend/
    ]);
    if (!p) throw new Error('CSV not found (expected backend/docs/choco products - segement_list.csv)');
    return p;
  })();

  const rows = parseChocoProductsSegmentListCsv({ absolutePath });
  const created = await prisma.memory.create({
    data: {
      scope: 'system',
      key: CHOCO_PRODUCTS_SEGMENT_LIST_MEMORY_KEY,
      value: {
        importedAt: new Date().toISOString(),
        sourceFile: path.basename(absolutePath),
        rowCount: rows.length,
        rows,
      } as any,
    },
    select: { createdAt: true },
  });

  log.info('Imported choco products segment list CSV', { rowCount: rows.length, createdAt: created.createdAt.toISOString() });

  return { createdAt: created.createdAt, rowCount: rows.length };
}

export async function getLatestChocoProductsSegmentListFromDb(): Promise<{
  createdAt: Date;
  rows: ChocoProductSegmentListRow[];
} | null> {
  const row = await prisma.memory.findFirst({
    where: { key: CHOCO_PRODUCTS_SEGMENT_LIST_MEMORY_KEY },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) return null;
  const value = (row as any).value as any;
  const rows = Array.isArray(value?.rows) ? (value.rows as ChocoProductSegmentListRow[]) : [];
  return { createdAt: row.createdAt, rows };
}

