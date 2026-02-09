import fs from 'fs';
import path from 'path';
import { SegmentsCatalogProd } from './types';

let cachedProd: SegmentsCatalogProd | null = null;
let cachedProdPath: string | null = null;

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

export function loadSegmentsCatalogProd(): { catalog: SegmentsCatalogProd; absolutePath: string } {
  const candidates = getRepoCandidates();
  const p = firstExistingPath(candidates, [
    path.join('backend', 'docs', 'Choco_Segments_Catalog.PROD.json'),
    path.join('docs', 'Choco_Segments_Catalog.PROD.json'), // when cwd already in backend/
  ]);
  if (!p) {
    throw new Error('Segments catalog JSON not found (expected backend/docs/Choco_Segments_Catalog.PROD.json)');
  }

  const raw = fs.readFileSync(p, 'utf8');
  return {
    catalog: JSON.parse(raw) as SegmentsCatalogProd,
    absolutePath: p,
  };
}

/**
 * Cached accessor. Safe to call frequently from tools.
 */
export function getSegmentsCatalogProd(): SegmentsCatalogProd {
  if (cachedProd) return cachedProd;
  const loaded = loadSegmentsCatalogProd();
  cachedProd = loaded.catalog;
  cachedProdPath = loaded.absolutePath;
  return cachedProd;
}

export function getSegmentsCatalogProdPath(): string | null {
  // ensure cache filled at least once
  if (!cachedProdPath) {
    try {
      getSegmentsCatalogProd();
    } catch {
      return null;
    }
  }
  return cachedProdPath;
}
