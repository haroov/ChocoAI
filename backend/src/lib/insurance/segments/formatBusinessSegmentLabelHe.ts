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

