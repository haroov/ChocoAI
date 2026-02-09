# Choco • Clal SMB — Topic-Split Questionnaire (PROD)

החבילה הזו מפצלת את השאלון הגדול (`SMB_Dynamic_Smart_Questionnaire.PROD.json`) לסט תהליכים קטנים לפי **נושאים וכיסויים**,
כדי שה‑LLM יוכל לבצע כל פעם **שלב אחד** (ב‑web chat או ב‑WhatsApp) בצורה יציבה.

## מה יש כאן

- `MANIFEST.PROD.json` — סדר הריצה + תנאי `ask_if` לכל תהליך.
- `01_...json` עד `23_...json` — כל קובץ הוא "תהליך" (Process) קטן:
  - מטא־דאטה + `runtime` (מדיניות שיחה + תלויות/ברירות מחדל)
  - רשימת `questions` רלוונטית בלבד
  - `validators` רלוונטיים בלבד
  - `handoff_triggers` ו‑`attachments_checklist` רלוונטיים בלבד

## עקרונות Best Practice (SMB Insurance Sales)

1. **Momentum קודם, עומק אחר כך**  
   קודם מבינים פעילות/סגמנט ובוחרים כיסויים, ורק לאחר מכן נכנסים לפרטים טכניים.
2. **שאלות דינמיות לפי כיסוי**  
   שאלון מבנה/תכולה/מלאי/צד ג׳/מעבידים/מוצר/סייבר נשאל **רק אם** הכיסוי נבחר.
3. **התאמה לערוץ**  
   - WhatsApp: שאלה אחת בכל הודעה (אין quick replies, multi-select עם מספרים/CSV).
   - Web chat: עד 2 שאלות בכל הודעה + כפתורים.

## איך להריץ בתזמור (Cursor)

### אלגוריתם תזמור מומלץ (פסאודו-קוד)

```ts
import manifest from './MANIFEST.PROD.json';

for (const step of manifest.process_order) {
  const proc = loadJson(`./${step}.json`);

  // 1) Evaluate ask_if against the collected state
  if (proc.process.ask_if && !evaluate(proc.process.ask_if, state)) continue;

  // 2) Ask questions sequentially, respecting:
  //    - proc.runtime.engine_contract.channel_profiles[channel]
  //    - question.required_mode + question.required_if
  //    - proc.validators
  //    - proc.runtime.engine_contract.attachments_strategy
  await runQuestionLoop(proc.questions, state, channel);

  // 3) checkpoint/save after each process
  saveState(state);
}
```

### הערות יישומיות

- שדות בחירה של כיסויים נמצאים ב־`02_intent_segment_and_coverages.json` (כדי לא לחזור עליהם בכל פרק).
- שדות "internal" (כמו הצהרת סוכן) נמצאים בקובץ `23_internal_agent_section.json` — **לא לשאול לקוח**.

## מיפוי לתהליך העסקי

- 01–02: זיהוי + בירור צרכים + בחירת כיסויים
- 03–06: מידע על מבנה/סיכונים (רק אם יש מיקום פיזי או כיסויי רכוש)
- 07–20: שאלוני כיסויים (רכוש/חבויות/סייבר/טרור)
- 21–22: עבר ביטוחי + הצהרות/חתימות
- 23: פנימי לסוכן

## גרסאות

- Generated at (UTC): 2026-02-04T18:00:42Z
- Carrier: Clal Insurance
