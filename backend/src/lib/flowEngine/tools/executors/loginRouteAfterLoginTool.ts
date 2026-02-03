import { prisma } from '../../../../core/prisma';
import { logger } from '../../../../utils/logger';
import { flowHelpers } from '../../flowHelpers';
import { FlowDefinition } from '../../types';
import { ToolExecutor, ToolResult } from '../types';

/**
 * Login route after login tool - routes user to services if KYC completed, or to KYC if not
 */
export const loginRouteAfterLoginTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    // Get conversation to find userId
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { user: true },
    });

    if (!conversation || !conversation.userId) {
      return {
        success: false,
        error: 'Conversation or user not found',
      };
    }

    const { userId } = conversation;

    // Get current userFlow
    const currentUserFlow = await prisma.userFlow.findUnique({
      where: { userId },
    });

    if (!currentUserFlow) {
      return {
        success: false,
        error: 'No active flow found for user',
      };
    }

    // Get current flow's userData
    const currentUserData = await flowHelpers.getUserData(userId, currentUserFlow.flowId);

    // Determine target flow
    // 1. Check if there is a pending gateway action (Async update from Meshulam/Grow)
    let targetFlowSlug = 'kyc';
    if (currentUserData.pending_gateway_action === 'meshulam_update') {
      targetFlowSlug = 'gateway-update';
      logger.info(`[loginRouteAfterLoginTool] Redirecting user ${userId} to gateway-update flow due to pending action`);
    } else {
      // 2. Default logic
      // C1: Post-login routing uses ACTIVE gateway only (do not gate on verified).
      // checkAccountContextTool sets workspace_has_active_gateway accordingly.
      const hasActiveGateway = currentUserData.workspace_has_active_gateway === true;
      if (hasActiveGateway) {
        targetFlowSlug = 'campaignManagement';
        await flowHelpers.setUserData(userId, currentUserFlow.flowId, {
          login_post_route_reason: 'has_active_gateway',
        }, conversationId);
      } else {
        targetFlowSlug = (currentUserData.next_flow_slug as string) || 'kyc';
        await flowHelpers.setUserData(userId, currentUserFlow.flowId, {
          login_post_route_reason: 'no_active_gateway',
        }, conversationId);
      }
    }

    // Find target flow
    const targetFlow = await prisma.flow.findUnique({
      where: { slug: targetFlowSlug },
    });

    if (!targetFlow) {
      return {
        success: false,
        error: `Flow with slug "${targetFlowSlug}" not found`,
      };
    }

    // Preserve relevant fields
    const fieldsToPreserve: Record<string, unknown> = {};
    const fieldsToCopy = [
      'jwt_token',
      'user_email',
      'user_phone',
      'org_customer_id',
      'role',
      'account_context_json', // Preserve the context we built
      'next_flow_slug',
      'organization_name',
      // CHANGE: Ensure pending gateway context survives flow switch
      'pending_gateway_action',
      'pending_meshulam_creds',
      'entity_id',
      'workspace_has_active_gateway',
      'workspace_has_active_verified_gateway',
      'workspace_has_entities',
      'workspace_has_gateways',
      'workspace_is_campaign_ready',
      'login_post_route_reason',
    ];

    for (const fieldKey of fieldsToCopy) {
      if (fieldKey in currentUserData && currentUserData[fieldKey] !== undefined && currentUserData[fieldKey] !== null && currentUserData[fieldKey] !== '') {
        fieldsToPreserve[fieldKey] = currentUserData[fieldKey];
      }
    }

    // Save preserved fields to target flow
    if (Object.keys(fieldsToPreserve).length > 0) {
      await flowHelpers.setUserData(userId, targetFlow.id, fieldsToPreserve, conversationId);
      logger.info(`[loginRouteAfterLoginTool] Preserved ${Object.keys(fieldsToPreserve).length} fields during routing`, {
        preservedFields: Object.keys(fieldsToPreserve),
        fromFlowId: currentUserFlow.flowId,
        toFlowSlug: targetFlowSlug,
        userId,
      });
    }

    // Get target flow's initial stage
    const targetFlowDefinition = targetFlow.definition as FlowDefinition;
    const targetInitialStage = targetFlowDefinition.config.initialStage;

    // Mark current stage as completed in flow history
    const currentFlow = await prisma.flow.findUnique({
      where: { id: currentUserFlow.flowId },
    });

    if (currentFlow) {
      await prisma.flowHistory.create({
        data: {
          userId,
          flowId: currentUserFlow.flowId,
          stage: currentUserFlow.stage,
          sessionId: currentUserFlow.id,
        },
      });
    }

    // Update userFlow to point to target flow
    await prisma.userFlow.update({
      where: { id: currentUserFlow.id },
      data: {
        flowId: targetFlow.id,
        stage: targetInitialStage,
      },
    });

    logger.info(`[loginRouteAfterLoginTool] Successfully routed user ${userId} from login to ${targetFlowSlug}`, {
      fromFlowId: currentUserFlow.flowId,
      toFlowSlug: targetFlowSlug,
      toStage: targetInitialStage,
    });

    return {
      success: true,
      data: {
        targetFlowSlug,
        targetStage: targetInitialStage,
        preservedFields: Object.keys(fieldsToPreserve),
      },
    };
  } catch (error: any) {
    logger.error('[loginRouteAfterLoginTool] Error during routing:', error);
    return {
      success: false,
      error: error?.message || 'Failed to complete routing',
    };
  }
};
