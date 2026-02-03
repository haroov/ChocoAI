import { prisma } from '../../core/prisma';
import { logger } from '../../utils/logger';
import { flowHelpers } from '../flowEngine/flowHelpers';
import { UserMemory, OrganizationMemory, FlowMemory, ConversationMemory } from './types';

/**
 * Memory Service - provides structured access to user/org/flow/conversation state
 *
 * This service wraps existing userData storage and provides a unified interface
 * for accessing and updating memory across different scopes.
 */
class MemoryService {
  /**
   * Get user memory (personal details, preferences, roles, flags)
   */
  async getUserMemory(userId: string): Promise<UserMemory | null> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          UserOrganisation: {
            include: {
              organisation: true,
            },
          },
        },
      });

      if (!user) return null;

      // Get phone from userData if available
      const userData = await prisma.userData.findFirst({
        where: { userId: user.id, key: 'phone' },
      });
      const phone = userData?.value || undefined;

      const userMemory: UserMemory = {
        userId: user.id,
        personalDetails: {
          firstName: user.firstName || undefined,
          lastName: user.lastName || undefined,
          email: user.email || undefined,
          phone: phone,
          role: (user.role as 'donor' | 'nonprofit') || undefined,
        },
        preferences: {},
        roles: user.role ? [user.role] : [],
        flags: {
          registered: user.registered || false,
        },
      };

      // Detect language from conversations (simplified - could be enhanced)
      const recentConversation = await prisma.conversation.findFirst({
        where: { userId },
        include: {
          messages: {
            where: { role: 'user' },
            take: 5,
            orderBy: { createdAt: 'asc' },
          },
        },
      });

      if (recentConversation?.messages) {
        const hasHebrew = recentConversation.messages.some((msg) =>
          /[\u0590-\u05FF]/.test(msg.content),
        );
        userMemory.personalDetails.language = hasHebrew ? 'hebrew' : 'english';
      }

      return userMemory;
    } catch (error) {
      logger.error('Error getting user memory:', error);
      return null;
    }
  }

  /**
   * Update user memory
   */
  async updateUserMemory(userId: string, patch: Partial<UserMemory>): Promise<void> {
    try {
      if (patch.personalDetails) {
        const updateData: any = {};
        if (patch.personalDetails.firstName !== undefined) updateData.firstName = patch.personalDetails.firstName;
        if (patch.personalDetails.lastName !== undefined) updateData.lastName = patch.personalDetails.lastName;
        if (patch.personalDetails.email !== undefined) updateData.email = patch.personalDetails.email;
        if (patch.personalDetails.phone !== undefined) updateData.phone = patch.personalDetails.phone;
        if (patch.personalDetails.role !== undefined) updateData.role = patch.personalDetails.role;

        if (Object.keys(updateData).length > 0) {
          await prisma.user.update({
            where: { id: userId },
            data: updateData,
          });
        }
      }

      if (patch.flags) {
        // Update flags in user table or userData as needed
        // For now, registered flag is in user table
        if (patch.flags.registered !== undefined) {
          await prisma.user.update({
            where: { id: userId },
            data: { registered: patch.flags.registered },
          });
        }
      }
    } catch (error) {
      logger.error('Error updating user memory:', error);
      throw error;
    }
  }

  /**
   * Get organization memory
   */
  async getOrganizationMemory(orgId: string): Promise<OrganizationMemory | null> {
    try {
      const orgInfo = await prisma.organisationInfo.findUnique({
        where: { id: orgId },
      });

      if (!orgInfo || !orgInfo.data) return null;

      const orgData = orgInfo.data as any;

      const orgMemory: OrganizationMemory = {
        organizationId: orgId,
        details: {
          name: orgData.name || orgData.fullName || undefined,
          taxId: orgData.regNum || orgData.ein || orgData.tax_id || undefined,
          country: orgInfo.region || undefined,
          address: {
            street: orgData.fullAddress || orgData.addressStreet || orgData.street || undefined,
            city: orgData.addressCity || orgData.city || undefined,
            zip: orgData.addressZipCode || orgData.zip || undefined,
            state: orgData.state || undefined,
          },
        },
        kycState: {
          verified: false, // Could be enhanced to check actual KYC status
        },
        riskFlags: {},
      };

      return orgMemory;
    } catch (error) {
      logger.error('Error getting organization memory:', error);
      return null;
    }
  }

  /**
   * Update organization memory
   */
  async updateOrganizationMemory(orgId: string, patch: Partial<OrganizationMemory>): Promise<void> {
    // Implementation would update organisationInfo table
    // For now, this is a placeholder
    logger.warn('updateOrganizationMemory not fully implemented');
  }

  /**
   * Get flow memory (wraps existing userData)
   */
  async getFlowMemory(userId: string, flowSlug: string): Promise<FlowMemory | null> {
    try {
      const flow = await prisma.flow.findUnique({ where: { slug: flowSlug } });
      if (!flow) return null;

      const userFlow = await prisma.userFlow.findUnique({
        where: { userId },
      });

      if (!userFlow || userFlow.flowId !== flow.id) {
        // Flow not started yet
        return null;
      }

      // Get userData for this flow
      const stageData = await flowHelpers.getUserData(userId, flow.id);

      // Get completed stages from flowHistory
      const flowHistory = await prisma.flowHistory.findMany({
        where: {
          userId,
          flowId: flow.id,
        },
        select: { stage: true, completedAt: true },
        orderBy: { completedAt: 'asc' },
      });

      const completedStages = [...new Set(flowHistory.map((h) => h.stage))];
      const startedAt = flowHistory[0]?.completedAt || new Date();

      return {
        userId,
        flowSlug,
        stageData,
        completedStages,
        startedAt,
        completedAt: userFlow ? undefined : new Date(), // If no userFlow, flow is complete
      };
    } catch (error) {
      logger.error('Error getting flow memory:', error);
      return null;
    }
  }

  /**
   * Update flow memory
   */
  async updateFlowMemory(userId: string, flowSlug: string, patch: Partial<FlowMemory>): Promise<void> {
    try {
      const flow = await prisma.flow.findUnique({ where: { slug: flowSlug } });
      if (!flow) throw new Error(`Flow not found: ${flowSlug}`);

      if (patch.stageData) {
        // Update userData via flowHelpers
        await flowHelpers.setUserData(userId, flow.id, patch.stageData);
      }
    } catch (error) {
      logger.error('Error updating flow memory:', error);
      throw error;
    }
  }

  /**
   * Set a single flow field
   */
  async setFlowField(userId: string, flowSlug: string, key: string, value: unknown): Promise<void> {
    try {
      const flow = await prisma.flow.findUnique({ where: { slug: flowSlug } });
      if (!flow) throw new Error(`Flow not found: ${flowSlug}`);

      await flowHelpers.setUserData(userId, flow.id, { [key]: value });
    } catch (error) {
      logger.error('Error setting flow field:', error);
      throw error;
    }
  }

  /**
   * Get conversation memory
   */
  async getConversationMemory(conversationId: string): Promise<ConversationMemory | null> {
    try {
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        include: {
          messages: {
            take: 10,
            orderBy: { createdAt: 'desc' },
          },
        },
      });

      if (!conversation) return null;

      // Get facts from Memory table (if exists)
      // Note: Memory table uses sessionId, not conversationId directly
      // We'll use userId and sessionId from conversation if available
      const sessionId = conversation.userId
        ? (await prisma.userFlow.findUnique({
          where: { userId: conversation.userId },
          select: { id: true },
        }))?.id || null
        : null;

      const memoryEntries = sessionId
        ? await prisma.memory.findMany({
          where: {
            sessionId,
          },
          orderBy: { createdAt: 'desc' },
          take: 50,
        })
        : [];

      const facts = memoryEntries.map((entry) => ({
        key: entry.key,
        value: entry.value,
        confidence: undefined, // Memory table doesn't have confidence field
        source: 'system' as const, // Memory table doesn't have source field
        timestamp: entry.createdAt,
      }));

      // Get last behavior from userFlow
      const userFlow = conversation.userId
        ? await prisma.userFlow.findUnique({
          where: { userId: conversation.userId },
          include: {
            flow: true,
          },
        })
        : null;

      const lastBehavior = {
        stage: userFlow?.stage || undefined,
        action: undefined, // Could be enhanced to track last action
        timestamp: userFlow ? new Date() : conversation.createdAt,
      };

      return {
        conversationId,
        facts,
        lastBehavior,
        openIssues: [], // Could be enhanced to track open issues
      };
    } catch (error) {
      logger.error('Error getting conversation memory:', error);
      return null;
    }
  }

  /**
   * Add a fact to conversation memory
   */
  async addConversationFact(
    conversationId: string,
    fact: ConversationMemory['facts'][0],
  ): Promise<void> {
    try {
      // Get sessionId from conversation
      const conversation = await prisma.conversation.findUnique({
        where: { id: conversationId },
        select: { userId: true },
      });

      const sessionId = conversation?.userId
        ? (await prisma.userFlow.findUnique({
          where: { userId: conversation.userId },
          select: { id: true },
        }))?.id || null
        : null;

      if (sessionId) {
        await prisma.memory.create({
          data: {
            sessionId,
            key: fact.key,
            value: fact.value as any,
            scope: 'session',
          },
        });
      }
    } catch (error) {
      logger.error('Error adding conversation fact:', error);
      // Don't throw - memory addition should not break flow
    }
  }

  /**
   * Get user context (user + organizations + active flows)
   */
  async getUserContext(userId: string): Promise<{
    user: Partial<UserMemory>;
    organizations: OrganizationMemory[];
    activeFlows: FlowMemory[];
  }> {
    try {
      const user = await this.getUserMemory(userId);
      if (!user) {
        return {
          user: {},
          organizations: [],
          activeFlows: [],
        };
      }

      // Get user's organizations
      const userOrgs = await prisma.userOrganisation.findMany({
        where: { userId },
        include: {
          organisation: true,
        },
      });

      const organizations = await Promise.all(
        userOrgs.map((uo) => this.getOrganizationMemory(uo.organisationId)),
      );
      const validOrgs = organizations.filter((org): org is OrganizationMemory => org !== null);

      // Get active flows
      const userFlow = await prisma.userFlow.findUnique({
        where: { userId },
        include: {
          flow: true,
        },
      });

      const activeFlows: FlowMemory[] = [];
      if (userFlow) {
        const flowMemory = await this.getFlowMemory(userId, userFlow.flow.slug);
        if (flowMemory) {
          activeFlows.push(flowMemory);
        }
      }

      return {
        user,
        organizations: validOrgs,
        activeFlows,
      };
    } catch (error) {
      logger.error('Error getting user context:', error);
      return {
        user: {},
        organizations: [],
        activeFlows: [],
      };
    }
  }

  /**
   * Get safe memory for LLM (masks sensitive fields)
   */
  async getSafeMemoryForLLM(userId: string, flowSlug: string): Promise<Record<string, unknown>> {
    const flowMemory = await this.getFlowMemory(userId, flowSlug);
    if (!flowMemory) return {};

    // Get flow definition to check for sensitive fields
    const flow = await prisma.flow.findUnique({ where: { slug: flowSlug } });
    if (!flow) return flowMemory.stageData;

    const flowDefinition = flow.definition as any;
    const fields = flowDefinition.fields || {};

    // Use flowHelpers.sanitizeData to mask sensitive fields
    return flowHelpers.sanitizeData(flowMemory.stageData, fields);
  }
}

export const memoryService = new MemoryService();
