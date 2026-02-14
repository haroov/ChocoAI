export function formatBusinessSegmentLabelHe(params: {
  segment_name_he?: string;
  group_name_he?: string;
  segment_group_id?: string;
}): string {
  const raw = String(params.segment_name_he || params.group_name_he || '').trim();
  if (!raw) return '';
  const base = raw.split('/')[0]?.trim() || raw;

  // Product convention: for professional offices, prefer the explicit "משרד <profession>" phrasing.
  // Example: "סוכן ביטוח" -> "משרד סוכן ביטוח".
  if (String(params.segment_group_id || '').trim() === 'professional_offices') {
    if (!/^משרד\s/.test(base)) return `משרד ${base}`.trim();
  }

  return base;
}

export function looksLikeNoiseBusinessSegmentHe(value: string): boolean {
  const s = String(value || '').trim();
  if (!s) return true;

  const stop = new Set([
    // generic intent/request noise
    'ביטוח',
    'לביטוח',
    'הצעה',
    'הצעת',
    'מחיר',
    'רוצה',
    'רציתי',
    'צריך',
    'צריכה',
    'אשמח',
    'אפשר',
    'נא',
    // greetings / politeness
    'תודה',
    'שלום',
    'הי',
    'היי',
    // too generic as occupation
    'משרד',
  ]);

  const norm = s
    .toLowerCase()
    .replace(/[״"'`’]/g, '')
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const tokens = norm.split(' ').map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) return true;

  const meaningful = tokens.filter((t) => !stop.has(t));
  return meaningful.length === 0;
}

function meaningfulTokensHe(value: string): Set<string> {
  const stop = new Set([
    // generic intent/request noise
    'ביטוח',
    'לביטוח',
    'הצעה',
    'הצעת',
    'מחיר',
    'רוצה',
    'רציתי',
    'צריך',
    'צריכה',
    'אשמח',
    'אפשר',
    'נא',
    // greetings / politeness
    'תודה',
    'שלום',
    'הי',
    'היי',
    // generic place tokens
    'עסק',
    'משרד',
    'חנות',
    'קליניקה',
    'מסעדה',
    'מחסן',
    'מפעל',
    // glue
    'של',
    'עם',
    'על',
  ]);

  const norm = String(value || '')
    .toLowerCase()
    .replace(/[״"'`’]/g, '')
    .replace(/[(){}\[\],.;:!?/\\\-–—_]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const out = new Set<string>();
  for (const t of norm.split(' ').map((x) => x.trim()).filter(Boolean)) {
    if (t.length < 2) continue;
    if (stop.has(t)) continue;
    out.add(t);
  }
  return out;
}

export function shouldOverrideBusinessSegmentHe(existing: string, desired: string): boolean {
  const ex = String(existing || '').trim();
  const des = String(desired || '').trim();
  if (!des) return false;
  if (!ex) return true;
  if (looksLikeNoiseBusinessSegmentHe(ex)) return true;

  // Prefer user terminology when it meaningfully differs.
  // If existing contains meaningful tokens that are NOT present in desired, keep existing.
  const exTok = meaningfulTokensHe(ex);
  const desTok = meaningfulTokensHe(des);
  if (exTok.size === 0) return true;
  if (desTok.size === 0) return false;

  let exNotInDes = 0;
  for (const t of exTok) if (!desTok.has(t)) exNotInDes++;
  if (exNotInDes > 0) return false;

  // If desired is a strict refinement (e.g., adding "משרד" prefix), allow override.
  if (des.length > ex.length && des.includes(ex)) return true;

  return false;
}
