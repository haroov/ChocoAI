import { SegmentsCatalogProd } from './types';
import { ChocoProductSegmentListRow } from '../../chocoProducts/importChocoProductsSegmentListCsv';

function normalizeHe(s: string): string {
  return String(s || '')
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[״"']/g, '')
    .replace(/[־–—]/g, ' ')
    .toLowerCase();
}

function tokenizeHe(s: string): string[] {
  const norm = normalizeHe(s);
  if (!norm) return [];
  return norm.split(' ').map((t) => t.trim()).filter(Boolean);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

function uniqStrings(values: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of values) {
    const raw = String(v ?? '').trim();
    if (!raw) continue;
    const key = normalizeHe(raw);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(raw);
  }
  return out;
}

function deriveSegmentKeywordsFromChocoProductRow(row?: ChocoProductSegmentListRow): string[] {
  if (!row) return [];
  const list: string[] = [];
  if (row.product_name) list.push(row.product_name);
  if (row.insured) list.push(row.insured);
  if (Array.isArray(row.keywords_source)) list.push(...row.keywords_source);
  if (Array.isArray(row.keywords)) list.push(...row.keywords);
  // Keep it bounded to avoid runaway payload sizes
  return uniqStrings(list).slice(0, 160);
}

export type CoverageMap = Record<string, boolean>;

export function deriveSegmentCoveragesFromChocoProductRow(row?: ChocoProductSegmentListRow): CoverageMap {
  if (!row) return {};
  const out: CoverageMap = {};

  if (typeof row.commercial_dwelling_coverage === 'boolean') out.building = row.commercial_dwelling_coverage;
  if (typeof row.commercial_content_coverage === 'boolean') {
    out.contents = row.commercial_content_coverage;
    // CSV does not separate contents vs stock; default both together.
    out.stock = row.commercial_content_coverage;
  }
  if (typeof row.third_party_liability_coverage === 'boolean') out.third_party = row.third_party_liability_coverage;
  if (typeof row.employers_liability_coverage === 'boolean') out.employers_liability = row.employers_liability_coverage;
  if (typeof row.product_liability_coverage === 'boolean') out.product_liability = row.product_liability_coverage;
  if (typeof row.professional_indemnity_coverage === 'boolean') out.professional_indemnity = row.professional_indemnity_coverage;
  if (typeof row.medical_malpractice_coverage === 'boolean') out.medical_malpractice = row.medical_malpractice_coverage;

  return out;
}

export function mergeCoverages(a?: CoverageMap, b?: CoverageMap): CoverageMap {
  return { ...(a || {}), ...(b || {}) };
}

export function indexChocoProductsByProductName(products: ChocoProductSegmentListRow[]): Map<string, ChocoProductSegmentListRow[]> {
  const m = new Map<string, ChocoProductSegmentListRow[]>();
  for (const p of products) {
    const key = normalizeHe(p.product_name || '');
    if (!key) continue;
    const arr = m.get(key) || [];
    arr.push(p);
    m.set(key, arr);
  }
  return m;
}

export function indexChocoProductsBySlug(products: ChocoProductSegmentListRow[]): Map<string, ChocoProductSegmentListRow> {
  const m = new Map<string, ChocoProductSegmentListRow>();
  for (const p of products) {
    const slug = String(p.slug_name || '').trim();
    if (!slug) continue;
    // Keep first seen (stable)
    if (!m.has(slug)) m.set(slug, p);
  }
  return m;
}

export function pickBestChocoProductForSegment(params: {
  segmentNameHe?: string;
  segmentPrimaryActivityHe?: string;
  productNameIndex: Map<string, ChocoProductSegmentListRow[]>;
}): { row?: ChocoProductSegmentListRow; confidence: number } {
  const segNameKey = normalizeHe(params.segmentNameHe || '');
  const segActKey = normalizeHe(params.segmentPrimaryActivityHe || '');
  const hayKey = segNameKey || segActKey;
  if (!hayKey) return { confidence: 0 };

  const segTokens = new Set([...tokenizeHe(segNameKey), ...tokenizeHe(segActKey)]);

  let best: { row: ChocoProductSegmentListRow; score: number } | null = null;

  // Quick exact map hit
  const exact = params.productNameIndex.get(hayKey);
  if (exact?.length) {
    const picked = exact.find((r) => r.is_active !== false) || exact[0];
    return { row: picked, confidence: 1 };
  }

  // Fuzzy scan over keys (bounded by products size; ok for admin tooling)
  for (const [productNameKey, rows] of params.productNameIndex.entries()) {
    if (!productNameKey) continue;
    const productTokens = new Set(tokenizeHe(productNameKey));
    const jac = jaccard(segTokens, productTokens);
    const bonus = (productNameKey.includes(hayKey) || hayKey.includes(productNameKey)) ? 0.6 : 0;
    const score = Math.max(0, Math.min(1, jac + bonus));
    if (!best || score > best.score) {
      const row = rows.find((r) => r.is_active !== false) || rows[0];
      best = { row, score };
    }
  }

  if (!best) return { confidence: 0 };
  return { row: best.row, confidence: best.score };
}

export function enrichSegmentsCatalog(params: {
  baseCatalog: SegmentsCatalogProd;
  chocoProducts?: ChocoProductSegmentListRow[];
}): { catalog: SegmentsCatalogProd; stats: { segments: number; matchedProducts: number; manualMatches: number; autoMatches: number } } {
  const base = params.baseCatalog;

  const products = params.chocoProducts || [];
  const productNameIndex = indexChocoProductsByProductName(products);
  const slugIndex = indexChocoProductsBySlug(products);
  const groupNameById = new Map<string, string>();
  for (const g of base.segment_groups || []) {
    if (g?.group_id) groupNameById.set(String(g.group_id), String(g.group_name_he || '').trim());
  }

  let matchedProducts = 0;
  let manualMatches = 0;
  let autoMatches = 0;

  const segments = base.segments.map((seg) => {
    const manualSlug = Array.isArray(seg.choco_product_slugs) ? String(seg.choco_product_slugs[0] || '').trim() : '';
    const manualRow = manualSlug ? slugIndex.get(manualSlug) : undefined;
    const auto = manualRow
      ? { row: manualRow, confidence: 1 }
      : pickBestChocoProductForSegment({
        segmentNameHe: seg.segment_name_he,
        segmentPrimaryActivityHe: seg.business_profile_defaults?.primary_activity_he,
        productNameIndex,
      });

    const matched = auto.row && auto.confidence >= 0.25 ? auto.row : undefined;

    const fromProduct = deriveSegmentCoveragesFromChocoProductRow(matched);
    if (matched) {
      matchedProducts += 1;
      if (manualRow) manualMatches += 1;
      else autoMatches += 1;
    }

    // Product-derived defaults first, then manual/admin overrides from the segment.
    const merged = mergeCoverages(fromProduct, seg.coverages);
    // Removed coverage: legal_expenses is bundled into third party / employers as appropriate.
    delete merged.legal_expenses;

    const existingKeywords = Array.isArray((seg as any).keywords) ? ((seg as any).keywords as unknown[]).map((x) => String(x ?? '').trim()).filter(Boolean) : [];
    const derivedKeywordsBase = uniqStrings([
      String(seg.segment_name_he || '').trim(),
      String(seg.business_profile_defaults?.primary_activity_he || '').trim(),
      String(groupNameById.get(String(seg.segment_group_id || '')) || '').trim(),
      ...deriveSegmentKeywordsFromChocoProductRow(matched),
    ].filter(Boolean));
    const derivedKeywords = derivedKeywordsBase.length ? derivedKeywordsBase : uniqStrings([String(seg.segment_id || '').trim()]).filter(Boolean);
    const mergedKeywords = uniqStrings([...derivedKeywords, ...existingKeywords]).slice(0, 180);

    return {
      ...seg,
      ...(Object.keys(merged).length ? { coverages: merged } : {}),
      ...(mergedKeywords.length ? { keywords: mergedKeywords } : {}),
      ...(!manualSlug && matched?.slug_name ? { choco_product_slugs: [matched.slug_name] } : {}),
    };
  });

  const next: SegmentsCatalogProd = {
    ...base,
    segments,
    generated_at_iso: new Date().toISOString(),
    catalog_version: `${base.catalog_version}-enriched-${new Date().toISOString().slice(0, 10)}`,
  };

  return {
    catalog: next,
    stats: { segments: segments.length, matchedProducts, manualMatches, autoMatches },
  };
}

