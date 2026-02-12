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

import { Flow, Message } from '@prisma/client';
import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';
import { GuidestarOrganisation, USAOrganisation } from '../../types/kycOrganisation';
import { FlowDefinition, FlowExecutionOptions, ProcessMessageOptions, FlowStageDefinition } from './types';
import { flowRouter } from './flowRouter';
import { conversationHelpers } from './conversationHelpers';
import { flowHelpers } from './flowHelpers';
import { llmService, ADAPTIVE_TONE_TEMPLATE } from './llmService';
import { errorHandler } from './errorHandler';
import { getFieldDisplayNameHe, isPresentNonPlaceholder, validateFieldValue } from './fieldValidation';
import { evaluateCondition } from '../insurance/questionnaire/conditions';

export class FlowEngine {
  async *processMessage(options: ProcessMessageOptions): AsyncGenerator<string | ProcessMessageRes> {
    const conversationId = options.conversationId || null;
    const conversation = await conversationHelpers.findOrCreate(conversationId, options.channel);

    if (!conversation) throw new Error('Conversation not found');

    const msg = await conversationHelpers.addMessage(conversation.id, 'user', options.message);

    // Define debugLog at function level so it's available everywhere
    const debugLog = (level: 'info' | 'warn' | 'error', message: string, data?: Record<string, unknown>) => {
      logger[level](message, data);
      options.debugCallback?.(level, message, data);
    };

    const determinedFlow = await flowRouter.determineFlowAndCollectData(conversation, msg);

    if (!determinedFlow) {
      yield* this.describeAvailableFlows(msg, options.stream);
      return;
    }

    await prisma.message.update({ where: { id: msg.id }, data: { flowId: determinedFlow.flow.id } });

    // Normal flow - proceed with flow execution

    debugLog('info', '[flowEngine] 🚀 Starting proceedFlow', {
      conversationId: conversation.id,
      userId: conversation.userId,
      flow: determinedFlow.flow.slug,
      stage: determinedFlow.stage,
    });

    const proceedResult = await flowRouter.proceedFlow({
      determinedFlow,
      conversation,
      debugCallback: options.debugCallback,
    });

    debugLog('info', '[flowEngine] 📊 proceedFlow completed', {
      conversationId: conversation.id,
      userId: conversation.userId,
      originalFlow: determinedFlow.flow.slug,
      originalStage: determinedFlow.stage,
      resultCurrentStage: proceedResult.currentStage,
      hasError: !!proceedResult.error,
      error: proceedResult.error,
    });

    // Resolve the state after execution (reloading from DB, handling transitions)
    const { currentFlow, currentFlowDefinition, actualUserData, allCollectedFields } = await this._resolvePostExecutionState(
      conversation,
      determinedFlow,
      proceedResult,
      debugLog,
    );

    let resp: AsyncGenerator<string, void, unknown>;

    // If there was an error, check if it's technical or user-actionable
    if (proceedResult.error) {
      resp = await this._handleProcessFlowError(
        proceedResult,
        options,
        conversation,
        msg,
        currentFlow,
        currentFlowDefinition,
        actualUserData,
        allCollectedFields,
      );
    } else {
      // No error - continue normally
      resp = await this._handleNormalFlowResponse(
        proceedResult,
        options,
        conversation,
        msg,
        currentFlow,
        currentFlowDefinition,
        determinedFlow,
        actualUserData,
        allCollectedFields,
        debugLog,
      );
    }

    let finalText = '';
    let chunkCount = 0;

    // Safety check: ensure resp is defined before iterating
    if (!resp) {
      logger.error('[flowEngine] resp is undefined - this should not happen', {
        conversationId: conversation.id,
        hasDeterminedFlow: !!determinedFlow,
        currentFlow: currentFlow?.slug,
      });
      resp = this.generateErrorResponse('An error occurred while processing your request. Please try again.', options.stream);
    }

    try {
      debugLog('info', '[flowEngine] 📡 Starting to stream response chunks', {
        conversationId: conversation.id,
        stream: options.stream,
      });

      for await (const chunk of resp) {
        chunkCount++;
        finalText += chunk;
        yield chunk;
      }

      debugLog('info', '[flowEngine] ✅ Finished streaming response', {
        conversationId: conversation.id,
        chunkCount,
        finalTextLength: finalText.length,
      });
    } catch (streamError: any) {
      // Log the error but continue to save what we have
      logger.error('Error during response streaming:', streamError);
      debugLog('error', '[flowEngine] Error during response streaming', {
        error: streamError.message,
        stack: streamError.stack,
        chunkCount,
        finalTextLength: finalText.length,
      });

      // If we have some text, use it; otherwise use error message
      // Temporary debugging: expose error to user
      finalText = `Sorry, I encountered an error: ${streamError.message}. Stack: ${streamError.stack}`;
    }

    // Save the response (including error messages) to conversation
    // Skip saving if content is empty (e.g., route stages that don't need responses)
    debugLog('info', '[flowEngine] 💾 Checking if assistant message should be saved', {
      conversationId: conversation.id,
      messageLength: finalText.length,
      hasContent: !!finalText,
      trimmedLength: finalText.trim().length,
    });

    // Only save if we have meaningful content (not empty or whitespace)
    if (finalText && finalText.trim().length > 0) {
      await conversationHelpers.addMessage(
        conversation.id,
        'assistant',
        finalText.trim(),
        currentFlow?.id,
      );

      debugLog('info', '[flowEngine] ✅ Assistant message saved successfully', {
        conversationId: conversation.id,
        messageLength: finalText.trim().length,
      });
    } else {
      debugLog('info', '[flowEngine] ⏭️  Skipping save - no meaningful content (likely route stage)', {
        conversationId: conversation.id,
        messageLength: finalText.length,
      });
    }

    // CRITICAL: Always ensure we have a response - if empty, provide fallback
    const trimmedFinalText = finalText.trim();
    if (!trimmedFinalText || trimmedFinalText.length === 0) {
      // Empty response - this shouldn't happen, but provide a fallback
      debugLog('warn', '[flowEngine] ⚠️  Empty response generated - providing fallback', {
        conversationId: conversation.id,
        stage: proceedResult?.currentStage,
        currentFlow: currentFlow?.slug,
      });
      // Detect language and provide appropriate fallback
      const conversationLanguage = await this.detectConversationLanguage(conversation.id);
      const fallbackMessage = conversationLanguage === 'hebrew'
        ? 'אני מעבד את הבקשה שלך. אנא המשך.'
        : 'I\'m processing your request. Please continue.';
      yield { finalText: fallbackMessage, conversationId: conversation.id };
    } else {
      yield { finalText: trimmedFinalText, conversationId: conversation.id };
    }
  }

  private async _resolvePostExecutionState(
    conversation: any,
    determinedFlow: any,
    proceedResult: any,
    debugLog: any,
  ) {
    let currentFlow = determinedFlow?.flow;
    let currentFlowDefinition = determinedFlow?.flow?.definition as FlowDefinition | undefined;

    // CRITICAL: Reload conversation to get updated userId (user might have been created during proceedFlow)
    const updatedConversation = await prisma.conversation.findUnique({
      where: { id: conversation.id },
      select: { userId: true },
    });

    // CRITICAL: Reload current flow state from database
    if (updatedConversation?.userId) {
      const userFlow = await prisma.userFlow.findUnique({ where: { userId: updatedConversation.userId } });

      if (userFlow) {
        const actualFlow = await prisma.flow.findUnique({ where: { id: userFlow.flowId } });
        if (actualFlow) {
          currentFlow = actualFlow;
          currentFlowDefinition = actualFlow.definition as FlowDefinition;
          proceedResult.currentStage = userFlow.stage;

          debugLog('info', '[flowEngine] 📍 Reloaded flow state from DB', {
            conversationId: conversation.id,
            flow: currentFlow.slug,
            stage: proceedResult.currentStage,
            originalFlow: determinedFlow.flow.slug,
          });
        }
      }
    } else {
      // No userId yet - use original flow
      currentFlow = determinedFlow.flow;
      currentFlowDefinition = determinedFlow.flow.definition as FlowDefinition;
    }

    // Check if proceedFlow processed a transition by comparing flows
    if (!currentFlow || !currentFlowDefinition) {
      logger.error('[flowEngine] currentFlow or currentFlowDefinition is undefined after reload - this should not happen', {
        conversationId: conversation.id,
        userId: conversation.userId,
        hasCurrentFlow: !!currentFlow,
        hasCurrentFlowDefinition: !!currentFlowDefinition,
      });
      // Fallback to original flow
      currentFlow = determinedFlow.flow;
      currentFlowDefinition = determinedFlow.flow.definition as FlowDefinition;
    }
    const flowTransitioned = currentFlow.id !== determinedFlow.flow.id;

    let allCollectedFields: string[] = [];
    let actualUserData: Record<string, unknown> = {};

    // Auto-proceed logic
    if (!flowTransitioned) {
      debugLog('info', '[flowEngine] 🔄 No flow transition, trusting proceedFlow result', {
        conversationId: conversation.id,
        flow: currentFlow.slug,
        stage: proceedResult.currentStage,
      });
    } else {
      debugLog('info', '[flowEngine] ✅ Flow transition was processed recursively by proceedFlow, trusting result', {
        conversationId: conversation.id,
        fromFlow: determinedFlow.flow.slug,
        toFlow: currentFlow?.slug || 'unknown',
        finalStage: proceedResult.currentStage,
      });

      // Reload flow definition again just in case (original code did this, kinda redundant but safe)
      if (conversation.userId) {
        const currentUserFlow = await prisma.userFlow.findUnique({ where: { userId: conversation.userId } });
        if (currentUserFlow) {
          const latestFlow = await prisma.flow.findUnique({ where: { id: currentUserFlow.flowId } });
          if (latestFlow) {
            currentFlow = latestFlow;
            currentFlowDefinition = latestFlow.definition as FlowDefinition;
            proceedResult.currentStage = currentUserFlow.stage;
          }
        }

        if (currentFlow) {
          actualUserData = await flowHelpers.getUserData(conversation.userId, currentFlow.id);
          allCollectedFields = Object.keys(actualUserData).filter((key) => {
            const value = actualUserData[key];
            if (key === 'campaign_start_date' && typeof value === 'string' && value.startsWith('RAW_DATE:')) {
              return false;
            }
            return value !== null && value !== undefined && value !== '';
          });
        }
      }
    }

    // If not set above (in else block), set it now if we have context
    // The original code had complex fallback logic.
    // If actualUserData is empty, try fallback
    if (Object.keys(actualUserData).length === 0) {
      if (conversation.userId) {
        // Fallback or specific logic if needed
      }
    }

    // Unified UserData fetching
    if (conversation.userId && currentFlow) {
      actualUserData = await flowHelpers.getUserData(conversation.userId, currentFlow.id);
      allCollectedFields = Object.keys(actualUserData).filter((key) => {
        const value = actualUserData[key];
        if (key === 'campaign_start_date' && typeof value === 'string' && value.startsWith('RAW_DATE:')) {
          return false;
        }
        return value !== null && value !== undefined && value !== '';
      });
    } else {
      // Fallback to what we collected in this turn
      actualUserData = determinedFlow.collectedData;
      allCollectedFields = Object.keys(determinedFlow.collectedData).filter(
        (key) => determinedFlow.collectedData[key] !== null &&
          determinedFlow.collectedData[key] !== undefined &&
          determinedFlow.collectedData[key] !== '',
      );
    }

    return { currentFlow, currentFlowDefinition, actualUserData, allCollectedFields };
  }

