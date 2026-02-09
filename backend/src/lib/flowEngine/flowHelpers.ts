/**
 * PROTECTED CORE ENGINE FILE
 *
 * ⚠️ DO NOT MODIFY WITHOUT ARCHITECT APPROVAL
 *
 * This file is part of the core flow engine. Changes here affect all flows.
 *
 * If you need to change behavior:
 * 1. Use flow config (onComplete, completionCondition)
 * 2. Use tool executors (move logic to tools/)
 * 3. Use error handling configs (onError)
 *
 * See: project documentation
 */

import {
  z,
  ZodBoolean,
  ZodEnum,
  ZodNull,
  ZodNumber,
  ZodString,
} from 'zod';
import { switchCaseGuard } from '../../utils/switchCaseGuard';
import { prisma } from '../../core/prisma';
import { GuidestarOrganisation, OrganisationRegion, USAOrganisation } from '../../types/kycOrganisation';
import { FieldDefinition, FieldsExtractionContext, FlowDefinition } from './types';
import { inferFirstLastFromText, isBadNameValue, repairNameFieldsFromInference } from './nameInference';

class FlowHelpers {
  private isAutoPopulating = false;

  extractStageFields(flowDefinition: FlowDefinition, stage: string): Array<[string, FieldDefinition]> {
    const stageFields = flowDefinition.stages[stage]?.fieldsToCollect || [];
    return Object.entries(flowDefinition.fields)
      .filter(([fieldSlug]) => stageFields.includes(fieldSlug));

  }

  generateExtractionContext(fields: FlowDefinition['fields'], stageDescription: string): FieldsExtractionContext {
    const fieldsDescription: Record<string, string> = {};
    const fieldsType: Record<string, 'string' | 'number' | 'boolean'> = {};
    const zodSchemaObject: Record<string, z.ZodTypeAny> = {};

    Object.entries(fields).forEach(([key, field]) => {
      const types = [];
      let rule: ZodString | ZodEnum<[string, ...string[]]> | ZodNumber | ZodBoolean | ZodNull;

      switch (field.type) {
        case 'string':
          rule = field.enum ? z.enum(field.enum as never) : z.string();
          break;

        case 'number':
          rule = z.number();
          break;

        case 'boolean':
          rule = z.boolean();
          break;

        default:
          rule = z.null();
          switchCaseGuard(field.type);
      }

      fieldsDescription[key] = field.description;
      if (field.type === 'boolean' || field.type === 'number' || field.type === 'string') {
        fieldsType[key] = field.type;
      }
      zodSchemaObject[key] = rule.nullish();
    });

    return {
      fieldsDescription,
      fieldsType,
      stageDescription,
      zodSchema: z.object(zodSchemaObject),
    };
  }

  async generateExtraContextForUser(userId: string): Promise<{
    contextString: string | null;
    templateContext: {
      orgName?: string;
      orgGoal?: string;
      orgArea?: string;
      organizationData?: GuidestarOrganisation | USAOrganisation;
    };
  }> {
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.firstName) {
      return { contextString: null, templateContext: {} };
    }

    const userRelatedOrganisations = await prisma.userOrganisation.findMany({ where: { userId } });
    const organisationIds = userRelatedOrganisations.map((org) => org.organisationId);
    const organisations = await prisma.organisationInfo.findMany({ where: { id: { in: organisationIds } } });

    const context: string[] = [];
    const templateContext: {
      orgName?: string;
      orgGoal?: string;
      orgArea?: string;
      organizationData?: GuidestarOrganisation | USAOrganisation;
    } = {};

    const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
    context.push('User:');
    context.push(`- Name: ${fullName}`);
    context.push('');

    if (organisations?.length) {
      context.push(`Organisations (${organisations.length}):`);

      // Use the first organization for template context (primary org)
      const primaryOrg = organisations[0];
      if (primaryOrg?.data) {
        const orgData = primaryOrg.data as GuidestarOrganisation | USAOrganisation;
        const country = primaryOrg.region === OrganisationRegion.USA ? 'USA' : 'Israel';

        context.push(`- ${orgData.name}. ${country}`);

        // Extract template variables from primary organization
        if (primaryOrg.region === OrganisationRegion.Israel) {
          const israelOrg = orgData as GuidestarOrganisation;
          templateContext.orgName = israelOrg.name || israelOrg.fullName || '';
          templateContext.orgGoal = israelOrg.orgGoal || '';
          templateContext.orgArea = israelOrg.activityAreas?.join(', ') ||
            israelOrg.primaryClassifications?.join(', ') || '';
          templateContext.organizationData = israelOrg;
        } else if (primaryOrg.region === OrganisationRegion.USA) {
          const usaOrg = orgData as USAOrganisation;
          templateContext.orgName = usaOrg.name || '';
          // For US orgs, we don't have orgGoal field, so use empty string
          // The organization data will be available in the knowledge base for the AI to use
          templateContext.orgGoal = '';
          templateContext.orgArea = usaOrg.ntee_cd || '';
          templateContext.organizationData = usaOrg;
        }
      }

      // Add remaining organizations to context
      for (let i = 1; i < organisations.length; i++) {
        const org = organisations[i];
        if (org?.data) {
          const orgData = org.data as GuidestarOrganisation | USAOrganisation;
          const country = org.region === OrganisationRegion.USA ? 'USA' : 'Israel';
          context.push(`- ${orgData.name}. ${country}`);
        }
      }
      context.push('');
    }

    // === Assistant hints (compact behavior cues, not a full system prompt) ===
    context.push('AssistantHints:');
    context.push('- PersonalSnippet: If org info exists, add a short warm line like "Oh, {orgName} does wonderful work in {orgGoal}!" If only a short description is known, use it.');
    context.push('- Terminology: Prefer "service" over "flow". Example: "Next, I can guide you through the next service — I\'m here to help you plan and support every step of your campaign, from preparation to launch and beyond."');
    context.push('- Style: Short, warm, natural language. Don\'t ask for info already known from context. Summarize and confirm when helpful.');
    context.push('');

