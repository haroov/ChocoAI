# Choco • Production Dynamic Questionnaire (Clal SMB)

מטרת החבילה: לאפשר ל-**Cursor** לייצר/לעדכן Flow דינאמי שממלא את טופס ההצעה של כלל לבית עסק בצורה חכמה לשיחה ב-**Web Chat** או **WhatsApp**.

> מקור: טופס הצעה לביטוח בית עסק – כלל (מק״ט 15943 07/2025).  
> הקונפיג מתיישב עם פרקי הכיסוי (1–10) + נספחי סייבר/טרור + חלקי עבר ביטוחי/הצהרות.

---

## קבצים בחבילה

- `Clal_SMB_Dynamic_Smart_Questionnaire.PROD.json`  
  קונפיג Production מלא: stages, question bank, מודולים, ולידציות, הנחיות ערוץ.

- `Clal_SMB_Production_Flow.mermaid`  
  דיאגרמת Mermaid תואמת.

---

## עקרונות Production (אלו לא הערות — אלו דרישות)

1. **שלב 01 ו-02 חייבים לרוץ לפני כל "פרטי כיסוי"**  
   - 01 = זיהוי (פרטי קשר + פרטי עסק מינימליים)  
   - 02 = בירור צרכים + בחירת כיסויים (Gate)

2. **ב-WhatsApp: שאלה אחת בכל הודעה**  
   `channel_profiles.whatsapp.max_questions_per_turn = 1`

3. **מסמכים (attachments) לא חוסמים**  
   - שאלות `file` מצטברות ל-checklist (`attachments_checklist`)  
   - מבקשים בסוף / או כשחובה.

4. **איסור איסוף כרטיס אשראי בצ׳אט**  
   - תשלום רק דרך טופס מאובטח / קישור סליקה.

5. **סיכום ביניים בסוף כל Stage**  
   - אם לקוח מתקן — לבצע rewrite של השדות ואז להמשיך.

---

## איך לממש Flow חדש בשוקו (צ׳קליסט ל-Cursor)

### Step 1 — להוסיף את הקונפיג לריפו
1. צור תיקיה: `src/flows/choco/clal_smb/`
2. הוסף את הקבצים:
   - `questionnaire.prod.json` (העתק של `Clal_SMB_Dynamic_Smart_Questionnaire.PROD.json`)
   - `flow.mermaid` (ל-docs)

### Step 2 — לבנות Runner דינאמי (אלגוריתם)
בכל הודעת משתמש:

1. טען `conversation_state` (JSONB) מה-DB.
2. קבע `current_stage_key` (או stage ראשון אם חדש).
3. עבור על `stages[]` לפי סדר:
   - דלג על stage אם `ask_if` לא מתקיים.
   - בתוך stage, עבור על `question_ids` לפי סדר.
4. לכל שאלה:
   - דלג אם כבר יש ערך ב-`json_path`.
   - דלג אם `ask_if` לא מתקיים.
   - דלג אם `required_if` לא מתקיים.
   - אחרת — זו "השאלה הבאה".

5. שלח prompt לפי הערוץ:
   - `prompt_variants.web_chat` או `prompt_variants.whatsapp`
6. אחרי תשובה:
   - בצע parse לפי `data_type` + `input_type`
   - שמור ל-`json_path`
   - הרץ `derived_rules`
   - הרץ `validators` (אם נכשל → שאל שוב עם `error_he`)

### Step 3 — מודולים
אל תנסה "לרוץ לפי מודולים" ידנית — stage 02 מפעיל flags ואז stage 04 כבר מסונן באמצעות `ask_if`.

### Step 4 — טבלאות (table)
לשאלות עם `input_type=table`:
- ב-WhatsApp: איסוף שורה-שורה (Row Wizard)
- ב-Web: טבלת UI (rows add/remove)
- שמירה ל-json כ-array של objects.

דוגמאות:
- `Q129` רכבים מובילים (פרק 6)  
- `Q134` טבלת עובדים (פרק 8)

### Step 5 — מסמכים
ייצר endpoint / UI שמציג ללקוח:
- “חסרים מסמכים” מתוך `attachments_checklist`
- מאפשר העלאה, ומעדכן `json_path`

---

## חוקים חיתומיים שכדאי להרים ל-UI validations
(מופיעים גם ב-`validators`):

- צד ג׳: 500,000–10,000,000 במדרגות 500,000  
- אובדן הכנסה יומי: מקסימום 5,000 ₪ ליום  
- סייבר: מחזור עד 50,000,000 ₪

---

## בדיקות מומלצות (QA)
- WhatsApp: 1 שאלה בכל הודעה + פירוק multi-select למספרים.
- בחירה ב-3א *לא מאפשרת* 3ב (ולהפך) — באמצעות `derived_rules`.
- אם `has_physical_premises = לא` → לא לשאול שאלות מבנה/מיגון/סביבה.
- אם `cyber_selected = כן` אבל תכולה <= 100,000 → הצג הודעת זכאות (להוסיף rule אם תרצו).

---

## הערה קצרה על הרחבה עתידית
אם מוסיפים עוד חברת ביטוח / מוצר:
- משכפלים את הקובץ
- מעדכנים:
  - `meta`
  - `validators`
  - `modules_catalog`
  - question bank

