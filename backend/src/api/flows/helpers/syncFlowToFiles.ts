import fs from 'node:fs';
import path from 'node:path';
import { FlowSchema } from '../../../lib/flowEngine';

const ZERO_WIDTH_AND_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
const canonicalizeSlug = (v: unknown): string => String(v ?? '')
  .normalize('NFKC')
  .replace(ZERO_WIDTH_AND_BIDI_RE, '')
  .trim();

const isTopicSplitProcessFlowSlug = (slug: string): boolean => /^flow_(0[1-9]|1[0-9]|2[0-3])_/.test(slug);

export type FlowFileSyncResult =
  | { ok: true; writtenFiles: string[] }
  | { ok: false; skipped: true; reason: string }
  | { ok: false; error: string };

function readJsonFile(p: string): any {
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

function writeJsonFile(p: string, data: any) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function renameIdentifiersInDsl(expr: string, renames: Record<string, string>): string {
  const s = String(expr ?? '');
  if (!s || Object.keys(renames).length === 0) return s;

  let out = '';
  let inSingleQuote = false;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\'') {
      inSingleQuote = !inSingleQuote;
      out += ch;
      continue;
    }
    if (inSingleQuote) {
      out += ch;
      continue;
    }

    if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j++;
      const word = s.slice(i, j);
      out += renames[word] || word;
      i = j - 1;
      continue;
    }

    out += ch;
  }

  return out;
}

function deepRewriteDslStrings(obj: any, renames: Record<string, string>) {
  if (!obj || typeof obj !== 'object') return;
  if (Array.isArray(obj)) {
    obj.forEach((v) => deepRewriteDslStrings(v, renames));
    return;
  }

  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string') {
      const key = String(k);
      const looksLikeDsl = key === 'ask_if'
        || key === 'required_if'
        || key === 'set_when'
        || key === 'condition'
        || key.endsWith('_ask_if')
        || key.endsWith('_required_if');
      if (looksLikeDsl) (obj as any)[k] = renameIdentifiersInDsl(v, renames);
    } else if (v && typeof v === 'object') {
      deepRewriteDslStrings(v, renames);
    }
  }
}

function mapFlowFieldTypeToQuestionDataType(field: any): { data_type: string; input_type: string; options_he?: string } {
  const t = String(field?.type || 'string');
  const hasEnum = Array.isArray(field?.enum) && field.enum.length > 0;
  if (hasEnum) return { data_type: 'enum', input_type: 'select', options_he: (field.enum as string[]).join(', ') };
  if (t === 'boolean') return { data_type: 'boolean', input_type: 'select', options_he: 'כן, לא' };
  if (t === 'number') return { data_type: 'number', input_type: 'number' };
  return { data_type: 'string', input_type: 'text' };
}

function composeRenames(renamesRaw: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [from0, to0] of Object.entries(renamesRaw || {})) {
    const from = canonicalizeSlug(from0);
    const to = canonicalizeSlug(to0);
    if (!from || !to || from === to) continue;
    for (const [k, v] of Object.entries(out)) {
      if (v === from) out[k] = to;
    }
    out[from] = to;
  }
  return out;
}

function renameObjectKeys<T extends Record<string, any>>(obj: T, renames: Record<string, string>): T {
  const out: any = {};
  for (const [k0, v] of Object.entries(obj || {})) {
    const k = canonicalizeSlug(k0);
    const nextK = renames[k] || k;
    if (nextK in out) continue;
    out[nextK] = v;
  }
  return out as T;
}

