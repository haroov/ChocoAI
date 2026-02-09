import { prisma } from '../../../../core';
import { flowHelpers } from '../../flowHelpers';
import { loadClalSmbQuestionnaireProd } from '../../../insurance/questionnaire/loadClalSmbQuestionnaire';
import {
  applyDerivedRules,
  buildInitialQuestionnaireState,
  buildStageSummaryHe,
  computePendingAttachments,
  evaluateHandoffTriggers,
  findQuestionById,
  getNextQuestion,
  parseAndApplyAnswer,
  validateProductionRules,
} from '../../../insurance/questionnaire/engine';
import { setByJsonPath } from '../../../insurance/questionnaire/jsonPath';
import { ToolExecutor, ToolResult } from '../types';
import { replaceTemplateVariables } from '../../../notifications/templates';
import { inferClalSmbFromUserData } from '../../../insurance/questionnaire/segmentInferences';

function safeParseJson(value: unknown): any | null {
  if (!value) return null;
  try {
    return JSON.parse(String(value));
  } catch {
    return null;
  }
}

function isDoneToken(raw: string): boolean {
  const s = raw.trim().toLowerCase();
  return /^(סיום|סיימתי|אין עוד|אין|done|finish|finished|stop)$/i.test(s);
}

function parseTableColumnsFromNotes(notesLogic?: string): string[] {
  const s = String(notesLogic || '').trim();
  const m = /טבלת\s+שורות\s*:\s*([a-z0-9_,\s-]+)/i.exec(s);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

function parseTableRowsFromText(rawAnswer: string, columns: string[]): Array<Record<string, unknown>> | null {
  const raw = String(rawAnswer || '').trim();
  if (!raw) return null;

  // JSON array/object support
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((x) => (typeof x === 'object' && x ? x : { value: x }));
    }
    if (typeof parsed === 'object' && parsed) return [parsed as any];
  } catch {
    // ignore
  }

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const rows: Array<Record<string, unknown>> = [];

  for (const line of lines) {
    const parts = line
      .split(/[|,;]+/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (parts.length === 0) continue;

    if (columns.length > 0) {
      if (parts.length < columns.length) return null;
      const row: Record<string, unknown> = {};
      columns.forEach((c, i) => { row[c] = parts[i] ?? ''; });
      rows.push(row);
    } else {
      // Generic: category, employees_count, annual_wage_ils (best-effort)
      const row: Record<string, unknown> = {};
      row.category = parts[0] ?? '';
      if (parts[1]) row.employees_count = parts[1];
      if (parts[2]) row.annual_wage_ils = parts[2];
      if (parts[3]) row.notes = parts.slice(3).join(' ');
      rows.push(row);
    }
  }

  return rows.length > 0 ? rows : null;
}

