import fs from 'fs';
import path from 'path';
import Ajv, { ErrorObject } from 'ajv';
import addFormats from 'ajv-formats';
import { getFormsRootDir, loadSchemaRegistry, resolveSchemaPath } from './schemaRegistry';
import { deriveSchemaIdFromPayload } from './schemaId';

export type ValidationResult =
  | { ok: true; schemaId: string; normalizedPayload: any }
  | { ok: false; schemaId: string | null; errors: ErrorObject[]; message: string };

let cachedAjv: Ajv | null = null;
let cachedRegistry: ReturnType<typeof loadSchemaRegistry> | null = null;

function getAjv() {
  if (cachedAjv) return cachedAjv;
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    allowUnionTypes: true,
    validateFormats: true,
  });
  addFormats(ajv);
  cachedAjv = ajv;
  return ajv;
}

function ensureRegistryLoaded() {
  if (!cachedRegistry) cachedRegistry = loadSchemaRegistry();
  return cachedRegistry;
}

function loadJsonFile(filePath: string): any {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw);
}

/**
 * Validate payload against schema derived from payload.meta.
 *
 * Notes:
 * - We load the canonical Clal schema file as well, because our canonical wrapper references its $id.
 * - In MVP, if schemaId is missing or not in registry, we fail fast with errors.
 */
export function validateCanonicalIntakePayload(payload: any): ValidationResult {
  const schemaId = deriveSchemaIdFromPayload(payload);
  if (!schemaId) {
    return {
      ok: false,
      schemaId: null,
      errors: [],
      message: 'Missing meta.insurer / meta.form_catalog_number / meta.form_version_date',
    };
  }

  const registry = ensureRegistryLoaded();
  const entry = registry.schemas[schemaId];
  if (!entry) {
    return {
      ok: false,
      schemaId,
      errors: [],
      message: `Schema not found in registry for schemaId=${schemaId}`,
    };
  }

  const ajv = getAjv();

  // Ensure base schema is loaded (the original Clal schema file in forms/)
  // This avoids file-path $refs and keeps $ref resolution stable across environments.
  const formsRoot = getFormsRootDir();
  const clalBasePath = path.join(formsRoot, 'forms', 'clal_business_proposal_15943_2025-07.schema.json');
  if (fs.existsSync(clalBasePath)) {
    const clalBaseSchema = loadJsonFile(clalBasePath);
    if (clalBaseSchema?.$id && !ajv.getSchema(clalBaseSchema.$id)) {
      ajv.addSchema(clalBaseSchema, clalBaseSchema.$id);
    }
  }

  const schemaPath = resolveSchemaPath(entry);
  const schema = loadJsonFile(schemaPath);
  const schemaKey = schema?.$id || schemaPath;
  if (!ajv.getSchema(schemaKey)) {
    ajv.addSchema(schema, schemaKey);
  }

  const validate = ajv.getSchema(schemaKey);
  if (!validate) {
    return {
      ok: false,
      schemaId,
      errors: [],
      message: `Failed to compile schema: ${schemaKey}`,
    };
  }

  const ok = validate(payload);
  if (ok) {
    return { ok: true, schemaId, normalizedPayload: payload };
  }

  return {
    ok: false,
    schemaId,
    errors: validate.errors || [],
    message: 'Schema validation failed',
  };
}