export function syncFlowToFiles(args: {
  flowId: string;
  schema: FlowSchema;
  renames: Record<string, string>;
}): FlowFileSyncResult {
  const { schema } = args;
  const slug = canonicalizeSlug(schema?.slug);
  if (!slug) return { ok: false, skipped: true, reason: 'missing slug' };
  if (!isTopicSplitProcessFlowSlug(slug)) return { ok: false, skipped: true, reason: `unsupported slug '${slug}'` };

  const processKey = slug.replace(/^flow_/, '');
  const renames = composeRenames(args.renames || {});

  // Resolve backend root robustly (works regardless of how server is launched).
  // __dirname is: backend/src/api/flows/helpers
  const backendRoot = path.resolve(__dirname, '../../../..');
  const builtInDir = path.resolve(backendRoot, 'src/lib/flowEngine/builtInFlows/chocoClalSmbTopicSplit');
  const docsDir = path.resolve(backendRoot, 'docs');

  const builtInProcPath = path.resolve(builtInDir, `${processKey}.json`);
  const docsProcPath = path.resolve(docsDir, `${processKey}.json`);
  const builtInManifestPath = path.resolve(builtInDir, 'MANIFEST.PROD.json');
  const docsManifestPath = path.resolve(docsDir, 'MANIFEST.PROD.json');

  if (!fs.existsSync(builtInProcPath)) return { ok: false, error: `built-in process file not found: ${builtInProcPath}` };
  if (!fs.existsSync(builtInManifestPath)) return { ok: false, error: `built-in manifest file not found: ${builtInManifestPath}` };

  let proc: any;
  let manifest: any;
  try {
    proc = readJsonFile(builtInProcPath);
  } catch (e: any) {
    return { ok: false, error: `failed reading process JSON (${builtInProcPath}): ${e?.message || String(e)}` };
  }
  try {
    manifest = readJsonFile(builtInManifestPath);
  } catch (e: any) {
    return { ok: false, error: `failed reading manifest JSON (${builtInManifestPath}): ${e?.message || String(e)}` };
  }

  const mainStage = (schema as any)?.definition?.stages?.main;
  const desiredKeysRaw = Array.isArray(mainStage?.fieldsToCollect) ? mainStage.fieldsToCollect : [];
  const desiredKeys: string[] = Array.from(new Set(
    desiredKeysRaw
      .map((k: any) => canonicalizeSlug(k))
      .filter((k: string): k is string => Boolean(k)),
  ));

  // Persist UI config into the process JSON runtime so restarts keep UI behavior.
  const ui = (schema as any)?.definition?.config?.ui;
  if (ui && typeof ui === 'object') {
    proc.runtime = proc.runtime && typeof proc.runtime === 'object' ? proc.runtime : {};
    proc.runtime.ui = { ...(proc.runtime.ui || {}), ...ui };
  }

  // Apply renames in process + manifest DSL and field keys
  deepRewriteDslStrings(proc, renames);
  deepRewriteDslStrings(manifest, renames);

  // Rename field_key_en in questions
  if (Array.isArray(proc.questions)) {
    for (const q of proc.questions) {
      if (!q || typeof q !== 'object') continue;
      if (!q.field_key_en) continue;
      const key = canonicalizeSlug(q.field_key_en);
      q.field_key_en = renames[key] || key;
    }
  }

  // Create/maintain a field_schemas map to persist UI field type/description across regen
  if (!proc.field_schemas || typeof proc.field_schemas !== 'object') proc.field_schemas = {};
  const flowFields = (schema as any)?.definition?.fields && typeof (schema as any).definition.fields === 'object'
    ? (schema as any).definition.fields as Record<string, any>
    : {};

  // Rename existing field_schemas keys too
  proc.field_schemas = renameObjectKeys(proc.field_schemas, renames);

  for (const [k0, def] of Object.entries(flowFields)) {
    const k = canonicalizeSlug(k0);
    const key = renames[k] || k;
    proc.field_schemas[key] = {
      ...(proc.field_schemas[key] || {}),
      type: def?.type || (proc.field_schemas[key]?.type ?? 'string'),
      description: def?.description || (proc.field_schemas[key]?.description ?? ''),
      enum: Array.isArray(def?.enum) ? def.enum : (proc.field_schemas[key]?.enum ?? undefined),
      // UI stores priority as per-question priority for this field (optional).
      priority: typeof def?.priority === 'number' ? def.priority : proc.field_schemas[key]?.priority,
    };
  }

  // Remove customer-facing questions for fields no longer collected
  if (Array.isArray(proc.questions)) {
    proc.questions = proc.questions.filter((q: any) => {
      const audience = String(q?.audience || proc?.process?.audience || 'customer');
      if (audience !== 'customer') return true;
      const key = canonicalizeSlug(q?.field_key_en);
      if (!key) return true;
      return desiredKeys.includes(key);
    });
  }

  // Apply UI schema overrides to existing questions (type/enum/options).
  if (Array.isArray(proc.questions)) {
    for (const q of proc.questions) {
      const key = canonicalizeSlug(q?.field_key_en);
      if (!key) continue;
      const override = proc.field_schemas?.[key];
      if (!override) continue;

      // If override has enum, force enum/select.
      if (Array.isArray(override.enum) && override.enum.length > 0) {
        q.data_type = 'enum';
        q.input_type = 'select';
        q.options_he = override.enum.join(', ');
        continue;
      }

      const t = String(override.type || '').trim();
      if (t === 'boolean') {
        q.data_type = 'boolean';
        q.input_type = 'select';
        q.options_he = 'כן, לא';
      } else if (t === 'number') {
        q.data_type = 'number';
        if (!['currency', 'integer', 'number'].includes(String(q.input_type || '').toLowerCase())) {
          q.input_type = 'number';
        }
      }
      // For string: keep existing input_type (email/phone/text/select/file/etc.).
    }
  }

  // Add stub questions for newly collected keys that don't exist in question bank
  const existingKeys = new Set<string>(
    Array.isArray(proc.questions)
      ? proc.questions.map((q: any) => canonicalizeSlug(q?.field_key_en)).filter(Boolean)
      : [],
  );
  const nextUiIndexStart = (Array.isArray(proc.questions) ? proc.questions.length : 0) + 1;
  let uiIdx = nextUiIndexStart;
  for (const k of desiredKeys) {
    if (existingKeys.has(k)) continue;
    const fieldDef = flowFields[k] || {};
    const mapped = mapFlowFieldTypeToQuestionDataType(fieldDef);
    const desc = String(fieldDef?.description || proc.field_schemas?.[k]?.description || k).trim() || k;
    proc.questions = Array.isArray(proc.questions) ? proc.questions : [];
    proc.questions.push({
      q_id: `UI_${processKey}_${uiIdx++}`,
      question_he: desc,
      prompt_he: desc,
      field_key_en: k,
      data_type: mapped.data_type,
      input_type: mapped.input_type,
      options_he: mapped.options_he,
      required_mode: 'optional',
      audience: 'customer',
      priority: typeof fieldDef?.priority === 'number' ? fieldDef.priority : 1000,
      json_path: `ui_added.${k}`,
    });
  }

  // Apply UI priority to matching questions (if provided)
  if (Array.isArray(proc.questions)) {
    for (const q of proc.questions) {
      const key = canonicalizeSlug(q?.field_key_en);
      const pr = proc.field_schemas?.[key]?.priority;
      if (typeof pr === 'number' && Number.isFinite(pr)) q.priority = pr;
    }
  }

  // Update manifest: process field_keys + question_count
  const procEntry = Array.isArray(manifest.processes)
    ? manifest.processes.find((p: any) => String(p?.process_key) === processKey)
    : null;
  if (procEntry) {
    procEntry.field_keys = desiredKeys;
    const customerQuestions = Array.isArray(proc.questions)
      ? proc.questions.filter((q: any) => String(q?.audience || proc?.process?.audience || 'customer') === 'customer')
      : [];
    procEntry.question_count = customerQuestions.length;
  }

  // Also rename manifest defaults keys + derived rules target_field
  if (manifest.engine_contract?.defaults && typeof manifest.engine_contract.defaults === 'object') {
    manifest.engine_contract.defaults = renameObjectKeys(manifest.engine_contract.defaults, renames);
  }
  if (Array.isArray(manifest.derived_rules)) {
    for (const r of manifest.derived_rules) {
      if (!r || typeof r !== 'object') continue;
      if (r.target_field) {
        const k = canonicalizeSlug(r.target_field);
        r.target_field = renames[k] || k;
      }
      if (typeof r.set_when === 'string') {
        r.set_when = renameIdentifiersInDsl(r.set_when, renames);
      }
    }
  }

  // Persist to both builtInFlows and docs mirror
  const writtenFiles: string[] = [];
  try {
    writeJsonFile(builtInProcPath, proc);
    writtenFiles.push(builtInProcPath);
    writeJsonFile(docsProcPath, proc);
    writtenFiles.push(docsProcPath);
    writeJsonFile(builtInManifestPath, manifest);
    writtenFiles.push(builtInManifestPath);
    writeJsonFile(docsManifestPath, manifest);
    writtenFiles.push(docsManifestPath);
  } catch (e: any) {
    return { ok: false, error: `failed writing synced files: ${e?.message || String(e)}` };
  }

  return { ok: true, writtenFiles };
}
