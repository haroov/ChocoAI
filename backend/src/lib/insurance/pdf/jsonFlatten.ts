export type FlattenedEntry = { path: string; value: string };

function isPrimitive(v: any): v is string | number | boolean | null {
  return v === null || ['string', 'number', 'boolean'].includes(typeof v);
}

export function flattenJsonToTextEntries(input: any, options?: { maxEntries?: number }): FlattenedEntry[] {
  const maxEntries = options?.maxEntries ?? 2000;
  const out: FlattenedEntry[] = [];

  const walk = (value: any, prefix: string) => {
    if (out.length >= maxEntries) return;

    if (isPrimitive(value)) {
      out.push({ path: prefix, value: value === null ? 'null' : String(value) });
      return;
    }

    if (Array.isArray(value)) {
      if (value.length === 0) {
        out.push({ path: prefix, value: '[]' });
        return;
      }
      value.forEach((item, idx) => walk(item, `${prefix}[${idx}]`));
      return;
    }

    if (typeof value === 'object' && value) {
      const keys = Object.keys(value);
      if (keys.length === 0) {
        out.push({ path: prefix, value: '{}' });
        return;
      }
      keys.forEach((k) => walk(value[k], prefix ? `${prefix}.${k}` : k));
      return;
    }

    out.push({ path: prefix, value: String(value) });
  };

  walk(input, '');
  return out.filter((e) => e.path !== '');
}