    return {
      contextString: context.join('\n'),
      templateContext,
    };
  }

  async createUser(role: string) {
    return prisma.user.create({ data: { role } });
  }

  /**
   * Normalize phone number to E.164 format with conservative heuristics.
   *
   * Detects Israeli numbers only when a domestic 0 prefix or explicit 972 country code is present
   * and falls back to +1 for NANP-style 10 digit numbers. All other inputs are sanitized and
   * prefixed with '+' without guessing additional locale details.
   *
   * @param phone - Phone number to normalize
   * @returns Normalized phone number in E.164 format (e.g., +972501234567, +12125551234)
   *
   * @example
   * ```typescript
   * normalizePhoneNumber('0501234567'); // Returns '+972501234567'
   * normalizePhoneNumber('2125551234'); // Returns '+12125551234'
   * normalizePhoneNumber('+972501234567'); // Returns '+972501234567' (unchanged)
   * ```
   */
  normalizePhoneNumber(phone: string, _conversationContext?: { messages?: Array<{ content: string; role?: string }> }): string {
    if (!phone || typeof phone !== 'string') return phone;

    const rawInput = phone.trim();
    if (!rawInput) return phone;

    // Remove all non-digit characters except +
    let cleaned = rawInput.replace(/[^\d+]/g, '');
    if (!cleaned) return phone;

    // Handle numbers that start with +00 (e.g., +00972...)
    if (cleaned.startsWith('+00')) {
      cleaned = `+${cleaned.slice(3)}`;
    }

    const digitsOnly = cleaned.replace(/\D/g, '');
    const digitsWithoutIntl = digitsOnly.replace(/^00/, '');

    const formatIsraeliNumber = (): string | null => {
      if (!digitsWithoutIntl) return null;

      if (digitsWithoutIntl.startsWith('972')) {
        const subscriber = digitsWithoutIntl.slice(3).replace(/^0+/, '');
        if (subscriber.length >= 7) {
          return `+972${subscriber}`;
        }
      }

      const nationalDigits = cleaned.startsWith('0') ? cleaned : digitsOnly;
      if (/^0\d{8,10}$/.test(nationalDigits)) {
        const subscriber = nationalDigits.replace(/^0+/, '');
        if (subscriber.length >= 7) {
          return `+972${subscriber}`;
        }
      }

      return null;
    };

    const israeliFormatted = formatIsraeliNumber();
    if (israeliFormatted) {
      return israeliFormatted;
    }

    // If already in E.164 format (starts with + and valid digits), return as-is
    if (cleaned.startsWith('+') && /^\+\d{6,15}$/.test(cleaned)) {
      return cleaned;
    }

    // US number detection: 11 digits starting with 1 (country code) or bare 10 digits
    if (digitsWithoutIntl.length === 11 && digitsWithoutIntl.startsWith('1')) {
      return `+${digitsWithoutIntl}`;
    }

    if (digitsWithoutIntl.length === 10 && !cleaned.startsWith('0')) {
      return `+1${digitsWithoutIntl}`;
    }

    // Return best-effort sanitized number with +
    if (cleaned.startsWith('+')) {
      return cleaned;
    }

    return digitsWithoutIntl ? `+${digitsWithoutIntl}` : rawInput;
  }

  /**
   * Save user data to the database
   *
   * This function handles normalization of phone numbers, date formatting, and auto-population
   * of entity fields when entity_type is set to PRIMARY_ORG.
   *
   * @param userId - User ID
   * @param flowId - Flow ID
   * @param data - Data to save (key-value pairs)
   * @param conversationId - Optional conversation ID for context (used for phone normalization and date parsing)
   *
   * @example
   * ```typescript
   * await flowHelpers.setUserData(
   *   userId,
   *   flowId,
   *   {
   *     first_name: 'John',
   *     email: 'john@example.com',
   *     phone: '0501234567', // Will be normalized to +972501234567
   *   },
   *   conversationId
   * );
   * ```
   *
   * Special handling:
   * - Phone numbers are normalized to E.164 format
   * - Dates are parsed and formatted to ISO 8601
   * - Empty strings, null, and undefined values are skipped
   * - Entity fields are auto-populated when entity_type is PRIMARY_ORG
   */
  async setUserData(userId: string, flowId: string, data: Record<string, unknown>, conversationId?: string) {
    const userUpdateData: Record<string, unknown> = {};
    // Some fields are intentionally transient pointers/state and must be clearable to empty string.
    // By default we skip empty strings to avoid accidental overwrites, but these keys need explicit clearing.
    const allowEmptyStringKeys = new Set<string>([
      // Questionnaire transient answer + pointers
      'questionnaire_answer',
      'questionnaire_complete',
      'questionnaire_current_qid',
      'questionnaire_last_qid',
      'questionnaire_stage_key',
      'questionnaire_stage_title_he',
      'questionnaire_stage_intro_to_send',
      'questionnaire_field_key',
      'questionnaire_json_path',
      'questionnaire_prompt_he',
      'questionnaire_options_he',
      'questionnaire_data_type',
      'questionnaire_input_type',
      'questionnaire_constraints',
      'questionnaire_channel',
      'insured_form_json',
      // Table draft state
      '__questionnaire_table_draft_qid',
      '__questionnaire_table_draft_rows_json',
      // Last-action error context (must be clearable after success)
      '__last_action_error_stage',
      '__last_action_error_tool',
      '__last_action_error_message',
      '__last_action_error_code',
      '__last_action_error_at',
    ]);

    // Get conversation context for phone normalization if needed
    let conversationContext: { messages?: Array<{ content: string; role?: string }> } | undefined;
    if (conversationId && (
      data.phone
      || (data as any).mobile_phone
      || data.proposer_mobile_phone
      || data.proposer_phone
      || (data as any).user_phone
      || (data as any).user_mobile_phone
    )) {
      const messages = await prisma.message.findMany({
        where: { conversationId, role: 'user' },
        select: { content: true, role: true },
        orderBy: { createdAt: 'asc' },
        take: 10,
      });
      conversationContext = { messages };
    }

    // === Name fallback inference (when user sent full name but extraction missed part) ===
    // Implemented in `nameInference.ts` (shared + unit-tested).

    const augmentedData: Record<string, unknown> = { ...data };

    // Guardrail: referral_source answers like "גוגל" can be mistakenly inferred as a first name by heuristics.
    // If referral_source is present in this update, never let it overwrite first-name fields.
    try {
      const rs = String((augmentedData as any).referral_source ?? '').trim();
      if (rs) {
        const rsLower = rs.toLowerCase();
        const referralTokens = new Set([
          'גוגל', 'google',
          'פייסבוק', 'facebook',
          'אינסטגרם', 'instagram',
          'טיקטוק', 'tiktok',
          'לינקדאין', 'linkedin',
          'המלצה', 'ממליצים', 'recommendation',
          'סוכן', 'agent',
          'פרסום', 'ads', 'ad',
        ]);
        const shouldDropIfSeen = (val: unknown): boolean => {
          const v = String(val ?? '').trim();
          if (!v) return false;
          const vLower = v.toLowerCase();
          return v === rs || referralTokens.has(vLower) || (referralTokens.has(rsLower) && referralTokens.has(vLower));
        };
        for (const k of ['first_name', 'user_first_name', 'proposer_first_name'] as const) {
          if (k in augmentedData && shouldDropIfSeen((augmentedData as any)[k])) {
            delete (augmentedData as any)[k];
          }
        }
      }
    } catch {
      // best-effort
    }

    const mightNeedNameInference = !!conversationId && (
      'proposer_first_name' in augmentedData ||
      'proposer_last_name' in augmentedData ||
      'user_first_name' in augmentedData ||
      'user_last_name' in augmentedData ||
      'first_name' in augmentedData ||
      'last_name' in augmentedData ||
      // If the user provided phone/email but the extractor missed the name fields,
      // we still want to infer full name from the latest user message.
      'proposer_mobile_phone' in augmentedData ||
      'mobile_phone' in augmentedData ||
      'user_phone' in augmentedData ||
      'user_mobile_phone' in augmentedData ||
      'phone' in augmentedData ||
      'proposer_email' in augmentedData ||
      'user_email' in augmentedData ||
      'email' in augmentedData
    );
    if (mightNeedNameInference) {
      try {
        const current = await this.getUserData(userId, flowId);
        const isBadName = isBadNameValue;
        const isValidEmail = (v: unknown): boolean => {
          const s = String(v ?? '').trim();
          if (!s) return false;
          // Minimal email sanity: local@domain.tld
          return /^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s);
        };
        const pickNonEmpty = (...vals: unknown[]) => vals.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
        const isMissingOrBad = (val: unknown): boolean => {
          const s = String(val ?? '').trim();
          if (!s) return true;
          return isBadName(s);
        };
        const isExplicitGood = (key: string): boolean => {
          if (!(key in augmentedData)) return false;
          const v = (augmentedData as any)[key];
          const s = String(v ?? '').trim();
          if (!s) return false;
          return !isBadName(s);
        };

        const needProposerFirst = !isExplicitGood('proposer_first_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.proposer_first_name, current.proposer_first_name));
        const needProposerLast = !isExplicitGood('proposer_last_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.proposer_last_name, current.proposer_last_name));
        const needFirst = !isExplicitGood('first_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.first_name, current.first_name));
        const needLast = !isExplicitGood('last_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.last_name, current.last_name));
        const needUserFirst = !isExplicitGood('user_first_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.user_first_name, current.user_first_name));
        const needUserLast = !isExplicitGood('user_last_name')
          && isMissingOrBad(pickNonEmpty(augmentedData.user_last_name, current.user_last_name));
        const needProposerEmail = !isValidEmail(current.proposer_email) && !isValidEmail(augmentedData.proposer_email);
        const needEmail = !isValidEmail(current.email) && !isValidEmail(augmentedData.email);

        if (needProposerFirst || needProposerLast || needFirst || needLast || needUserFirst || needUserLast || needProposerEmail || needEmail) {
          const lastUserMsg = await prisma.message.findFirst({
            where: { conversationId: conversationId!, role: 'user' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          const lastText = String(lastUserMsg?.content || '');

          // Infer names
          const inferred = inferFirstLastFromText(lastText);
          if (needProposerFirst || needProposerLast || needFirst || needLast || needUserFirst || needUserLast) {
            // Key fix: if *either* side of a name pair is missing/bad, repair BOTH together for that slot.
            // This prevents states like: user_first_name="גפן", user_last_name="נייד" after a contact-block paste.
            const repaired = repairNameFieldsFromInference({ current, augmented: augmentedData, inferred });
            Object.assign(augmentedData, repaired);
          }

          // Infer email if missing/invalid
          if (needProposerEmail || needEmail) {
            const m = lastText.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
            const inferredEmail = m?.[0]?.trim();
            if (inferredEmail && isValidEmail(inferredEmail)) {
              if (needProposerEmail) augmentedData.proposer_email = inferredEmail;
              if (needEmail) augmentedData.email = inferredEmail;
            }
          }
        }
      } catch {
        // Ignore inference errors; extraction remains the primary path.
      }
    }

    // === Deterministic segment enrichment (catalog-only) ===
    // Goal: if the user already provided their business/segment in the first message,
    // we should immediately enrich it (segment_id/site_type) so the assistant won't re-ask basics.
    try {
      const intentKeys = [
        'business_segment',
        'segment_description',
        'industry',
        'activity_description',
        'business_used_for',
        'business_activity_and_products',
        'business_occupation',
      ];
      const hasNewIntent = intentKeys.some((k) => k in augmentedData && String((augmentedData as any)[k] || '').trim());
      if (hasNewIntent) {
        const current = await this.getUserData(userId, flowId);
        const merged = { ...current, ...augmentedData } as Record<string, unknown>;
        const isEmpty = (v: unknown): boolean => {
          if (v === null || v === undefined) return true;
          const s = String(v).trim();
          if (!s) return true;
          // Treat common placeholder strings as missing (some older flows stored these).
          const lowered = s.toLowerCase();
          if (['/', '//', '-', '.', 'n/a', 'na', 'none', 'null', 'undefined'].includes(lowered)) return true;
          return false;
        };

        const existingSegmentId = String((merged as any).segment_id || '').trim();
        const existingGroupId = String((merged as any).segment_group_id || '').trim();

        const needsSegment = isEmpty(existingSegmentId) && isEmpty(existingGroupId);
        const needsSiteType = isEmpty((merged as any).business_site_type);
        const needsSegmentLabelFix = (() => {
          const v = String((merged as any).business_segment || '').trim();
          if (!v) return true;
          // Very short / partial values observed in production (e.g., "דין", "דיו")
          if (v.length <= 4) return true;
          return false;
        })();

        // If we already have a segment id but the label is partial, we can enrich from catalog without re-resolving.
        if (!needsSegment && existingSegmentId && needsSegmentLabelFix) {
          const { getSegmentsCatalogProd } = await import('../insurance/segments/loadSegmentsCatalog');
          const { buildQuestionnaireDefaultsFromResolution } = await import('../insurance/segments/buildQuestionnaireDefaults');

          const catalog = getSegmentsCatalogProd();
          const seg = catalog.segments.find((s: any) => s.segment_id === existingSegmentId);
          const segName = String(seg?.segment_name_he || '').trim();
          if (segName) {
            const compact = segName.replace(/^משרד\s+/, '').trim();
            augmentedData.business_segment = compact || segName;
          }

          // If site type is missing/placeholder, fill it from the defaults builder.
          const defaults = buildQuestionnaireDefaultsFromResolution({
            segment_id: existingSegmentId,
            segment_group_id: existingGroupId || undefined,
            source: 'catalog',
            match_confidence: 1,
          } as any);
          const st = (defaults.prefill as any)?.business_site_type;
          if (needsSiteType && Array.isArray(st) && st.length > 0) {
            augmentedData.business_site_type = String(st[0] || '').trim();
          }
        }

        if (needsSegment || needsSiteType || (!existingSegmentId && needsSegmentLabelFix)) {
          const combinedText = [
            merged.business_segment,
            merged.segment_description,
            merged.industry,
            merged.activity_description,
            merged.business_used_for,
            merged.business_activity_and_products,
            merged.business_occupation,
          ]
            .map((x) => String(x || '').trim())
            .filter(Boolean)
            .join(' | ');

          if (combinedText) {
            const { resolveSegmentFromText } = await import('../insurance/segments/resolveSegmentFromText');
            const { buildQuestionnaireDefaultsFromResolution } = await import('../insurance/segments/buildQuestionnaireDefaults');

            // IMPORTANT: do NOT pass conversationId to keep this deterministic (no extra LLM calls).
            const resolved = await resolveSegmentFromText(combinedText);
            const defaults = buildQuestionnaireDefaultsFromResolution(resolved);

            // Apply non-destructively (only if missing).
            for (const [k, v] of Object.entries(defaults.userData || {})) {
              if (k === 'segment_resolution_source' || k === 'segment_resolution_confidence') {
                if (!(k in augmentedData)) augmentedData[k] = v;
                continue;
              }
              if (isEmpty((merged as any)[k]) && v !== undefined) augmentedData[k] = v;
            }
            for (const [k, v] of Object.entries(defaults.prefill || {})) {
              if (isEmpty((merged as any)[k]) && v !== undefined) {
                if (k === 'business_site_type' && Array.isArray(v)) {
                  augmentedData[k] = String(v[0] || '').trim();
                } else {
                  augmentedData[k] = v;
                }
              }
            }

            // Upgrade business_segment label to the canonical catalog name (e.g., "משרד עורכי דין").
            const segName = String((defaults.userData as any)?.segment_name_he || '').trim();
            const grpName = String((defaults.userData as any)?.segment_group_name_he || '').trim();
            const desiredLabel = segName || grpName;
            if (desiredLabel) {
              const compact = desiredLabel.replace(/^משרד\s+/, '').trim();
              // Prefer compact label for the business_segment field (occupation vs site).
              augmentedData.business_segment = compact || desiredLabel;
            }
          }
        }
      }
    } catch {
      // Best-effort; never block saving userData
    }

    // If the user answered "insured_relation_to_business" but the extractor mistakenly put it into a name field,
    // remap it to prevent overwriting first_name/last_name.
    try {
      const relationWords = new Set<string>([
        'בעלים',
        'מנהל',
        'מנהלת',
        'שותף',
        'שותפה',
        'אחר',
        'owner',
        'manager',
      ]);
      const norm = (v: unknown) => String(v || '').trim().toLowerCase();
      const current = await this.getUserData(userId, flowId);
      const existingRel = String((current as any).insured_relation_to_business || '').trim();
      const hasRelAlready = existingRel.length > 0;
      const hasRelIncoming = 'insured_relation_to_business' in augmentedData && String((augmentedData as any).insured_relation_to_business || '').trim();

      if (!hasRelAlready && !hasRelIncoming) {
        const nameKeys = ['first_name', 'proposer_first_name', 'user_first_name'];
        for (const k of nameKeys) {
          const raw = String((augmentedData as any)[k] || '').trim();
          if (!raw) continue;
          if (relationWords.has(norm(raw))) {
            (augmentedData as any).insured_relation_to_business = raw;
            delete (augmentedData as any)[k];
            break;
          }
        }
      }
    } catch {
      // best-effort
    }

    // === Deterministic inference: has_physical_premises from business_site_type ===
    // Goal: If we already know the site type (e.g., "משרד"), we should NOT re-ask
    // whether the business has physical premises. This is used early in Flow 02 gating.
    try {
      const current = await this.getUserData(userId, flowId);
      const merged = { ...current, ...augmentedData } as Record<string, unknown>;
      const isEmpty = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

      const existing = (merged as any).has_physical_premises;
      const needs = isEmpty(existing);
      if (needs) {
        const stRaw = (merged as any).business_site_type;
        const stList = Array.isArray(stRaw) ? stRaw : [stRaw];
        const st = stList
          .map((x) => String(x ?? '').trim())
          .filter(Boolean)
          .join(' | ');

        const stLower = st.toLowerCase();
        const isOnlineOnly = /אונליין|online|וירטואלי|ללא\s+מקום\s+פיזי|אין\s+מקום\s+פיזי/.test(stLower);
        const isPhysicalType = /משרד|חנות|קליניקה|מחסן|מפעל|בית\s*מלאכה|ביח["״׳']?ר|בית/.test(st);

        if (isPhysicalType && !isOnlineOnly) {
          augmentedData.has_physical_premises = true;
        } else if (isOnlineOnly && !isPhysicalType) {
          augmentedData.has_physical_premises = false;
        }
      }
    } catch {
      // best-effort
    }

    for (const entry of Object.entries(augmentedData)) {
      const [key, rawValue] = entry;

      // Skip empty strings, null, and undefined - only save fields that have actual values
      if (rawValue === null || rawValue === undefined) {
        continue;
      }
      if (rawValue === '' && !allowEmptyStringKeys.has(key)) {
        continue;
      }

      let value = rawValue;

      // Normalize phone numbers
      const isPhoneKey = key === 'phone'
        || key === 'mobile_phone'
        || key === 'proposer_mobile_phone'
        || key === 'proposer_phone'
        || key === 'user_phone'
        || key === 'user_mobile_phone';
      if (isPhoneKey && rawValue) {
        const rawPhoneInput = String(rawValue).trim();

        if (rawPhoneInput) {
          const rawDigits = rawPhoneInput.replace(/\D/g, '');
          const isUserHebrew = conversationContext?.messages?.some((msg) =>
            /[\u0590-\u05FF]/.test(msg.content),
          ) ?? false;

          const hintPayload = JSON.stringify({
            raw: rawPhoneInput,
            digits: rawDigits,
            language: isUserHebrew ? 'he' : 'other',
          });

          await prisma.userData.upsert({
            where: { key_userId_flowId: { userId, flowId, key: 'raw_phone_country_hint' } },
            create: { userId, flowId, key: 'raw_phone_country_hint', value: hintPayload, type: 'string' },
            update: { value: hintPayload },
          });
        }

        value = this.normalizePhoneNumber(rawPhoneInput, conversationContext);
        // After normalization, check if phone is still valid (not empty)
        if (!value || value === '') {
          continue;
        }
      }

      // Validate emails (skip invalid so we don't persist partials like "@domain.com")
      const isEmailKey = key === 'email' || key.endsWith('_email');
      if (isEmailKey) {
        const s = String(value ?? '').trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(s)) {
          continue;
        }
      }

      // Normalize campaign_start_date to ISO 8601 format
      // CRITICAL: Date MUST be parsed and formatted - raw text is NOT acceptable
      // Also validate Shabbat/holiday dates based on religious affinity
      if (key === 'campaign_start_date' && rawValue) {
        try {
          const { getUserTimezone, formatCampaignDate, isShabbatOrHoliday } = await import('./utils/dateTimeUtils');
          const conversation = conversationId ? await prisma.conversation.findUnique({
            where: { id: conversationId },
            select: { channel: true },
          }) : null;
          const timezone = conversation ? await getUserTimezone(conversationId!, conversation.channel as 'web' | 'whatsapp') : 'UTC';
          const formattedDate = await formatCampaignDate(String(rawValue), timezone);
          if (formattedDate && formattedDate.trim() !== '') {
            // Check if date falls on Shabbat or holiday
            const dateObj = new Date(formattedDate);
            if (isNaN(dateObj.getTime())) {
              // Invalid date object - save as RAW_DATE instead of skipping
              const { logger } = await import('../../utils/logger');
              logger.warn('Invalid date object after parsing, saving as RAW_DATE', {
                rawValue: String(rawValue).substring(0, 100),
                formattedDate,
                conversationId,
              });
              value = `RAW_DATE:${String(rawValue)}`;
              // Continue to save (don't skip)
            } else {
              let shabbatCheck;
              try {
                shabbatCheck = await isShabbatOrHoliday(dateObj);
              } catch (checkError: any) {
                // If holiday check fails, log but continue - don't block date saving
                try {
                  const { logger } = await import('../../utils/logger');
                  logger.error('Error checking Shabbat/holiday:', {
                    error: checkError?.message,
                    formattedDate,
                  });
                } catch {
                  // Ignore logging errors
                }
                // If we can't check for holiday, assume it's valid and save it
                value = formattedDate;
                // Continue to save (don't skip)
              }

              // CRITICAL: Always reject Shabbat/holiday dates, regardless of religious affinity
              // This ensures synagogues never accidentally launch campaigns on these days
              if (shabbatCheck && shabbatCheck.isShabbatOrHoliday) {
                // Check for religious affinity (Hebrew language suggests religious context)
                let hasReligiousAffinity = false;
                if (conversationId) {
                  const messages = await prisma.message.findMany({
                    where: { conversationId, role: 'user' },
                    orderBy: { createdAt: 'asc' },
                    take: 10,
                    select: { content: true },
                  });

                  // Check for Hebrew language or religious expressions
                  const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
                  const hasReligiousExpressions = messages.some((msg) =>
                    /בעזרת השם|בלי נדר|ברוך השם|יהיה רצון|בס״ד|בס"ד|שבת|שבת שלום|חג|חג שמח|פסח|סוכות|שבועות|ראש השנה|יום כיפור|יוכיפור/i.test(msg.content),
                  );

                  hasReligiousAffinity = hasHebrew || hasReligiousExpressions;
                }

                // If religious affinity detected and date is Shabbat/holiday:
                // Save as RAW_DATE with holiday flag so LLM can see it and ask for confirmation
                // CRITICAL: Always save the field, even if it's a problematic date
                const { logger } = await import('../../utils/logger');
                logger.warn('Date falls on Shabbat/holiday, saving as RAW_DATE with flag', {
                  rawValue: String(rawValue).substring(0, 100),
                  formattedDate,
                  holidayName: shabbatCheck.eventName,
                  hasReligiousAffinity,
                  conversationId,
                });
                // Save with holiday information so LLM can see it
                value = `RAW_DATE:${String(rawValue)}:HOLIDAY:${shabbatCheck.eventName || 'Shabbat/Holiday'}`;
                // Continue to save (don't skip)
              } else {
                // Date is valid and not Shabbat/holiday - save it
                value = formattedDate;
              }
            }
          } else {
            // If parsing fails, store the raw value with a flag so LLM can handle it
            // This allows LLM to ask for Gregorian date or guess a reasonable date
            // Store as "RAW_DATE:<original_text>" so we can detect and handle it
            const { logger } = await import('../../utils/logger');
            logger.warn('Date parsing returned empty, saving as RAW_DATE', {
              rawValue: String(rawValue).substring(0, 100),
              conversationId,
            });
            value = `RAW_DATE:${String(rawValue)}`;
            // Continue to save this raw date value - LLM will be instructed to handle it
          }
        } catch (dateError: any) {
          // If date parsing fails completely, store raw value with flag
          // LLM will be instructed to ask for Gregorian date or guess
          try {
            const { logger } = await import('../../utils/logger');
            logger.warn('Error parsing campaign_start_date, storing raw value for LLM to handle:', {
              error: dateError?.message,
              rawValue: String(rawValue).substring(0, 100),
              conversationId,
            });
          } catch (logError) {
            // If logging fails, just continue
          }
          // Store raw value with flag so LLM can handle it
          value = `RAW_DATE:${String(rawValue)}`;
        }
      }

      // CRITICAL: Auto-populate entity fields from organization data when entity_type is PRIMARY_ORG
      if (key === 'entity_type' && rawValue === 'PRIMARY_ORG' && conversationId) {
        try {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
              user: {
                include: {
                  UserOrganisation: {
                    include: {
                      organisation: true,
                    },
                  },
                },
              },
            },
          });

          if (conversation?.userId && conversation.user?.UserOrganisation?.[0]?.organisation) {
            const orgInfo = conversation.user.UserOrganisation[0].organisation;
            const orgData = orgInfo.data as GuidestarOrganisation | USAOrganisation | null;

            if (orgData) {
              // Get current userData to check what's already set
              const currentUserData = await this.getUserData(userId, flowId);
              const autoPopulatedData: Record<string, unknown> = {};

              // Populate entity_name if not already set - use "name" from organization object
              if (!currentUserData.entity_name) {
                if (orgData.name) {
                  autoPopulatedData.entity_name = orgData.name;
                } else if ('fullName' in orgData && orgData.fullName) {
                  autoPopulatedData.entity_name = orgData.fullName;
                }
              }

              // Populate entity_tax_id if not already set - use "regNum"
              if (!currentUserData.entity_tax_id) {
                if ('regNum' in orgData && orgData.regNum) {
                  autoPopulatedData.entity_tax_id = orgData.regNum;
                } else if ('ein' in orgData && orgData.ein) {
                  autoPopulatedData.entity_tax_id = orgData.ein;
                }
              }

              // Populate entity_country - stub "ישראל" for now (will be converted to 'IL' in buildEntity tool)
              if (!currentUserData.entity_country) {
                if (orgInfo.region === OrganisationRegion.Israel || orgInfo.region === 'IL' || orgInfo.region === 'Israel') {
                  autoPopulatedData.entity_country = 'ישראל';
                } else if (orgInfo.region === OrganisationRegion.USA || orgInfo.region === 'US' || orgInfo.region === 'USA') {
                  autoPopulatedData.entity_country = 'US';
                }
              }

              // Populate address fields if not already set
              if (orgInfo.region === OrganisationRegion.Israel || orgInfo.region === 'IL' || orgInfo.region === 'Israel') {
                const israelOrg = orgData as GuidestarOrganisation;
                // Use fullAddress directly (not addressStreet)
                if (!currentUserData.entity_address_line_1 && israelOrg.fullAddress) {
                  autoPopulatedData.entity_address_line_1 = israelOrg.fullAddress;
                } else if (!currentUserData.entity_address_line_1 && israelOrg.addressStreet) {
                  // Fallback to addressStreet if fullAddress not available
                  autoPopulatedData.entity_address_line_1 = israelOrg.addressStreet;
                }
                if (!currentUserData.entity_city && israelOrg.addressCity) {
                  autoPopulatedData.entity_city = israelOrg.addressCity;
                }
                if (!currentUserData.entity_zip && israelOrg.addressZipCode) {
                  autoPopulatedData.entity_zip = israelOrg.addressZipCode;
                }
                // entity_state and entity_address_line_2 left blank for Israel
              } else if (orgInfo.region === OrganisationRegion.USA || orgInfo.region === 'US' || orgInfo.region === 'USA') {
                const usaOrg = orgData as USAOrganisation;
                if (!currentUserData.entity_address_line_1 && usaOrg.street) {
                  autoPopulatedData.entity_address_line_1 = usaOrg.street;
                }
                if (!currentUserData.entity_city && usaOrg.city) {
                  autoPopulatedData.entity_city = usaOrg.city;
                }
                if (!currentUserData.entity_zip && usaOrg.zip) {
                  autoPopulatedData.entity_zip = usaOrg.zip;
                }
                if (!currentUserData.entity_state && usaOrg.state) {
                  autoPopulatedData.entity_state = usaOrg.state;
                }
              }

              // Save auto-populated data directly to UserData table (avoid recursion that causes async issues)
              if (Object.keys(autoPopulatedData).length > 0) {
                // Save each auto-populated field directly to UserData table
                // This avoids recursive calls that can cause async timing issues
                // CRITICAL: Save these fields immediately so they're available for the next stage
                const savePromises = Object.entries(autoPopulatedData)
                  .filter(([_, fieldValue]) => fieldValue !== null && fieldValue !== undefined && fieldValue !== '')
                  .map(async ([fieldKey, fieldValue]) => {
                    const fieldType = typeof fieldValue;
                    const fieldStringValue = String(fieldValue);

                    return prisma.userData.upsert({
                      where: { key_userId_flowId: { userId, flowId, key: fieldKey } },
                      create: { userId, flowId, key: fieldKey, value: fieldStringValue, type: fieldType },
                      update: { value: fieldStringValue },
                    });
                  });

                // Wait for all auto-populated fields to be saved
                await Promise.all(savePromises);
              }
            }
          }
        } catch (autoPopulateError) {
          // If auto-population fails, log but don't break the flow
          try {
            const { logger } = await import('../../utils/logger');
            logger.error('Error auto-populating entity fields:', autoPopulateError);
          } catch {
            // Ignore logging errors
          }
        }
      }

      // Normalize goal_currency - infer from context if missing
      if (key === 'goal_currency' && (!rawValue || rawValue === '')) {
        // Check conversation language and organization data
        if (conversationId) {
          const conversation = await prisma.conversation.findUnique({
            where: { id: conversationId },
            include: {
              user: {
                include: {
                  UserOrganisation: {
                    include: {
                      organisation: true,
                    },
                  },
                },
              },
            },
          });

          // Check if conversation is in Hebrew
          const messages = await prisma.message.findMany({
            where: { conversationId, role: 'user' },
            orderBy: { createdAt: 'asc' },
            take: 5,
            select: { content: true },
          });
          const isHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));

          // Check organization region
          const org = conversation?.user?.UserOrganisation?.[0]?.organisation;
          const isIsraeli = org?.region === OrganisationRegion.Israel || org?.region === 'IL' || org?.region === 'Israel';

          if (isHebrew || isIsraeli) {
            value = 'ILS';
          } else if (org?.region === OrganisationRegion.USA || org?.region === 'US' || org?.region === 'USA') {
            value = 'USD';
          }
          // If we can't determine, leave it empty - LLM will ask
        }
      }

      // Persist arrays/objects as JSON so we don't lose structure
      // (e.g., completed_processes, multi_select values).
      const type = typeof value;
      let stringValue = '';
      if (value !== null && typeof value === 'object') {
        try {
          stringValue = JSON.stringify(value);
        } catch {
          stringValue = String(value);
        }
      } else {
        stringValue = String(value);
      }

      await prisma.userData.upsert({
        where: { key_userId_flowId: { userId, flowId, key } },
        create: { userId, flowId, key, value: stringValue, type },
        update: { value: stringValue },
      });

      // Canonical aliases (keep internal topic-split keys, but also write canonical keys).
      // This improves UX: avoids re-asking in other flows, and enables UI titles to show full name.
      const aliasKeys: string[] = [];
      // Legacy proposer_* keys
      if (key === 'proposer_first_name') aliasKeys.push('first_name', 'user_first_name');
      if (key === 'proposer_last_name') aliasKeys.push('last_name', 'user_last_name');
      if (key === 'proposer_mobile_phone') aliasKeys.push('phone', 'user_phone');
      if (key === 'proposer_email') aliasKeys.push('email', 'user_email');

      // Mobile phone (common slug) → also write canonical + preferred + legacy
      if (key === 'mobile_phone') aliasKeys.push('phone', 'user_phone', 'proposer_mobile_phone');

      // Preferred user_* keys (also write legacy + canonical keys for compatibility)
      if (key === 'user_first_name') aliasKeys.push('first_name', 'proposer_first_name');
      if (key === 'user_last_name') aliasKeys.push('last_name', 'proposer_last_name');
      if (key === 'user_phone' || key === 'user_mobile_phone') aliasKeys.push('phone', 'proposer_mobile_phone');
      if (key === 'user_email') aliasKeys.push('email', 'proposer_email');

      // Canonical keys (also write preferred + legacy keys so all flows can reuse data)
      if (key === 'first_name') aliasKeys.push('user_first_name', 'proposer_first_name');
      if (key === 'last_name') aliasKeys.push('user_last_name', 'proposer_last_name');
      if (key === 'phone') aliasKeys.push('user_phone', 'proposer_mobile_phone');
      if (key === 'email') aliasKeys.push('user_email', 'proposer_email');

      for (const aliasKey of aliasKeys) {
        if (!aliasKey || aliasKey === key) continue;
        await prisma.userData.upsert({
          where: { key_userId_flowId: { userId, flowId, key: aliasKey } },
          create: { userId, flowId, key: aliasKey, value: stringValue, type },
          update: { value: stringValue },
        });
      }

      switch (key) {
        case 'first_name': userUpdateData.firstName = stringValue; break;
        case 'last_name': userUpdateData.lastName = stringValue; break;
        case 'email': userUpdateData.email = stringValue; break;
        case 'role': userUpdateData.role = stringValue; break;
        // Topic-split questionnaire proposer keys → also update User row.
        case 'proposer_first_name': userUpdateData.firstName = stringValue; break;
        case 'proposer_last_name': userUpdateData.lastName = stringValue; break;
        case 'proposer_email': userUpdateData.email = stringValue; break;
        // Preferred user keys → also update User row.
        case 'user_first_name': userUpdateData.firstName = stringValue; break;
        case 'user_last_name': userUpdateData.lastName = stringValue; break;
        case 'user_email': userUpdateData.email = stringValue; break;
      }
    }

    if (Object.keys(userUpdateData).length > 0) {
      await prisma.user.update({ where: { id: userId }, data: userUpdateData });
    }
  }

  /**
   * Get user data from the database
   *
   * Retrieves ALL userData entries for a given user across ALL flows.
   * If flowId is provided, entries for that flow take precedence over entries from other flows
   * (Standard "overlay" behavior: Specific > Generic).
   *
   * @param userId - User ID (returns empty object if null/undefined)
   * @param flowId - Optional flow ID to prioritize specific flow data
   * @returns Object with user data key-value pairs (merged from all flows)
   */
  async getUserData(userId?: string | null, flowId?: string) {
    if (!userId) return {};

    // 1. Fetch ALL data for this user, regardless of flow
    const allUserData = await prisma.userData.findMany({
      where: { userId },
      // Note: UserData doesn't have createdAt, relying on default DB order (entry order)
    });

    const collectedData: Record<string, unknown> = {};

    // 2. Separate current flow data vs others to implement precedence
    const currentFlowData: Record<string, unknown> = {};
    const otherFlowsData: Record<string, unknown> = {};

    allUserData.forEach((row) => {
      let value: unknown;
      switch (row.type) {
        case 'string': value = row.value; break;
        case 'number': value = Number(row.value); break;
        case 'boolean': value = row.value === 'true'; break;
        case 'object':
          try {
            if (!row.value) value = row.value;
            else value = JSON.parse(row.value);
          } catch {
            value = row.value;
          }
          break;
        default: value = row.value;
      }

      // Heuristic JSON parsing for known keys stored as strings.
      // (Some records predate richer type handling, but store JSON in the value string.)
      try {
        if (typeof value === 'string') {
          const s = value.trim();
          const k = String(row.key || '').trim();
          const shouldParse = k.endsWith('_json')
            || k.endsWith('_jsonb')
            || k === 'completed_processes'
            || k === 'business_site_type'
            || k.endsWith('_selected') // sometimes stored as arrays/objects
            || k.endsWith('_ids');
          if (shouldParse && s && (s.startsWith('[') || s.startsWith('{'))) {
            value = JSON.parse(s);
          }
        }
      } catch {
        // ignore
      }

      if (flowId && row.flowId === flowId) {
        currentFlowData[row.key] = value;
      } else {
        // checks if multiple flows have same key?
        // Since we ordered by createdAt asc, newer values overwrite older ones here
        otherFlowsData[row.key] = value;
      }
    });

    // 3. Merge: Other flows (Base) + Current Flow (Overlay)
    // This ensures that if I just answered "email" in *this* flow, it wins.
    // But if "email" was set in a previous flow and not here, I still see it.
    const merged = { ...otherFlowsData, ...currentFlowData } as Record<string, unknown>;

    // Back-compat aliases (read-time) for common contact keys.
    // Some flows use `mobile_phone`; we want the UI + other flows to see canonical `user_phone`/`phone`.
    const pickNonEmpty = (...vals: unknown[]) => vals.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
    const mobile = pickNonEmpty(merged.user_phone, merged.phone, (merged as any).mobile_phone, merged.proposer_mobile_phone, (merged as any).proposer_phone);
    if (merged.user_phone == null && mobile != null) merged.user_phone = mobile;
    if (merged.phone == null && mobile != null) merged.phone = mobile;
    if ((merged as any).proposer_mobile_phone == null && mobile != null) (merged as any).proposer_mobile_phone = mobile;

    // Read-time repair:
    // 1) If first_name accidentally contains a relation word (e.g., "בעלים"), move it to insured_relation_to_business.
    try {
      const relationWords = new Set(['בעלים', 'מנהל', 'מנהלת', 'שותף', 'שותפה', 'אחר']);
      const first = String((merged as any).first_name || (merged as any).user_first_name || '').trim();
      const rel = String((merged as any).insured_relation_to_business || '').trim();
      if (!rel && first && relationWords.has(first)) {
        (merged as any).insured_relation_to_business = first;
        delete (merged as any).first_name;
        delete (merged as any).user_first_name;
        delete (merged as any).proposer_first_name;
      }
    } catch {
      // ignore
    }

    // 2) If we have a catalog segment id but business_segment is partial, normalize it to the catalog label.
    try {
      const segId = String((merged as any).segment_id || '').trim();
      const bs = String((merged as any).business_segment || '').trim();
      if (segId && (!bs || bs.length <= 4)) {
        const { getSegmentsCatalogProd } = await import('../insurance/segments/loadSegmentsCatalog');
        const catalog = getSegmentsCatalogProd();
        const seg = catalog.segments.find((s: any) => s.segment_id === segId);
        const segName = String(seg?.segment_name_he || '').trim();
        if (segName) {
          const compact = segName.replace(/^משרד\s+/, '').trim();
          (merged as any).business_segment = compact || segName;
        }
      }
    } catch {
      // ignore
    }

    // 3) If first/last name accidentally contain customer-status tokens ("לקוח חדש/קיים"),
    // treat them as invalid names (they are answers to is_new_customer).
    try {
      const first = String((merged as any).first_name || (merged as any).user_first_name || '').trim();
      const last = String((merged as any).last_name || (merged as any).user_last_name || '').trim();
      const isStatusName = first === 'לקוח' && (last === 'חדש' || last === 'קיים' || last === 'ותיק');
      if (isStatusName) {
        delete (merged as any).first_name;
        delete (merged as any).last_name;
        delete (merged as any).user_first_name;
        delete (merged as any).user_last_name;
        delete (merged as any).proposer_first_name;
        delete (merged as any).proposer_last_name;
      }
    } catch {
      // ignore
    }

    return merged;
  }

  /**
   * Get reset_token from userData for use in subsequent API calls
   * Returns null if reset_token is not found
   */
  async getResetToken(userId: string, flowId: string): Promise<string | null> {
    const userData = await this.getUserData(userId, flowId);
    const resetToken = userData.reset_token as string | undefined;
    return resetToken || null;
  }

  /**
   * Get jwt_token from userData for use in authenticated API calls
   * Returns null if jwt_token is not found
   */
  async getJwtToken(userId: string, flowId: string): Promise<string | null> {
    const userData = await this.getUserData(userId, flowId);
    const jwtToken = userData.jwt_token as string | undefined;
    return jwtToken || null;
  }

  sanitizeData(data: Record<string, unknown>, fieldsDefinitions: Record<string, FieldDefinition>) {
    return Object.fromEntries(Object.entries(data).map(([key, value]) => {
      const isSensitive = fieldsDefinitions[key]?.sensitive;
      return [key, isSensitive && value ? '••••••••' : value];
    }));
  }
}

export const flowHelpers = new FlowHelpers();
