/**
 * Choco • Clal SMB — Topic-Split Modular Process Flows (PROD)
 *
 * Generates 23 individual flows:
 *   flow_01_welcome_user
 *   ...
 *   flow_23_internal_agent_section
 *
 * Each flow collects only the fields for its process and then automatically routes
 * to the next relevant flow via `insurance.markProcessComplete`.
 */
import fs from 'fs';
import path from 'path';
import MANIFEST_JSON from './chocoClalSmbTopicSplit/MANIFEST.PROD.json';
import { buildProcessCompletionExpression } from './chocoClalSmbTopicSplitCompletion';

const MANIFEST: any = MANIFEST_JSON as any;

type RawProcessFile = {
  runtime?: any;
  process: {
    process_key: string;
    title_he: string;
    description_he?: string | null;
    opening_message?: string | null;
    ask_if?: string | null;
    audience?: 'customer' | 'internal' | string;
    notes_best_practice_he?: string[];
  };
  questions: any[];
  validators?: any[];
  handoff_triggers?: any[];
  attachments_checklist?: any[];
};

const GLOBAL_RULES_HE = `את/ה ChocoAI — סוכן/ת ביטוח דיגיטלי/ת (SMB) עבור כלל ביטוח.
השיחה מתנהלת בעברית. שמות השדות/keys באנגלית.

כללי ערוץ:
- WhatsApp: שאלה אחת בכל הודעה, טקסט קצר (עד ~500 תווים). אין Quick Replies. Multi-select: הלקוח מחזיר מספרים מופרדים בפסיק.
- Web chat: עד 2 שאלות בכל הודעה. אפשר להציג אפשרויות ברשימה קצרה.

כללי Best Practice:
- מתחילים ב״זיהוי + בירור צרכים + בחירת כיסויים״ ורק אז נכנסים לפרטים.
- שואלים רק מה שרלוונטי לפי הכיסוי שנבחר (דינמי).
- אם הלקוח לא יודע סכום: אפשר אומדן זמני, מסמנים להמשך בדיקה, וממשיכים.
- חילוץ מידע מקדים (Proactive Extraction): אם הלקוח נותן מידע עבור שדות שעדיין לא שאלת — חובה לחלץ ולשמור אותו מיד, גם אם זה לא \"התור\" שלו לפי ה-priority.
- מניעת כפילות: לפני כל שאלה, בדוק אם השדה (field_key) כבר מלא. אם כן — דלג עליו ואל תשאל שוב.
- פנייה ללקוח: אם ידוע שם פרטי (user_first_name / first_name / proposer_first_name) — פנה אליו בשם הפרטי. אל תפנה ללקוח לפי מקצוע/סגמנט (למשל: \"עורך דין\") ואל תכתוב \"מעולה, עורך דין\". אפשר להגיד \"מעולה\" או \"מעולה, ליאב\".

סוגי נתונים:
- date: לשמור כ-YYYY-MM-DD.
- number/currency/integer: לשמור כמספר (ללא פסיקים/₪).
- boolean: למפות כן/לא -> true/false.
- enum/select: חייב להיות אחת מהאפשרויות.
- array/multi_select: לשמור מערך של מחרוזות (labels בעברית).

קבצים/מסמכים:
- אם שאלה היא מסוג file: לא חייבים לעצור. להוסיף לרשימת 'attachments_checklist' ולבקש בסוף או כשחובה.

אבטחה/ציות:
- לא לאסוף פרטי כרטיס אשראי בצ׳אט. רק בטופס תשלום ייעודי/מאובטח.`;

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr.filter((x: any) => x !== undefined && x !== null && x !== '')));
}

