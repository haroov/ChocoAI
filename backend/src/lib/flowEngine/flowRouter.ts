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
import { FlowDefinition, FlowStageDefinition } from './types';
import { llmService } from './llmService';
import { flowHelpers } from './flowHelpers';

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
    const cleanedCollectedData = Object.fromEntries(
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

    await flowHelpers.setUserData(userId, options.determinedFlow.flow.id, cleanedCollectedData, conversation.id);

    const currentStage = determinedFlow.stage;

    // CRITICAL: Reload userData after setUserData to ensure auto-populated fields (like PRIMARY_ORG entity fields) are included
    // Auto-population now saves directly to database synchronously, so fields should be available immediately
    // CRITICAL: Reload userData after setUserData to ensure auto-populated fields (like PRIMARY_ORG entity fields) are included
    // Auto-population now saves directly to database synchronously, so fields should be available immediately
    let userData = await flowHelpers.getUserData(userId, options.determinedFlow.flow.id);

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
      const isCompleted = this.isStageCompleted(stage, userData);

      if (!isCompleted) {
        // Handle custom logging on stage incomplete
        if (stage.orchestration?.onStageIncomplete) {
          const { logLevel = 'info', message, extraData = {} } = stage.orchestration.onStageIncomplete;
          const missingFields = stage.fieldsToCollect.filter((fieldSlug) =>
            !(fieldSlug in userData &&
              userData[fieldSlug] !== undefined &&
              userData[fieldSlug] !== null &&
              userData[fieldSlug] !== ''),
          );

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

  isStageCompleted(stage: FlowStageDefinition, data: Record<string, unknown>): boolean {
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
          const isPresentValue = (v: unknown): boolean => {
            if (v === undefined || v === null) return false;
            if (typeof v === 'string') {
              const s = v.trim();
              if (!s) return false;
              // Treat common LLM placeholders as missing values.
              // We've observed values like ":null" being extracted and persisted, which must NOT count as "present".
              const lowered = s.toLowerCase();
              if (lowered === 'null' || lowered === ':null' || lowered === 'undefined' || lowered === ':undefined') return false;
              return true;
            }
            if (Array.isArray(v)) return v.length > 0;
            // boolean false is a valid answer
            return true;
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

          if (customConditionResult) {
            // Mode A: requiredFields gate (legacy behavior)
            if (Array.isArray(requiredFields) && requiredFields.length > 0) {
              const allRequiredFieldsCollected = requiredFields.every((fieldSlug) =>
                isPresentValue((data as any)[fieldSlug]),
              );
              if (allRequiredFieldsCollected) {
                return true;
              }
            } else {
              // Mode B: condition-only completion (condition expression fully determines completion)
              return true;
            }
          }
        }
      } catch (error) {
        logger.error(`Error evaluating customCompletionCheck: ${condition}`, error);
      }
    }

    // Check that all required fields are collected
    const allFieldsCollected = stage.fieldsToCollect.every((fieldSlug) => {
      if (!(fieldSlug in data)) return false;
      const v = (data as any)[fieldSlug];
      if (v === undefined || v === null) return false;
      if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return false;
        const lowered = s.toLowerCase();
        if (lowered === 'null' || lowered === ':null' || lowered === 'undefined' || lowered === ':undefined') return false;
      }
      if (Array.isArray(v)) return v.length > 0;
      return true;
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
