import fs from 'fs';
import path from 'path';

export type SchemaRegistryEntry = {
  canonical: boolean;
  path: string; // repo-relative path, e.g. forms/schemas/canonical/...
};

export type SchemaRegistry = {
  schemas: Record<string, SchemaRegistryEntry>;
};

function detectFormsDir(): string {
  const candidates = [
    path.join(process.cwd(), 'forms'),
    path.join(process.cwd(), '..', 'forms'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) return p;
  }
  throw new Error(`forms directory not found. Tried: ${candidates.join(', ')}`);
}

export function getFormsRootDir(): string {
  return path.dirname(detectFormsDir());
}

export function getFormsDir(): string {
  return detectFormsDir();
}

export function loadSchemaRegistry(): SchemaRegistry {
  const formsDir = getFormsDir();
  const registryPath = path.join(formsDir, 'schemas', 'registry.json');
  const raw = fs.readFileSync(registryPath, 'utf8');
  return JSON.parse(raw) as SchemaRegistry;
}

export function resolveSchemaPath(entry: SchemaRegistryEntry): string {
  const root = getFormsRootDir();
  return path.join(root, entry.path);
}