function normalizePriority(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

function orderQuestionsByUiPolicy(procFile: RawProcessFile, questions: any[]): any[] {
  // Topic-split flows are orchestrated by priority; always present questions ordered by priority
  // to match the Settings "Priority" field and reduce LLM ambiguity.
  return [...questions].sort((a: any, b: any) => {
    const ap = normalizePriority(a?.priority);
    const bp = normalizePriority(b?.priority);
    if (ap !== bp) return ap - bp;
    const ak = String(a?.field_key_en || '');
    const bk = String(b?.field_key_en || '');
    if (ak !== bk) return ak.localeCompare(bk);
    const aq = String(a?.q_id || '');
    const bq = String(b?.q_id || '');
    return aq.localeCompare(bq);
  });
}

function simplifyQuestions(rawQuestions: any[]): any[] {
  return (rawQuestions || []).map((q) => ({
    q_id: q.q_id,
    question_he: q.question_he,
    prompt_he: q.prompt_he || (q.prompt_variants ? (q.prompt_variants.web_chat || q.prompt_variants.whatsapp) : undefined),
    field_key_en: q.field_key_en,
    data_type: q.data_type,
    input_type: q.input_type,
    options_he: q.options_he,
    constraints: q.constraints,
    required_mode: q.required_mode,
    required_if: q.required_if,
    ask_if: q.ask_if,
    conversational: q.conversational,
    notes_logic: q.notes_logic,
    json_path: q.json_path,
    audience: q.audience,
    priority: normalizePriority(q.priority),
  }));
}

function formatQuestionBankCompact(questions: any[]): string {
  const qs = Array.isArray(questions) ? questions : [];
  if (qs.length === 0) return '(none)';

  const cleanInline = (v: unknown): string => String(v ?? '').replace(/\s+/g, ' ').trim();

  const lines: string[] = [];
  for (const q of qs) {
    const key = cleanInline(q.field_key_en);
    if (!key) continue;
    const alts = Array.isArray(q?.conversational?.alternatives_he)
      ? (q.conversational.alternatives_he as string[]).map(cleanInline).filter(Boolean).slice(0, 2)
      : [];
    const parts = [
      `qid=${cleanInline(q.q_id)}`,
      `key=${key}`,
      q.priority ? `prio=${cleanInline(q.priority)}` : '',
      `type=${cleanInline(q.data_type)}/${cleanInline(q.input_type)}`,
      q.required_mode ? `required=${cleanInline(q.required_mode)}` : '',
      q.ask_if ? `ask_if=${cleanInline(q.ask_if)}` : '',
      q.required_if ? `required_if=${cleanInline(q.required_if)}` : '',
      q.constraints ? `constraints=${cleanInline(q.constraints)}` : '',
      q.options_he ? `options=${cleanInline(q.options_he)}` : '',
      q.prompt_he ? `prompt="${cleanInline(q.prompt_he)}"` : '',
      alts.length ? `alts="${alts.join(' / ')}"` : '',
    ].filter(Boolean);
    lines.push(`- ${parts.join(' | ')}`);
  }
  return lines.length ? lines.join('\n') : '(none)';
}

function mapDataTypeToFieldType(dataType: string): 'string' | 'number' | 'boolean' {
  if (['number', 'integer', 'currency'].includes(String(dataType))) return 'number';
  if (String(dataType) === 'boolean') return 'boolean';
  return 'string';
}

function parseOptionsHeEnum(optionsHe: unknown): string[] | undefined {
  const raw = String(optionsHe ?? '').trim();
  if (!raw) return undefined;
  // Common format: "א, ב, ג" (comma-separated). Keep exact labels.
  const items = raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  // If not a real options list (single token), ignore.
  if (items.length < 2) return undefined;
  return items;
}

function buildProcessPrompt(procFile: RawProcessFile): string {
  const p = procFile.process;
  const askIf = p.ask_if ? p.ask_if : '—';
  const audience = p.audience || 'customer';

  const questions = orderQuestionsByUiPolicy(procFile, simplifyQuestions(procFile.questions || []));

  // Some fields are deterministically derived by the system (engine_contract.derived_rules).
  // When a question's q_id is listed as maps_to_q_id in derived_rules, we should NOT ask it:
  // - It may be auto-set based on other fields (e.g. has_employees -> ch8_employers_selected)
  // - Asking it can create a confusing duplicate question in the same turn
  const derivedRules = (procFile as any)?.runtime?.engine_contract?.derived_rules || (procFile as any)?.engine_contract?.derived_rules || [];
  const derivedQids = new Set<string>(
    Array.isArray(derivedRules)
      ? derivedRules.map((r: any) => String(r?.maps_to_q_id || '').trim()).filter(Boolean)
      : [],
  );
  const derivedQuestions = questions.filter((q: any) => derivedQids.has(String(q?.q_id || '').trim()));
  const questionBankQuestions = questions.filter((q: any) => !derivedQids.has(String(q?.q_id || '').trim()));
  const validators = procFile.validators || [];
  const handoff = procFile.handoff_triggers || [];
  const attachments = procFile.attachments_checklist || [];

  return [
    GLOBAL_RULES_HE,
    '',
    `תהליך: ${p.title_he} (${p.process_key})`,
    p.description_he ? `מטרה: ${p.description_he}` : '',
    '',
    `תנאי הפעלה (ask_if): ${askIf}`,
    `קהל יעד: ${audience}`,
    p.opening_message ? `הודעת פתיחה (חובה להתחיל איתה): "${p.opening_message}"` : '',
    '',
    p.notes_best_practice_he ? 'דגשים חשובים (Best Practice) לשלב זה:' : '',
    ...(p.notes_best_practice_he || []).map((n: string) => `- ${n}`),
    '',
    'הנחיות קריטיות לביצוע (System Instructions):',
    '1. סדר השאלות (Priority Rules):',
    '   - עליך לחשב מהו ה-priority הנמוך ביותר של שאלות שטרם נענו.',
    '   - שאל אך ורק שאלות מתוך קבוצת ה-priority הזו.',
    '   - אל תשאל שאלות עם priority גבוה יותר, עד שכל השאלות מה-priority הנמוך קיבלו מענה מלא.',
    '2. סגנון דיבור (Tone & Style):',
    '   - היה אנושי, שירותי ונעים. אל תישמע כמו רובוט או טופס.',
    '   - דבר בשפה טבעית ("במה אתה עוסק?" עדיף על "אנא בחר סוג עסק").',
    '   - התאם את עצמך לתשובות הלקוח (Acknowledge) בקצרה לפני השאלה הבאה.',
    '3. כללי עבודה:',
    '   - אם תנאי ההפעלה (ask_if) לא מתקיים — דלג על השלב (סמן כבוצע).',
    '   - שאל מקסימום 2 שאלות בהודעה (ב-Web) או 1 (ב-WhatsApp).',
    '   - הקפד על constraints ו-required_if.',
    '   - שדה מסוג file: לא לעצור. הוסף ל-attachments_checklist.',
    '',
    derivedQuestions.length ? 'שדות שנגזרים ע״י המערכת (לא לשאול עליהם שאלה):' : '',
    ...(derivedQuestions.length
      ? derivedQuestions.map((q: any) => `- ${q.field_key_en}: נקבע אוטומטית לפי derived_rules (אל תשאל/י על זה בכלל)`)
      : []),
    derivedQuestions.length ? '' : '',
    'רשימת שאלות (Question Bank):',
    formatQuestionBankCompact(questionBankQuestions),
    '',
    validators.length ? 'Validators:' : 'Validators: (none)',
    validators.length ? JSON.stringify(validators, null, 2) : '',
    '',
    handoff.length ? 'Handoff triggers:' : 'Handoff triggers: (none)',
    handoff.length ? JSON.stringify(handoff, null, 2) : '',
    '',
    attachments.length ? 'Attachments checklist:' : 'Attachments checklist: (none)',
    attachments.length ? JSON.stringify(attachments, null, 2) : '',
    '',
    'בסיום השלב: סכם/י במשפט 1–2 ובקש/י אישור/תיקון. אם חסר מידע חובה — המשך לשאול עד להשלמה.',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

// Exported for live regeneration on flow edits (Settings → Save) without requiring backend restart.
// NOTE: This is NOT a FlowSchema export and will be ignored by built-in seeding.
export function buildTopicSplitProcessPrompt(procFile: RawProcessFile): string {
  return buildProcessPrompt(procFile);
}

function loadProcessFile(processKey: string): RawProcessFile {
  const procMeta = (MANIFEST.processes || []).find((p: any) => p.process_key === processKey);
  if (!procMeta) throw new Error(`Missing process metadata for key: ${processKey}`);
  const p = path.join(__dirname, 'chocoClalSmbTopicSplit', procMeta.file);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as RawProcessFile;
}

function isNumeric0123ProcessKey(key: string): boolean {
  return /^(0[1-9]|1[0-9]|2[0-3])_/.test(String(key || ''));
}

function flowNumberFromProcessKey(key: string): string {
  const m = /^(\d\d)_/.exec(String(key || ''));
  return m ? m[1] : key;
}

export const chocoClalSmbTopicSplitProcessFlows = (() => {
  const orderedKeys: string[] = Array.isArray(MANIFEST.process_order) ? MANIFEST.process_order : [];
  const keys = orderedKeys.filter(isNumeric0123ProcessKey);

  return keys.map((processKey) => {
    const procFile = loadProcessFile(processKey);
    const n = flowNumberFromProcessKey(processKey);

    const questions = orderQuestionsByUiPolicy(procFile, simplifyQuestions(procFile.questions || []));
    const customerQuestions = questions.filter((q: any) => String(q?.audience || 'customer') === 'customer');
    const questionFieldKeys = uniq(customerQuestions.map((q: any) => q.field_key_en).filter(Boolean) as string[]);
    const fieldsToCollect = uniq([...questionFieldKeys]);

    const fieldDefinitions: Record<string, any> = {};
    for (const q of customerQuestions) {
      if (!q.field_key_en) continue;
      const override = (procFile as any)?.field_schemas?.[q.field_key_en];
      const baseType = mapDataTypeToFieldType(q.data_type);

      // Defensive mapping: field_schemas overrides are for UI/wording tweaks, but must not break types.
      // If question is numeric/boolean, always keep the computed type even if the override says otherwise.
      const overrideTypeRaw = String(override?.type ?? '').trim();
      const overrideType = (overrideTypeRaw === 'string' || overrideTypeRaw === 'number' || overrideTypeRaw === 'boolean')
        ? overrideTypeRaw
        : '';
      const resolvedType: 'string' | 'number' | 'boolean' = (
        baseType === 'number' || baseType === 'boolean'
          ? baseType
          : (overrideType as any) || baseType
      );

      // Enums: for select/enum questions, constrain extraction to allowed options.
      // This is critical to prevent numeric cross-field pollution (e.g., ח"פ spilling into enum fields).
      const shouldAddEnum = resolvedType === 'string'
        && (String(q.data_type) === 'enum' || String(q.input_type) === 'select')
        && q.options_he;
      const enumOptions = shouldAddEnum ? parseOptionsHeEnum(q.options_he) : undefined;

      const extra: Record<string, any> = {};
      if (resolvedType === 'string') {
        if (typeof override?.minLength === 'number' && Number.isFinite(override.minLength)) extra.minLength = override.minLength;
        if (typeof override?.maxLength === 'number' && Number.isFinite(override.maxLength)) extra.maxLength = override.maxLength;
        if (typeof override?.pattern === 'string' && override.pattern.trim()) extra.pattern = override.pattern;
        if (typeof override?.prohibitedWordsList === 'string' && override.prohibitedWordsList.trim()) {
          extra.prohibitedWordsList = override.prohibitedWordsList.trim();
        }
        if (typeof override?.sensitive === 'boolean') extra.sensitive = override.sensitive;
        if (Array.isArray(override?.enum) && override.enum.length > 0) extra.enum = override.enum;
      }

      fieldDefinitions[q.field_key_en] = {
        type: resolvedType,
        description: override?.description || q.question_he || q.field_key_en,
        priority: normalizePriority(override?.priority ?? q.priority),
        ...(enumOptions ? { enum: enumOptions } : {}),
        ...extra,
      };
    }

    const isFlow02 = processKey === '02_intent_segment_and_coverages';
    const shouldResolveSegment = processKey === '01_welcome_user' || processKey === '02_intent_segment_and_coverages';
    const mainNextStage = shouldResolveSegment ? 'resolveSegment' : 'route';
    const initialStage = isFlow02 ? 'prefillCoverages' : 'main';

    return {
      name: `Flow ${n}: ${procFile.process.title_he || processKey}`,
      slug: `flow_${processKey}`,
      description: `Modular process for ${processKey}`,
      version: 1,
      definition: {
        stages: {
          ...(isFlow02 ? {
            prefillCoverages: {
              name: `Flow ${n} (prefill coverages)`,
              description: 'System: prefill coverages from segment defaults (non-blocking)',
              prompt: [
                'CRITICAL: This stage should NOT generate a response message.',
                'Do NOT generate any message.',
                'System Internal: Prefilling coverages from segment defaults...',
              ].join('\n'),
              fieldsToCollect: [],
              orchestration: {
                customCompletionCheck: { condition: 'true' },
                questionPolicy: { maxQuestionsPerTurn: { whatsapp: 1, web: 2 } },
              },
              action: {
                toolName: 'insurance.prefillCoveragesFromSegmentDefaults',
                // IMPORTANT: action condition runs in a scope where missing identifiers can throw ReferenceError.
                // Use `typeof` to safely handle the first run when the flag doesn't exist yet.
                condition: 'segment_id && (typeof segment_coverages_prefilled_v1 === \"undefined\" || segment_coverages_prefilled_v1 !== true)',
                allowReExecutionOnError: true,
                onError: { behavior: 'continue' },
              },
              nextStage: 'main',
            },
          } : {}),
          main: {
            name: `Flow ${n}`,
            description: `Process ${processKey} • ${procFile.process.title_he || processKey}`,
            prompt: buildProcessPrompt(procFile),
            fieldsToCollect,
            orchestration: {
              // Condition-only completion: derived from question metadata (required/conditional + ask_if/required_if).
              customCompletionCheck: { condition: buildProcessCompletionExpression(procFile as any) },
              // The stage prompt includes its own question-bank orchestration; suppress core missing-fields/bulk rules.
              questionPolicy: {
                maxQuestionsPerTurn: { whatsapp: 1, web: 2 },
                disableBulkCollectionRule: true,
                suppressCoreMissingFieldsSection: true,
              },
              systemPromptHooks: {
                beforePrompt: [
                  ...(isFlow02 ? [{
                    condition: 'userData.segment_coverages_prefilled_v1 === true',
                    promptLines: [
                      '',
                      'Flow02 — כיסויים דינאמיים לפי סגמנט (קריטי):',
                      '- אם segment_coverages_prefilled_v1=true, הכיסויים כבר הוגדרו לפי קטלוג הסגמנטים.',
                      '- אל תשאל/י על כיסוי אם השדה כבר קיים ב-userData והוא false. התייחס/י לזה כ״לא רלוונטי לפי הסגמנט״.',
                      '- שדות כיסוי רלוונטיים בשלב זה:',
                      '  - ch1_contents_selected, ch1_stock_selected, ch2_building_selected, ch4_burglary_selected, ch5_money_selected, ch6_transit_selected, ch7_third_party_selected, ch8_employers_selected, ch9_product_selected, ch10_electronic_selected, cyber_selected, terror_selected',
                      '  - business_interruption_type: אם כבר "לא" — אל תשאל/י על אובדן הכנסה.',
                      '- חריג (מותר): אם הלקוח מבקש במפורש כיסוי שסומן false לפי הסגמנט — אפשר לאפשר זאת:',
                      '  - שאל/י שאלה קצרה לאישור ואז שמור/י את השדה ל-true (או עבור אובדן הכנסה: business_interruption_type="אובדן הכנסה (פיצוי יומי)").',
                      '  - אל תציע/י את הכיסוי מיוזמתך אם הוא false; רק בתגובה לבקשה מפורשת של הלקוח.',
                    ],
                  }] : []),
                  {
                    condition: `(() => {
                      const seg = String(userData.segment_name_he || userData.business_segment || '').trim();
                      const occ = String(userData.business_occupation || '').trim();
                      const st = String(userData.business_site_type || '').trim();
                      return Boolean(seg || occ || st);
                    })()`,
                    promptLines: [
                      '',
                      'התאמה לסגמנט (חובה): אם זיהית סגמנט/עיסוק/סוג אתר (למשל: segment_name_he / business_segment / business_occupation / business_site_type) — התאם את הניסוח של השאלות לעולם המונחים של הלקוח.',
                      '- במקום ניסוחים כלליים כמו "העסק/בית העסק" נסח באופן מקצועי לפי התחום (משרד/קליניקה/סטודיו/חנות וכו׳) ושמור על אותו טמפרמנט ושפה מקצועית שהלקוח משתמש בה.',
                      '- הראה עניין אמיתי בתחום העיסוק (שאלה/הערה קצרה, בלי חפירות), אבל אל תסטה מהשדות שחסרים בשלב.',
                    ],
                  },
                  {
                    condition: `(() => {
                      const s = [
                        userData.segment_name_he,
                        userData.business_segment,
                        userData.business_occupation,
                        (templateContext && templateContext.__recent_user_text) || '',
                      ].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
                      return /(עו״ד|עו\\"ד|עורך\\s*דין|עורכי\\s*דין|משרד\\s*עורכ)/i.test(s);
                    })()`,
                    promptLines: [
                      '',
                      'סגמנט זוהה: עורכי דין — התאמת ניסוח (קריטי):',
                      '- אם יש סתירה בין היסטוריית ההודעות של הלקוח לבין userData (למשל segment_name_he ישן/לא רלוונטי) — התייחס להודעת הלקוח כ-ground truth.',
                      '- בכל שאלה שבה מופיע "עסק/בית העסק" חובה להשתמש ב-"משרד עורכי הדין" / "המשרד" (לפי טבעיות המשפט).',
                      '- אל תכתוב "עו״ד" בניסוח שלך. כתוב במפורש: "עורך דין" / "עורכי דין".',
                      '- להתייחס למיקום הפיזי כמיקום המשרד (לא "מיקום העסק" כללי).',
                      'דוגמאות ניסוח (להשראה, לא ציטוט חובה):',
                      '- במקום "מה שם העסק?" → "מה שם משרד עורכי הדין שלך?"',
                      '- במקום "נא לציין שם בית העסק." → "נא לציין את שם משרד עורכי הדין."',
                      '- במקום "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במשרד עורכי הדין שלך?"',
                      '- במקום "נא לציין יישוב." → "באיזה יישוב נמצא משרד עורכי הדין?"',
                    ],
                  },
                  {
                    condition: `(() => {
                      const s = [
                        userData.segment_name_he,
                        userData.business_segment,
                        userData.business_occupation,
                        (templateContext && templateContext.__recent_user_text) || '',
                      ].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
                      return /(רואי\\s*חשבון|רואה\\s*חשבון|הנהלת\\s*חשבונות|רו״ח|רו\\"ח)/i.test(s);
                    })()`,
                    promptLines: [
                      '',
                      'סגמנט זוהה: רואי חשבון / הנהלת חשבונות — התאמת ניסוח (קריטי):',
                      '- אם יש סתירה בין היסטוריית ההודעות של הלקוח לבין userData (למשל segment_name_he ישן/לא רלוונטי) — התייחס להודעת הלקוח כ-ground truth.',
                      '- בכל שאלה שבה מופיע "עסק/בית העסק" חובה להשתמש ב-"משרד רואי החשבון" / "המשרד" (לפי טבעיות המשפט).',
                      '- אל תכתוב "רו״ח" בניסוח שלך. כתוב במפורש: "רואי חשבון".',
                      'דוגמאות ניסוח (להשראה, לא ציטוט חובה):',
                      '- במקום "מה שם העסק?" → "מה שם משרד רואי החשבון שלך?"',
                      '- במקום "ומה התפקיד שלך בעסק?" → "תודה על המידע. ומה התפקיד שלך במשרד רואי החשבון? (למשל: בעלים, מורשה חתימה וכו׳)"',
                      '- במקום "נא לציין יישוב." → "באיזה יישוב נמצא משרד רואי החשבון?"',
                    ],
                  },
                  {
                    condition: `(() => {
                      const s = [
                        userData.business_segment,
                        userData.business_occupation,
                        (templateContext && templateContext.__recent_user_text) || '',
                      ].map((x) => String(x || '').trim()).filter(Boolean).join(' ');
                      return /הנדסא/i.test(s);
                    })()`,
                    promptLines: [
                      '',
                      'טרמינולוגיה לקוח — הנדסאים (קריטי):',
                      '- הלקוח/ה השתמש/ה בביטוי "משרד הנדסאים". חובה לשמור על אותו ניסוח בדיוק לאורך השיחה.',
                      '- אל תחליף/י ל-"משרד אדריכלים" או ניסוח אחר, גם אם הסגמנט מזוהה כ-"משרד אדריכלים / מהנדסים".',
                      '- בכל מקום שבו היית כותב/ת "העסק/בית העסק" השתמש/י ב-"משרד הנדסאים" / "המשרד" לפי טבעיות המשפט.',
                    ],
                  },
                ],
              },
            },
            nextStage: mainNextStage,
          },
          ...(shouldResolveSegment ? {
            resolveSegment: {
              description: 'System: resolve segment (non-blocking)',
              prompt: [
                'CRITICAL: This stage should NOT generate a response message.',
                'Do NOT generate any message.',
                'System Internal: Resolving segment...',
              ].join('\n'),
              fieldsToCollect: [],
              action: {
                toolName: 'insurance.resolveSegment',
                // Run only if we still don't have a segment id, and we have some activity text.
                // (kseval evaluates this against userData directly.)
                condition: '((typeof segment_id === \"undefined\" || !segment_id) || (typeof segment_resolution_confidence !== \"undefined\" && Number(segment_resolution_confidence) < 0.7)) && (business_segment || business_activity_and_products || business_used_for || business_occupation || industry || activity_description || segment_description)',
                allowReExecutionOnError: true,
                onError: { behavior: 'continue' },
              },
              nextStage: 'route',
            },
          } : {}),
          route: {
            description: 'System: routing to next flow',
            prompt: [
              'CRITICAL: This stage should NOT generate a response message.',
              'Do NOT generate any message.',
              'System Internal: Routing...',
            ].join('\n'),
            fieldsToCollect: [],
            action: { toolName: 'insurance.markProcessComplete' },
            nextStage: undefined,
          },
          error: {
            description: 'שגיאה / העברה לנציג',
            prompt:
              'נראה שיש בעיה או שחסר מידע מהותי להמשך.\n' +
              'אני מעביר/ה את זה לנציג/ת אנושי/ת / חתם/ת להמשך טיפול.',
            fieldsToCollect: [],
            nextStage: undefined,
          },
          decidenextstep: {
            description: 'Fallback stage for LLM hallucinations',
            prompt: 'System Internal: Redirecting...',
            fieldsToCollect: [],
            nextStage: 'error',
          },
        },
        fields: fieldDefinitions,
        config: {
          initialStage,
          errorStage: 'error',
          ui: (procFile as any)?.runtime?.ui,
          // Make Flow 01 the default entry flow
          ...(processKey === '01_welcome_user' ? { defaultForNewUsers: true } : {}),
        },
      },
    };
  });
})();
