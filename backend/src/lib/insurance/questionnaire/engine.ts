import { evaluateCondition } from './conditions';
import { getByJsonPath, setByJsonPath } from './jsonPath';
import {
  Questionnaire,
  QuestionnaireNextQuestion,
  QuestionnaireQuestion,
} from './types';

export type QuestionnaireState = {
  /** Canonical-ish form JSON constructed via json_path writes */
  formJson: Record<string, any>;
  /** Flat vars for condition evaluation (keyed by field_key_en + derived targets) */
  vars: Record<string, unknown>;
  /** Enabled modules computed from modules_catalog.enable_if */
  enabledModules?: Set<string>;
  /** Keys that were populated from engine defaults (not user answers) */
  defaultedKeys?: Set<string>;
};

function splitOptions(optionsHe?: string): string[] {
  const s = String(optionsHe || '').trim();
  if (!s) return [];
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function isAnswered(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === 'string') return v.trim() !== '';
  if (Array.isArray(v)) return v.length > 0;
  // boolean false is an answer
  return true;
}

function parseNumber(raw: string): number | null {
  const cleaned = raw
    .replace(/[₪,]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const m = cleaned.match(/-?\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseBooleanHe(raw: string): boolean | null {
  const s = String(raw || '').trim().toLowerCase();
  if (!s) return null;

  // NOTE: \b word-boundary is not reliable for Hebrew letters in JS regex.
  // Accept "כן"/"לא" even when followed by punctuation / extra details (e.g., "כן. תכולה: ...").
  const head = s
    .replace(/^[\s"'“”׳״]+/g, '')
    .trim();
  const m = head.match(/^(כן|לא|yes|no|y|n|true|false)(?=$|[\s,.:;!?()\[\]{}'"“”\-–—])/i);
  if (!m) return null;
  const token = m[1].toLowerCase();
  if (token === 'כן' || token === 'yes' || token === 'y' || token === 'true') return true;
  if (token === 'לא' || token === 'no' || token === 'n' || token === 'false') return false;
  return null;
}

function parseEnum(raw: string, options: string[]): string | null {
  let s = raw.trim();
  if (!s) return null;
  // Tolerate prefixes like "כן," or "לא," while still allowing "לא" as an option.
  s = s.replace(/^(כן|yes)\s*[,:.\-–]\s*/i, '').trim();
  if (options.includes(s)) return s;
  const matches = options.filter((o) => o.includes(s) || s.includes(o));
  if (matches.length === 1) return matches[0];
  // Extra tolerance for common BI wording
  if (/אובדן\s*הכנסה/i.test(s)) {
    const m = options.find((o) => /אובדן\s*הכנסה/i.test(o));
    if (m) return m;
  }
  if (/(תוצאתי|רווח\s*גולמי)/i.test(s)) {
    const m = options.find((o) => /(תוצאתי|רווח\s*גולמי)/i.test(o));
    if (m) return m;
  }
  return null;
}

function parseMultiSelect(raw: string, options: string[]): string[] | null {
  const s = raw.trim();
  if (!s) return null;
  const parts = s.split(/[,\n]/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;
  const resolved: string[] = [];
  for (const p of parts) {
    const v = parseEnum(p, options) ?? options.find((o) => o.includes(p) || p.includes(o));
    if (!v) return null;
    if (!resolved.includes(v)) resolved.push(v);
  }
  return resolved;
}

type ParsedConstraints = {
  min?: number;
  max?: number;
  step?: number;
  gte?: number;
  lte?: number;
};

function parseConstraints(constraints?: string): ParsedConstraints {
  const s = String(constraints || '').trim();
  if (!s) return {};
  const out: ParsedConstraints = {};

  // Formats we saw:
  // - ">=1"
  // - "<=5000; max_days<=100" (we only enforce the numeric part for this field)
  // - "min=500000; max=10000000; step=500000"
  const parts = s.split(';').map((p) => p.trim()).filter(Boolean);
  for (const p of parts) {
    let m = /^min\s*=\s*(\d+(?:\.\d+)?)$/i.exec(p);
    if (m) { out.min = Number(m[1]); continue; }
    m = /^max\s*=\s*(\d+(?:\.\d+)?)$/i.exec(p);
    if (m) { out.max = Number(m[1]); continue; }
    m = /^step\s*=\s*(\d+(?:\.\d+)?)$/i.exec(p);
    if (m) { out.step = Number(m[1]); continue; }
    m = /^>=\s*(\d+(?:\.\d+)?)$/.exec(p);
    if (m) { out.gte = Number(m[1]); continue; }
    m = /^<=\s*(\d+(?:\.\d+)?)$/.exec(p);
    if (m) { out.lte = Number(m[1]); continue; }
  }
  return out;
}

function validateNumber(n: number, constraints?: string): string | null {
  const c = parseConstraints(constraints);
  if (c.min !== undefined && n < c.min) return `הסכום חייב להיות לפחות ${c.min.toLocaleString()}`;
  if (c.gte !== undefined && n < c.gte) return `הערך חייב להיות לפחות ${c.gte.toLocaleString()}`;
  if (c.max !== undefined && n > c.max) return `הסכום חייב להיות עד ${c.max.toLocaleString()}`;
  if (c.lte !== undefined && n > c.lte) return `הערך חייב להיות עד ${c.lte.toLocaleString()}`;
  if (c.step !== undefined) {
    const base = c.min ?? c.gte ?? 0;
    const diff = n - base;
    if (diff % c.step !== 0) return `הערך חייב להיות במדרגות של ${c.step.toLocaleString()}`;
  }
  return null;
}

function getEngineContract(questionnaire: Questionnaire) {
  return questionnaire.runtime?.engine_contract || questionnaire.engine_contract || { condition_dsl: 'simple', defaults: {} };
}

function computeEnabledModules(questionnaire: Questionnaire, state: QuestionnaireState) {
  const enabled = new Set<string>();
  const modules = questionnaire.modules_catalog || [];
  for (const m of modules) {
    if (!m?.module_key) continue;
    const ok = evaluateCondition(m.enable_if, state.vars);
    if (ok) enabled.add(m.module_key);
  }
  state.enabledModules = enabled;
}

function computeComputedVars(state: QuestionnaireState) {
  // These are referenced by some ask_if expressions (e.g. terror threshold)
  const building = Number(state.vars.ch2_building_sum_insured_ils || 0);
  const contents = Number(state.vars.ch1_contents_sum_insured_excl_stock_ils || state.vars.contents_sum_insured_ils || 0);
  const stock = Number(state.vars.ch1_stock_sum_insured_ils || state.vars.stock_sum_insured_ils || 0);
  const electronic = Number(state.vars.ch10_sum_insured_ils || 0);
  const money = Number(state.vars.ch5_money_sum_insured_ils || 0);
  const transit = Number(state.vars.ch6_transit_sum_insured_ils || 0);
  const property_sum = [building, contents, stock, electronic, money, transit].filter((x) => Number.isFinite(x)).reduce((a, b) => a + b, 0);

  const biGross = Number(state.vars.ch3b_sum_insured_gross_profit_ils || 0);
  const biDaily = Number(state.vars.ch3a_daily_comp_ils || 0);
  const bi_sum = biGross || (biDaily ? biDaily * 100 : 0);

  state.vars.property_sum = property_sum;
  state.vars.bi_sum = bi_sum;
}

function formatValueHe(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'כן' : 'לא';
  if (typeof v === 'number') return Number.isFinite(v) ? v.toLocaleString('he-IL') : String(v);
  if (Array.isArray(v)) return v.map((x) => formatValueHe(x)).filter(Boolean).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function shortLabelHe(q: QuestionnaireQuestion): string {
  const raw = String(q.question_he || q.prompt_he || q.field_key_en || '').trim();
  return raw
    .replace(/\s+/g, ' ')
    .replace(/[?？]\s*$/g, '')
    .slice(0, 80);
}

export function buildInitialQuestionnaireState(
  questionnaire: Questionnaire,
  existingVars: Record<string, unknown> = {},
  existingFormJson: Record<string, any> = {},
): QuestionnaireState {
  const state: QuestionnaireState = {
    formJson: existingFormJson || {},
    vars: { ...(existingVars || {}) },
    defaultedKeys: new Set<string>(),
  };

  // Apply defaults for gating/coverage selections (mostly booleans)
  const contract = getEngineContract(questionnaire);
  Object.entries(contract.defaults || {}).forEach(([k, v]) => {
    if (!(k in state.vars)) {
      state.vars[k] = v;
      state.defaultedKeys?.add(k);
    }
  });

  computeComputedVars(state);
  computeEnabledModules(questionnaire, state);
  return state;
}

export function findQuestionById(questionnaire: Questionnaire, qid: string): QuestionnaireQuestion | undefined {
  return questionnaire.questions.find((q) => q.q_id === qid);
}

export function buildStageSummaryHe(
  questionnaire: Questionnaire,
  state: QuestionnaireState,
  stageKey: string,
  options?: { maxItems?: number },
): string {
  const stage = questionnaire.stages.find((s) => s.stage_key === stageKey);
  if (!stage) return '';
  const maxItems = options?.maxItems ?? 4;

  const pairs: string[] = [];
  let answeredCount = 0;

  for (const qid of stage.question_ids || []) {
    const q = findQuestionById(questionnaire, qid);
    if (!q) continue;
    if (q.audience !== 'customer') continue;
    if (q.input_type === 'file') continue;

    const v = getByJsonPath(state.formJson, q.json_path);
    if (!isAnswered(v)) continue;

    answeredCount += 1;
    if (pairs.length < maxItems) {
      pairs.push(`${shortLabelHe(q)}: ${formatValueHe(v)}`);
    }
  }

  if (pairs.length === 0) return '';
  const more = answeredCount - pairs.length;
  return more > 0 ? `${pairs.join('; ')}; ועוד ${more} פרטים` : pairs.join('; ');
}

export function applyDerivedRules(questionnaire: Questionnaire, state: QuestionnaireState): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  const rules = getEngineContract(questionnaire).derived_rules || [];
  for (const rule of rules) {
    if (!rule?.target_field || !rule?.set_when) continue;
    const shouldSet = evaluateCondition(rule.set_when, state.vars);
    if (!shouldSet) continue;

    const q = findQuestionById(questionnaire, rule.maps_to_q_id);
    if (!q) continue;

    state.vars[rule.target_field] = rule.value;
    state.defaultedKeys?.delete(rule.target_field);
    updates[rule.target_field] = rule.value;
    setByJsonPath(state.formJson, q.json_path, rule.value);
  }

  computeComputedVars(state);
  computeEnabledModules(questionnaire, state);
  return updates;
}

export function parseAndApplyAnswer(
  questionnaire: Questionnaire,
  state: QuestionnaireState,
  question: QuestionnaireQuestion,
  rawAnswer: string,
): { ok: true; value: unknown; errorMessage?: never } | { ok: false; errorMessage: string } {
  const raw = String(rawAnswer || '').trim();
  if (!raw) return { ok: false, errorMessage: 'לא הצלחתי להבין — אפשר לענות שוב בקצרה?' };

  const options = splitOptions(question.options_he);
  let parsed: unknown = null;

  switch (question.data_type) {
    case 'boolean': {
      const b = parseBooleanHe(raw);
      if (b === null) return { ok: false, errorMessage: 'אפשר לענות "כן" או "לא"?' };
      parsed = b;
      break;
    }
    case 'number': {
      const n = parseNumber(raw);
      if (n === null) return { ok: false, errorMessage: 'אפשר לכתוב מספר?' };
      const validation = validateNumber(n, question.constraints);
      if (validation) return { ok: false, errorMessage: validation };
      parsed = n;
      break;
    }
    case 'enum': {
      const v = parseEnum(raw, options);
      if (v === null) return { ok: false, errorMessage: options.length ? `אפשר לבחור אחת מהאפשרויות: ${options.join(', ')}` : 'אפשר לבחור אחת מהאפשרויות?' };
      parsed = v;
      break;
    }
    case 'array': {
      const arr = parseMultiSelect(raw, options);
      if (arr === null) return { ok: false, errorMessage: options.length ? `אפשר לבחור אחת או יותר מהאפשרויות: ${options.join(', ')}` : 'אפשר לבחור אחת או יותר מהאפשרויות?' };
      parsed = arr;
      break;
    }
    case 'date':
    case 'string':
    default:
      parsed = raw;
      break;
  }

  // Save into vars + form json
  state.vars[question.field_key_en] = parsed;
  state.defaultedKeys?.delete(question.field_key_en);
  setByJsonPath(state.formJson, question.json_path, parsed);

  computeComputedVars(state);
  computeEnabledModules(questionnaire, state);
  return { ok: true, value: parsed };
}

export function computePendingAttachments(questionnaire: Questionnaire, state: QuestionnaireState) {
  const pending: Array<{ field_key_en: string; title_he: string; json_path: string; q_id: string; notes?: string }> = [];
  const items = questionnaire.attachments_checklist || [];
  for (const it of items) {
    if (!it?.field_key_en || !it.json_path) continue;
    if (it.when && !evaluateCondition(it.when, state.vars)) continue;
    const v = getByJsonPath(state.formJson, it.json_path);
    if (isAnswered(v)) continue;
    pending.push({
      q_id: it.q_id,
      field_key_en: it.field_key_en,
      title_he: it.title_he,
      json_path: it.json_path,
      notes: it.notes,
    });
  }
  return pending;
}

export function evaluateHandoffTriggers(questionnaire: Questionnaire, state: QuestionnaireState) {
  const triggers = questionnaire.handoff_triggers || [];
  const fired = triggers
    .filter((t) => t?.when && evaluateCondition(t.when, state.vars))
    .map((t) => ({ trigger_key: t.trigger_key, reason_he: t.reason_he, action: t.action }));
  return fired;
}

export function validateProductionRules(questionnaire: Questionnaire, state: QuestionnaireState): string | null {
  const rules = questionnaire.production_validations || [];
  for (const r of rules) {
    if (!evaluateCondition(r.when, state.vars)) continue;
    const v = state.vars[r.field_key_en];
    if (v === null || v === undefined || v === '') continue;
    const n = typeof v === 'number' ? v : Number(String(v).replace(/[₪,]/g, '').trim());
    if (!Number.isFinite(n)) continue;
    if (r.rule.min !== undefined && n < r.rule.min) return r.error_he;
    if (r.rule.max !== undefined && n > r.rule.max) return r.error_he;
    if (r.rule.multipleOf !== undefined && n % r.rule.multipleOf !== 0) return r.error_he;
  }
  return null;
}

export function getNextQuestion(
  questionnaire: Questionnaire,
  state: QuestionnaireState,
): QuestionnaireNextQuestion | null {
  const stages = [...questionnaire.stages].sort((a, b) => a.stage_key.localeCompare(b.stage_key));

  const stageByKey = new Map(stages.map((s) => [s.stage_key, s]));
  const titleByStageKey = new Map(stages.map((s) => [s.stage_key, s.title_he]));

  for (const stage of stages) {
    if (stage.ask_if && !evaluateCondition(stage.ask_if, state.vars)) continue;

    for (const qid of stage.question_ids) {
      const q = findQuestionById(questionnaire, qid);
      if (!q) continue;
      if (q.audience !== 'customer') continue;

      // Module gating (production catalog)
      // IMPORTANT: Stage 01 (identification) and Stage 02 (needs discovery / gate) contain questions
      // that *determine* module selection. Those must NOT be gated by enabledModules, otherwise
      // we'd never ask the user whether they want the coverage in the first place.
      const effectiveStageKey = q.stage_key || stage.stage_key;
      const shouldApplyModuleGating = effectiveStageKey !== '01_identification' && effectiveStageKey !== '02_needs_discovery';
      if (shouldApplyModuleGating && q.module_key && state.enabledModules && !state.enabledModules.has(q.module_key)) continue;

      // Attachment questions should not block the conversation (handled via checklist)
      if (q.collection_mode && String(q.collection_mode).includes('attachment')) continue;
      if (q.input_type === 'file') continue;

      const already = state.vars[q.field_key_en];
      // IMPORTANT:
      // Some fields (especially coverage selections) have defaults (false) to ensure a final value,
      // but we still MUST ask the question in stage 02. Therefore, a defaulted value does not count
      // as "answered" until the user (or a derived rule) explicitly sets it.
      const isDefaulted = state.defaultedKeys?.has(q.field_key_en);
      if (!isDefaulted && isAnswered(already)) continue;

      if (q.ask_if && !evaluateCondition(q.ask_if, state.vars)) continue;
      if (q.required_if && !evaluateCondition(q.required_if, state.vars)) continue;

      // If stage exists but question's stage_key differs, still respect question's own stage_key ordering
      const stageKey = effectiveStageKey;
      const stageTitle = titleByStageKey.get(stageKey) || stageByKey.get(stageKey)?.title_he || stage.title_he;

      // Prefer channel-specific prompt if tool injected it into vars (prompt chosen later in tool)
      return {
        q_id: q.q_id,
        stage_key: stageKey,
        stage_title_he: stageTitle,
        prompt_he: q.prompt_he,
        field_key_en: q.field_key_en,
        data_type: q.data_type,
        input_type: q.input_type,
        options_he: q.options_he,
        constraints: q.constraints,
        required_if: q.required_if,
        ask_if: q.ask_if,
        json_path: q.json_path,
      };
    }
  }

  return null;
}
