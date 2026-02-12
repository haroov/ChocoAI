/**
 * Choco • Clal SMB — Topic-Split Router Flow (PROD)
 * Generated at (UTC): 2026-02-04T18:45:55Z
 *
 * This flow reads the topic-split MANIFEST + process JSON files, and runs each process as a separate stage.
 * It is designed for WhatsApp / Web chat sales flows, so each stage stays small and digestible.
 *
 * Folder layout expected (relative to this file):
 *   ./chocoClalSmbTopicSplit/MANIFEST.PROD.json
 *   ./chocoClalSmbTopicSplit/01_welcome_user.json
 *   ...
 */

import fs from 'fs';
import path from 'path';
import MANIFEST_JSON from './chocoClalSmbTopicSplit/MANIFEST.PROD.json';
import { buildProcessCompletionExpression } from './chocoClalSmbTopicSplitCompletion';
import { getSegmentsCatalogProd } from '../../insurance/segments/loadSegmentsCatalog';

const MANIFEST: any = MANIFEST_JSON as any;

function buildSegmentGroupContext(): string {
  try {
    const catalog = getSegmentsCatalogProd();
    const groups = Array.isArray((catalog as any)?.segment_groups) ? (catalog as any).segment_groups : [];
    const lines = groups
      .map((g: any) => `- ${String(g?.group_name_he || '').trim()} (ברירת מחדל: ${String(g?.default_site_type_he || '').trim()})`)
      .filter((l: string) => !l.includes('-  (ברירת מחדל: )'));
    return lines.length ? lines.join('\n') : '(none)';
  } catch {
    return '(segments catalog not loaded)';
  }
}

