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
 * See: backend/docs/LLM_DEVELOPMENT_PLAYBOOK.md
 *
 * PROTECTED: No flow-specific logic, no stageSlug/toolName checks.
 */

import { Conversation, Flow, Message } from '@prisma/client';
import kseval from 'kseval';
import { prisma } from '../../core';
import { logger } from '../../utils/logger';
import { flowTracer } from '../observability/flowTracer';
import { executeTool } from './tools';
import { FieldDefinition, FlowDefinition, FlowStageDefinition } from './types';
import { llmService } from './llmService';
import { flowHelpers } from './flowHelpers';
import {
  getFieldDisplayNameHe,
  inferBusinessLegalEntityTypeFromBusinessRegistrationId,
  isPresentNonPlaceholder,
  validateFieldValue,
} from './fieldValidation';
import { enrichBusinessAddressInPlace } from './businessAddressEnrichment';
import { enrichIsraelCompaniesRegistryInPlace } from './israelCompaniesRegistryEnrichment';

class FlowRouter {
  async determineFlowAndCollectData(conversation: Conversation, message: Message): Promise<DeterminedFlow | null> {
    let res: DeterminedFlow | null = null;

    if (!conversation.userId) {
      // Find flow marked as default for new users
      const allFlows = await prisma.flow.findMany();
      const defaultFlow = allFlows.find((f) => {
        const definition = f.definition as FlowDefinition;
        return definition.config.defaultForNewUsers === true;
      });

      if (!defaultFlow) {
        logger.error('[flowRouter] No flow found with defaultForNewUsers: true');
        return null;
      }

      const flow = defaultFlow;
      const stage = (flow.definition as FlowDefinition).config.initialStage;

      res = {
        kind: 'initial',
        flow,
        stage,
        collectedData: {},
      };
    } else {
      const userFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
      if (userFlow) {
        const flow = (await prisma.flow.findUnique({ where: { id: userFlow.flowId } }))!;
        const { stage } = userFlow;

        res = {
          kind: 'assigned',
          flow,
          stage,
          sessionId: userFlow.id,
          collectedData: {},
        };
      } else {
        const flow = await this.guessFlow(message);
        if (flow) {
          const stage = (flow.definition as FlowDefinition).config.initialStage;

          res = {
            kind: 'guessed',
            flow,
            stage,
            collectedData: {},
          };
        }
      }
    }

    if (res) {
      const flowDefinition = res.flow.definition as FlowDefinition;
      const stage = flowDefinition.stages[res.stage];

      // CRITICAL:
      // Only extract fields that the CURRENT STAGE is collecting.
      // Extracting against the entire flow schema causes unrelated numeric inputs (e.g., OTP codes)
      // to overwrite previously collected fields like organization_name, regNum, website, etc.
      const stageFields = Object.fromEntries(flowHelpers.extractStageFields(flowDefinition, res.stage));
      // BUT: We still want "global memory" for a small set of safe, high-value fields across stages,
      // so the assistant won't ask for something the user said a moment ago in a different stage.
      // IMPORTANT: We keep this list tight to avoid OTP pollution / unrelated numeric overwrite.
      const globalFieldAllowlist = new Set<string>([
        // Org / entity identifiers
        'regNum',
        'entity_tax_id',
        'entity_name',
        'entity_country',
        'organization_name',
        // Campaign context
        'campaign_brief',
        'campaign_title',
        'campaign_currency',
        'campaign_primary_goal',
        'campaign_start_date',
        'campaign_end_date',
        // Contact hints (often needed for setup/validation)
        'email',
        'phone',
        // Israel SMB: initial user messages often contain mobile in the same sentence as name/intent.
        // Keep this in the global allowlist so we can persist it even before the stage explicitly asks.
        'mobile_phone',
        'user_phone',
        'proposer_mobile_phone',
        'proposer_phone',
        'meshulam_phone_local',
      ]);
      const globalFields = Object.fromEntries(
        Object.entries(flowDefinition.fields).filter(([fieldSlug]) => globalFieldAllowlist.has(fieldSlug)),
      );
      const extractionFields = { ...globalFields, ...stageFields };

      res.collectedData = await llmService.extractFieldsData({
        conversationId: conversation.id,
        messageId: message.id,
        message: message.content,
        flowId: res.flow.id,
        context: flowHelpers.generateExtractionContext(extractionFields, stage.description),
      });

      // Deterministic fallback: PO box "אין/לא" should reliably persist as boolean false.
      // We do this here (in addition to llmService heuristics) because a missing `business_po_box` can cause
      // the assistant to re-ask later, even though the user already answered.
      try {
        const collected: any = res.collectedData || {};
        const wantsPoBox = Object.prototype.hasOwnProperty.call(stageFields, 'business_po_box');
        const hasPoBox = isPresentNonPlaceholder(collected.business_po_box);
        if (wantsPoBox && !hasPoBox) {
          const lastAssistant = await prisma.message.findFirst({
            where: { conversationId: conversation.id, role: 'assistant', createdAt: { lt: message.createdAt } },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          const lastQ = String(lastAssistant?.content || '').trim();
          const askedForPoBox = /ת\\.?[\"״׳']?ד|תיבת\\s*דואר|תא\\s*דואר|po\\s*box/i.test(lastQ);
          if (askedForPoBox) {
            const msgRaw = String(message.content || '').trim();
            const digits = msgRaw.replace(/\\D/g, '');
            const token = msgRaw
              .trim()
              .toLowerCase()
              .replace(/[“”"׳״']/g, '')
              .replace(/\\s+/g, ' ')
              .replace(/^[\\s\\-–—.,;:!?()\\[\\]{}]+/g, '')
              .replace(/[\\s\\-–—.,;:!?()\\[\\]{}]+$/g, '')
              .trim();
            const looksLikeNo = !digits && (
              token === 'אין'
              || token === 'לא'
              || token === 'ללא'
              || token.startsWith('אין ')
              || token.startsWith('אין לי')
              || token.startsWith('אין לנו')
              || token === 'none'
              || token === 'no'
            );
            if (looksLikeNo) {
              collected.business_po_box = false;
              res.collectedData = collected;
            } else if (digits && digits.length <= 7) {
              collected.business_po_box = digits;
              res.collectedData = collected;
            }
          }
        }
      } catch {
        // best-effort
      }

      // Deterministic fallback: if the stage is asking for an Israeli ID and the user replies with digits,
      // accept it even if the LLM extraction missed it. This prevents stuck loops.
      try {
        const collected: any = res.collectedData || {};
        const msgRaw = String(message.content || '').trim();
        const digits = msgRaw.replace(/\D/g, '');
        const msgIsMostlyDigits = digits.length >= 8 && digits.length <= 9
          && digits.length === msgRaw.replace(/\s+/g, '').replace(/[-–—]/g, '').length;
        if (msgIsMostlyDigits) {
          const candidate = digits.padStart(9, '0');
          const userIdDef = (flowDefinition.fields as any)?.user_id as FieldDefinition | undefined;
          const legalIdDef = (flowDefinition.fields as any)?.legal_id as FieldDefinition | undefined;
          const wantsUserId = Object.prototype.hasOwnProperty.call(stageFields, 'user_id');
          const wantsLegalId = Object.prototype.hasOwnProperty.call(stageFields, 'legal_id');

          if (wantsUserId && !isPresentNonPlaceholder(collected.user_id)) {
            const vr = validateFieldValue('user_id', userIdDef, candidate);
            if (vr.ok) collected.user_id = vr.normalizedValue;
          }
          if (wantsLegalId && !isPresentNonPlaceholder(collected.legal_id)) {
            const vr = validateFieldValue('legal_id', legalIdDef, candidate);
            if (vr.ok) collected.legal_id = vr.normalizedValue;
          }
          res.collectedData = collected;
        }
      } catch {
        // best-effort
      }

      // Best-effort: early segment resolution for Flow01 (lock-once).
      // This enables Flow01 to infer segment_id from the initial user prompt or from the occupation answer,
      // without waiting for the post-stage tool runner.
      try {
        const isFlow01 = String(res.flow?.slug || '') === 'flow_01_welcome_user';
        if (isFlow01) {
          // Use a short window of recent user messages (not just the current one).
          // This allows segment resolution even when the user's follow-up answer is short (e.g., "חדש"),
          // while the occupation was provided in the first message.
          const recentUserMsgs = await prisma.message.findMany({
            where: { conversationId: conversation.id, role: 'user' },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { content: true },
          });
          const combinedText = recentUserMsgs
            .map((m) => String(m.content || '').trim())
            .filter(Boolean)
            .reverse() // chronological
            .join(' | ')
            .slice(0, 900);

          if (combinedText.length < 3) return res;

          const collected: any = res.collectedData || {};
          const alreadyInPayload = String(collected.segment_id || '').trim();
          const alreadyInDb = await (async (): Promise<string> => {
            try {
              if (!conversation.userId) return '';
              const existing = await flowHelpers.getUserData(conversation.userId, res.flow.id);
              return String((existing as any)?.segment_id || '').trim();
            } catch {
              return '';
            }
          })();

          if (!alreadyInPayload && !alreadyInDb) {
            const { resolveSegmentFromText } = await import('../insurance/segments/resolveSegmentFromText');
            const resolved = await resolveSegmentFromText(combinedText);
            if (resolved?.source !== 'none' && Number(resolved.match_confidence || 0) >= 0.45 && resolved.segment_id) {
              const { buildQuestionnaireDefaultsFromResolution } = await import('../insurance/segments/buildQuestionnaireDefaults');
              const defaults = buildQuestionnaireDefaultsFromResolution(resolved);

              // Apply identifiers + safe questionnaire prefills non-destructively into collectedData.
              const merged = { ...(defaults.userData || {}), ...(defaults.prefill || {}) };
              for (const [k, v] of Object.entries(merged)) {
                if (collected[k] === undefined || collected[k] === null || collected[k] === '') collected[k] = v;
              }

              // Also set human-friendly fields used by UI + downstream orchestration.
              // - `business_segment` is what the UI links to a segment page.
              // - `business_site_type` improves phrasing + removes unnecessary follow-up questions.
              const { formatBusinessSegmentLabelHe, looksLikeNoiseBusinessSegmentHe } = await import('../insurance/segments/formatBusinessSegmentLabelHe');
              const desiredLabel = formatBusinessSegmentLabelHe({
                segment_name_he: (defaults.userData as any)?.segment_name_he,
                group_name_he: (defaults.userData as any)?.segment_group_name_he,
                segment_group_id: (defaults.userData as any)?.segment_group_id,
              });
              const existingBs = String(collected.business_segment || '').trim();
              if (desiredLabel && (!existingBs || looksLikeNoiseBusinessSegmentHe(existingBs))) {
                collected.business_segment = desiredLabel;
              }
              const st = (defaults.prefill as any)?.business_site_type;
              if (!String(collected.business_site_type || '').trim() && Array.isArray(st) && st.length > 0) {
                collected.business_site_type = String(st[0] || '').trim();
              }

              res.collectedData = collected;
            }
          }
        }
      } catch {
        // best-effort
      }
    }

    return res;
  }

  async proceedFlow(options: ProceedFlowOptions): Promise<ProceedFlowResult> {
    const { conversation, determinedFlow, debugCallback } = options;
    const debugLog = (level: 'info' | 'warn' | 'error', message: string, data?: any) => {
      logger[level](message, data);
      debugCallback?.(level, message, data);
    };
    let userId: string;
    if (!conversation.userId) {
      // CRITICAL:
      // Historically we required role to exist before creating a User record.
      // For non-registration entry flows (e.g., insurance welcome), the user may start with a greeting
      // and only provide role-like context later. We must still create a user to persist collected fields.
      const role = (determinedFlow.collectedData.role as string | undefined) || 'customer';
      const user = await flowHelpers.createUser(role);
      userId = user.id;

      await prisma.conversation.update({
        where: { id: conversation.id },
        data: { userId },
      });

      // CRITICAL: Update local conversation object so recursive calls see the new userId
      conversation.userId = userId;
    } else userId = conversation.userId;

    // Filter out empty strings and null values before saving - only save fields that were actually provided
    const cleanedCollectedData: Record<string, unknown> = Object.fromEntries(
      Object.entries(options.determinedFlow.collectedData).filter(([_, value]) =>
        value !== null
        && value !== undefined
        && value !== ''
        && !(
          typeof value === 'string'
          && ['null', ':null', 'undefined', ':undefined'].includes(value.trim().toLowerCase())
        ),
      ),
    );

    // Validate + normalize collected data before persisting.
    const flowDefinition = options.determinedFlow.flow.definition as FlowDefinition;
    const fieldDefs = flowDefinition.fields || {};
    const stageSlug = determinedFlow.stage;
    const stageDef = flowDefinition.stages?.[stageSlug];
    const stageFields = new Set<string>(Array.isArray(stageDef?.fieldsToCollect) ? stageDef!.fieldsToCollect : []);

    const expandCanonicalAliases = (k: string): string[] => {
      // Keep in sync (subset) with flowHelpers.setUserData aliasing rules.
      switch (String(k || '').trim()) {
        case 'email': return ['user_email', 'proposer_email'];
        case 'user_email': return ['email', 'proposer_email'];
        case 'proposer_email': return ['email', 'user_email'];

        case 'phone': return ['user_phone', 'proposer_mobile_phone', 'mobile_phone', 'user_mobile_phone'];
        case 'mobile_phone': return ['phone', 'user_phone', 'proposer_mobile_phone'];
        case 'user_phone': return ['phone', 'proposer_mobile_phone', 'mobile_phone'];
        case 'user_mobile_phone': return ['phone', 'proposer_mobile_phone', 'mobile_phone'];
        case 'proposer_mobile_phone': return ['phone', 'user_phone', 'mobile_phone'];

        case 'first_name': return ['user_first_name', 'proposer_first_name'];
        case 'user_first_name': return ['first_name', 'proposer_first_name'];
        case 'proposer_first_name': return ['first_name', 'user_first_name'];

        case 'last_name': return ['user_last_name', 'proposer_last_name'];
        case 'user_last_name': return ['last_name', 'proposer_last_name'];
        case 'proposer_last_name': return ['last_name', 'user_last_name'];

        // Israeli ID: flows sometimes use user_id vs legal_id interchangeably.
        // Treat them as aliases to avoid stale invalid markers / missed corrections.
        case 'user_id': return ['legal_id'];
        case 'legal_id': return ['user_id'];

        default: return [];
      }
    };

    const parseBooleanish = (v: unknown): boolean | null => {
      if (v === true) return true;
      if (v === false) return false;
      const s = String(v ?? '').trim().toLowerCase();
      if (!s) return null;

      // Explicit tokens + common Hebrew synonyms
      if (['true', '1', 'כן', 'y', 'yes', 'יש', 'מעסיק', 'עם עובדים', 'עובדים', 'חיובי'].includes(s)) return true;
      if (['false', '0', 'לא', 'n', 'no', 'אין', 'בלי', 'ללא', 'שלילי'].includes(s)) return false;

      // Numeric prefixes: 0 => false, any positive integer => true (e.g., "3 עובדים", "1-999999")
      const m = /^(\d{1,9})\b/.exec(s);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n)) return n > 0;
      }

      return null;
    };

    const validatedCollectedData: Record<string, unknown> = {};
    const invalidFieldSlugs: string[] = [];
    const invalidHints: Record<string, string> = {};

    for (const [fieldSlug, rawValue] of Object.entries(cleanedCollectedData)) {
      const def = (fieldDefs as any)?.[fieldSlug] as FieldDefinition | undefined;
      const res = validateFieldValue(fieldSlug, def, rawValue);
      if (!res.ok) {
        invalidFieldSlugs.push(fieldSlug);
        if (typeof (res as any).suggestion === 'string' && String((res as any).suggestion).trim()) {
          invalidHints[fieldSlug] = String((res as any).suggestion).trim();
        }
        continue;
      }
      validatedCollectedData[fieldSlug] = res.normalizedValue;
    }

    try {
      const flowId = options.determinedFlow.flow.id;
      const existing = await flowHelpers.getUserData(userId, flowId);
      await enrichBusinessAddressInPlace({
        validatedCollectedData,
        existingUserData: existing as any,
        conversationId: conversation.id,
      });
      await enrichIsraelCompaniesRegistryInPlace({
        validatedCollectedData,
        existingUserData: existing as any,
        conversationId: conversation.id,
      });
    } catch {
      // best-effort (never block the flow on enrichment failures)
    }

    // Derivation: employers liability interest is fully determined by has_employees.
    // If the business has employees -> ch8_employers_selected=true; otherwise false. Skip asking the question.
    try {
      const hasEmployees = parseBooleanish(validatedCollectedData.has_employees);
      const hasCh8FieldDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'ch8_employers_selected');
      const stageCollectsCh8 = stageFields.has('ch8_employers_selected');
      if ((hasCh8FieldDef || stageCollectsCh8) && hasEmployees !== null) {
        validatedCollectedData.ch8_employers_selected = hasEmployees;
        validatedCollectedData.ch8_employers_selected_source = 'has_employees';
      }
    } catch {
      // best-effort
    }

    // Derivation (Flow 02): if the user explicitly does NOT need building coverage, default contents coverage to YES.
    // Product rule: policy must include building and/or contents as foundational coverages.
    // When building=false -> contents=true, and we should skip asking contents.
    try {
      const isFlow02 = String(options.determinedFlow.flow.slug || '').trim() === 'flow_02_intent_segment_and_coverages';
      const hasBuildingDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'ch2_building_selected');
      const hasContentsDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'ch1_contents_selected');
      if (isFlow02 && hasBuildingDef && hasContentsDef) {
        const building = parseBooleanish(validatedCollectedData.ch2_building_selected);
        if (building === false) {
          validatedCollectedData.ch1_contents_selected = true;
          validatedCollectedData.ch1_contents_selected_source = 'building_false_default';
        }
      }
    } catch {
      // best-effort
    }

