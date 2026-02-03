import { z } from 'zod';
import { Conversation, Message } from '@prisma/client';
import { prisma } from '../../core/prisma';

class ConversationHelpers {
  async findOrCreate(conversationId: string | null, channel: string) {
    return conversationId
      ? await prisma.conversation.findUnique({ where: { id: conversationId } })
      : await prisma.conversation.create({ data: { channel } });
  }

  async createUser(role: string) {
    return prisma.user.create({ data: { role } });
  }

  async getUserData(userId: string | null) {
    if (!userId) return {};

    const dataRows = await prisma.userData.findMany({ where: { userId } });
    const rawData: Record<string, string | null> = {};
    for (const row of dataRows) {
      rawData[row.key] = row.value;
    }

    const dataSchema = z.object({
      organization_name: z.string().optional(),
      first_name: z.string().optional(),
      last_name: z.string().optional(),
      email: z.string().optional(),
      phone: z.string().optional(),
    });
    return dataSchema.safeParse(rawData).data || {};
  }

  async addMessage(conversationId: string, role: 'user' | 'assistant' | 'system', content: string, flowId?: string) {
    const rec = await prisma.message.create({
      data: {
        conversationId,
        role,
        content,
        ...(flowId && { flowId }),
      },
    });

    const now = new Date();
    const updateData: Record<string, any> = { updatedAt: now };
    if (role === 'user') {
      updateData.lastUserAt = now;
    }
    if (role === 'assistant') {
      updateData.lastAgentAt = now;
    }
    await prisma.conversation.update({ where: { id: conversationId }, data: updateData });
    return rec;
  }
}

export const conversationHelpers = new ConversationHelpers();
