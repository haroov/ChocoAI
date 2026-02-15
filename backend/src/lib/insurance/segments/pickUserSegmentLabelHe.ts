import { getSegmentsCatalogProd } from './loadSegmentsCatalog';

function normalizeText(s: string): string {
  return String(s || '')
    .toLowerCase()
    .replace(/[״"'`’]/g, '')
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasMeaningfulToken(kwNorm: string): boolean {
  const generic = new Set([
    'עסק',
    'חנות',
    'משרד',
    'קליניקה',
    'מסעדה',
    'מחסן',
    'מפעל',
    'סוכנות',
    'ביטוח',
    'הצעה',
    'הצעת',
    'מחיר',
  ]);
  const toks = kwNorm.split(' ').map((t) => t.trim()).filter(Boolean);
  return toks.some((t) => t.length >= 2 && !generic.has(t));
}

/**
 * Best-effort: pick a human segment label as phrased by the user.
 * Prefer explicit keyword phrases that appear in the user's message, otherwise fall back to "משרד <X>" extraction.
 */
export function pickUserSegmentLabelHeFromText(params: {
  rawText: string;
  resolvedSegmentId?: string;
}): string {
  const raw = String(params.rawText || '').trim();
  if (!raw) return '';
  const segId = String(params.resolvedSegmentId || '').trim();
  if (!segId) return '';

  let seg: any;
  try {
    const cat = getSegmentsCatalogProd();
    seg = cat.segments.find((s: any) => String(s?.segment_id || '') === segId);
  } catch {
    seg = null;
  }
  if (!seg) return '';

  const inputNorm = normalizeText(raw);
  const keywords = Array.isArray(seg.keywords) ? seg.keywords.map((x: any) => String(x ?? '').trim()).filter(Boolean) : [];

  // Prefer explicit keyword phrase match (longest meaningful)
  let bestKw: string = '';
  let bestLen = 0;
  for (const kw of keywords) {
    const kwNorm = normalizeText(kw);
    if (!kwNorm || kwNorm.length < 4) continue;
    if (!hasMeaningfulToken(kwNorm)) continue;
    if (!inputNorm.includes(kwNorm)) continue;
    if (kwNorm.length > bestLen) {
      bestLen = kwNorm.length;
      bestKw = kw;
    }
  }
  if (bestKw) {
    // If the raw text includes the keyword as a substring (exact), keep the raw substring for fidelity.
    const idx = raw.indexOf(bestKw);
    if (idx >= 0) return raw.slice(idx, idx + bestKw.length).trim().replace(/[.。,，!！?？]+$/g, '');
    return bestKw.trim().replace(/[.。,，!！?？]+$/g, '');
  }

  // Fallback: extract "משרד <...>" phrase (up to 2 words after "משרד")
  const m = /משרד\s+([^\s.,!?，。]+)(?:\s+([^\s.,!?，。]+))?/u.exec(raw);
  if (m) {
    const a = String(m[1] || '').trim();
    const b = String(m[2] || '').trim();
    const phrase = ['משרד', a, b].filter(Boolean).join(' ').trim();
    if (phrase.length >= 6) return phrase.replace(/[.。,，!！?？]+$/g, '');
  }

  return '';
}