function parseIsraelFullAddress(rawAnswer: string): {
  street?: string;
  houseNumber?: string;
  city?: string;
  zip?: string;
} | null {
  const raw = String(rawAnswer || '').trim();
  if (!raw) return null;

  const cleaned = raw
    .replace(/\s+/g, ' ')
    .replace(/，/g, ',')
    .trim();

  const zipMatch = cleaned.match(/\b(\d{5,7})\b/);
  const zip = zipMatch ? zipMatch[1] : undefined;
  const withoutZip = zip ? cleaned.replace(zip, '').replace(/\s+/g, ' ').trim() : cleaned;

  const parts = withoutZip.split(',').map((p) => p.trim()).filter(Boolean);

  // Common format: "<street> <house>, <city>"
  if (parts.length >= 2) {
    const streetPart = parts[0];
    const cityPart = parts[1];
    const streetM = streetPart.match(/^(.*?)(\d+[A-Za-zא-ת]?)$/);
    const street = streetM ? streetM[1].trim() : streetPart;
    const houseNumber = streetM ? streetM[2].trim() : undefined;
    const city = cityPart.trim();
    return { street: street || undefined, houseNumber, city: city || undefined, zip };
  }

  // Fallback: try to detect a trailing house number and city word(s)
  // Example: "היובלים 52 בארותיים"
  const m = withoutZip.match(/^(.+?)\s+(\d+[A-Za-zא-ת]?)\s+([\u0590-\u05FF\"׳״\-\s]+)$/);
  if (m) {
    return {
      street: m[1].trim(),
      houseNumber: m[2].trim(),
      city: m[3].trim(),
      zip,
    };
  }

  return null;
}

async function parseAddressWithGoogleGeocoding(rawAnswer: string): Promise<{
  street?: string;
  houseNumber?: string;
  city?: string;
  zip?: string;
} | null> {
  const apiKey = String(process.env.GOOGLE_MAPS_API_KEY || '').trim();
  if (!apiKey) return null;
  const address = String(rawAnswer || '').trim();
  if (!address) return null;

  try {
    const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
    url.searchParams.set('address', address);
    url.searchParams.set('region', 'il');
    url.searchParams.set('language', 'he');
    url.searchParams.set('key', apiKey);

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) return null;
    const data = await res.json() as any;
    const first = data?.results?.[0];
    if (!first?.address_components) return null;

    const byType = (type: string) => first.address_components.find((c: any) => Array.isArray(c.types) && c.types.includes(type));
    const streetNumber = byType('street_number')?.long_name;
    const route = byType('route')?.long_name;
    const locality = byType('locality')?.long_name
      || byType('administrative_area_level_2')?.long_name
      || byType('administrative_area_level_1')?.long_name;
    const postal = byType('postal_code')?.long_name;

    return {
      street: route || undefined,
      houseNumber: streetNumber || undefined,
      city: locality || undefined,
      zip: postal || undefined,
    };
  } catch {
    return null;
  }
}

function applyBusinessAddressToState(state: any, parsed: { street?: string; houseNumber?: string; city?: string; zip?: string }) {
  if (parsed.city) {
    state.vars.business_city = parsed.city;
    setByJsonPath(state.formJson, 'locations[0].address.city', parsed.city);
  }
  if (parsed.street) {
    state.vars.business_street = parsed.street;
    setByJsonPath(state.formJson, 'locations[0].address.street', parsed.street);
  }
  if (parsed.houseNumber) {
    state.vars.business_house_number = parsed.houseNumber;
    setByJsonPath(state.formJson, 'locations[0].address.house_number', parsed.houseNumber);
  }
  if (parsed.zip) {
    state.vars.business_zip = parsed.zip;
    setByJsonPath(state.formJson, 'locations[0].address.zip', parsed.zip);
  }
  // Store full address for convenience / UI
  const full = [
    [parsed.street, parsed.houseNumber].filter(Boolean).join(' ').trim(),
    parsed.city,
    parsed.zip,
  ].filter(Boolean).join(', ');
  if (full) state.vars.business_address_full = full;
}

function normalizeBusinessCityIfLooksLikeFullAddress(userData: Record<string, unknown>) {
  const cityRaw = String(userData.business_city || '').trim();
  if (!cityRaw) return null;
  // Heuristic: full address usually contains a comma and/or digits.
  if (!/[,\d]/.test(cityRaw)) return null;
  const parsed = parseIsraelFullAddress(cityRaw);
  if (!parsed?.city) return null;
  return parsed;
}

function parseContactDetails(raw: string): { first?: string; last?: string; phone?: string } | null {
  const text = raw.trim();
  // Check for phone number (digits, at least 9 or 10, maybe with hyphens/dots)
  // Heuristic: must have at least 9 digits.
  const phoneMatch = text.match(/[\d\-\.]{9,}/);

  // If no phone found, it might just be the name. But the user prompt specifically asks for phone.
  // We will try to be flexible.

  if (!phoneMatch) return null;

  const phone = phoneMatch[0];
  const namePart = text.replace(phone, '').replace(/[,\-]/g, ' ').trim();

  // Split name by whitespace
  const parts = namePart.split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return { phone };
  }

  // If 1 part: Assign to First Name? (Or Last Name logic? Q001 is Last Name).
  // The prompt is "First Name, Family...". So we assume First Name comes first.
  if (parts.length === 1) {
    return { first: parts[0], phone };
  }

  // If 2+ parts: First is First Name, Rest is Last Name
  const first = parts[0];
  const last = parts.slice(1).join(' ');
  return { first, last, phone };
}

export const insuranceQuestionnaireAnswerTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const convo = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true, channel: true },
    });
    if (!convo?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const userFlow = await prisma.userFlow.findUnique({ where: { userId: convo.userId } });
    if (!userFlow?.flowId) {
      return { success: false, error: 'No active flow', errorCode: 'NO_ACTIVE_FLOW' };
    }

    const questionnaire = loadClalSmbQuestionnaireProd();
    const userData = await flowHelpers.getUserData(convo.userId, userFlow.flowId);

    const currentQid = String(userData.questionnaire_current_qid || '').trim();
    if (!currentQid) {
      return { success: false, error: 'Missing questionnaire_current_qid', errorCode: 'NO_CURRENT_QUESTION' };
    }

    const q = findQuestionById(questionnaire, currentQid);
    if (!q) {
      return { success: false, error: `Unknown question id: ${currentQid}`, errorCode: 'UNKNOWN_QUESTION' };
    }

    // IMPORTANT: Use the *actual last user message* as the answer source of truth.
    // LLM extraction can occasionally mis-assign questionnaire_answer (e.g., pulling a previous entity name),
    // which breaks the questionnaire flow. The user's message content is the safest signal here.
    const lastUserMsg = await prisma.message.findFirst({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'desc' },
      select: { content: true },
    });
    const rawAnswer = String(lastUserMsg?.content || payload.questionnaire_answer || '').trim();

    // If the user is just asking to continue ("המשך", "next", etc.), do not attempt to parse.
    // Keep the current question pointers so the assistant re-asks the current question.
    if (/^(המשך|המשיכי|משיכי|המשיכו|קדימה|next|continue|go on)$/i.test(rawAnswer)) {
      return {
        success: true,
        data: { skipped: true, reason: 'continue_intent' },
        saveResults: {
          questionnaire_answer: '',
          questionnaire_current_qid: currentQid,
          questionnaire_prompt_he: String(userData.questionnaire_prompt_he || ''),
          questionnaire_options_he: String(userData.questionnaire_options_he || ''),
          questionnaire_stage_intro_to_send: String(userData.questionnaire_stage_intro_to_send || ''),
        },
      };
    }
    const existingForm = safeParseJson(userData.insured_form_json) || {};
    const existingVars: Record<string, unknown> = {};
    questionnaire.questions.forEach((qq) => {
      const k = qq.field_key_en;
      if (k in userData && userData[k] !== null && userData[k] !== undefined && userData[k] !== '') {
        existingVars[k] = userData[k];
      }
    });

    const state = buildInitialQuestionnaireState(questionnaire, existingVars, existingForm);

    const inferredSaveResults: Record<string, unknown> = {};

    // Data hygiene: if business_city accidentally contains the full address, normalize it.
    const normalizedFromCity = normalizeBusinessCityIfLooksLikeFullAddress(userData);
    if (normalizedFromCity) {
      applyBusinessAddressToState(state, normalizedFromCity);
      if (normalizedFromCity.city) inferredSaveResults.business_city = normalizedFromCity.city;
      if (normalizedFromCity.street) inferredSaveResults.business_street = normalizedFromCity.street;
      if (normalizedFromCity.houseNumber) inferredSaveResults.business_house_number = normalizedFromCity.houseNumber;
      if (normalizedFromCity.zip) inferredSaveResults.business_zip = normalizedFromCity.zip;
      if (state.vars.business_address_full) inferredSaveResults.business_address_full = state.vars.business_address_full;
    }

    // Segment inferences: fill obvious "site type" and "activity/products" so we don't ask redundant questions.
    const inferred = inferClalSmbFromUserData(userData);
    if (inferred) {
      if (inferred.has_physical_premises !== undefined && (state.vars.has_physical_premises === null || state.vars.has_physical_premises === undefined)) {
        state.vars.has_physical_premises = inferred.has_physical_premises;
        setByJsonPath(state.formJson, 'triage.has_physical_premises', inferred.has_physical_premises);
        inferredSaveResults.has_physical_premises = inferred.has_physical_premises;
      }
      if (inferred.business_site_type && (!Array.isArray(state.vars.business_site_type) || state.vars.business_site_type.length === 0)) {
        state.vars.business_site_type = inferred.business_site_type;
        setByJsonPath(state.formJson, 'business.site_type', inferred.business_site_type);
        inferredSaveResults.business_site_type = inferred.business_site_type;
      }
      if (inferred.business_site_type_other && !state.vars.business_site_type_other) {
        state.vars.business_site_type_other = inferred.business_site_type_other;
        setByJsonPath(state.formJson, 'business.site_type_other', inferred.business_site_type_other);
        inferredSaveResults.business_site_type_other = inferred.business_site_type_other;
      }
      if (inferred.business_used_for && !state.vars.business_used_for) {
        state.vars.business_used_for = inferred.business_used_for;
        setByJsonPath(state.formJson, 'business.used_for', inferred.business_used_for);
        inferredSaveResults.business_used_for = inferred.business_used_for;
      }
      if (inferred.business_activity_and_products && !state.vars.business_activity_and_products) {
        state.vars.business_activity_and_products = inferred.business_activity_and_products;
        setByJsonPath(state.formJson, 'business.activity_description', inferred.business_activity_and_products);
        inferredSaveResults.business_activity_and_products = inferred.business_activity_and_products;
      }

      // Apply Coverage Defaults (Lawyer logic etc.)
      const coverageFlags = [
        'ch1_contents_selected', 'ch2_building_selected', 'ch3a_selected',
        'ch4_burglary_selected', 'ch5_money_selected', 'ch6_transit_selected',
        'ch7_third_party_selected', 'ch8_employers_selected', 'ch9_product_selected',
        'ch10_electronic_selected', 'cyber_selected', 'professional_liability_selected',
      ];

      for (const flag of coverageFlags) {
        // Only set if not already set (don't overwrite user changes if they backtracked?)
        // Actually, inference should probably win if the field is empty/null.
        // We cast as keyof SegmentInference which is safe because we defined it there.
        const val = inferred[flag as keyof typeof inferred];
        if (typeof val === 'boolean' && state.vars[flag] === undefined) {
          state.vars[flag] = val;
          // Coverage flags are often transient vars, but sometimes mapped to form.
          // We don't have a direct form mapping for all flags in the simple map, they drive `enable_if`.
          // But we should persist them to userData via inferredSaveResults so they stick.
          inferredSaveResults[flag] = val;
        }
      }
    }

    // Address UX: allow answering with full address once; auto-fill city/street/house/zip.
    // We trigger this on the first address question (Q022) and also if user provides full address while asked a part.
    if (q.q_id === 'Q022' || ['business_city', 'business_street', 'business_house_number', 'business_zip'].includes(q.field_key_en)) {
      const parsedAddr = (q.q_id === 'Q022'
        ? (await parseAddressWithGoogleGeocoding(rawAnswer)) || parseIsraelFullAddress(rawAnswer)
        : parseIsraelFullAddress(rawAnswer));
      if (parsedAddr && (parsedAddr.city || parsedAddr.street || parsedAddr.houseNumber || parsedAddr.zip)) {
        applyBusinessAddressToState(state, parsedAddr);
        if (parsedAddr.city) inferredSaveResults.business_city = parsedAddr.city;
        if (parsedAddr.street) inferredSaveResults.business_street = parsedAddr.street;
        if (parsedAddr.houseNumber) inferredSaveResults.business_house_number = parsedAddr.houseNumber;
        if (parsedAddr.zip) inferredSaveResults.business_zip = parsedAddr.zip;
        if (state.vars.business_address_full) inferredSaveResults.business_address_full = state.vars.business_address_full;
        // Mark the current field as answered too, to avoid re-asking.
        const v = state.vars[q.field_key_en] ?? rawAnswer;
        state.vars[q.field_key_en] = v;
        setByJsonPath(state.formJson, q.json_path, v);
      }
    }

    // Persona UX: Handle combined First/Last/Phone answer on Q001
    if (q.q_id === 'Q001') {
      const contact = parseContactDetails(rawAnswer);
      if (contact) {
        if (contact.first) {
          state.vars['proposer_first_name'] = contact.first;
          inferredSaveResults['proposer_first_name'] = contact.first;
          setByJsonPath(state.formJson, 'applicant.person.first_name', contact.first); // Path for Q002
        }

        if (contact.last) {
          state.vars['proposer_last_name'] = contact.last;
          inferredSaveResults['proposer_last_name'] = contact.last;
          setByJsonPath(state.formJson, 'applicant.person.last_name', contact.last); // Path for Q001
        } else if (contact.first) {
          // If we only got one name part, but this is Q001 (Last Name),
          // and we assigned it to First Name above... we should probably ensure Q001 is satisfied
          // or let the engine ask Q001 again?
          // If user said "Liav 050...", we parsed "Liav" as First Name, Phone as Phone.
          // Q001 (Last Name) is still empty.
          // So the engine will re-ask Q001?
          // "Please state surname."
          // This is actually CORRECT behavior.
        }

        if (contact.phone) {
          state.vars['proposer_mobile_phone'] = contact.phone;
          inferredSaveResults['proposer_mobile_phone'] = contact.phone;
          setByJsonPath(state.formJson, 'applicant.person.mobile_phone', contact.phone); // Path for Q005
        }

        // If we successfully parsed a Last Name, we need to mark Q001 as done using THAT value.
        // (If we didn't parse a last name, we let the normal flow handle the rawAnswer below or re-ask).
        if (contact.last) {
          // We set it in state.vars above.
          // We also need to populate 'applied.value' logic if we want to skip the "parseAndApplyAnswer" call?
          // But parseAndApplyAnswer is called AFTER this block? No, it's called BELOW (line 446).
          // Wait, I am inserting this BEFORE line 446?
          // Line 341 is BEFORE line 446.

          // If we handled Q001 fully here, we might want to skip `parseAndApplyAnswer` or ensure it doesn't overwrite.
          // `parseAndApplyAnswer` uses `rawAnswer`. If `rawAnswer` is "Liav Gophen 050...",
          // `parseAndApplyAnswer` for Q001 (Last Name) will try to set `proposer_last_name` = "Liav Gophen 050...".
          // WE DO NOT WANT THAT.

          // So if `contact.last` is present, we should probably update `rawAnswer` to just be `contact.last`?
          // Or return early?
          // If we return, we skip the rest of the validations and checking.

          // Better strategy:
          // Since we manually updated the state, we can just let the function flow proceed?
          // But `parseAndApplyAnswer` will overwrite `state.vars['proposer_last_name']` with `rawAnswer`.

          // So we MUST return early if we handled everything, OR modify `rawAnswer`.
          // But `rawAnswer` is a const string.
          // We can't modify `rawAnswer`.
        }
      }
    }

    // Recovery: if questionnaire_current_qid is stale (common after engine upgrades),
    // do NOT consume the user's answer. Instead, jump to the next expected question.
    const expected = getNextQuestion(questionnaire, state);
    if (expected && expected.q_id !== currentQid) {
      const channelProfile = convo.channel === 'whatsapp' ? 'whatsapp' : 'web_chat';
      const stageMap = new Map(questionnaire.stages.map((s) => [s.stage_key, s]));
      const stage = stageMap.get(expected.stage_key);
      const intro = stage
        ? (channelProfile === 'whatsapp' ? stage.intro_whatsapp_he : stage.intro_he)
        : '';
      const qq = questionnaire.questions.find((x) => x.q_id === expected.q_id);
      let prompt = qq?.prompt_variants?.[channelProfile] || expected.prompt_he;
      const options = qq?.options_he || expected.options_he || '';

      // Product requirement: do not offer consequential loss (3b). Only allow daily income loss (3a).
      let optionsOverride = '';
      if (expected.q_id === 'G004') {
        prompt = 'אם העסק ייאלץ להיסגר זמנית בגלל נזק (למשל אש/מים/פריצה) — תרצה כיסוי לאובדן הכנסה?';
        optionsOverride = 'לא, אובדן הכנסה (פיצוי יומי)';
      }

      return {
        success: true,
        saveResults: {
          ...inferredSaveResults,
          questionnaire_current_qid: expected.q_id,
          questionnaire_stage_key: expected.stage_key,
          questionnaire_stage_title_he: expected.stage_title_he,
          questionnaire_stage_intro_to_send: intro || '',
          questionnaire_field_key: expected.field_key_en,
          questionnaire_json_path: expected.json_path,
          questionnaire_prompt_he: prompt,
          questionnaire_data_type: expected.data_type,
          questionnaire_input_type: expected.input_type || '',
          questionnaire_options_he: optionsOverride || options,
          questionnaire_constraints: expected.constraints || '',
          questionnaire_answer: '',
        },
      };
    }

    // Special handling: input_type=table (row wizard)
    if (q.input_type === 'table' && q.data_type === 'array') {
      const draftQid = String(userData.__questionnaire_table_draft_qid || '').trim();
      const draftRows = safeParseJson(userData.__questionnaire_table_draft_rows_json) || [];
      const rowsSoFar: Array<Record<string, unknown>> = Array.isArray(draftRows) ? draftRows : [];
      const columns = parseTableColumnsFromNotes(q.notes_logic);
      const example = columns.length > 0
        ? `דוגמה: ${columns.map((c) => c).join(', ')}`
        : 'דוגמה: משרד, 2, 200000';

      // Continue draft only if same qid; otherwise reset
      const activeRows = draftQid === q.q_id ? rowsSoFar : [];

      if (isDoneToken(rawAnswer)) {
        if (activeRows.length === 0) {
          return {
            success: true,
            saveResults: {
              __questionnaire_table_draft_qid: q.q_id,
              __questionnaire_table_draft_rows_json: JSON.stringify(activeRows),
              questionnaire_current_qid: q.q_id,
              questionnaire_prompt_he: `מעולה — כדי למלא את הטבלה, שלח/י שורה אחת בפורמט: ${example}. כשמסיימים כתוב/י "סיום".`,
              questionnaire_options_he: '',
              questionnaire_stage_intro_to_send: '',
            },
          };
        }

        // Commit table to form + vars
        state.vars[q.field_key_en] = activeRows;
        setByJsonPath(state.formJson, q.json_path, activeRows);
      } else {
        const newRows = parseTableRowsFromText(rawAnswer, columns);
        if (!newRows) {
          return {
            success: true,
            saveResults: {
              __questionnaire_table_draft_qid: q.q_id,
              __questionnaire_table_draft_rows_json: JSON.stringify(activeRows),
              questionnaire_current_qid: q.q_id,
              questionnaire_prompt_he: `בוא/י נעשה את זה שורה-שורה. שלח/י שורה אחת בפורמט: ${example}. כשמסיימים כתוב/י "סיום".`,
              questionnaire_options_he: '',
              questionnaire_stage_intro_to_send: '',
            },
          };
        }

        const combined = [...activeRows, ...newRows];
        return {
          success: true,
          saveResults: {
            __questionnaire_table_draft_qid: q.q_id,
            __questionnaire_table_draft_rows_json: JSON.stringify(combined),
            questionnaire_current_qid: q.q_id,
            questionnaire_prompt_he: 'קיבלתי. יש עוד שורה? אם כן — שלח/י שורה נוספת. אם לא — כתוב/י "סיום".',
            questionnaire_options_he: '',
            questionnaire_stage_intro_to_send: '',
          },
        };
      }
    }

    let answerToApply = rawAnswer;
    if (q.q_id === 'Q001') {
      const contact = parseContactDetails(rawAnswer);
      if (contact && contact.phone) {
        // We are in "Combined Mode". Use the parsed name part as the answer for THIS question (Last Name).
        // Note: We already populated First Name and Phone in state.vars above.
        if (contact.last) {
          answerToApply = contact.last;
        } else if (contact.first) {
          // e.g. "Liav 050..." -> assigns "Liav" to Last Name (Q001).
          answerToApply = contact.first;
        }
      }
    }

    const applied = parseAndApplyAnswer(questionnaire, state, q, answerToApply);
    if (!applied.ok) {
      // IMPORTANT: questionnaire_answer is a transient extracted field.
      // If parsing fails, we must clear it so the stage is NOT considered "completed" on the next turn.
      await flowHelpers.setUserData(convo.userId, userFlow.flowId, { questionnaire_answer: '' }, conversationId);
      return {
        success: false,
        error: applied.errorMessage,
        errorCode: 'ANSWER_PARSE_FAILED',
      };
    }

    // Product requirement: do not allow "אובדן תוצאתי" at all (G004).
    // If user tries to select it, ask again with the allowed options only.
    if (q.q_id === 'G004' && /תוצאתי|רווח\s*גולמי/i.test(rawAnswer)) {
      await flowHelpers.setUserData(convo.userId, userFlow.flowId, { questionnaire_answer: '' }, conversationId);
      return {
        success: false,
        error: 'כרגע אפשר לבחור רק: לא / אובדן הכנסה (פיצוי יומי). מה מתאים לך?',
        errorCode: 'ANSWER_PARSE_FAILED',
      };
    }

    // Apply derived rules after each answer (especially after G004)
    const derivedUpdates = applyDerivedRules(questionnaire, state);

    // Production validations (critical): enforce after derived updates too
    const prodValidationError = validateProductionRules(questionnaire, state);
    if (prodValidationError) {
      // Validation failure means we keep the same question; clear transient answer to avoid "stage complete" glitches.
      await flowHelpers.setUserData(convo.userId, userFlow.flowId, { questionnaire_answer: '' }, conversationId);
      return { success: false, error: prodValidationError, errorCode: 'VALIDATION_FAILED' };
    }

    const next = getNextQuestion(questionnaire, state);
    const complete = !next;

    const channelProfile = convo.channel === 'whatsapp' ? 'whatsapp' : 'web_chat';
    const stageMap = new Map(questionnaire.stages.map((s) => [s.stage_key, s]));
    const stage = next ? stageMap.get(next.stage_key) : null;
    let nextIntro = stage
      ? (channelProfile === 'whatsapp' ? stage.intro_whatsapp_he : stage.intro_he)
      : '';
    // UX: friendlier intro for the "gate" stage (still followed by the exact carrier questions)
    if (stage?.stage_key === '02_needs_discovery') {
      nextIntro = 'תודה. בוא נעבור על הכיסויים ונראה מה אתה צריך.';
    }

    const pendingAttachments = computePendingAttachments(questionnaire, state);
    const firedHandoffs = evaluateHandoffTriggers(questionnaire, state);
    const handoffRequired = firedHandoffs.length > 0;

    const saveResults: Record<string, unknown> = {
      insured_form_json: JSON.stringify(state.formJson),
      questionnaire_complete: complete || handoffRequired,
      questionnaire_last_qid: currentQid,
      // Always keep this transient field empty; it should only exist during extraction for the current turn.
      questionnaire_answer: '',
      // Persist the typed value also at top-level key so it appears in Collected Data and can be used by conditions.
      ...(q.input_type === 'table' && q.data_type === 'array'
        ? { [q.field_key_en]: state.vars[q.field_key_en] }
        : { [q.field_key_en]: applied.value }),
      questionnaire_channel: channelProfile,
      attachments_checklist_pending_json: JSON.stringify(pendingAttachments),
      attachments_checklist_pending_count: pendingAttachments.length,
      handoff_required: handoffRequired,
      handoff_reasons_he: firedHandoffs.map((t) => t.reason_he).filter(Boolean).join(' | '),
      ...inferredSaveResults,
    };

    if (next) {
      const qq = questionnaire.questions.find((x) => x.q_id === next.q_id);
      let prompt = qq?.prompt_variants?.[channelProfile] || next.prompt_he;
      let options = qq?.options_he || next.options_he || '';
      const prevStageKey = String(userData.questionnaire_stage_key || '').trim();
      let introToSend = next.stage_key !== prevStageKey ? (nextIntro || '') : '';

      // Stage summary checkpoint (send once when we transition stages)
      if (next.stage_key !== prevStageKey && prevStageKey) {
        const prevStage = stageMap.get(prevStageKey);
        if (prevStage?.completion_checkpoint?.send_summary) {
          const stageSummary = buildStageSummaryHe(questionnaire, state, prevStageKey);
          const tpl = String(prevStage.completion_checkpoint.summary_template_he || '').trim();
          const rendered = tpl
            ? replaceTemplateVariables(tpl, { stage_summary: stageSummary })
            : (stageSummary ? `סיכום קצר עד כאן: ${stageSummary}. אם משהו לא מדויק — כתוב/י לי ונעדכן.` : '');
          const parts = [rendered, introToSend].map((x) => String(x || '').trim()).filter(Boolean);
          introToSend = parts.join('\n\n');
        }
      }

      saveResults.questionnaire_current_qid = next.q_id;
      saveResults.questionnaire_stage_key = next.stage_key;
      saveResults.questionnaire_stage_title_he = next.stage_title_he;
      saveResults.questionnaire_stage_intro_to_send = introToSend;
      saveResults.questionnaire_field_key = next.field_key_en;
      saveResults.questionnaire_json_path = next.json_path;
      // Product requirement: do not offer consequential loss (3b). Only allow daily income loss (3a).
      if (next.q_id === 'G004') {
        prompt = 'אם העסק ייאלץ להיסגר זמנית בגלל נזק (למשל אש/מים/פריצה) — תרצה כיסוי לאובדן הכנסה?';
        options = 'לא, אובדן הכנסה (פיצוי יומי)';
      }

      saveResults.questionnaire_prompt_he = prompt;
      saveResults.questionnaire_data_type = next.data_type;
      saveResults.questionnaire_input_type = next.input_type || '';
      saveResults.questionnaire_options_he = options;
      saveResults.questionnaire_constraints = next.constraints || '';
    } else {
      // Clear current question pointers
      saveResults.questionnaire_current_qid = '';
      saveResults.questionnaire_prompt_he = '';
      saveResults.questionnaire_field_key = '';
      saveResults.questionnaire_json_path = '';
      saveResults.questionnaire_stage_intro_to_send = '';
    }

    // IMPORTANT: Do NOT persist engine defaults as userData.
    // Persist only explicit user answers, derived updates, and explicit inferences.
    await flowHelpers.setUserData(convo.userId, userFlow.flowId, {
      ...derivedUpdates,
      ...saveResults,
      // Clear any table draft once we advanced past it (or flow ended)
      ...(q.input_type === 'table' && q.data_type === 'array'
        ? { __questionnaire_table_draft_qid: '', __questionnaire_table_draft_rows_json: '' }
        : {}),
    }, conversationId);

    return {
      success: true,
      data: { complete, currentQid, nextQid: next?.q_id || null },
      saveResults,
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to apply questionnaire answer' };
  }
};