function buildGlobalRulesHe(): string {
  const SEGMENT_GROUP_CONTEXT = buildSegmentGroupContext();
  return `את/ה ChocoAI — סוכן/ת ביטוח דיגיטלי/ת (SMB) עבור כלל ביטוח.

*** חוקים קריטיים (לא ניתן לעבור עליהם) ***
1. הודעת פתיחה: אם מוגדרת הודעת פתיחה לשלב, חובה להתחיל איתה בדיוק, מילה במילה.
2. כמות שאלות: אסור לשאול יותר מ-2 פרטים בהודעה אחת! (אלא אם מדובר בפרטי קשר בסיסיים כמו שם+נייד+מייל — אז ניתן עד 4). קבץ שאלות קשורות להודעה אחת.
3. סדר: לשאול לפי סדר העדיפויות.
4. מגדר: ברירת המחדל היא זכר. אם המשתמש מגלה את מגדרו (במפורש או במשתמע), ציין זאת בשדה 'proposer_gender' (ערכים: male/female) והתאם את כל הניסוחים שלך למגדר זה.
5. העשרה (Enrichment): כאשר המשתמש מציין את עיסוקו ('business_occupation'), נסה להסיק את 'business_site_type' (סוג העסק/אתר) בצורה סבירה. אם לא בטוח — שאל את שאלת סוג העסק.
6. צמצום שאלות: אם הצלחת להסיק את סוג העסק ('business_site_type') מהעיסוק, הימנע מלשאול "אם אחר - פרט". שאל רק את פרטי ההמשך החסרים (ת.ז, תפקיד). תשובות כמו "יש לי משרד עורכי דין" עונות גם על העיסוק וגם על סוג העסק.
7. חילוץ מידע מקדים (Proactive Extraction): אם הלקוח מספק מידע עבור שדות שטרם שאלת (למשל: "אני עורך דין" בתחילת השיחה) — חובה לחלץ ולשמור את המידע בשדה המתאים ("business_occupation") מיד, גם אם זה לא התור שלו לפי הסדר.
8. מניעת כפילות: לפני שאתה שואל שאלה, בדוק אם השדה (field_key) כבר מלא. אם כן — דלג עליו! אל תשאל על מידע שכבר יש לך.
9. פנייה ללקוח: אם ידוע שם פרטי (user_first_name / first_name / proposer_first_name) — פנה אליו בשם הפרטי. אל תפנה ללקוח לפי מקצוע/סגמנט (למשל: "עורך דין") ואל תכתוב "מעולה, עורך דין". אפשר להגיד "מעולה" או "מעולה, ליאב".

קבוצות סגמנטים (להכוונה בלבד):
${SEGMENT_GROUP_CONTEXT}

השיחה מתנהלת בעברית. שמות השדות/keys באנגלית.

כללי ערוץ:
- WhatsApp: **שאלה אחת בלבד** בכל הודעה. טקסט קצר. אין Quick Replies.
- Web chat: **שאלה אחת בלבד** (או מקסימום 2 אם הן קשורות מאוד).

כללי Best Practice (US SMB sales):
- מתחילים ב״זיהוי + בירור צרכים + בחירת כיסויים״ ורק אז נכנסים לפרטים.
- שואלים רק מה שרלוונטי לכיסוי שנבחר.
- אם הלקוח לא יודע סכום: אפשר אומדן זמני.

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
}

type RawProcessFile = {
  meta?: any;
  runtime?: any;
  process: {
    process_key: string;
    title_he: string;
    description_he?: string | null;
    opening_message?: string;
    opening_message_he?: string;
    ask_if?: string | null;
    audience?: 'customer' | 'internal' | string;
    notes_best_practice_he?: string[];
    included_module_keys?: string[];
  };
  questions: any[];
  validators?: any[];
  handoff_triggers?: any[];
  attachments_checklist?: any[];
};

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
    audience: q.audience,
    priority: q.priority,
    conversational: q.conversational,
    notes_logic: q.notes_logic,
    json_path: q.json_path,
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

function buildProcessPrompt(procFile: RawProcessFile): string {
  const p = procFile.process;
  const askIf = p.ask_if ? p.ask_if : '—';
  const audience = p.audience || 'customer';

  const questions = orderQuestionsByUiPolicy(procFile, simplifyQuestions(procFile.questions || []));
  const validators = procFile.validators || [];
  const handoff = procFile.handoff_triggers || [];
  const attachments = procFile.attachments_checklist || [];

  return [
    buildGlobalRulesHe(),
    '',
    `תהליך: ${p.title_he} (${p.process_key})`,
    p.description_he ? `מטרה: ${p.description_he}` : '',
    '',
    `תנאי הפעלה (ask_if): ${askIf}`,
    `קהל יעד: ${audience}`,
    '',
    '',
    'הנחיות לשלב:',
    '- אם תנאי ההפעלה לא מתקיים (לפי הנתונים שכבר נאספו), או אם קהל היעד אינו customer — אל תשאל/י את הלקוח/ה. פשוט סמן/י את השלב כ״בוצע״ והתקדם/י.',
    '- אם התנאי מתקיים — שאל/י את השאלות לפי הרשימה, אחת-אחת (או **מקסימום 2!**), תוך כיבוד required_if/required_mode/constraints.',
    '- שמור/י תשובות בשדה field_key_en (בדיוק כפי שמופיע).',
    '- ערכים מספריים: לשמור כ-number. תאריכים: YYYY-MM-DD.',
    '- שדה מסוג file: לא לעצור. הוסף/י ל-attachments_checklist ובקש/י בהמשך.',
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
    p.opening_message || p.opening_message_he ? `*** הוראה מיידית ***\nאם זו תחילת השיחה/השלב הזה, אתה *חייב* לפתוח עם המשפט הבא (ורק איתו + 1-2 שאלות ראשונות):\n"${p.opening_message || p.opening_message_he}"` : '',
    '',
    'בסיום השלב: סכם/י במשפט 1–2 ובקש/י אישור/תיקון. אם חסר מידע חובה — המשך לשאול עד להשלמה.',
  ]
    .filter(Boolean)
    .join('\n')
    .trim();
}

function loadProcessFile(processKey: string): RawProcessFile {
  const procMeta = (MANIFEST.processes || []).find((p: any) => p.process_key === processKey);
  if (!procMeta) {
    throw new Error(`Missing process metadata for key: ${processKey}`);
  }
  const p = path.join(__dirname, 'chocoClalSmbTopicSplit', procMeta.file);
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as RawProcessFile;
}

function mapDataTypeToFieldType(dataType: string): string {
  if (['number', 'integer', 'currency'].includes(dataType)) return 'number';
  if (dataType === 'boolean') return 'boolean';
  return 'string';
}

function buildFlowComponents() {
  const stages: Record<string, any> = {};
  const fieldDefinitions: Record<string, any> = {
    // Minimal definitions (expand as needed)
    has_physical_premises: { type: 'boolean', description: 'האם יש מקום פיזי/מבנה (משרד/קליניקה/חנות וכו׳)' },
    customer_status: { type: 'string', description: 'האם לקוח חדש או קיים' },
    proposer_gender: { type: 'string', description: 'מגדר המשתמש (male/female) - אם זוהה' },
    business_occupation: { type: 'string', description: 'עיסוק העסק (טקסט חופשי)' },
    has_employees: { type: 'boolean', description: 'האם יש עובדים' },
    has_products_activity: { type: 'boolean', description: 'האם יש פעילות ייצור/שיווק מוצרים' },
    ch1_contents_selected: { type: 'boolean', description: 'בחירת כיסוי תכולה' },
    ch2_building_selected: { type: 'boolean', description: 'בחירת כיסוי מבנה' },
    ch3a_selected: { type: 'boolean', description: 'בחירת אובדן הכנסה (יומי)' },
    ch3b_selected: { type: 'boolean', description: 'בחירת אובדן תוצאתי (רווח גולמי)' },
    ch4_burglary_selected: { type: 'boolean', description: 'בחירת פריצה ושוד' },
    ch5_money_selected: { type: 'boolean', description: 'בחירת כל הסיכונים כספים' },
    ch6_transit_selected: { type: 'boolean', description: 'בחירת רכוש בהעברה' },
    ch7_third_party_selected: { type: 'boolean', description: 'בחירת צד ג׳' },
    ch8_employers_selected: { type: 'boolean', description: 'בחירת חבות מעבידים' },
    ch9_product_selected: { type: 'boolean', description: 'בחירת אחריות מוצר' },
    ch10_electronic_selected: { type: 'boolean', description: 'בחירת ציוד אלקטרוני' },
    cyber_selected: { type: 'boolean', description: 'בחירת נספח סייבר' },
    terror_selected: { type: 'boolean', description: 'בחירת נספח טרור' },
  };

  const orderedKeys: string[] = MANIFEST.process_order || [];
  const procFiles: RawProcessFile[] = orderedKeys.map(loadProcessFile);

  for (let i = 0; i < procFiles.length; i++) {
    const procFile = procFiles[i];
    const procKey = procFile.process.process_key;
    const stageSlug = `p${procKey}`;
    const nextStageSlug = i < procFiles.length - 1 ? `p${procFiles[i + 1].process.process_key}` : 'done';

    const questions = orderQuestionsByUiPolicy(procFile, simplifyQuestions(procFile.questions || []));
    const customerQuestions = questions.filter((q: any) => String(q?.audience || 'customer') === 'customer');
    const questionFieldKeys = uniq(customerQuestions.map((q: any) => q.field_key_en).filter(Boolean) as string[]);
    const fields = uniq([...questionFieldKeys]);

    // Register dynamic fields
    for (const q of customerQuestions) {
      if (q.field_key_en) {
        const override = (procFile as any)?.field_schemas?.[q.field_key_en];
        fieldDefinitions[q.field_key_en] = {
          type: override?.type || mapDataTypeToFieldType(q.data_type),
          description: override?.description || q.question_he || q.field_key_en,
          priority: normalizePriority(override?.priority ?? q.priority),
        };
      }
    }

    stages[stageSlug] = {
      name: `${i + 1}. ${procFile.process.title_he}`,
      description: `Process ${procKey} • ${procFile.process.title_he}`,
      prompt: buildProcessPrompt(procFile),
      fields,
      fieldsToCollect: fields,
      orchestration: {
        customCompletionCheck: { condition: buildProcessCompletionExpression(procFile as any) },
        questionPolicy: {
          maxQuestionsPerTurn: { whatsapp: 1, web: 2 },
          disableBulkCollectionRule: true,
          suppressCoreMissingFieldsSection: true,
        },
        systemPromptHooks: {
          beforePrompt: [
            ...(procKey === '02_intent_segment_and_coverages' ? [{
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
              // Segment-aware phrasing (generic): if we know the segment/occupation/site type, adapt wording.
              // Keep it non-binding for non-lawyers; we add a stricter hook below for lawyers.
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
              // Lawyer-specific strict phrasing: "business" => "law firm office", and address => physical office.
              condition: `(() => {
                const s = String(userData.segment_name_he || userData.business_segment || userData.business_occupation || '').trim();
                return /עורכ/.test(s) && /דין/.test(s);
              })()`,
              promptLines: [
                '',
                'סגמנט זוהה: עורכי דין — התאמת ניסוח (קריטי):',
                '- בכל שאלה שבה מופיע "עסק/בית העסק" חובה להשתמש ב-"משרד עורכי הדין" / "המשרד" (לפי טבעיות המשפט).',
                '- להתייחס למיקום הפיזי כמיקום המשרד (לא "מיקום העסק" כללי).',
                'דוגמאות ניסוח (להשראה, לא ציטוט חובה):',
                '- במקום "מה שם העסק?" → "מה שם משרד עורכי הדין שלך?"',
                '- במקום "נא לציין שם בית העסק." → "נא לציין את שם משרד עורכי הדין."',
                '- במקום "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במשרד עורכי הדין שלך?"',
                '- במקום "נא לציין יישוב." → "באיזה יישוב נמצא משרד עורכי הדין?"',
              ],
            },
          ],
        },
      },
      nextStage: nextStageSlug,
    };
  }

  stages['done'] = {

    description: 'סיום',
    prompt:
      'סיימנו את כל שלבי השאלון ✅\n' +
      'אם תרצה/י — אוכל לסכם את הפרטים שנאספו ולהפיק תקציר להצעה לחברת הביטוח.',
    fields: [],
    fieldsToCollect: [],
    nextStage: undefined,
  };

  stages['error'] = {

    description: 'שגיאה / העברה לנציג',
    prompt:
      'נראה שיש בעיה או שחסר מידע מהותי להמשך.\n' +
      'אני מעביר/ה את זה לנציג/ת אנושי/ת / חתם/ת להמשך טיפול.',
    fields: [],
    fieldsToCollect: [],
    nextStage: undefined,
  };

  stages['decidenextstep'] = {
    description: 'Fallback stage for LLM hallucinations',
    prompt: 'System Internal: Redirecting...',
    fields: [],
    fieldsToCollect: [],
    nextStage: 'error', // Redirect to error handler or appropriate fallback
  };

  return { stages, fieldDefinitions };
}

const { stages, fieldDefinitions } = buildFlowComponents();

const flow = {
  name: 'Choco • Clal SMB • Topic Split Questionnaire Router',
  slug: 'choco-clal-smb-topic-split-router',
  description: 'Main orchestrator for the modular topic-split questionnaire.',
  version: 1,
  definition: {
    stages,
    fields: fieldDefinitions,
    config: {
      initialStage: 'p01_welcome_user',
      successStage: 'done',
      errorStage: 'error',
    },
  },
};

export default flow;