  private async _handleProcessFlowError(
    proceedResult: any,
    options: ProcessMessageOptions,
    conversation: any,
    msg: any,
    currentFlow: any,
    currentFlowDefinition: any,
    actualUserData: any,
    allCollectedFields: any,
  ): Promise<AsyncGenerator<string, void, unknown>> {
    logger.child(`conv_${options.conversationId}`).error('Error while proceeding flow', proceedResult.error);
    const isTechnical = proceedResult.error.isTechnical ?? errorHandler.analyzeError(proceedResult.error.error).isTechnical;

    if (isTechnical) {
      if (!currentFlow || !currentFlowDefinition) {
        logger.error('[flowEngine] currentFlow or currentFlowDefinition is undefined in technical error handler', {
          conversationId: conversation.id,
        });
        return this.generateErrorResponse('An internal error occurred. Please try again.', options.stream);
      }

      const currentStageDef = currentFlowDefinition.stages[proceedResult.currentStage];
      // Note: original code re-fetched userData here. We pass it in.
      const allFieldsCollected = currentStageDef ? this.isStageCompleted(currentStageDef, actualUserData) : false;

      const errorMessage = await errorHandler.generateErrorMessage(
        proceedResult.error.error,
        {
          toolName: proceedResult.error.toolName,
          stage: proceedResult.error.stage,
          stageDescription: proceedResult.error.stageDescription,
          httpStatus: proceedResult.error.httpStatus,
          conversationId: conversation.id,
          messageId: msg.id,
          userMessage: options.message,
        },
      );

      if (allFieldsCollected) {
        const conversationLanguage = await this.detectConversationLanguage(conversation.id);
        const enhancedMessage = conversationLanguage === 'hebrew'
          ? `${errorMessage}\n\nאם תרצה לנסות שוב, פשוט כתוב "נסה שוב" או "retry".`
          : `${errorMessage}\n\nIf you'd like to try again, just say "try again" or "retry".`;

        return this.generateErrorResponse(enhancedMessage, options.stream);
      }
      return this.generateErrorResponse(errorMessage, options.stream);

    }
    // User actionable error
    if (!currentFlow || !currentFlowDefinition) {
      logger.error('[flowEngine] currentFlow or currentFlowDefinition is undefined in user-actionable error handler', {
        conversationId: conversation.id,
      });
      return this.generateErrorResponse('An internal error occurred. Please try again.', options.stream);
    }

    const errorContext = await errorHandler.generateErrorMessage(
      proceedResult.error.error,
      {
        toolName: proceedResult.error.toolName,
        stage: proceedResult.error.stage,
        stageDescription: proceedResult.error.stageDescription,
        httpStatus: proceedResult.error.httpStatus,
        conversationId: conversation.id,
        messageId: msg.id,
        userMessage: options.message,
      },
    );

    // Continue flow with error context
    return this.generateResponse(
      currentFlowDefinition,
      {
        stage: proceedResult.currentStage,
        stream: options.stream,
        message: options.message,
        messageId: msg.id,
        conversationId: conversation.id,
        userId: conversation.userId,
        collectedFields: allCollectedFields,
        actualUserData,
        errorContext,
      },
    );

  }

  private async _handleNormalFlowResponse(
    proceedResult: any,
    options: ProcessMessageOptions,
    conversation: any,
    msg: any,
    currentFlow: any,
    currentFlowDefinition: any,
    determinedFlow: any,
    actualUserData: any,
    allCollectedFields: any,
    debugLog: any,
  ): Promise<AsyncGenerator<string, void, unknown>> {
    // Ensure currentFlow and currentFlowDefinition are defined
    if (!currentFlow || !currentFlowDefinition) {
      logger.error('[flowEngine] currentFlow or currentFlowDefinition is undefined in normal flow', {
        conversationId: conversation.id,
      });
      return this.generateErrorResponse('An internal error occurred. Please try again.', options.stream);
    }

    // Check if current stage needs a response before generating
    let responseStage = proceedResult.currentStage;
    const maxStageChecks = 5;
    let stageCheckCount = 0;

    // Use a local copy of userData for the loop, as we might update it
    let loopUserData = actualUserData;
    let loopCollectedFields = allCollectedFields;

    while (stageCheckCount < maxStageChecks && conversation.userId) {
      const checkStage = currentFlowDefinition.stages[responseStage];
      if (!checkStage) break;

      const promptSaysNoResponse = checkStage.prompt && (
        checkStage.prompt.toLowerCase().includes('should not generate a response message') ||
        checkStage.prompt.toLowerCase().includes('do not generate any message')
      );

      const hasFieldsToCollect = checkStage.fieldsToCollect && checkStage.fieldsToCollect.length > 0;
      const missingFields = hasFieldsToCollect
        ? checkStage.fieldsToCollect.filter((fieldSlug: string) => {
          const v = (loopUserData as any)?.[fieldSlug];
          if (!isPresentNonPlaceholder(v)) return true;
          const def = (currentFlowDefinition.fields as any)?.[fieldSlug];
          return !validateFieldValue(fieldSlug, def, v).ok;
        })
        : [];

      const stageNeedsResponse = !promptSaysNoResponse && (
        (checkStage.prompt && checkStage.prompt.trim().length > 0) ||
        (hasFieldsToCollect && missingFields.length > 0)
      );

      if (stageNeedsResponse) {
        debugLog('info', `[flowEngine] ✅ Found stage that needs response: ${responseStage}`, {
          conversationId: conversation.id,
          stage: responseStage,
          hasPrompt: !!checkStage.prompt,
          hasFieldsToCollect,
          missingFields: missingFields.length,
        });
        break;
      }

      // Stage doesn't need response - try to find next stage
      stageCheckCount++;
      const nextStageSlug = typeof checkStage.nextStage === 'string'
        ? checkStage.nextStage
        : checkStage.nextStage?.conditional?.[0]?.ifTrue || checkStage.nextStage?.fallback;

      if (!nextStageSlug || nextStageSlug === responseStage) {
        debugLog('info', `[flowEngine] ⏹️  No next stage found, using current stage: ${responseStage}`, {
          conversationId: conversation.id,
          stage: responseStage,
        });
        break;
      }

      debugLog('info', `[flowEngine] ➡️  Stage ${responseStage} doesn't need response, checking next: ${nextStageSlug}`, {
        conversationId: conversation.id,
        fromStage: responseStage,
        toStage: nextStageSlug,
        checkCount: stageCheckCount,
      });

      // Update DB stage
      await prisma.userFlow.updateMany({
        where: { userId: conversation.userId },
        data: { stage: nextStageSlug },
      });

      responseStage = nextStageSlug;

      // Reload userData for new stage
      if (currentFlow) {
        loopUserData = await flowHelpers.getUserData(conversation.userId, currentFlow.id);
        loopCollectedFields = Object.keys(loopUserData).filter((key) => {
          const value = loopUserData[key];
          if (key === 'campaign_start_date' && typeof value === 'string' && value.startsWith('RAW_DATE:')) {
            return false;
          }
          return value !== null && value !== undefined && value !== '';
        });
      }
    }

    return this.generateResponse(
      currentFlowDefinition,
      {
        stage: responseStage,
        stream: options.stream,
        message: options.message,
        messageId: msg.id,
        conversationId: conversation.id,
        userId: conversation.userId,
        collectedFields: loopCollectedFields,
        actualUserData: loopUserData,
      },
    );
  }

