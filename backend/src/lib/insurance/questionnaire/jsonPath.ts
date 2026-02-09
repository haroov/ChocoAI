type PathSegment = string | number;

function parsePath(path: string): PathSegment[] {
  // Supports:
  // - dot notation: a.b.c
  // - bracket array indices: locations[0].address.city
  const segments: PathSegment[] = [];
  const re = /([^[.\]]+)|\[(\d+)\]/g;
  let m: RegExpExecArray | null;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(path)) !== null) {
    if (m[1]) segments.push(m[1]);
    else if (m[2]) segments.push(Number(m[2]));
  }
  return segments;
}

export function getByJsonPath(obj: any, path: string): any {
  const segs = parsePath(path);
  let cur: any = obj;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s as any];
  }
  return cur;
}

export function setByJsonPath(obj: any, path: string, value: any): void {
  const segs = parsePath(path);
  let cur: any = obj;
  for (let i = 0; i < segs.length - 1; i += 1) {
    const s = segs[i];
    const next = segs[i + 1];
    if (cur[s as any] == null) {
      cur[s as any] = typeof next === 'number' ? [] : {};
    }
    cur = cur[s as any];
  }
  const last = segs[segs.length - 1];
  cur[last as any] = value;
}
