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
    priority: q.priority,
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

function buildProcessPrompt(procFile: RawProcessFile): string {
  const p = procFile.process;
  const askIf = p.ask_if ? p.ask_if : '—';
  const audience = p.audience || 'customer';

  const questions = simplifyQuestions(procFile.questions || []);
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
    'רשימת שאלות (Question Bank):',
    formatQuestionBankCompact(questions),
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

    const questions = simplifyQuestions(procFile.questions || []);
    const questionFieldKeys = uniq(questions.map((q: any) => q.field_key_en).filter(Boolean) as string[]);
    const fieldsToCollect = uniq([...questionFieldKeys]);

    const fieldDefinitions: Record<string, any> = {};
    for (const q of questions) {
      if (!q.field_key_en) continue;
      const override = (procFile as any)?.field_schemas?.[q.field_key_en];
      fieldDefinitions[q.field_key_en] = {
        type: override?.type || mapDataTypeToFieldType(q.data_type),
        description: override?.description || q.question_he || q.field_key_en,
        priority: override?.priority ?? q.priority,
      };
    }

    const shouldResolveSegment = processKey === '01_welcome_user' || processKey === '02_intent_segment_and_coverages';
    const mainNextStage = shouldResolveSegment ? 'resolveSegment' : 'route';

    return {
      name: `Flow ${n}: ${procFile.process.title_he || processKey}`,
      slug: `flow_${processKey}`,
      description: `Modular process for ${processKey}`,
      version: 1,
      definition: {
        stages: {
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
                condition: '!segment_id && (business_segment || business_activity_and_products || business_used_for || business_occupation || industry || activity_description || segment_description)',
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
          initialStage: 'main',
          errorStage: 'error',
          ui: (procFile as any)?.runtime?.ui,
          // Make Flow 01 the default entry flow
          ...(processKey === '01_welcome_user' ? { defaultForNewUsers: true } : {}),
        },
      },
    };
  });
})();