  private async * generateResponse(flowDefinition: FlowDefinition, options: FlowExecutionOptions) {
    const stage = flowDefinition.stages[options.stage];

    // CRITICAL: Safety check - if stage doesn't exist, yield error message
    if (!stage) {
      logger.error(`[flowEngine] Stage ${options.stage} not found in flow definition`, {
        conversationId: options.conversationId,
        stage: options.stage,
        availableStages: Object.keys(flowDefinition.stages),
      });
      yield 'I encountered an error processing your request. Please try again.';
      return;
    }

    // Get actual userData values to check for RAW_DATE prefix
    const actualUserData: Record<string, unknown> = options.actualUserData || {};

    // Check if stage is completed (validation-aware when field definitions exist)
    const { flowRouter } = await import('./flowRouter');
    const isStageComplete = flowRouter.isStageCompleted(stage, actualUserData, flowDefinition.fields);

    // Check what fields are missing
    const missingFields = stage.fieldsToCollect.filter((fieldSlug) => {
      const v = (actualUserData as any)[fieldSlug];
      if (!isPresentNonPlaceholder(v)) return true;
      const def = (flowDefinition.fields as any)?.[fieldSlug];
      return !validateFieldValue(fieldSlug, def, v).ok;
    });

    // Detect conversation language for consistency
    const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
    const languageInstruction = conversationLanguage === 'hebrew'
      ? 'CRITICAL: The user is communicating in Hebrew. You MUST respond ONLY in Hebrew throughout this entire conversation. Never switch to English, even for technical terms or links. Maintain Hebrew language consistency at all times.'
      : conversationLanguage === 'english'
        ? 'CRITICAL: The user is communicating in English. You MUST respond ONLY in English throughout this entire conversation. Maintain English language consistency at all times.'
        : '';

    // Determine per-stage question orchestration policy (generic; no flow-specific logic).
    // Defaults: WhatsApp=1 question per turn, Web=2 questions per turn.
    let conversationChannel: 'web' | 'whatsapp' | null = null;
    try {
      const convo = await prisma.conversation.findUnique({
        where: { id: options.conversationId },
        select: { channel: true },
      });
      const raw = String((convo as any)?.channel || '').toLowerCase();
      if (raw === 'whatsapp') conversationChannel = 'whatsapp';
      else if (raw === 'web') conversationChannel = 'web';
    } catch {
      // ignore - fall back to defaults
    }

    const qp = stage.orchestration?.questionPolicy;
    const defaultMaxQuestions = conversationChannel === 'whatsapp' ? 1 : 2;
    const maxQuestionsPerTurn = (() => {
      const byChannel = qp?.maxQuestionsPerTurn;
      const v = conversationChannel === 'whatsapp'
        ? byChannel?.whatsapp
        : byChannel?.web;
      const n = Number(v ?? defaultMaxQuestions);
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : defaultMaxQuestions;
    })();
    const suppressCoreMissingFieldsSection = qp?.suppressCoreMissingFieldsSection === true;
    const disableBulkCollectionRule = qp?.disableBulkCollectionRule === true || maxQuestionsPerTurn <= 1;

    // Get extra context from Valentine's system (user name, organizations, assistant hints)
    let extraContextString: string | null = null;
    let extraTemplateContext: Record<string, string | GuidestarOrganisation | USAOrganisation | undefined> = {};

    // CRITICAL: For kycEntitySelection, do NOT inject organization data - it should only ask the simple question
    if (options.userId && options.stage !== 'kycEntitySelection') {
      const extraContext = await flowHelpers.generateExtraContextForUser(options.userId);
      extraContextString = extraContext.contextString;
      extraTemplateContext = extraContext.templateContext;
    } else if (options.userId && options.stage === 'kycEntitySelection') {
      // For kycEntitySelection, only get user name, not organization data
      const user = await prisma.user.findUnique({ where: { id: options.userId } });
      if (user?.firstName) {
        const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ');
        extraContextString = `User:\n- Name: ${fullName}\n\nAssistantHints:\n- PersonalSnippet: If org info exists, add a short warm line like "Oh, {orgName} does wonderful work in {orgGoal}!" If only a short description is known, use it.\n- Terminology: Prefer "service" over "flow". Example: "Next, I can guide you through the next service — I'm here to help you plan and support every step of your campaign, from preparation to launch and beyond."\n- Style: Short, warm, natural language. Don't ask for info already known from context. Summarize and confirm when helpful.\n`;
        // Only provide orgName for template variable, not full organization data
        const userOrgs = await prisma.userOrganisation.findMany({ where: { userId: options.userId } });
        if (userOrgs.length > 0) {
          const org = await prisma.organisationInfo.findUnique({ where: { id: userOrgs[0].organisationId } });
          if (org?.data) {
            const orgData = org.data as GuidestarOrganisation | USAOrganisation;
            extraTemplateContext.orgName = orgData.name || (orgData as GuidestarOrganisation).fullName || '';
          }
        }
      }
    }

    // Get template context (org data, etc.) - merge with extra context
    const templateContext = await this.getTemplateContext(options.conversationId, stage);

    // Get available user data context from the explicit actualUserData passed to this function
    const userDataContext: Record<string, string | number | boolean> = {};
    if (options.actualUserData) {
      Object.entries(options.actualUserData).forEach(([key, value]) => {
        if (value !== null && value !== undefined &&
          (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean')) {
          userDataContext[key] = value;
        }
      });
    }

    // Merge template contexts (extra context takes precedence for template variables)
    // CRITICAL: For kycEntitySelection, do NOT include organizationData
    // We inject userDataContext LAST (before explicit overrides) to ensure the fresh data passed from processMessage is used
    const mergedTemplateContext = {
      ...templateContext,
      ...userDataContext, // <--- INJECT FRESH DATA HERE to override any stale DB fetch in templateContext
      ...extraTemplateContext,
      // If both have organizationData, prefer the one from extraContext (more complete)
      // BUT: For kycEntitySelection, exclude organizationData completely
      organizationData: (options.stage === 'kycEntitySelection')
        ? undefined
        : (extraTemplateContext.organizationData || templateContext.organizationData),
    };

    // Check for off-topic confusion - only after significant conversation without progress
    // INCREASED THRESHOLD: Check last 10-12 messages (5-6 exchanges) to be less aggressive
    const recentMessages = await prisma.message.findMany({
      where: { conversationId: options.conversationId },
      orderBy: { createdAt: 'desc' },
      take: 12, // Check last 12 messages (5-6 exchanges) - less aggressive
      select: { role: true, content: true },
    });
    const lastAssistantMessageText = String(recentMessages.find((m) => m.role === 'assistant')?.content || '');

    // Expose recent user text for prompt hooks (topic-split phrasing).
    // This is important when userData is stale/polluted across conversations (UserData is keyed by user+flow).
    try {
      const recentUserText = recentMessages
        .filter((m) => m.role === 'user')
        .map((m) => String(m.content || '').trim())
        .filter(Boolean)
        .reverse() // chronological
        .join(' | ');
      (mergedTemplateContext as any).__recent_user_text = recentUserText;
    } catch {
      // best-effort
    }

    // Detect if conversation has been stuck/off-topic
    // CRITICAL: Only trigger recovery if there's ACTUAL confusion/loop, not just clarification questions
    let needsRecovery = false;
    if (recentMessages.length >= 10) {
      // Check if last 5 assistant messages exist (indicating extended loop)
      const assistantMessages = recentMessages.filter((m) => m.role === 'assistant').slice(0, 5);
      const userMessages = recentMessages.filter((m) => m.role === 'user').slice(0, 5);

      // Extract field keywords from current stage to detect if user is providing relevant info
      const stageFields = flowHelpers.extractStageFields(flowDefinition, options.stage);
      const fieldKeywords = stageFields.map(([slug, field]) => {
        // Include both slug and field description keywords
        const desc = field.description || '';
        const keywords = desc.split(/[\s,.:;]/).filter((w) => w.length > 3);
        const allKeywords = [slug, ...keywords.slice(0, 3)];

        // CRITICAL: Escape regex special characters to prevent crashes (e.g., "(EIN")
        return allKeywords.map((k) => k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
      }).join('|');

      // Check if user messages contain field-related keywords (user is answering questions)
      const hasFieldKeywords = userMessages.some((msg) =>
        fieldKeywords ? new RegExp(fieldKeywords, 'i').test(msg.content) : false,
      );

      // Check if user messages are clarification questions (like "מה?", "מה זה?", etc.)
      const allUserMessagesAreShortQuestions = userMessages.length >= 3
        && userMessages.every((msg) => msg.content.trim().length < 50
          && (/^(מה|מה זה|מהו|איך|למה|why|what|how|can you|explain).*[?؟]?$/i.test(msg.content.trim())));

      // Check if assistant messages are very similar (indicating loop)
      const assistantMessagesAreSimilar = assistantMessages.length >= 4
        && assistantMessages.slice(0, 3).every((msg, idx) => {
          if (idx === 0) return true;
          const prev = assistantMessages[idx - 1].content;
          const curr = msg.content;
          // Simple similarity check: if messages share >70% of words, they're similar
          const prevWords = prev.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const currWords = curr.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
          const commonWords = prevWords.filter((w) => currWords.includes(w)).length;
          return commonWords / Math.max(prevWords.length, currWords.length) > 0.7;
        });

      // Only trigger recovery if:
      // - No field keywords in user messages (user is NOT answering questions)
      // - At least 5 assistant messages (extended loop)
      // - Assistant messages are similar (repeating same question)
      // - User messages are NOT just clarification questions
      // - User is genuinely off-topic, not just asking for help
      if (!hasFieldKeywords
        && assistantMessages.length >= 5
        && assistantMessagesAreSimilar
        && !allUserMessagesAreShortQuestions) {
        needsRecovery = true;
      }
    }

    // Determine if adaptive tone should be enabled (default: true)
    // Can be disabled at the flow invocation level or stage level
    const adaptiveToneEnabled = options.adaptiveToneEnabled !== false
      && stage.adaptiveToneEnabled !== false;

    const systemPrompt = [
      // Emotionally-adaptive tone template - adapts to user's language style, culture, and preferences
      ...(adaptiveToneEnabled ? [ADAPTIVE_TONE_TEMPLATE, ''] : []),
      'You are the Choco Expert Agent. Be proactive, concise, and helpful.',
      `You need to help user. Current stage description: ${stage.description}`,
      '',
      // Add stage completion status
      ...(isStageComplete ? [] : [
        '⚠️ STAGE COMPLETION STATUS: The current stage is NOT yet complete.',
        `Missing required fields: ${missingFields.length > 0 ? missingFields.join(', ') : 'none (checking completion condition)'}`,
        stage.completionCondition ? `Completion condition: ${stage.completionCondition}` : '',
        'CRITICAL: Focus ONLY on completing this stage. Do NOT move to next topics or stages.',
        'Do NOT discuss future steps, campaign planning, or other flows until this stage is complete.',
        '',
      ]),
      'CONCISE COMMUNICATION RULES (CRITICAL):',
      '- Maximum 2-3 sentences per response',
      '- No emojis unless user uses them first',
      '- Get to the point immediately - no unnecessary explanations',
      '- Professional but friendly tone',
      '- No repetitive phrases or filler words',
      `- If asking questions, ask at most ${maxQuestionsPerTurn} question(s) per message`,
    ];

    // Validation UX: if the user provided invalid values, we must NOT rely on the LLM to "do the right thing".
    // Emit a deterministic, user-facing prompt so the flow can't get stuck.
    // The invalid markers are persisted by the router when validation fails.
    try {
      const invalidRaw = (actualUserData as any).__invalid_fields;
      const invalidAt = Number((actualUserData as any).__invalid_fields_at || 0);
      const invalidIsRecent = Number.isFinite(invalidAt)
        ? (Date.now() - invalidAt) < 1000 * 60 * 10 // 10 minutes
        : false;
      const invalidSlugs = Array.isArray(invalidRaw)
        ? invalidRaw.map((x: any) => String(x || '').trim()).filter(Boolean)
        : [];
      const invalidInStage = invalidSlugs.filter((s) => stage.fieldsToCollect.includes(s));

      if (invalidIsRecent && invalidInStage.length > 0) {
        const hintsRaw = (actualUserData as any).__invalid_fields_hints;
        const hints: Record<string, string> = (hintsRaw && typeof hintsRaw === 'object' && !Array.isArray(hintsRaw))
          ? hintsRaw as Record<string, string>
          : {};
        const namesHe = [...new Set(invalidInStage.map((s) => (
          getFieldDisplayNameHe(s, (flowDefinition.fields as any)?.[s])
        )))];

        const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
        if (conversationLanguage === 'hebrew') {
          // Deterministic response: "X isn't valid, please re-enter"
          if (invalidInStage.length === 1) {
            const slug = invalidInStage[0];
            const label = namesHe[0] || 'הערך';
            const suggestion = String(hints[slug] || '').trim();
            if (suggestion) {
              yield `${label} נראה לא תקין — התכוונת ל־${suggestion}? אם כן, אפשר לכתוב אותו שוב בדיוק כך: ${suggestion}`;
              return;
            }
            yield `${label} שהזנת אינו תקין — אפשר להזין שוב?`;
            return;
          }
          yield `${namesHe.join(', ')} שהזנת אינם תקינים — אפשר להזין שוב?`;
          return;
        }
        if (conversationLanguage === 'english') {
          if (invalidInStage.length === 1) {
            yield `That value for "${invalidInStage[0]}" is not valid — please enter it again.`;
            return;
          }
          yield `Some values are not valid (${invalidInStage.join(', ')}) — please enter them again.`;
          return;
        }

        // Fall back to prompt injection only if language couldn't be detected.
        if (conversationLanguage === 'hebrew') {
          systemPrompt.push(
            '',
            `CRITICAL: המשתמש הזין ערך לא תקין עבור ${namesHe.join(', ')}.`,
            'אתה חובה לומר במפורש שהערך אינו תקין, ולבקש להזין אותו מחדש.',
            'שאל עכשיו רק על השדות הלא-תקינים. אל תשאל שדות אחרים עד שיתקבל ערך תקין.',
            'דוגמה: "הדוא״ל שהזנת אינו תקין — אפשר לכתוב אותו שוב?"',
          );
        } else {
          systemPrompt.push(
            '',
            `CRITICAL: The user provided an invalid value for: ${invalidInStage.join(', ')}.`,
            'You MUST explicitly say it is invalid and ask the user to re-enter it.',
            'Ask ONLY for the invalid field(s) now. Do not ask other fields until valid values are provided.',
          );
        }
      }
    } catch {
      // best-effort
    }

    // UX guardrail: address user by first name (never by profession/segment).
    // We observed the agent sometimes replying "מעולה, <business_segment>" which is explicitly undesired.
    try {
      const ud = actualUserData || {};
      const pickNonEmpty = (...vals: unknown[]) => vals.find((v) => v !== null && v !== undefined && String(v).trim() !== '');
      const firstNameRaw = pickNonEmpty((ud as any).user_first_name, (ud as any).first_name, (ud as any).proposer_first_name);
      const firstName = String(firstNameRaw || '').trim();
      const seg = String((ud as any).business_segment || '').trim();
      const badFirst = new Set(['הי', 'היי', 'שלום', 'אהלן', 'הלו', 'לקוח', 'חדש', 'קיים', 'ותיק']);
      if (firstName && !badFirst.has(firstName)) {
        const segHint = seg ? ` (profession/segment="${seg}")` : '';
        systemPrompt.push(
          '',
          `CRITICAL UX RULE: When addressing the user, use their first name ("${firstName}") and NEVER address them by their profession/segment${segHint}.`,
          'Hebrew example: "מעולה, ליאב. ומה התפקיד שלך בעסק?"',
          'Bad example: "מעולה, רואה חשבון. ומה התפקיד שלך בעסק?"',
        );
      }
    } catch {
      // best-effort
    }

    // Segment-aware phrasing (generic + targeted enrichments).
    // This is intentionally flow-agnostic: it only uses existing userData hints to improve wording.
    try {
      const ud = actualUserData || {};
      const seg = String((ud as any).segment_name_he || (ud as any).business_segment || '').trim();
      const occ = String((ud as any).business_occupation || (ud as any).business_used_for || (ud as any).business_activity_and_products || '').trim();
      const siteType = String((ud as any).business_site_type || '').trim();
      const hasSegmentHints = Boolean(seg || occ || siteType);
      if (hasSegmentHints) {
        systemPrompt.push(
          '',
          'SEGMENT PERSONALIZATION (CRITICAL): If you have a known segment / occupation / site type from userData (e.g., segment_name_he, business_segment, business_occupation, business_site_type) you MUST adapt question phrasing to that domain.',
          '- Use the user\'s professional terminology and keep the same temperament and formality level.',
          '- Replace generic terms like "business / בית העסק / העסק" with the correct domain noun (office/clinic/studio/store/etc.) whenever it makes the question more natural.',
          '- When asking address/location fields, refer to the physical location of that domain noun (e.g., the office location).',
        );
      }

      const lawyerHay = `${seg} | ${occ} | ${siteType}`;
      const isLawyer = /עורכ/.test(lawyerHay) && /דין/.test(lawyerHay);
      if (isLawyer) {
        systemPrompt.push(
          '',
          'LAWYER SEGMENT (CRITICAL HEBREW PHRASING): The user is a lawyer / law firm.',
          'In Hebrew, you MUST use: "משרד עורכי הדין" / "המשרד" instead of "העסק/בית העסק". Refer to the physical location as the office location.',
          'Field-specific phrasing rules (MUST):',
          '- If asking for business_name (name of the business): ask as the name of the law firm office, e.g. "מה שם משרד עורכי הדין שלך?" / "נא לציין את שם משרד עורכי הדין."',
          '- If asking for insured_relation_to_business (your role): ask as the role in the law firm office, e.g. "ומה התפקיד שלך במשרד עורכי הדין שלך?"',
          '- If asking for address fields (city/street/house number/zip): refer to the office address, e.g. "באיזה יישוב נמצא משרד עורכי הדין?"',
        );
      }

      // Other common segments (generic rules + examples). Keep these as *phrasing instructions* only.
      // IMPORTANT: Do not address the user by their profession; only adapt the nouns inside questions.
      const hay = `${seg} | ${occ} | ${siteType}`;
      const isAccountant = /(רוא[\"״׳']?ח|רואה\s*חשבון|חשבונ|הנה[\"״׳']?ח|הנהלת\s*חשבונות|משרד\s*רו[\"״׳']?ח)/.test(hay);
      const isInsuranceAgency = /(סוכן\s*ביטוח|סוכנות\s*ביטוח|סוכני\s*ביטוח|משרד\s*ביטוח)/.test(hay);
      const isRealEstateBrokerage = /(תיווך|משרד\s*תיווך|מתווך|מתווכ|נדל[\"״׳']?ן|נדלן)/.test(hay);
      const isArchitectureEngineering = /(אדריכ|אדריכלות|משרד\s*אדריכל|מהנדס|מהנדסת|הנדסה|קונסטרוקטור|תכנון\s*מבנים)/.test(hay);
      const isClinic = /(קליניק|מרפא|פיזיותרפ|ריפוי\s*בעיסוק|דיאטנ|פסיכולוג|טיפול|שינ|רופא|רפוא|וטרינר|קוסמטיק)/.test(hay);
      const isStudio = /(סטודיו|פילאטיס|יוגה|חדר\s*כושר|אימון|מאמנ|צילום|עיצוב|גרפיקה|Dance|ריקוד)/i.test(hay);
      const isStore = /(חנות|בוטיק|קמעונא|שופ|מכולת|מרכול)/.test(hay);
      const isFoodBiz = /(מסעד|בית\s*קפה|קפה|בר\b|פאב|קייטרינג|מזון)/.test(hay);
      const isWorkshop = /(בית\s*מלאכה|נגרי|מסגרי|מוסך|סדנ|ייצור|מפעל)/.test(hay);
      const isWarehouse = /(מחסן|לוגיסט|מרלו[\"״׳']?ג|מרכז\s*לוגיסטי)/.test(hay);
      const isOnlineOnlyHint = /(אונליין|דיגיטל|ללא\s*מקום\s*פיזי|מהבית|עבודה\s*מהבית|remote|online)/i.test(hay);

      if (isAccountant) {
        systemPrompt.push(
          '',
          'SEGMENT: ACCOUNTANT (Hebrew phrasing examples): prefer "משרד רו״ח" / "המשרד" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם משרד רו״ח שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במשרד רו״ח?"',
          '- Address: "באיזה יישוב נמצא המשרד?"',
        );
      }
      if (isInsuranceAgency) {
        systemPrompt.push(
          '',
          'SEGMENT: INSURANCE AGENCY (Hebrew phrasing examples): prefer "סוכנות הביטוח" / "המשרד" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם סוכנות הביטוח שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך בסוכנות הביטוח?"',
          '- Address: "באיזה יישוב נמצא המשרד?"',
        );
      }
      if (isRealEstateBrokerage) {
        systemPrompt.push(
          '',
          'SEGMENT: REAL ESTATE BROKERAGE (Hebrew phrasing examples): prefer "משרד התיווך" / "המשרד" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם משרד התיווך שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במשרד התיווך?"',
          '- Address: "באיזה יישוב נמצא משרד התיווך?"',
        );
      }
      if (isArchitectureEngineering) {
        systemPrompt.push(
          '',
          'SEGMENT: ARCHITECTURE/ENGINEERING (Hebrew phrasing examples): prefer "משרד האדריכלים/המהנדסים" / "המשרד" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם משרד האדריכלים/המהנדסים שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במשרד?" (או "במשרד האדריכלים/המהנדסים")',
          '- Address: "באיזה יישוב נמצא המשרד?"',
        );
      }
      if (isClinic) {
        systemPrompt.push(
          '',
          'SEGMENT: CLINIC (Hebrew phrasing examples): prefer "הקליניקה" / "המרפאה" (whichever fits user wording) instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם הקליניקה שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך בקליניקה?"',
          '- Address: "באיזה יישוב נמצאת הקליניקה?"',
        );
      }
      if (isStudio) {
        systemPrompt.push(
          '',
          'SEGMENT: STUDIO (Hebrew phrasing examples): prefer "הסטודיו" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם הסטודיו שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך בסטודיו?"',
          '- Address: "באיזה יישוב נמצא הסטודיו?"',
        );
      }
      if (isStore) {
        systemPrompt.push(
          '',
          'SEGMENT: STORE/RETAIL (Hebrew phrasing examples): prefer "החנות" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם החנות שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך בחנות?"',
          '- Address: "באיזה יישוב נמצאת החנות?"',
        );
      }
      if (isFoodBiz) {
        systemPrompt.push(
          '',
          'SEGMENT: RESTAURANT/CAFE (Hebrew phrasing examples): prefer "המסעדה/בית הקפה" (mirror user wording) instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם המסעדה/בית הקפה שלך?"',
          '- "ומה התפקיד שלך בעסק?" → "ומה התפקיד שלך במסעדה/בבית הקפה?"',
          '- Address: "באיזה יישוב נמצאת המסעדה/בית הקפה?"',
        );
      }
      if (isWarehouse) {
        systemPrompt.push(
          '',
          'SEGMENT: WAREHOUSE/LOGISTICS (Hebrew phrasing examples): prefer "המחסן/המרלוג" instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם המחסן/המרלוג?" (or keep "שם החברה" if it\'s a company entity)',
          '- Address: "באיזה יישוב נמצא המחסן/המרלוג?"',
        );
      }
      if (isWorkshop) {
        systemPrompt.push(
          '',
          'SEGMENT: WORKSHOP/PRODUCTION (Hebrew phrasing examples): prefer "בית המלאכה/הסדנה/המפעל" (mirror user wording) instead of "העסק/בית העסק".',
          'Examples:',
          '- "מה שם העסק?" → "מה שם בית המלאכה/הסדנה שלך?"',
          '- Address: "באיזה יישוב נמצא בית המלאכה/הסדנה?"',
        );
      }
      if (isOnlineOnlyHint) {
        systemPrompt.push(
          '',
          'ONLINE BUSINESS PHRASE (Hebrew): If the user indicates the activity is online / no physical location, phrase location/address questions as "כתובת להתכתבות/כתובת עסקית" rather than "מיקום העסק".',
          'Example:',
          '- "נא לציין יישוב." → "לאיזו כתובת להתכתבות/כתובת עסקית נרשום את הפרטים? באיזה יישוב?"',
        );
      }
    } catch {
      // best-effort
    }

    // Add recovery instructions if needed
    if (needsRecovery) {
      const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
      const missingFields = flowHelpers.extractStageFields(flowDefinition, options.stage)
        .filter(([fieldSlug]) => !options.collectedFields.includes(fieldSlug));
      const missingFieldNames = missingFields.map(([slug, field]) => {
        const desc = field.description;
        const match = desc.match(/^([^.:]+)/);
        return match ? match[1].trim() : slug;
      });

      if (conversationLanguage === 'hebrew') {
        systemPrompt.push(
          '',
          'RECOVERY: בואו נחזור לנושא. המשתמש צריך לספק מידע חסר.',
          `השלב הנוכחי: ${stage.name}`,
          `מידע שחסר: ${missingFieldNames.join(', ')}`,
          '',
          'הוראות:',
          '1. אל תאשים את המשתמש או תגיד "יצאנו מהמסלול"',
          '2. פשוט תאמר: "בואו נמשיך. אני צריך עדיין לדעת [שדה אחד או שניים]."',
          '3. בחר את השדה החשוב ביותר ושאל עליו בלבד',
          '4. היה קצר, מנומס, וחיובי',
          '',
          'דוגמה טובה: "בואו נמשיך. אני צריך לדעת [שדה אחד]. תוכל לספק את זה?"',
          'דוגמה רעה: "נראה שהשיחה יצאה מהמסלול" או "אנחנו באמצע תהליך הרשמה"',
        );
      } else {
        systemPrompt.push(
          '',
          'RECOVERY: Let\'s get back on track. The user needs to provide missing information.',
          `Current stage: ${stage.name}`,
          `Missing information: ${missingFieldNames.join(', ')}`,
          '',
          'Instructions:',
          '1. Do NOT blame the user or say "we\'ve gotten off track"',
          '2. Simply say: "Let\'s continue. I still need to know [one or two fields]."',
          '3. Choose the most important field and ask about it only',
          '4. Be brief, polite, and positive',
          '',
          'Good example: "Let\'s continue. I need to know [one field]. Can you provide that?"',
          'Bad example: "We\'ve gotten off track" or "We\'re in the middle of onboarding"',
        );
      }
    }

    // If organization data is available, add it to the prompt as a knowledge base
    // BUT: For kycEntitySelection, do NOT inject organization data - it should only ask the simple question
    if (mergedTemplateContext.organizationData && options.stage !== 'kycEntitySelection') {
      systemPrompt.push(
        '',
        'ORGANIZATION DATA (Available Knowledge Base - DO NOT ask for this information):',
        JSON.stringify(mergedTemplateContext.organizationData, null, 2),
        '',
        'This organization data is already available. Use it to show knowledge and personalize the conversation, but DO NOT ask for any information that is already in this data (like address, phone, email, organization name, etc.).',
        'CRITICAL: For verification messages (verifyPhoneOrEmail stage), NEVER use organization email or phone. ALWAYS use userData email/phone from template variables {email} or {phone}.',
      );
    }

    // Add error context if there was an error - this helps the user fix the issue
    if (options.errorContext) {
      systemPrompt.push(
        '',
        'INTERNAL DIAGNOSTIC CONTEXT (DO NOT SHOW USER): A tool/action failed in the previous attempt.',
        `Error details: ${options.errorContext}`,
        '',
        'CRITICAL INSTRUCTIONS:',
        '- Do NOT quote or reveal internal tool errors, stack traces, endpoints, or error codes to the user.',
        '- Use this info ONLY to decide what to ask next and how to remediate.',
        '- Prefer remediation by collecting plain missing/invalid fields and trying again.',
        '- If you suspect a previously saved field caused the error, ask the user to confirm/correct it and overwrite that field.',
        '- After collecting corrections, proceed with the flow (tools will be re-run by the system when appropriate).',
      );
    }

    // Add "last tool error" context stored in userData (from tool execution).
    // This is independent of options.errorContext and helps remediation even after stage transitions.
    const lastTool = actualUserData.__last_action_error_tool as string | undefined;
    const lastStage = actualUserData.__last_action_error_stage as string | undefined;
    const lastMsg = actualUserData.__last_action_error_message as string | undefined;
    const lastCode = actualUserData.__last_action_error_code as string | undefined;
    const lastAt = Number(actualUserData.__last_action_error_at || 0);
    const lastIsRecent = Number.isFinite(lastAt) ? (Date.now() - lastAt) < 1000 * 60 * 30 : false; // 30 minutes
    if (lastIsRecent && (lastTool || lastMsg)) {
      systemPrompt.push(
        '',
        'INTERNAL: Last tool failure context (DO NOT SHOW USER).',
        `tool=${lastTool || ''} stage=${lastStage || ''} code=${lastCode || ''}`,
        `message=${lastMsg || ''}`,
        '',
        'Use this to adjust your next question(s) and to correct data. Never mention IDs/endpoints/errors directly to the user.',
      );
    }

    // Check if campaign_start_date was provided but not saved or saved as RAW_DATE (parsing failure)
    // This applies to any stage that collects campaign_start_date
    const campaignDateValue = actualUserData.campaign_start_date as string | undefined;
    const hasRawDateValue = campaignDateValue && typeof campaignDateValue === 'string' && campaignDateValue.startsWith('RAW_DATE:');
    // Check if RAW_DATE includes holiday flag (format: RAW_DATE:original:HOLIDAY:holidayName)
    const hasHolidayFlag = hasRawDateValue && campaignDateValue.includes(':HOLIDAY:');

    if (stage.fieldsToCollect.includes('campaign_start_date') &&
      (!options.collectedFields.includes('campaign_start_date') || hasRawDateValue)) {
      // Check recent user messages for date mentions
      const recentMessages = await prisma.message.findMany({
        where: { conversationId: options.conversationId, role: 'user' },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { content: true },
      });

      const hasDateMention = recentMessages.some((msg) => {
        const content = msg.content.toLowerCase();
        // Check for absolute dates, relative dates, Hebrew dates, and time references
        // Be specific to avoid false positives - look for date patterns, not just words
        return /תאריך|date|תשרי|חשוון|כסלו|טבת|שבט|אדר|ניסן|אייר|סיוון|תמוז|אב|אלול|אוקטובר|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|נובמבר|דצמבר|בעוד\s+(שבוע|שבועיים|חודש|חודשים|ימים)|בשבוע|בחודש|לאחר|אחרי|לפני|מיום|in\s+(two\s+)?weeks?|in\s+\d+\s+(weeks?|days?|months?)|next\s+week|next\s+month|after|tomorrow|yesterday/.test(content);
      });

      if (hasDateMention) {
        // Get the exact date mentioned by the user from recent messages
        const dateMentioned = recentMessages.find((msg) => {
          const { content } = msg;
          const contentLower = content.toLowerCase();
          // Check for absolute dates, relative dates, Hebrew dates, and time references
          // Be specific to avoid false positives
          return /תאריך|date|תשרי|חשוון|כסלו|טבת|שבט|אדר|ניסן|אייר|סיוון|תמוז|אב|אלול|אוקטובר|ינואר|פברואר|מרץ|אפריל|מאי|יוני|יולי|אוגוסט|ספטמבר|נובמבר|דצמבר|בעוד\s+(שבוע|שבועיים|חודש|חודשים|ימים)|בשבוע|בחודש|לאחר|אחרי|לפני|מיום|in\s+(two\s+)?weeks?|in\s+\d+\s+(weeks?|days?|months?)|next\s+week|next\s+month|after|tomorrow|yesterday/.test(contentLower);
        });

        const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
        const mentionedDateText = dateMentioned?.content || 'תאריך';

        // Extract raw date if it was stored with RAW_DATE: prefix
        // Handle format: RAW_DATE:original or RAW_DATE:original:HOLIDAY:holidayName
        let rawDateText = mentionedDateText;
        let holidayName: string | undefined;
        if (hasRawDateValue && campaignDateValue) {
          if (hasHolidayFlag) {
            // Format: RAW_DATE:original:HOLIDAY:holidayName
            const parts = campaignDateValue.split(':HOLIDAY:');
            rawDateText = parts[0].replace('RAW_DATE:', '');
            holidayName = parts[1];
          } else {
            // Format: RAW_DATE:original
            rawDateText = campaignDateValue.replace('RAW_DATE:', '');
          }
        }

        if (conversationLanguage === 'hebrew') {
          if (hasRawDateValue) {
            if (hasHolidayFlag && holidayName) {
              // Date falls on Shabbat/holiday
              systemPrompt.push(
                '',
                `CRITICAL: המשתמש הזכיר תאריך ("${rawDateText}"), אבל התאריך נופל על ${holidayName}.`,
                '',
                'אתה חובה:',
                '1. אזהר את המשתמש שהתאריך נופל על שבת/חג',
                '2. שאל אם הוא בטוח שהוא רוצה להתחיל קמפיין בתאריך זה',
                '3. אם המשתמש מאשר, שמור את התאריך בפורמט ISO 8601 (YYYY-MM-DD)',
                '4. אם המשתמש לא מאשר, בקש תאריך חלופי',
                '5. אל תמשיך ללא תאריך תקין - זה שדה חובה',
                '',
                `דוגמה: "התאריך שציינת (${rawDateText}) נופל על ${holidayName}. האם אתה בטוח שאתה רוצה להתחיל את הקמפיין בתאריך זה?"`,
              );
            } else {
              // Date parsing failed - ask for Gregorian date or let LLM guess
              systemPrompt.push(
                '',
                `CRITICAL: המשתמש הזכיר תאריך ("${rawDateText}"), אבל המערכת לא הצליחה לפרס אותו לתאריך לועזי (Gregorian).`,
                '',
                'אתה חובה:',
                '1. נסה לנחש תאריך סביר בהתבסס על מה שהמשתמש אמר - השתמש בלוח השנה הלועזי (Gregorian)',
                '2. אם אתה לא בטוח, שאל את המשתמש: "נסה להזכיר את התאריך בתאריך לועזי (למשל: 15 במרץ 2026, או 2026-03-15)"',
                '3. אחרי שהתאריך נחש או התקבל, שמור אותו בפורמט ISO 8601 (YYYY-MM-DD)',
                '4. אל תמשיך ללא תאריך תקין - זה שדה חובה',
                '',
                'דוגמה אם נוחת תאריך: "אני מבין שהתאריך שציינת הוא בערך [תאריך לועזי שנוחש]. זה נכון?"',
                'דוגמה אם שואלים: "לא הצלחתי לפרס את התאריך. תוכל להזכיר אותו בתאריך לועזי? למשל: 15 במרץ 2026"',
              );
            }
          } else {
            // Date not saved for other reasons (Shabbat/holiday or missing)
            systemPrompt.push(
              '',
              `CRITICAL: המשתמש כבר הזכיר תאריך (כנראה "${mentionedDateText}"), אבל התאריך לא נשמר במערכת.`,
              'זה יכול להיות כי:',
              '1. התאריך נופל על שבת או חג',
              '2. הפריס של התאריך נכשל (תאריכים יחסיים כמו "בעוד שבועיים" צריכים להיות מתורגמים לתאריך מדויק)',
              '',
              'אתה חובה:',
              '1. לשאול את המשתמש שוב על התאריך',
              '2. אם התאריך שהוזכר הוא תאריך יחסי (כמו "בעוד שבועיים"), בקש תאריך יותר מדויק או אישר את התאריך',
              '3. אם זה תאריך אבסולוטי שנופל על שבת/חג, אזהר את המשתמש ושאל אם הוא בטוח',
              '4. אם יש בעיה בפריס, בקש תאריך לועזי (Gregorian)',
              '5. אל תמשיך ללא תאריך - התאריך הוא שדה חובה',
              '',
              'דוגמה: "נזכרת שהזכרת תאריך אבל הוא לא נשמר. תוכל להזכיר אותו בתאריך לועזי? למשל: 15 במרץ 2026"',
            );
          }
        } else {
          const mentionedDateTextEn = dateMentioned?.content || 'a date';

          // Extract raw date if it was stored with RAW_DATE: prefix
          // Handle format: RAW_DATE:original or RAW_DATE:original:HOLIDAY:holidayName
          let rawDateTextEn = mentionedDateTextEn;
          let holidayNameEn: string | undefined;
          if (hasRawDateValue && campaignDateValue) {
            if (hasHolidayFlag) {
              // Format: RAW_DATE:original:HOLIDAY:holidayName
              const parts = campaignDateValue.split(':HOLIDAY:');
              rawDateTextEn = parts[0].replace('RAW_DATE:', '');
              holidayNameEn = parts[1];
            } else {
              // Format: RAW_DATE:original
              rawDateTextEn = campaignDateValue.replace('RAW_DATE:', '');
            }
          }

          if (hasRawDateValue) {
            if (hasHolidayFlag && holidayNameEn) {
              // Date falls on Shabbat/holiday
              systemPrompt.push(
                '',
                `CRITICAL: The user mentioned a date ("${rawDateTextEn}"), but this date falls on ${holidayNameEn}.`,
                '',
                'You MUST:',
                '1. Warn the user that the date falls on Shabbat/holiday',
                '2. Ask if they are sure they want to start the campaign on this date',
                '3. If the user confirms, save the date in ISO 8601 format (YYYY-MM-DD)',
                '4. If the user does not confirm, ask for an alternative date',
                '5. Do NOT proceed without a valid date - it is required',
                '',
                `Example: "The date you mentioned (${rawDateTextEn}) falls on ${holidayNameEn}. Are you sure you want to start the campaign on this date?"`,
              );
            } else {
              // Date parsing failed - ask for Gregorian date or let LLM guess
              systemPrompt.push(
                '',
                `CRITICAL: The user mentioned a date ("${rawDateTextEn}"), but the system failed to parse it to a Gregorian date.`,
                '',
                'You MUST:',
                '1. Try to guess a reasonable date based on what the user said - use Gregorian calendar',
                '2. If you\'re not sure, ask the user: "Could you provide the date in Gregorian format? (e.g., March 15, 2026, or 2026-03-15)"',
                '3. After the date is guessed or received, save it in ISO 8601 format (YYYY-MM-DD)',
                '4. Do NOT proceed without a valid date - it is required',
                '',
                'Example if guessing: "I understand the date you mentioned is approximately [guessed Gregorian date]. Is that correct?"',
                'Example if asking: "I couldn\'t parse the date. Could you provide it in Gregorian format? For example: March 15, 2026"',
              );
            }
          } else {
            // Date not saved for other reasons (Shabbat/holiday or missing)
            systemPrompt.push(
              '',
              `CRITICAL: The user already mentioned a date (likely "${mentionedDateTextEn}"), but the date was not saved.`,
              'This could be because:',
              '1. The date falls on Shabbat or a holiday',
              '2. Date parsing failed (relative dates like "in two weeks" need to be converted to exact dates)',
              '',
              'You MUST:',
              '1. Ask the user about the date again',
              '2. If it\'s a relative date (like "in two weeks"), ask for a more specific date or confirm the calculated date',
              '3. If it\'s an absolute date that falls on Shabbat/holiday, warn the user and ask if they\'re sure',
              '4. If there\'s a parsing issue, ask for a Gregorian date',
              '5. Do NOT proceed without a date - date is a required field',
              '',
              'Example: "I remember you mentioned a date but it wasn\'t saved. Could you provide it in Gregorian format? For example: March 15, 2026"',
            );
          }
        }
      }
    }

    if (languageInstruction) {
      systemPrompt.push(languageInstruction);
    }

    if (options.collectedFields.length > 0) {
      systemPrompt.push(
        `IMPORTANT: The following fields have already been collected from the user: ${options.collectedFields.join(', ')}.`,
        'Do NOT re-ask for them from scratch.',
        'If you need to validate a value (because it might be wrong/outdated), ask a quick confirmation question like: "Just to confirm — is X your <field>?"',
      );
    }

    // CRITICAL (Topic-split / question-bank stages):
    // When the stage suppresses the core missing-fields section, the model often lacks a deterministic view
    // of what is already stored in userData, which can cause re-asking loops (especially for yes/no coverages).
    // Provide a compact snapshot of current stage field values so the model can reliably skip already-answered fields.
    try {
      const suppress = stage.orchestration?.questionPolicy?.suppressCoreMissingFieldsSection === true;
      const ud = actualUserData || {};
      if (suppress && ud && typeof ud === 'object') {
        const stageKeys = new Set<string>(Array.isArray(stage.fieldsToCollect) ? stage.fieldsToCollect : []);
        // Include a small set of extra orchestration keys commonly used by topic-split flows.
        for (const k of [
          'segment_id',
          'segment_name_he',
          'segment_coverages_prefilled_v1',
          'business_segment',
          'business_site_type',
          'has_physical_premises',
          'has_employees',
          'has_products_activity',
          'business_interruption_type',
          'policy_start_date',
          'business_legal_entity_type',
        ]) stageKeys.add(k);

        const snapshot: Record<string, string | number | boolean> = {};
        for (const [k, v] of Object.entries(ud)) {
          if (!stageKeys.has(k)) continue;
          if (typeof v === 'string') {
            const s = v.trim();
            if (!s) continue;
            snapshot[k] = s.length > 260 ? `${s.slice(0, 260)}…` : s;
          } else if (typeof v === 'number' || typeof v === 'boolean') {
            snapshot[k] = v;
          }
        }

        if (Object.keys(snapshot).length > 0) {
          systemPrompt.push(
            '',
            'CURRENT USER DATA SNAPSHOT (for skipping already-answered fields):',
            JSON.stringify(snapshot, null, 2),
            '',
            'CRITICAL: When selecting the next question, treat any key present in the snapshot as already answered and do NOT ask it again.',
          );
        }
      }
    } catch {
      // best-effort
    }

    // CRITICAL: Campaign date handling - no follow-up questions
    if (stage.fieldsToCollect.includes('campaign_start_date')) {
      systemPrompt.push(
        '',
        'CRITICAL CAMPAIGN DATE RULE:',
        '- If user provides a date (any format: Hebrew calendar, Gregorian, relative like "in 2 weeks"), accept it AS-IS',
        '- Do NOT ask follow-up questions like "exact date or range?" or "do you want it as a week?"',
        '- The date is INDICATIVE only - system will convert to exact date automatically',
        '- Only ask about the date if it was NOT provided yet',
        '- Example: User says "כ״ח בניסן" → Accept it immediately, do NOT ask if they want it exact or as a range',
      );
    }

    // Add instruction to be positive and helpful, never negative
    systemPrompt.push('CRITICAL: Be positive and helpful. NEVER tell the user they are providing "irrelevant information" or that their question is "wrong". Instead, gently guide them to the current task with helpful, positive language. Focus on what they need to do next, not on what they did wrong.');

    // Apply systemPromptHooks before stage prompt
    if (stage.orchestration?.systemPromptHooks?.beforePrompt) {
      const kseval = (await import('kseval')).default;
      for (const hook of stage.orchestration.systemPromptHooks.beforePrompt) {
        const shouldInject = !hook.condition ||
          (kseval.native?.evaluate(hook.condition, {
            userData: actualUserData,
            templateContext: mergedTemplateContext,
            stage: options.stage,
          }) ?? true);

        if (shouldInject) {
          // Replace template variables in prompt lines
          const processedLines = hook.promptLines.map((line) =>
            this.replaceTemplateVariables(line, mergedTemplateContext),
          );
          systemPrompt.push(...processedLines);
        }
      }
    }

    // IMPORTANT: Inject the stage prompt LAST (after generic missing-field guidance),
    // so the stage's own instructions and exact copy remain the final, most salient instruction.
    let stagePromptToInject = stage.prompt
      ? this.replaceTemplateVariables(stage.prompt, mergedTemplateContext)
      : '';

    // Topic-split hardening:
    // When suppressing the deterministic "missing fields" section, the stage prompt includes a compiled question list.
    // Empirically, the model may still ask questions whose keys are already present in userData (esp. booleans=false),
    // or ask questions whose ask_if condition is false. Filter them out *deterministically* here so they cannot be asked.
    try {
      const suppress = stage.orchestration?.questionPolicy?.suppressCoreMissingFieldsSection === true;
      const ud = actualUserData || {};
      if (suppress && stagePromptToInject && ud && typeof ud === 'object') {
        const lines = stagePromptToInject.split('\n');
        const filtered: string[] = [];

        for (const line of lines) {
          // Only attempt to filter compiled question lines of the form:
          // - qid=... | key=some_field | ... | ask_if=... | ...
          const keyMatch = line.match(/\bkey=([A-Za-z_][A-Za-z0-9_]*)\b/);
          if (!keyMatch) {
            filtered.push(line);
            continue;
          }

          const key = keyMatch[1];
          const v = (ud as any)[key];

          // If the key is present (including boolean=false), do not show this question at all.
          if (isPresentNonPlaceholder(v)) {
            continue;
          }

          // If an ask_if is present on the line, evaluate and suppress the question if false.
          const askIfMatch = line.match(/\bask_if=([^|]+)(?:\s+\|\s+|$)/);
          if (askIfMatch) {
            const expr = String(askIfMatch[1] || '').trim();
            if (expr) {
              const ok = evaluateCondition(expr, ud as Record<string, unknown>);
              if (!ok) continue;
            }
          }

          filtered.push(line);
        }

        stagePromptToInject = filtered.join('\n');
      }
    } catch {
      // best-effort
    }

    // Apply systemPromptHooks after stage prompt
    if (stage.orchestration?.systemPromptHooks?.afterPrompt) {
      const kseval = (await import('kseval')).default;
      for (const hook of stage.orchestration.systemPromptHooks.afterPrompt) {
        const shouldInject = !hook.condition ||
          (kseval.native?.evaluate(hook.condition, {
            userData: actualUserData,
            templateContext: mergedTemplateContext,
            stage: options.stage,
          }) ?? true);

        if (shouldInject) {
          // Replace template variables in prompt lines
          const processedLines = hook.promptLines.map((line) =>
            this.replaceTemplateVariables(line, mergedTemplateContext),
          );
          systemPrompt.push(...processedLines);
        }
      }
    }

    if (stage.fieldsToCollect.length > 0 && !suppressCoreMissingFieldsSection) {
      const fields = flowHelpers.extractStageFields(flowDefinition, options.stage);

      // When a stage defines a customCompletionCheck, treat its requiredFields as the "required" list
      // for prompting. This prevents the agent from repeatedly asking optional fields (e.g. "*_other")
      // that are present in fieldsToCollect but not required under current condition.
      let requiredFieldSlugs = stage.fieldsToCollect;
      const cc = stage.orchestration?.customCompletionCheck;
      if (cc?.requiredFields?.length) {
        try {
          const kseval = (await import('kseval')).default;
          const shouldUse = (cc.condition
            ? (kseval.native?.evaluate(cc.condition, {
              userData: actualUserData,
              templateContext: mergedTemplateContext,
              stage: options.stage,
            }) ?? false)
            : true);
          if (shouldUse) {
            requiredFieldSlugs = cc.requiredFields;
          }
        } catch {
          // Ignore completion-check evaluation errors and fall back to fieldsToCollect
        }
      }

      // If we recently detected invalid values for fields in this stage, prioritize re-collecting them.
      // This prevents the assistant from treating them as generic "missing" without stating they were invalid.
      try {
        const invalidRaw = (actualUserData as any).__invalid_fields;
        const invalidAt = Number((actualUserData as any).__invalid_fields_at || 0);
        const invalidIsRecent = Number.isFinite(invalidAt)
          ? (Date.now() - invalidAt) < 1000 * 60 * 10
          : false;
        const invalidSlugs = Array.isArray(invalidRaw)
          ? invalidRaw.map((x: any) => String(x || '').trim()).filter(Boolean)
          : [];
        const invalidInStage = invalidSlugs.filter((s) => requiredFieldSlugs.includes(s));
        if (invalidIsRecent && invalidInStage.length > 0) {
          requiredFieldSlugs = invalidInStage;
        }
      } catch {
        // best-effort
      }

      const missingFields = fields.filter(([fieldSlug]) => {
        if (!requiredFieldSlugs.includes(fieldSlug)) return false;
        const v = (actualUserData as any)[fieldSlug];
        if (!isPresentNonPlaceholder(v)) return true;
        const def = (flowDefinition.fields as any)?.[fieldSlug];
        return !validateFieldValue(fieldSlug, def, v).ok;
      });

      if (missingFields.length > 0) {
        const fieldsContext = missingFields.map((field) => `* ${field[1].description}`);
        systemPrompt.push(`You need to ask for the following fields:\n${fieldsContext.join('\n')}`);

        // CRITICAL: Smart bulk field collection - when 3+ fields missing, ask for ALL in single turn
        if (!disableBulkCollectionRule && missingFields.length >= 3) {
          const fieldNames = missingFields.map(([slug, field]) => {
            // Extract field name from description (first sentence or key phrase)
            const desc = field.description;
            const match = desc.match(/^([^.:]+)/);
            return match ? match[1].trim() : slug;
          });

          const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
          if (conversationLanguage === 'hebrew') {
            systemPrompt.push(
              `EFFICIENCY RULE (CRITICAL): יש לך ${missingFields.length} שדות חסרים (${fieldNames.join(', ')}).`,
              'אתה חובה לשאול על כולם בהודעה אחת, לא אחד אחד.',
              'צור שאלה טבעית ומשולבת שמבקשת את כל המידע החסר בבת אחת.',
              'דוגמה (קצר וישיר): "מעולה — מה [שדה 1], [שדה 2] ו-[שדה 3]?"',
              'חשוב: עבור מידע עובדתי (כמו אימייל, טלפון, כתובת), בקש את הנתונים ישירות - אל תבקש "לספר עליהם".',
            );
          } else {
            systemPrompt.push(
              `EFFICIENCY RULE (CRITICAL): You have ${missingFields.length} missing fields (${fieldNames.join(', ')}).`,
              'You MUST ask for ALL of them in a SINGLE message, not one by one.',
              'Create a natural, bundled question that requests all missing information at once.',
              'Example (short + direct): "Great — what are [field 1], [field 2], and [field 3]?"',
              'Important: For factual data (like email, phone, address), request the data directly - do not ask to "tell me about them".',
            );
          }
        } else {
          systemPrompt.push('You can ask for these fields one by one or together, whichever is more natural.');
        }
      } else {
        // CRITICAL: Double-check that ALL required fields are actually present before saying completion
        // This prevents premature "that's it" messages when fields aren't actually saved
        const allRequiredFieldsPresent = stage.fieldsToCollect.every((fieldSlug) => {
          const v = (actualUserData as any)[fieldSlug];
          if (!isPresentNonPlaceholder(v)) return false;
          const def = (flowDefinition.fields as any)?.[fieldSlug];
          return validateFieldValue(fieldSlug, def, v).ok;
        });

        if (allRequiredFieldsPresent) {
          // All fields are actually collected - proceed to next stage (signup)
          // CRITICAL: Do NOT ask for additional information, drafting text, or anything else
          const collectedList = stage.fieldsToCollect.map((slug) => `${slug}: ✓`).join(', ');
          systemPrompt.push(
            `CRITICAL: All required fields collected: ${collectedList}`,
            'The system will automatically proceed to the next step NOW.',
            'Do NOT ask:',
            '- "Is there anything else?" or "anything more?" or "anything important to know?"',
            '- "Would you like to draft campaign text?" or "Shall I help you with..."',
            '- Any additional questions or next steps',
            'Simply acknowledge briefly (1 sentence) and STOP. The system handles the transition automatically.',
            'Example (Hebrew): "מעולה — ממשיכים לשלב הבא."',
            'Example (English): "Great — moving to the next step."',
          );
        } else {
          // Some fields are missing - list them and ask for them
          const trulyMissingFields = stage.fieldsToCollect.filter((fieldSlug) => {
            const v = (actualUserData as any)[fieldSlug];
            if (!isPresentNonPlaceholder(v)) return true;
            const def = (flowDefinition.fields as any)?.[fieldSlug];
            return !validateFieldValue(fieldSlug, def, v).ok;
          });
          const fields = flowHelpers.extractStageFields(flowDefinition, options.stage);
          const missingFields = fields.filter(([slug]) => trulyMissingFields.includes(slug));

          if (missingFields.length > 0) {
            const missingFieldNames = missingFields.map(([slug, field]) => {
              const desc = field.description;
              const match = desc.match(/^([^.:]+)/);
              return match ? match[1].trim() : slug;
            });

            const conversationLanguage = await this.detectConversationLanguage(options.conversationId);
            const hasDateMissing = trulyMissingFields.includes('campaign_start_date');

            if (conversationLanguage === 'hebrew') {
              if (hasDateMissing) {
                const otherMissingFields = missingFieldNames.filter((name) => !name.toLowerCase().includes('date') && !name.toLowerCase().includes('תאריך'));
                const otherFieldsText = otherMissingFields.length > 0
                  ? ` אם יש שדות נוספים חסרים, שאל עליהם גם: ${otherMissingFields.join(', ')}.`
                  : '';

                systemPrompt.push(
                  'CRITICAL: התאריך לא נשמר במערכת - המטרה שלך היא לאסוף אותו.',
                  'אתה חובה לשאול על התאריך שוב. אם המשתמש נתן תאריך יחסי (כמו "בעוד שבועיים"), המערכת חייבת לחשב תאריך מדויק.',
                  'אם המערכת לא הצליחה לחשב את התאריך, בקש תאריך יותר מדויק מהמשתמש.',
                  otherFieldsText,
                  'אל תמשיך ללא תאריך - זה שדה חובה. אל תגיד "יש לנו את כל המידע" או "זה הכל" - התאריך חסר.',
                  'השאל שאלות עד שתקבל תאריך תקין ותשייג אותו לשדה campaign_start_date.',
                );
              } else {
                systemPrompt.push(
                  `CRITICAL: עדיין חסרים שדות: ${missingFieldNames.join(', ')}.`,
                  'אתה חובה לשאול עליהם לפני שתמשיך. אל תגיד "זה הכל" או "סיימנו" או "יש לנו את כל המידע" - עדיין חסרים שדות.',
                  'המשך לשאול על השדות החסרים עד שכולם נאספו.',
                );
              }
            } else {
              if (hasDateMissing) {
                const otherMissingFields = missingFieldNames.filter((name) => !name.toLowerCase().includes('date'));
                const otherFieldsText = otherMissingFields.length > 0
                  ? ` If there are other missing fields, ask about them too: ${otherMissingFields.join(', ')}.`
                  : '';

                systemPrompt.push(
                  'CRITICAL: The date was not saved - your goal is to collect it.',
                  'You MUST ask about the date again. If the user gave a relative date (like "in two weeks"), the system must calculate an exact date.',
                  'If the system failed to calculate the date, ask the user for a more specific date.',
                  otherFieldsText,
                  'Do NOT proceed without a date - it is required. Do NOT say "we have everything" or "that\'s it" - the date is missing.',
                  'Keep asking until you get a valid date and save it to the campaign_start_date field.',
                );
              } else {
                systemPrompt.push(
                  `CRITICAL: Missing fields: ${missingFieldNames.join(', ')}.`,
                  'You MUST ask for them before proceeding. Do NOT say "that\'s it" or "we\'re done" or "we have everything" - fields are still missing.',
                  'Continue asking for missing fields until all are collected.',
                );
              }
            }
          }
        }
      }
    }

    // Post-stage critical instructions:
    // We inject these AFTER the stage prompt only when we must deterministically recover from invalid user input.
    // This is rare by design (stage prompt should normally remain last and most salient).
    const postStageCriticalLines: string[] = [];
    try {
      const userText = String(options.message || '').trim();
      const digits = userText.replace(/\D/g, '');
      const askedForPhone = /נייד|טלפון|phone/i.test(lastAssistantMessageText);
      const askedForPolicyStartDate = /מאיזה\s*תאריך|תאריך\s*תחילת|שהביטוח\s*יתחיל|הביטוח\s*יתחיל|effective\s*date|start\s*date/i.test(lastAssistantMessageText);
      const stageNeedsMobilePhone = Array.isArray(stage.fieldsToCollect) && stage.fieldsToCollect.includes('mobile_phone');
      const stageNeedsPolicyStartDate = Array.isArray(stage.fieldsToCollect) && stage.fieldsToCollect.includes('policy_start_date');
      const hasMobilePhone = (
        'mobile_phone' in actualUserData &&
        actualUserData.mobile_phone !== undefined &&
        actualUserData.mobile_phone !== null &&
        String(actualUserData.mobile_phone).trim() !== ''
      );
      const hasPolicyStartDate = (
        'policy_start_date' in actualUserData &&
        actualUserData.policy_start_date !== undefined &&
        actualUserData.policy_start_date !== null &&
        /^\d{4}-\d{2}-\d{2}$/.test(String(actualUserData.policy_start_date).trim())
      );

      if (stageNeedsMobilePhone && askedForPhone && !hasMobilePhone && digits.length > 0) {
        const looksValidMobileCandidate = (() => {
          // Accept common IL mobile inputs: 05xxxxxxxx, +9725xxxxxxxx, 9725xxxxxxxx (after stripping non-digits)
          if (digits.length >= 11 && digits.startsWith('9725')) return true;
          if (digits.length === 10 && digits.startsWith('05')) return true;
          if (digits.length === 9 && digits.startsWith('5')) return true;
          // Generic E.164-like minimum (fallback)
          if (digits.length >= 9 && digits.length <= 15) return true;
          return false;
        })();

        if (!looksValidMobileCandidate) {
          postStageCriticalLines.push(
            '',
            'CRITICAL PHONE VALIDATION:',
            '- The user attempted to provide a mobile phone number, but it was NOT saved (likely invalid / too short).',
            '- You MUST tell the user the mobile number is not valid and ask them to enter it again.',
            '- Do NOT proceed to any other questions (like email) until mobile_phone is collected.',
            '- Examples of valid formats: 05XXXXXXXX, +9725XXXXXXXX, 9725XXXXXXXX.',
          );
        }
      }

      // Date validation (policy_start_date): if user attempted to provide a start date but it was not saved,
      // force a clear retry UX (even when the stage suppresses the core missing-fields section).
      if (stageNeedsPolicyStartDate && askedForPolicyStartDate && !hasPolicyStartDate) {
        const looksLikeDateAttempt = (() => {
          if (!userText) return false;
          if (digits.length >= 2) return true;
          // Common Hebrew relative date tokens + English fallbacks.
          if (/(היום|מחר|ממחר|מחרתיים|בעוד|בשבוע|בחודש|תחילת|אמצע|סוף)\b/i.test(userText)) return true;
          if (/\b(today|tomorrow|next\s+week|next\s+month|in\s+\d+\s+(days?|weeks?|months?))\b/i.test(userText)) return true;
          return false;
        })();

        if (looksLikeDateAttempt) {
          postStageCriticalLines.push(
            '',
            'CRITICAL POLICY START DATE VALIDATION:',
            '- The user attempted to provide a policy start date, but it was NOT saved (invalid / out of allowed range).',
            '- You MUST tell the user the date is not valid and ask them to enter it again.',
            '- Allowed range: from today up to 45 days from today.',
            '- Do NOT proceed to any other questions until policy_start_date is collected.',
            '- Accept formats: YYYY-MM-DD (e.g., 2026-02-12) or DD/MM/YYYY (e.g., 12/02/2026) or Hebrew relative (e.g., "ממחר", "תחילת השבוע הבא").',
          );
        }
      }
    } catch {
      // best-effort
    }

    if (stagePromptToInject) {
      systemPrompt.push(stagePromptToInject);
    }
    if (postStageCriticalLines.length) {
      systemPrompt.push(...postStageCriticalLines);
    }

    const resp = llmService.generateResponse({
      conversationId: options.conversationId,
      messageId: options.messageId,
      message: options.message,
      stream: options.stream,
      systemPrompt: systemPrompt.join('\n'),
      extraContext: extraContextString,
    });

    for await (const chunk of resp) {
      yield chunk;
    }
  }

  private async * describeAvailableFlows(message: Message, stream: boolean) {
    // Exclude flows marked as defaultForNewUsers from available flows list
    const allFlows = await prisma.flow.findMany({
      select: { name: true, description: true, definition: true },
    });
    const availableFlows = allFlows.filter((f) => {
      const definition = f.definition as FlowDefinition;
      return definition.config.defaultForNewUsers !== true;
    });

    // Include adaptive tone for user-facing flow description
    const systemPrompt = [
      ADAPTIVE_TONE_TEMPLATE,
      '',
      `Describe to user how can you help to the him. Available flows: ${JSON.stringify(availableFlows)}`,
    ].join('\n');

    const resp = llmService.generateResponse({
      conversationId: message.conversationId,
      messageId: message.id,
      message: message.content,
      stream: stream,
      systemPrompt,
    });

    for await (const chunk of resp) {
      yield chunk;
    }
  }

  private async detectConversationLanguage(conversationId: string): Promise<'hebrew' | 'english' | null> {
    const messages = await prisma.message.findMany({
      where: { conversationId, role: 'user' },
      orderBy: { createdAt: 'asc' },
      take: 5,
      select: { content: true },
    });

    if (messages.length === 0) return null;

    // Check if any user message contains Hebrew characters
    const hasHebrew = messages.some((msg) => /[\u0590-\u05FF]/.test(msg.content));
    return hasHebrew ? 'hebrew' : 'english';
  }

  /**
   * Checks if a stage is completed (all required fields are collected)
   */
  private isStageCompleted(stage: FlowStageDefinition, data: Record<string, unknown>): boolean {
    // Delegate to FlowRouter's completion logic so completionCondition/customCompletionCheck are respected consistently.
    return flowRouter.isStageCompleted(stage, data);
  }

  /**
   * Generates an error response that can be streamed to the user
   */
  private async * generateErrorResponse(errorMessage: string, stream: boolean): AsyncGenerator<string, void, unknown> {
    if (stream) {
      // Stream the error message character by character for consistency with normal responses
      for (const char of errorMessage) {
        yield char;
      }
    } else {
      yield errorMessage;
    }
  }

  /**
   * Replaces template variables in prompt strings (e.g., {orgName}, {orgGoal})
   */
  private replaceTemplateVariables(prompt: string, context: Record<string, string | number | boolean | GuidestarOrganisation | USAOrganisation | undefined>): string {
    let result = prompt;
    // Replace {variableName} with actual values from context
    for (const [key, value] of Object.entries(context)) {
      const regex = new RegExp(`\\{${key}\\}`, 'g');
      result = result.replace(regex, value !== null && value !== undefined ? String(value) : '');
    }
    return result;
  }

  /**
   * Gets template context (org data, etc.) for template variable replacement
   */
  private async getTemplateContext(conversationId: string, stage: FlowStageDefinition): Promise<Record<string, string | number | boolean | GuidestarOrganisation | USAOrganisation | undefined>> {
    const context: Record<string, string | number | boolean | GuidestarOrganisation | USAOrganisation | undefined> = {};

    // Always include user data (email, etc.) for template variables
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });

      if (conversation?.userId) {
        // Get flowId from UserFlow
        const userFlow = await prisma.userFlow.findUnique({
          where: { userId: conversation.userId },
        });

        if (userFlow?.flowId) {
          const userData = await flowHelpers.getUserData(conversation.userId, userFlow.flowId);

          // CRITICAL: Expose ALL primitive user data fields to template context
          // This ensures that dynamic fields like formatted_entity_list are available for substitution
          Object.entries(userData).forEach(([key, value]) => {
            if (value !== null && value !== undefined) {
              // Only expose primitives (string, number, boolean)
              if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
                context[key] = value;
              }
            }
          });
        }
      }
    } catch (error) {
      // Silently fail - user data is optional
    }

    // If stage specifies context injection, gather that data
    if (stage.context && stage.context.includes('organization')) {
      try {
        const conversation = await prisma.conversation.findUnique({
          where: { id: conversationId },
          include: { user: { include: { UserOrganisation: { include: { organisation: true } } } } },
        });
        if (conversation?.userId && conversation.user && conversation.user.UserOrganisation && conversation.user.UserOrganisation.length > 0) {
          const orgInfo = conversation.user.UserOrganisation[0]?.organisation;
          if (orgInfo?.data) {
            const orgData = orgInfo.data as GuidestarOrganisation | USAOrganisation;
            const orgRegion = orgInfo.region;

            // Store full organization data for knowledge base
            context.organizationData = orgData;

            // For Israeli orgs, use orgGoal (describes what the organization is doing)
            // For US orgs, use description/mission
            // Check region string or enum value
            const isIsrael = orgRegion === 'IL' || orgRegion === 'Israel' || orgRegion === 'israel';
            if (isIsrael) {
              const israelOrg = orgData as GuidestarOrganisation;
              context.orgName = israelOrg.name || israelOrg.fullName || '';
              context.orgGoal = israelOrg.orgGoal || '';
              context.orgArea = israelOrg.activityAreas?.join(', ') || israelOrg.primaryClassifications?.join(', ') || '';
            } else {
              const usaOrg = orgData as USAOrganisation;
              context.orgName = usaOrg.name || '';
              context.orgGoal = ''; // US orgs don't have orgGoal field
              context.orgArea = usaOrg.ntee_cd || '';
            }
          }
        }
      } catch (error) {
        // Silently fail - org data is optional
      }
    }

    return context;
  }
}

export const flowEngine = new FlowEngine();

export type ProcessMessageRes = {
  conversationId: string;
  finalText: string;
}