    // Derivation (topic-split insurance): if the user selected Business Interruption daily coverage (ch3a),
    // deterministically set the enum business_interruption_type so downstream routing is reliable.
    //
    // UX requirement: choosing "כן" for BI coverage must auto-map to:
    // business_interruption_type = "אובדן הכנסה (פיצוי יומי)".
    try {
      const hasBiDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'business_interruption_type');
      const hasCh3aDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'ch3a_selected');
      const stageCollectsBi = stageFields.has('business_interruption_type');
      const stageCollectsCh3a = stageFields.has('ch3a_selected');
      if ((hasBiDef || stageCollectsBi) && (hasCh3aDef || stageCollectsCh3a)) {
        const ch3a = parseBooleanish(validatedCollectedData.ch3a_selected);
        if (ch3a === true) {
          validatedCollectedData.business_interruption_type = 'אובדן הכנסה (פיצוי יומי)';
        } else if (ch3a === false) {
          validatedCollectedData.business_interruption_type = 'לא';
        }
      }
    } catch {
      // best-effort
    }

    // Derivation: infer business_legal_entity_type from business_registration_id (when available and not already set).
    try {
      const flowId = options.determinedFlow.flow.id;
      const hasFieldDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'business_legal_entity_type');
      const reg = String(validatedCollectedData.business_registration_id || '').trim();
      const providedEntityType = String(validatedCollectedData.business_legal_entity_type || '').trim();

      if (hasFieldDef && reg && !providedEntityType) {
        // Only overwrite if missing, or if it was previously derived by this same mechanism.
        const existingType = await prisma.userData.findUnique({
          where: { key_userId_flowId: { userId, flowId, key: 'business_legal_entity_type' } },
          select: { value: true },
        });
        const existingSource = await prisma.userData.findUnique({
          where: { key_userId_flowId: { userId, flowId, key: 'business_legal_entity_type_source' } },
          select: { value: true },
        });

        const existingValue = String(existingType?.value || '').trim();
        const existingSrc = String(existingSource?.value || '').trim();
        const canOverwrite = !existingValue || existingSrc === 'business_registration_id_prefix';

        if (canOverwrite) {
          const inferred = inferBusinessLegalEntityTypeFromBusinessRegistrationId(reg);
          const def = (fieldDefs as any)?.business_legal_entity_type as FieldDefinition | undefined;
          const vr = validateFieldValue('business_legal_entity_type', def, inferred.heLabel);
          if (vr.ok) {
            validatedCollectedData.business_legal_entity_type = vr.normalizedValue;
            validatedCollectedData.business_legal_entity_type_code = inferred.code;
            validatedCollectedData.business_legal_entity_type_source = 'business_registration_id_prefix';
            if (inferred.detailHe) validatedCollectedData.business_legal_entity_type_detail_he = inferred.detailHe;
          }
        }
      }
    } catch {
      // best-effort
    }

    // Persist invalid markers for prompt injection.
    // IMPORTANT: Do NOT clear invalid markers unless the user actually provided a valid replacement.
    try {
      const flowId = options.determinedFlow.flow.id;
      const prevRow = await prisma.userData.findUnique({
        where: { key_userId_flowId: { userId, flowId, key: '__invalid_fields' } },
        select: { value: true },
      });
      let prevInvalid: string[] = [];
      try {
        const parsed = prevRow?.value ? JSON.parse(prevRow.value) : [];
        if (Array.isArray(parsed)) prevInvalid = parsed.map((x) => String(x || '').trim()).filter(Boolean);
      } catch {
        prevInvalid = [];
      }

      const merged = new Set<string>(prevInvalid);
      // Persist hints alongside invalid markers (best-effort; never store raw invalid values).
      const prevHintsRow = await prisma.userData.findUnique({
        where: { key_userId_flowId: { userId, flowId, key: '__invalid_fields_hints' } },
        select: { value: true },
      });
      let prevHints: Record<string, string> = {};
      try {
        const parsed = prevHintsRow?.value ? JSON.parse(prevHintsRow.value) : {};
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) prevHints = parsed as Record<string, string>;
      } catch {
        prevHints = {};
      }

      // Remove fields that were corrected in this message (valid values were saved).
      const corrected = new Set<string>();
      for (const k of Object.keys(validatedCollectedData)) {
        corrected.add(k);
        for (const a of expandCanonicalAliases(k)) corrected.add(a);
      }
      for (const k of corrected) merged.delete(k);
      // Add newly invalid fields detected in this message.
      for (const k of invalidFieldSlugs) merged.add(k);

      const mergedList = Array.from(merged);
      const invalidForStage = mergedList.filter((s) => stageFields.has(s));

      // CRITICAL:
      // If the user *attempted* to answer a stage-required field but the value is invalid,
      // we must NOT keep an older valid value in DB; otherwise the stage can erroneously proceed
      // (observed: user typed invalid business_registration_id, but an older valid value remained
      // and the flow continued without showing an error / retry prompt).
      //
      // Therefore: for invalid fields detected in THIS message (not historical invalid markers),
      // delete the stored value (and its canonical aliases) so the engine will re-ask.
      try {
        const invalidThisTurnForStage = invalidFieldSlugs.filter((s) => stageFields.has(s));
        if (invalidThisTurnForStage.length > 0) {
          const toDelete = new Set<string>();
          for (const k of invalidThisTurnForStage) {
            toDelete.add(k);
            for (const a of expandCanonicalAliases(k)) toDelete.add(a);
          }
          // If business_registration_id is invalid, also clear derived legal entity type fields
          // to avoid inconsistent UI/state.
          if (toDelete.has('business_registration_id')) {
            for (const k of [
              'business_legal_entity_type',
              'business_legal_entity_type_code',
              'business_legal_entity_type_source',
              'business_legal_entity_type_detail_he',
            ]) toDelete.add(k);
          }

          await prisma.userData.deleteMany({
            where: { userId, flowId, key: { in: Array.from(toDelete) } },
          });
        }
      } catch {
        // best-effort (never block the flow on cleanup failures)
      }
      // Always persist the merged list (including empty) so we can CLEAR stale invalid markers in DB.
      validatedCollectedData.__invalid_fields = mergedList;
      validatedCollectedData.__invalid_fields_at = mergedList.length > 0 ? String(Date.now()) : '';
      validatedCollectedData.__invalid_fields_labels_he = invalidForStage.map((s) => (
        getFieldDisplayNameHe(s, (fieldDefs as any)?.[s] as FieldDefinition | undefined)
      ));

      // Merge hints: remove corrected, add newly detected.
      const mergedHints: Record<string, string> = { ...prevHints };
      for (const k of corrected) delete mergedHints[k];
      for (const [k, v] of Object.entries(invalidHints)) mergedHints[k] = v;
      // Keep only hints for fields that are still invalid.
      const stillInvalidSet = new Set<string>(mergedList);
      for (const k of Object.keys(mergedHints)) {
        if (!stillInvalidSet.has(k)) delete mergedHints[k];
      }
      validatedCollectedData.__invalid_fields_hints = mergedHints;
    } catch {
      // best-effort fallback: store only current invalids for this stage (legacy behavior)
      const invalidForStage = invalidFieldSlugs.filter((s) => stageFields.has(s));
      // Store full invalid list for clearing on next successful merge attempt.
      validatedCollectedData.__invalid_fields = invalidFieldSlugs;
      validatedCollectedData.__invalid_fields_at = invalidFieldSlugs.length > 0 ? String(Date.now()) : '';
      validatedCollectedData.__invalid_fields_labels_he = invalidForStage.map((s) => (
        getFieldDisplayNameHe(s, (fieldDefs as any)?.[s] as FieldDefinition | undefined)
      ));
      validatedCollectedData.__invalid_fields_hints = invalidHints;
    }

    await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, validatedCollectedData, conversation.id);

    const currentStage = determinedFlow.stage;

    // CRITICAL: Reload userData after setUserData to ensure auto-populated fields (like PRIMARY_ORG entity fields) are included
    // Auto-population now saves directly to database synchronously, so fields should be available immediately
    // CRITICAL: Reload userData after setUserData to ensure auto-populated fields (like PRIMARY_ORG entity fields) are included
    // Auto-population now saves directly to database synchronously, so fields should be available immediately
    let userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);

    // Post-save prefill: if has_employees exists but ch8_employers_selected is missing/stale, set it so the question is skipped.
    try {
      const hasCh8FieldDef = Object.prototype.hasOwnProperty.call(fieldDefs, 'ch8_employers_selected');
      const stageCollectsCh8 = stageFields.has('ch8_employers_selected');
      if (hasCh8FieldDef || stageCollectsCh8) {
        const hasEmployees = parseBooleanish((userData as any).has_employees);
        const cur = (userData as any).ch8_employers_selected;
        const curSrc = String((userData as any).ch8_employers_selected_source || '').trim();
        const hasCur = cur !== undefined && cur !== null && cur !== '';
        const shouldSet = hasEmployees !== null && (!hasCur || curSrc === 'has_employees');
        if (shouldSet) {
          await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, {
            ch8_employers_selected: hasEmployees,
            ch8_employers_selected_source: 'has_employees',
          }, conversation.id);
          userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);
        }
      }
    } catch {
      // best-effort
    }

    // Post-save prefill (Flow 02): enforce foundational coverages rule.
    // If building coverage is explicitly NO, force contents coverage to YES (even if userData is missing/stale).
    try {
      const isFlow02 = String(options.determinedFlow.flow.slug || '').trim() === 'flow_02_intent_segment_and_coverages';
      if (isFlow02) {
        const building = parseBooleanish((userData as any).ch2_building_selected);
        if (building === false) {
          const curContents = parseBooleanish((userData as any).ch1_contents_selected);
          if (curContents !== true) {
            await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, {
              ch1_contents_selected: true,
              ch1_contents_selected_source: 'building_false_default',
            }, conversation.id);
            userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);
          }
        }
      }
    } catch {
      // best-effort
    }

    // Post-save cleanup: if invalid markers exist but values are now valid, clear them.
    try {
      const raw = (userData as any).__invalid_fields;
      const invalidSlugs = Array.isArray(raw) ? raw.map((x) => String(x || '').trim()).filter(Boolean) : [];
      if (invalidSlugs.length > 0) {
        const stillInvalid = invalidSlugs.filter((fieldSlug) => {
          const def = (fieldDefs as any)?.[fieldSlug] as FieldDefinition | undefined;
          const v0 = (userData as any)[fieldSlug];
          if (isPresentNonPlaceholder(v0)) {
            return !validateFieldValue(fieldSlug, def, v0).ok;
          }
          // If the canonical slug isn't present, allow any alias value to satisfy it.
          for (const alias of expandCanonicalAliases(fieldSlug)) {
            const va = (userData as any)[alias];
            if (!isPresentNonPlaceholder(va)) continue;
            if (validateFieldValue(fieldSlug, def, va).ok) return false;
          }
          return true;
        });
        if (stillInvalid.length !== invalidSlugs.length) {
          const hintsRaw = (userData as any).__invalid_fields_hints;
          const currentHints = (hintsRaw && typeof hintsRaw === 'object' && !Array.isArray(hintsRaw))
            ? (hintsRaw as Record<string, string>)
            : {};
          const hintsNext: Record<string, string> = {};
          const stillSet = new Set<string>(stillInvalid);
          for (const [k, v] of Object.entries(currentHints)) {
            if (stillSet.has(k) && String(v || '').trim()) hintsNext[k] = String(v).trim();
          }
          await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, {
            __invalid_fields: stillInvalid,
            __invalid_fields_at: stillInvalid.length > 0 ? String(Date.now()) : '',
            __invalid_fields_labels_he: stillInvalid
              .filter((s) => stageFields.has(s))
              .map((s) => getFieldDisplayNameHe(s, (fieldDefs as any)?.[s] as FieldDefinition | undefined)),
            __invalid_fields_hints: hintsNext,
          }, conversation.id);
          // Refresh local snapshot
          userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);
        }
      }
    } catch {
      // best-effort
    }

    const sessionId = determinedFlow.sessionId
      ? determinedFlow.sessionId
      : await this.initFlowState(userId, options.determinedFlow.flow.id, currentStage);

    const proceed = async (stageSlug: string): Promise<{ nextStage?: string | null; currentStage?: string; error?: ProceedFlowResult['error'] }> => {
      const stage = (options.determinedFlow.flow.definition as FlowDefinition).stages[stageSlug];

      // Only trace stage entry if we're actually entering a NEW stage (not staying in the same one)
      // Check if userFlow stage matches - if it does, we're staying in the same stage, don't trace again
      const userFlow = await prisma.userFlow.findUnique({
        where: { id: sessionId },
        select: { stage: true },
      });

      let traceId = '';
      // Check if we're entering a new stage or staying in the same one
      if (!userFlow || userFlow.stage !== stageSlug) {
        // We're entering a new stage - trace it
        traceId = await flowTracer.traceStageEntry(
          conversation.id,
          options.determinedFlow.flow.slug,
          stageSlug,
          userData,
        );
      } else {
        // We're staying in the same stage - find existing trace
        const existingTraces = await flowTracer.getConversationTrace(conversation.id);
        const existingTrace = existingTraces.find(
          (t) => t.flowSlug === options.determinedFlow.flow.slug &&
            Object.is(t.stageSlug, stageSlug) &&
            !t.completedAt,
        );
        traceId = existingTrace?.id || '';

        // If no existing trace found, create one (shouldn't happen, but safety check)
        if (!traceId) {
          traceId = await flowTracer.traceStageEntry(
            conversation.id,
            options.determinedFlow.flow.slug,
            stageSlug,
            userData,
          );
        }
      }

      // Check if stage is completed (fields collected + completionCondition if present)
      const isCompleted = this.isStageCompleted(
        stage,
        userData,
        (options.determinedFlow.flow.definition as FlowDefinition).fields,
      );

      if (!isCompleted) {
        // Handle custom logging on stage incomplete
        if (stage.orchestration?.onStageIncomplete) {
          const { logLevel = 'info', message, extraData = {} } = stage.orchestration.onStageIncomplete;
          const defs = (options.determinedFlow.flow.definition as FlowDefinition).fields || {};
          const missingFields = stage.fieldsToCollect.filter((fieldSlug) => {
            const v = (userData as any)[fieldSlug];
            if (!isPresentNonPlaceholder(v)) return true;
            const def = (defs as any)?.[fieldSlug] as FieldDefinition | undefined;
            return !validateFieldValue(fieldSlug, def, v).ok;
          });

          const logContext: Record<string, unknown> = {
            stageSlug,
            missingFields,
            ...userData,
          };

          // Evaluate extraData expressions
          for (const [key, expr] of Object.entries(extraData)) {
            try {
              if (kseval.native) {
                logContext[key] = kseval.native.evaluate(expr, { userData, stageSlug, missingFields, stage });
              }
            } catch (error) {
              // Ignore evaluation errors
            }
          }

          const logMessage = message || `Stage ${stageSlug} not completed`;
          logger[logLevel](logMessage, logContext);
        }
        return { nextStage: stageSlug };
      }

      if (stage.action) {
        let needToRunAction = false;
        try {
          // Evaluate action condition with error handling
          if (!stage.action.condition) {
            needToRunAction = true;
          } else if (kseval.native) {
            needToRunAction = !!kseval.native.evaluate(stage.action.condition, userData);
          } else {
            // If kseval is not available, assume action is needed
            needToRunAction = true;
          }
        } catch (error) {
          // If condition evaluation fails, log and assume action is not needed
          logger.error(`Error evaluating action condition for stage ${stageSlug}:`, error);
          needToRunAction = false;
        }

        if (needToRunAction) {
          // Allow manual retries: if user explicitly asked to retry, don't block tool execution.
          // This helps the agent recover from transient failures without getting stuck.
          const lastUserMessage = await prisma.message.findFirst({
            where: { conversationId: conversation.id, role: 'user' },
            orderBy: { createdAt: 'desc' },
            select: { content: true },
          });
          const userRequestedRetry = !!lastUserMessage?.content &&
            /(^|\b)(retry|try again|re-try|again|נסה שוב|תנסה שוב)(\b|$)/i.test(lastUserMessage.content);

          // Prevent re-execution loops for action-only stages:
          // If the last attempt to run *this same tool* in *this same stage* failed, do not
          // keep re-running on every user message unless the stage explicitly allows it or user asked to retry.
          const lastErrorStage = userData.__last_action_error_stage as string | undefined;
          const lastErrorTool = userData.__last_action_error_tool as string | undefined;
          const lastErrorMessage = userData.__last_action_error_message as string | undefined;
          const lastErrorAt = Number(userData.__last_action_error_at || 0);
          const isRecent = Number.isFinite(lastErrorAt) ? (Date.now() - lastErrorAt) < 1000 * 60 * 30 : false; // 30 minutes

          const shouldPreventReExecution = !userRequestedRetry &&
            stage.fieldsToCollect.length === 0 &&
            !stage.action?.allowReExecutionOnError &&
            isRecent &&
            lastErrorStage === stageSlug &&
            lastErrorTool === stage.action.toolName;

          if (shouldPreventReExecution) {
            // Return the last error so the engine shows it again instead of re-executing.
            return {
              nextStage: stageSlug,
              error: {
                toolName: stage.action.toolName,
                error: lastErrorMessage || 'The previous attempt failed. Say "retry" to try again.',
                stage: stageSlug,
                stageDescription: stage.description,
                isTechnical: true,
              },
            };
          }

          logger.info(`[flowRouter] Executing action tool: ${stage.action.toolName} for stage ${stageSlug}`, {
            hasVerificationCode: !!userData.verification_code,
            stageSlug,
            actionToolName: stage.action.toolName,
          });

          const res = await executeTool(stage.action.toolName, userData, { conversationId: conversation.id });

          // Trace tool execution
          await flowTracer.traceToolExecution(
            traceId,
            stage.action.toolName,
            res.success,
            res.error,
          );

          logger.info(`[flowRouter] Action tool result for ${stageSlug}`, {
            toolName: stage.action.toolName,
            success: res.success,
            hasError: !!res.error,
            error: res.error,
          });

          // REFRESH USER DATA: The tool likely updated the database. We must reload userData
          // to ensure subsequent logic and prompt construction use the fresh data.
          if (res.success) {
            userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);
            // Also update local tracking of verification code if it changed
            if (userData.verification_code) {
              // Keep local variable in sync if needed, though strictly userData is the source of truth now
            }

            // Clear stale "last tool error" context after a successful tool run.
            // This prevents the LLM from seeing an old failure and over-correcting.
            if (userData.__last_action_error_tool || userData.__last_action_error_message) {
              await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, {
                __last_action_error_stage: '',
                __last_action_error_tool: '',
                __last_action_error_message: '',
                __last_action_error_code: '',
                __last_action_error_at: '',
              }, conversation.id);
              Object.assign(userData, {
                __last_action_error_stage: '',
                __last_action_error_tool: '',
                __last_action_error_message: '',
                __last_action_error_code: '',
                __last_action_error_at: '',
              });
            }
          }

          if (!res.success) {
            // Capture structured errorCode for downstream remediation.
            const { errorCode } = (res as { errorCode?: string });

            // Persist last-action failure so the next LLM prompt can understand what failed and remediate.
            // We persist both for action-only stages (loop prevention) and for normal stages (context only).
            // Note: loop-prevention logic still applies only to action-only stages (fieldsToCollect.length === 0).
            await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, {
              __last_action_error_stage: stageSlug,
              __last_action_error_tool: stage.action.toolName,
              __last_action_error_message: String(res.error || 'Unknown error'),
              __last_action_error_code: String(errorCode || ''),
              __last_action_error_at: String(Date.now()),
            }, conversation.id);
            Object.assign(userData, {
              __last_action_error_stage: stageSlug,
              __last_action_error_tool: stage.action.toolName,
              __last_action_error_message: String(res.error || 'Unknown error'),
              __last_action_error_code: String(errorCode || ''),
              __last_action_error_at: String(Date.now()),
            });

            // Persist last-action failure to prevent re-execution loops in action-only stages.
            // (We intentionally do NOT persist for stages that collect user fields.)
            if (stage.fieldsToCollect.length === 0) {
              // (Already persisted above; keep for backwards compatibility with older logic.)
            }

            // Check for errorCode from tool (structured error)
            // Trace error
            await flowTracer.traceError(
              traceId,
              res.error || 'Unknown error',
              stageSlug,
              stage.action.toolName,
              errorCode,
            );

            // Handle error code handlers if configured
            if (errorCode && stage.action?.onErrorCode?.[errorCode]) {
              const handler = stage.action.onErrorCode[errorCode];

              // Update userData if specified
              if (handler.updateUserData) {
                const updates: Record<string, unknown> = {};
                for (const [key, expr] of Object.entries(handler.updateUserData)) {
                  try {
                    if (kseval.native) {
                      updates[key] = kseval.native.evaluate(expr, { userData, errorCode, res });
                    }
                  } catch (error) {
                    logger.error(`Error evaluating updateUserData expression for ${key}:`, error);
                  }
                }
                await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, updates, conversation.id);
                Object.assign(userData, updates);
              }

              // If handler specifies behavior, use it instead of default onError
              if (handler.behavior) {
                if (handler.behavior === 'newStage' && handler.nextStage) {
                  // Get flow-level error handling strategy
                  const flowDefinition = options.determinedFlow.flow.definition as FlowDefinition;
                  const errorStrategy = flowDefinition.config.errorHandlingStrategy?.onUnhandledError || 'skip';

                  // CRITICAL: Wrap updateFlowState and proceed in try-catch to handle errors gracefully
                  try {
                    // Update flow state to new stage
                    await this.updateFlowState({
                      userId,
                      flowId: options.determinedFlow.flow.id,
                      completedStage: stageSlug,
                      nextStage: handler.nextStage,
                      sessionId,
                    });

                    // Proceed to the new stage
                    const proceedResult = await proceed(handler.nextStage);
                    return proceedResult;
                  } catch (error: any) {
                    // Handle errors during stage transition based on flow-level strategy
                    logger.error(`Error during newStage transition (error code handler) from ${stageSlug} to ${handler.nextStage}:`, error);

                    if (errorStrategy === 'killFlow') {
                      // Gracefully end the flow
                      try {
                        await prisma.userFlow.deleteMany({ where: { userId } });
                      } catch (deleteError) {
                        logger.error('Error deleting userFlow during killFlow:', deleteError);
                      }
                      return {
                        nextStage: null,
                        error: {
                          toolName: stage.action.toolName,
                          error: error?.message || 'Flow ended due to error',
                          stage: stageSlug,
                          stageDescription: stage.description,
                          isTechnical: true,
                        },
                      };
                    }
                    // 'skip' strategy: revert database state to original stage before returning
                    // CRITICAL: We updated the database to the new stage, but proceed() failed.
                    // We must revert the database state to match the returned value (original stage).
                    try {
                      await prisma.userFlow.update({
                        where: { id: sessionId },
                        data: { stage: stageSlug },
                      });
                      logger.info(`Reverted flow state from ${handler.nextStage} back to ${stageSlug} after proceed() error (error code handler)`);
                    } catch (revertError) {
                      logger.error('Error reverting flow state after proceed() failure (error code handler):', revertError);
                      // CRITICAL: Check if tool performed a flow transition (e.g., welcome.route, flow.handoff)
                      // If the tool returns targetFlowSlug, it means the flow has been handed off to another flow
                      // The tool is responsible for updating the DB state.
                      // We MUST return early to updateFlowState from overwriting the tool's changes.
                      if (res.data?.targetFlowSlug) {
                        const { targetFlowSlug, targetStage } = res.data;
                        logger.info(`[flowRouter] Tool ${stage.action.toolName} triggered transition to ${targetFlowSlug}`, {
                          fromStage: stageSlug,
                          userId,
                        });

                        // Mark current stage as completed in trace before returning
                        if (traceId) {
                          // Fix: pass the collection of field slugs, not the userData object
                          const fieldsCollected = stage.fieldsToCollect.filter((fieldSlug) =>
                            userData[fieldSlug] !== undefined && userData[fieldSlug] !== null && userData[fieldSlug] !== '',
                          );
                          await flowTracer.traceStageCompletion(traceId, fieldsCollected);
                        }

                        // Return early - flowEngine will detect the flowId change in userFlow table
                        // and reload the correct flow definition
                        return {
                          currentStage: targetStage || stageSlug,
                        };
                      }

                      // Check for error handling configuration (action-level first, then stage-level)
                      // Only use default error config if no error code handler handled it
                      const errorConfig = stage.action.onError || stage.onError;
                    }
                    return {
                      nextStage: stageSlug,
                      error: {
                        toolName: stage.action.toolName,
                        error: error?.message || 'Failed to transition to next stage',
                        stage: stageSlug,
                        stageDescription: stage.description,
                        isTechnical: true,
                      },
                    };
                  }
                } else if (handler.behavior === 'pause') {
                  // Stay in current stage, show error
                  return {
                    nextStage: stageSlug,
                    error: {
                      toolName: stage.action.toolName,
                      error: res.error || 'Unknown error',
                      stage: stageSlug,
                      stageDescription: stage.description,
                      isTechnical: true,
                    },
                  };
                } else if (handler.behavior === 'continue') {
                  // Continue to next stage normally (log error but proceed)
                  logger.warn(`Tool action failed but continuing due to error code handler: ${res.error}`, {
                    stageSlug,
                    toolName: stage.action.toolName,
                    errorCode,
                  });
                  // Continue to next stage normally (don't return error)
                } else if (handler.behavior === 'endFlow') {
                  // Delete UserFlow to end the flow
                  await prisma.userFlow.deleteMany({
                    where: { userId },
                  });
                  return {
                    nextStage: null,
                    error: {
                      toolName: stage.action.toolName,
                      error: res.error || 'Flow ended due to error',
                      stage: stageSlug,
                      stageDescription: stage.description,
                      isTechnical: true,
                    },
                  };
                }
              }
            }

            // Check for error handling configuration (action-level first, then stage-level)
            // Only use default error config if no error code handler handled it
            const errorConfig = stage.action.onError || stage.onError;

            if (errorConfig) {
              // Use configured error handling
              const { errorHandler } = await import('./errorHandler');
              // Get the last message from conversation for error context
              const lastMessage = await prisma.message.findFirst({
                where: { conversationId: conversation.id },
                orderBy: { createdAt: 'desc' },
              });
              const errorHandlingResult = await errorHandler.handleTechnicalError(
                res.error || 'Unknown error',
                {
                  toolName: stage.action.toolName,
                  stage: stageSlug,
                  stageDescription: stage.description,
                  httpStatus: (res as { status?: number }).status,
                  conversationId: conversation.id,
                  messageId: lastMessage?.id || '',
                  userMessage: lastMessage?.content || '',
                  flowId: options.determinedFlow.flow.id,
                  flowSlug: options.determinedFlow.flow.slug,
                },
                errorConfig,
              );

              // Handle different behaviors
              if (errorHandlingResult.behavior === 'pause') {
                // If this stage is collecting user fields, most failures are user-actionable (validation/parse).
                // Mark them as non-technical so the engine re-asks the stage question instead of masking it.
                const analyzedIsTechnical = errorHandler.analyzeError(res.error || 'Unknown error').isTechnical;
                const isTechnical = stage.fieldsToCollect.length === 0 ? true : analyzedIsTechnical;
                // Stay in current stage, show custom message
                return {
                  nextStage: stageSlug,
                  error: {
                    toolName: stage.action.toolName,
                    error: errorHandlingResult.userMessage,
                    stage: stageSlug,
                    stageDescription: stage.description,
                    isTechnical,
                  },
                };
              } else if (errorHandlingResult.behavior === 'newStage') {
                // Transition to configured next stage
                if (!errorHandlingResult.nextStage) {
                  logger.error('Error config specifies newStage but nextStage is missing', {
                    stageSlug,
                    toolName: stage.action.toolName,
                  });
                  // Fall back to pause behavior
                  return {
                    nextStage: stageSlug,
                    error: {
                      toolName: stage.action.toolName,
                      error: errorHandlingResult.userMessage,
                      stage: stageSlug,
                      stageDescription: stage.description,
                      isTechnical: true,
                    },
                  };
                }

                // Get flow-level error handling strategy
                const flowDefinition = options.determinedFlow.flow.definition as FlowDefinition;
                const errorStrategy = flowDefinition.config.errorHandlingStrategy?.onUnhandledError || 'skip';

                // CRITICAL: Wrap updateFlowState and proceed in try-catch to handle errors gracefully
                try {
                  // Update flow state to new stage
                  await this.updateFlowState({
                    userId,
                    flowId: options.determinedFlow.flow.id,
                    completedStage: stageSlug,
                    nextStage: errorHandlingResult.nextStage,
                    sessionId,
                  });

                  // CRITICAL: For newStage behavior, proceed to the new stage WITHOUT returning an error
                  // This allows the new stage to execute its action (e.g., sendLoginOTP) automatically
                  // userData is already updated (e.g., already_registered flag set above for ALREADY_REGISTERED errors)
                  const proceedResult = await proceed(errorHandlingResult.nextStage);
                  return proceedResult;
                } catch (error: any) {
                  // Handle errors during stage transition based on flow-level strategy
                  logger.error(`Error during newStage transition from ${stageSlug} to ${errorHandlingResult.nextStage}:`, error);

                  if (errorStrategy === 'killFlow') {
                    // Gracefully end the flow
                    try {
                      await prisma.userFlow.deleteMany({ where: { userId } });
                    } catch (deleteError) {
                      logger.error('Error deleting userFlow during killFlow:', deleteError);
                    }
                    return {
                      nextStage: null,
                      error: {
                        toolName: stage.action.toolName,
                        error: errorHandlingResult.userMessage || error?.message || 'Flow ended due to error',
                        stage: stageSlug,
                        stageDescription: stage.description,
                        isTechnical: true,
                      },
                    };
                  }
                  // 'skip' strategy: revert database state to original stage before returning
                  // CRITICAL: We updated the database to the new stage, but proceed() failed.
                  // We must revert the database state to match the returned value (original stage).
                  try {
                    await prisma.userFlow.update({
                      where: { id: sessionId },
                      data: { stage: stageSlug },
                    });
                    logger.info(`Reverted flow state from ${errorHandlingResult.nextStage} back to ${stageSlug} after proceed() error`);
                  } catch (revertError) {
                    logger.error('Error reverting flow state after proceed() failure:', revertError);
                    // Continue anyway - the error will be logged and user will see the error message
                  }
                  return {
                    nextStage: stageSlug,
                    error: {
                      toolName: stage.action.toolName,
                      error: errorHandlingResult.userMessage || error?.message || 'Failed to transition to next stage',
                      stage: stageSlug,
                      stageDescription: stage.description,
                      isTechnical: true,
                    },
                  };
                }
              } else if (errorHandlingResult.behavior === 'endFlow') {
                // Delete UserFlow to end the flow
                await prisma.userFlow.deleteMany({
                  where: { userId },
                });
                return {
                  nextStage: null,
                  error: {
                    toolName: stage.action.toolName,
                    error: errorHandlingResult.userMessage,
                    stage: stageSlug,
                    stageDescription: stage.description,
                    isTechnical: true,
                  },
                };
              }
              // behavior === 'continue' - log error and proceed normally
              logger.warn(`Tool action failed but continuing due to error config: ${res.error}`, {
                stageSlug,
                toolName: stage.action.toolName,
              });
              // Continue to next stage normally (don't return error)

            } else {
              // No error config - use generic error handling
              // Check if tool returned an errorCode (structured error from tool executor)
              const { errorCode } = (res as { errorCode?: string });

              // If errorCode matches a known error that should be handled by onError config,
              // but no onError config exists, use default behavior
              // For now, treat all errors generically
              const { errorHandler } = await import('./errorHandler');
              const errorAnalysis = errorHandler.analyzeError(res.error || 'Unknown error');

              return {
                nextStage: stageSlug,
                error: {
                  toolName: stage.action.toolName,
                  error: res.error || 'Unknown error',
                  httpStatus: (res as { status?: number }).status,
                  stage: stageSlug,
                  stageDescription: stage.description,
                  isTechnical: errorAnalysis.isTechnical,
                },
              };
            }
          } else {
            // Tool execution succeeded - save any results returned by tool
            if (res.saveResults) {
              await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, res.saveResults, conversation.id);
              // Update userData for next stage
              Object.assign(userData, res.saveResults);
            }

            // CRITICAL: Check if tool performed a flow transition (e.g., welcome.route, flow.handoff)
            // If the tool returns targetFlowSlug, it means the flow has been handed off to another flow
            // The tool is responsible for updating the DB state.
            // We MUST recursively proceed to continue processing the new flow automatically.
            if (res.data?.targetFlowSlug) {
              const { targetFlowSlug, targetStage } = res.data;
              debugLog('info', `[flowRouter] 🔄 Tool ${stage.action.toolName} triggered transition to ${targetFlowSlug}`, {
                fromFlow: options.determinedFlow.flow.slug,
                fromStage: stageSlug,
                toFlow: targetFlowSlug,
                toStage: targetStage,
                userId,
                toolResult: res.data,
              });

              // Mark current stage as completed in trace before transitioning
              if (traceId) {
                const fieldsCollected = stage.fieldsToCollect.filter((fieldSlug) =>
                  userData[fieldSlug] !== undefined && userData[fieldSlug] !== null && userData[fieldSlug] !== '',
                );
                await flowTracer.traceStageCompletion(traceId, fieldsCollected);
              }

              // Find the target flow
              const targetFlow = await prisma.flow.findUnique({
                where: { slug: targetFlowSlug },
              });

              if (!targetFlow) {
                logger.error(`[flowRouter] Target flow ${targetFlowSlug} not found after tool transition`);
                return {
                  nextStage: stageSlug,
                  error: {
                    toolName: stage.action.toolName,
                    error: `Target flow ${targetFlowSlug} not found`,
                    stage: stageSlug,
                    stageDescription: stage.description,
                    isTechnical: true,
                  },
                };
              }

              const targetFlowDefinition = targetFlow.definition as FlowDefinition;
              const targetInitialStage = targetStage || targetFlowDefinition.config.initialStage;

              // Reload userFlow to get the updated stage after tool execution
              const updatedUserFlow = await prisma.userFlow.findUnique({
                where: { userId },
              });

              debugLog('info', '[flowRouter] 📍 Reloaded userFlow after tool transition', {
                userId,
                flowId: updatedUserFlow?.flowId,
                stage: updatedUserFlow?.stage,
                targetFlowSlug,
                targetInitialStage,
              });

              // Create new determinedFlow for target flow and proceed recursively
              // CRITICAL: Reset collectedData to empty object for new flow (don't carry over data from previous flow)
              // But preserve sessionId since the tool updates the same userFlow record
              const nextDeterminedFlow = {
                ...options.determinedFlow,
                flow: targetFlow,
                stage: updatedUserFlow?.stage || targetInitialStage, // Use updated stage from DB
                sessionId: updatedUserFlow?.id || options.determinedFlow.sessionId, // Preserve sessionId
                collectedData: {}, // Reset collectedData for new flow - userData is already saved by tool
              };

              debugLog('info', `[flowRouter] 🔀 Transitioning from ${options.determinedFlow.flow.slug} to ${targetFlowSlug} via tool`, {
                fromStage: stageSlug,
                toStage: updatedUserFlow?.stage || targetInitialStage,
                userId,
                nextDeterminedFlowStage: nextDeterminedFlow.stage,
                sessionId: nextDeterminedFlow.sessionId,
              });

              // CRITICAL: Wrap recursive proceedFlow call in try-catch to handle transition errors gracefully
              try {
                debugLog('info', `[flowRouter] 🔁 Starting RECURSIVE proceedFlow call for ${targetFlowSlug}`, {
                  flow: targetFlow.slug,
                  initialStage: nextDeterminedFlow.stage,
                  userId,
                  sessionId: nextDeterminedFlow.sessionId,
                });

                const nextProceedResult = await this.proceedFlow({
                  determinedFlow: nextDeterminedFlow,
                  conversation,
                  debugCallback,
                });

                debugLog('info', `[flowRouter] ✅ Successfully completed RECURSIVE proceedFlow for ${targetFlowSlug}`, {
                  currentStage: nextProceedResult.currentStage,
                  hasError: !!nextProceedResult.error,
                  error: nextProceedResult.error,
                  nextStage: (nextProceedResult as any).nextStage,
                  resultKeys: Object.keys(nextProceedResult),
                });

                // Return currentStage so flowEngine knows we're in the new flow
                // CRITICAL: Don't propagate errors from recursive call - they're handled internally
                return {
                  currentStage: nextProceedResult.currentStage || targetInitialStage,
                  // Propagate errors from recursive proceedFlow so flowEngine can handle them
                  error: nextProceedResult.error,
                };
              } catch (error: any) {
                // If recursive proceedFlow fails, log error but don't crash - return the new stage anyway
                logger.error(`[flowRouter] Error during tool-triggered flow transition from ${options.determinedFlow.flow.slug} to ${targetFlowSlug}:`, {
                  error: error?.message,
                  stack: error?.stack,
                  fromStage: stageSlug,
                  toStage: targetInitialStage,
                  userId,
                });

                // Return the new stage without error - let the flow start normally
                return {
                  currentStage: targetInitialStage,
                };
              }
            }

            // Continue to next stage normally (if no transition occurred)
          }
        }
      }

      const nextStage = this.getNextStage(stage, userData);
      const flowDefinition = options.determinedFlow.flow.definition as FlowDefinition;

      debugLog('info', `[flowRouter] 🎯 Determined nextStage for ${stageSlug}: ${nextStage}`, {
        flow: options.determinedFlow.flow.slug,
        stageSlug,
        nextStage,
        userDataKeys: Object.keys(userData),
        role: userData.role,
        hasNextStageConditional: typeof stage.nextStage === 'object' && !!stage.nextStage?.conditional,
      });

      // Check if flow has onComplete config and current stage is the last stage (no nextStage)
      if ((!nextStage || nextStage === stageSlug) && flowDefinition.config.onComplete) {
        const nextFlowSlug = flowDefinition.config.onComplete.startFlowSlug;
        const nextFlow = await prisma.flow.findUnique({ where: { slug: nextFlowSlug } });

        if (nextFlow) {
          const nextFlowDefinition = nextFlow.definition as FlowDefinition;
          const nextFlowInitialStage = nextFlowDefinition.config.initialStage;

          // Mark current stage as completed in trace BEFORE transitioning
          if (traceId) {
            const fieldsCollected = stage.fieldsToCollect.filter((fieldSlug) =>
              fieldSlug in userData &&
              userData[fieldSlug] !== undefined &&
              userData[fieldSlug] !== null &&
              userData[fieldSlug] !== '',
            );
            await flowTracer.traceStageCompletion(traceId, fieldsCollected);
          }

          // Mark current stage as completed
          await prisma.flowHistory.create({
            data: {
              userId,
              flowId: options.determinedFlow.flow.id,
              stage: stageSlug,
              sessionId,
            },
          });

          // Preserve specified fields from current flow to next flow
          if (flowDefinition.config.onComplete.preserveFields && flowDefinition.config.onComplete.preserveFields.length > 0) {
            const fieldsToPreserve: Record<string, unknown> = {};
            for (const fieldKey of flowDefinition.config.onComplete.preserveFields) {
              if (fieldKey in userData && userData[fieldKey] !== undefined && userData[fieldKey] !== null && userData[fieldKey] !== '') {
                fieldsToPreserve[fieldKey] = userData[fieldKey];
              }
            }
            if (Object.keys(fieldsToPreserve).length > 0) {
              await flowHelpers.setUserData(userId, nextFlow.id, fieldsToPreserve, conversation.id);
              logger.info(`[flowRouter] Preserved ${Object.keys(fieldsToPreserve).length} fields during flow transition`, {
                preservedFields: Object.keys(fieldsToPreserve),
                fromFlow: options.determinedFlow.flow.slug,
                toFlow: nextFlowSlug,
              });
            }
          }

          // Update userFlow to point to next flow
          await prisma.userFlow.update({
            where: { id: sessionId },
            data: { flowId: nextFlow.id, stage: nextFlowInitialStage },
          });

          // Create new determinedFlow for next flow and proceed
          // CRITICAL: Reset collectedData to empty object for new flow (don't carry over data from previous flow)
          const nextDeterminedFlow = {
            ...options.determinedFlow,
            flow: nextFlow,
            stage: nextFlowInitialStage,
            collectedData: {}, // Reset collectedData for new flow
          };

          logger.info(`[flowRouter] Transitioning from ${options.determinedFlow.flow.slug} to ${nextFlowSlug}`, {
            fromStage: stageSlug,
            toStage: nextFlowInitialStage,
            userId,
          });

          // CRITICAL: Wrap recursive proceedFlow call in try-catch to handle transition errors gracefully
          try {
            const nextProceedResult = await this.proceedFlow({
              determinedFlow: nextDeterminedFlow,
              conversation,
              debugCallback: options.debugCallback,
            });

            logger.info(`[flowRouter] Successfully transitioned to ${nextFlowSlug}`, {
              currentStage: nextProceedResult.currentStage,
              hasError: !!nextProceedResult.error,
            });

            // Return currentStage so flowEngine knows we're in the new flow
            // CRITICAL: Don't propagate errors from recursive call - they're handled internally
            // Only return error if it's a critical issue that prevents flow continuation
            return {
              currentStage: nextProceedResult.currentStage || nextFlowInitialStage,
              // Don't propagate errors from recursive proceedFlow - let the new flow handle its own errors
              // This prevents showing confusing error messages during flow transitions
            };
          } catch (error: any) {
            // If recursive proceedFlow fails, log error but don't crash - return the new stage anyway
            // The new flow will start on next message
            logger.error(`[flowRouter] Error during flow transition from ${options.determinedFlow.flow.slug} to ${nextFlowSlug}:`, {
              error: error?.message,
              stack: error?.stack,
              fromStage: stageSlug,
              toStage: nextFlowInitialStage,
              userId,
            });

            // Return the new stage without error - let the flow start normally on next message
            // This prevents showing confusing error messages to users during flow transitions
            return {
              currentStage: nextFlowInitialStage,
            };
          }
        }
      }

      // Trace stage completion
      const fieldsCollected = stage.fieldsToCollect.filter((fieldSlug) =>
        fieldSlug in userData &&
        userData[fieldSlug] !== undefined &&
        userData[fieldSlug] !== null &&
        userData[fieldSlug] !== '',
      );
      await flowTracer.traceStageCompletion(traceId, fieldsCollected);

      // CRITICAL: Wrap updateFlowState in try-catch to handle database errors gracefully
      try {
        await this.updateFlowState({
          userId,
          flowId: determinedFlow.flow.id,
          completedStage: stageSlug,
          nextStage,
          sessionId,
        });
      } catch (error: any) {
        // If flow state update fails, return error but don't crash
        logger.error(`Error updating flow state for stage ${stageSlug}:`, error);
        return {
          nextStage: stageSlug,
          error: {
            toolName: 'flowRouter',
            error: error?.message || 'Failed to update flow state',
            stage: stageSlug,
            stageDescription: stage.description,
            isTechnical: true,
          },
        };
      }

      if (nextStage === stageSlug || !nextStage) {
        debugLog('info', `[flowRouter] ⏹️  Stopping at ${stageSlug} - no nextStage or nextStage === current`, {
          stageSlug,
          nextStage,
          flow: options.determinedFlow.flow.slug,
        });
        return { currentStage: stageSlug };
      }

      // CRITICAL: Wrap proceed call in try-catch to handle any errors during stage transition
      try {
        debugLog('info', `[flowRouter] ➡️  Recursively proceeding from ${stageSlug} to ${nextStage}`, {
          fromStage: stageSlug,
          toStage: nextStage,
          flow: options.determinedFlow.flow.slug,
        });

        const proceedResult = await proceed(nextStage);

        const normalizedCurrentStage = proceedResult.currentStage || proceedResult.nextStage || nextStage;
        const normalizedNextStage = proceedResult.nextStage ?? null;

        debugLog('info', `[flowRouter] ✅ Recursive proceed from ${stageSlug} to ${nextStage} completed`, {
          fromStage: stageSlug,
          toStage: nextStage,
          currentStage: normalizedCurrentStage,
          nextStage: normalizedNextStage,
          flow: options.determinedFlow.flow.slug,
        });

        // If proceedResult has currentStage, use it; otherwise use nextStage as currentStage
        // This ensures that when we recursively proceed through stages, we return the final stage reached
        return {
          ...proceedResult,
          currentStage: proceedResult.currentStage || proceedResult.nextStage || nextStage,
        };
      } catch (error: any) {
        // If proceeding to next stage fails, return error but stay in current stage
        logger.error(`Error proceeding to stage ${nextStage}:`, error);
        return {
          nextStage: stageSlug,
          error: {
            toolName: 'flowRouter',
            error: error?.message || 'Failed to proceed to next stage',
            stage: stageSlug,
            stageDescription: stage.description,
            isTechnical: true,
          },
        };
      }
    };

    // CRITICAL: Wrap initial proceed call in try-catch to handle errors based on flow-level strategy
    let proceedResult: { nextStage?: string | null; currentStage?: string; error?: ProceedFlowResult['error'] };
    try {
      proceedResult = await proceed(currentStage);
    } catch (error: any) {
      // Handle unhandled errors at the top level based on flow-level strategy
      const flowDefinition = options.determinedFlow.flow.definition as FlowDefinition;
      const errorStrategy = flowDefinition.config.errorHandlingStrategy?.onUnhandledError || 'skip';

      logger.error(`Unhandled error in proceedFlow for stage ${currentStage}:`, error);

      if (errorStrategy === 'killFlow') {
        // Gracefully end the flow
        try {
          await prisma.userFlow.deleteMany({ where: { userId } });
        } catch (deleteError) {
          logger.error('Error deleting userFlow during killFlow:', deleteError);
        }
        proceedResult = {
          nextStage: null,
          error: {
            toolName: 'flowRouter',
            error: error?.message || 'Flow ended due to unhandled error',
            stage: currentStage,
            stageDescription: 'Flow execution error',
            isTechnical: true,
          },
        };
      } else {
        // 'skip' strategy: return error but stay in current stage
        proceedResult = {
          nextStage: currentStage,
          error: {
            toolName: 'flowRouter',
            error: error?.message || 'An error occurred. Please try again.',
            stage: currentStage,
            stageDescription: 'Flow execution error',
            isTechnical: true,
          },
        };
      }
    }

    // CRITICAL: If signUpSuccess transitioned to KYC, the transition returns currentStage directly
    // Check if currentStage was set (indicating a transition happened)
    // This happens when signUpSuccess transitions to KYC flow
    if (proceedResult.currentStage && proceedResult.currentStage !== currentStage) {
      // Stage changed (e.g., transitioned from signUpSuccess to KYC) - return the new currentStage
      return {
        currentStage: proceedResult.currentStage,
        error: proceedResult.error,
      };
    }

    // Normal flow - return nextStage as currentStage for next iteration
    return {
      currentStage: proceedResult.nextStage || currentStage,
      error: proceedResult.error,
    };
  }

  private async guessFlow(message: Message): Promise<Flow | null> {
    // Exclude flows marked as defaultForNewUsers from guessing
    const allFlows = await prisma.flow.findMany();
    const availableFlows = allFlows.filter((f) => {
      const definition = f.definition as FlowDefinition;
      return definition.config.defaultForNewUsers !== true;
    });

    return llmService.determineFlow(availableFlows, message);
  }

  private async initFlowState(userId: string, flowId: string, stage: string): Promise<string> {
    const userFlow = await prisma.userFlow.upsert({
      where: { userId },
      update: { flowId, stage },
      create: { userId, flowId, stage },
    });
    return userFlow.id;
  }

  private async updateFlowState(options: UpdateFlowStateOptions) {
    await prisma.flowHistory.create({
      data: {
        userId: options.userId,
        flowId: options.flowId,
        stage: options.completedStage,
        sessionId: options.sessionId,
      },
    });

    if (!options.nextStage) await prisma.userFlow.delete({ where: { id: options.sessionId } });
    else await prisma.userFlow.update({ where: { id: options.sessionId }, data: { stage: options.nextStage } });
  }

  private async updateFlowStateOld(userId: string, flowId: string, stage: string | null): Promise<void> {
    if (!stage) {
      await prisma.userFlow.deleteMany({ where: { userId } });
      return;
    }

    await prisma.userFlow.upsert({
      where: { userId },
      update: { flowId, stage },
      create: { userId, flowId, stage },
    });
  }

  isStageCompleted(stage: FlowStageDefinition, data: Record<string, unknown>, fields?: FlowDefinition['fields']): boolean {
    /*
    try {
      if (stage.fieldsToCollect && stage.fieldsToCollect.length > 0) {
        // Debug logging removed for production
      }
    } catch (e) { }
    */
    // If completionCondition is defined, evaluate it first
    // If condition passes, we can be more lenient with fields
    let completionConditionPassed = false;
    if (stage.completionCondition) {
      try {
        if (kseval.native) {
          const conditionResult = kseval.native.evaluate(stage.completionCondition, data);
          completionConditionPassed = Boolean(conditionResult);
        }
      } catch (error) {
        // If condition evaluation fails, log and assume condition is not met
        logger.error(`Error evaluating completionCondition for stage: ${stage.completionCondition}`, error);
        completionConditionPassed = false;
      }
    }

    // Check custom completion check if configured
    if (stage.orchestration?.customCompletionCheck) {
      const { condition, requiredFields } = stage.orchestration.customCompletionCheck;
      try {
        if (kseval.native) {
          const defs = fields || {};
          const isPresentValue = (v: unknown): boolean => isPresentNonPlaceholder(v);
          const isFieldPresentAndValid = (fieldSlug: string): boolean => {
            const v = (data as any)[fieldSlug];
            if (!isPresentValue(v)) return false;
            const def = (defs as any)?.[fieldSlug] as FieldDefinition | undefined;
            return validateFieldValue(fieldSlug, def, v).ok;
          };
          const __present = isPresentValue;
          const __includes = (container: unknown, needle: unknown): boolean => {
            if (container === null || container === undefined) return false;
            const n = String(needle ?? '');
            if (!n) return false;
            if (Array.isArray(container)) return container.map(String).includes(n);
            if (typeof container === 'string') return container.includes(n);
            return false;
          };

          // Prefer evaluating custom completion checks with an explicit userData scope so expressions
          // can safely reference missing keys (e.g. userData.some_field) without ReferenceErrors.
          let customConditionResult: unknown;
          try {
            customConditionResult = kseval.native.evaluate(condition, { userData: data, __present, __includes });
          } catch {
            // Backwards-compat: older expressions may assume direct access to fields.
            customConditionResult = kseval.native.evaluate(condition, data);
          }

          const ok = Boolean(customConditionResult);

          // IMPORTANT:
          // When a stage defines a customCompletionCheck, it must be the source of truth for completion.
          // Otherwise, we can get stuck in loops where:
          // - the stage "completes" due to naive presence checks (allFieldsCollected),
          // - but routing/tools re-evaluate stricter completion and bounce back.
          //
          // Mode A: requiredFields gate (legacy behavior)
          if (Array.isArray(requiredFields) && requiredFields.length > 0) {
            if (!ok) return false;
            const allRequiredFieldsCollected = requiredFields.every((fieldSlug) => isFieldPresentAndValid(fieldSlug));
            return allRequiredFieldsCollected;
          }

          // Mode B: condition-only completion (condition expression fully determines completion)
          return ok;
        }
      } catch (error) {
        logger.error(`Error evaluating customCompletionCheck: ${condition}`, error);
      }
    }

    // Check that all required fields are collected
    const defs = fields || {};
    const allFieldsCollected = stage.fieldsToCollect.every((fieldSlug) => {
      const v = (data as any)[fieldSlug];
      if (!isPresentNonPlaceholder(v)) return false;
      const def = (defs as any)?.[fieldSlug] as FieldDefinition | undefined;
      return validateFieldValue(fieldSlug, def, v).ok;
    });

    // If completionCondition is defined and passes, still need all fields (unless customCompletionCheck handled it)
    if (completionConditionPassed && stage.completionCondition) {
      return allFieldsCollected;
    }

    // If no completionCondition or it didn't pass, require all fields
    if (!allFieldsCollected) {
      return false;
    }

    // If all fields collected and no completionCondition, stage is complete
    if (!stage.completionCondition) {
      return true;
    }

    // If we have completionCondition but it didn't pass, stage is not complete
    return false;
  }

  private getNextStage(stage: FlowStageDefinition, data: Record<string, unknown>): string | null {
    if (typeof stage.nextStage === 'string') return stage.nextStage;

    if (typeof stage.nextStage === 'object') {
      let conditionalNextStage: string | null = null;
      stage.nextStage.conditional.some((c) => {
        try {
          // Evaluate condition with error handling
          // Ensure kseval.native exists before evaluating
          if (!kseval.native) {
            // If kseval.native is not available, fall back to fallback stage
            return false;
          }

          const res = Boolean(kseval.native.evaluate(c.condition, data));
          if (res) conditionalNextStage = c.ifTrue;
          else if (!res && c.ifFalse) conditionalNextStage = c.ifFalse;

          return !!conditionalNextStage;
        } catch (error) {
          // If condition evaluation fails, log and continue to next condition
          // Don't throw - let fallback handle it
          logger.error(`Error evaluating condition "${c.condition}":`, error);
          return false;
        }
      });
      return conditionalNextStage || stage.nextStage.fallback;
    }

    return null;
  }
}

export const flowRouter = new FlowRouter();

export type DeterminedFlow = {
  kind: 'initial' | 'assigned' | 'guessed';
  flow: Flow;
  stage: string;
  sessionId?: string;
  collectedData: Record<string, unknown>;
}

export type FlowError = {
  toolName: string;
  error: string;
  httpStatus?: number;
  stage: string;
  stageDescription?: string;
  isTechnical?: boolean;
};

export type ProceedFlowOptions = {
  determinedFlow: DeterminedFlow;
  conversation: Conversation;
  debugCallback?: (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => void;
}

export type ProceedFlowResult = {
  currentStage: string;
  error?: FlowError;
}

export type UpdateFlowStateOptions = {
  flowId: string;
  userId: string;
  completedStage: string;
  nextStage: string | null;
  sessionId: string;
}
