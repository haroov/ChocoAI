import { ToolExecutor } from '../types';
import { prisma } from '../../../../core';

export const setupOrgTool: ToolExecutor = async (payload, { conversationId }) => {
  try {
    const conversation = await prisma.conversation.findUnique({ where: { id: conversationId } });

    if (!conversation) throw new Error('Conversation not found');
    if (!conversation.userId) throw new Error('User not found in conversation');
    if (!payload.regNum) throw new Error('Organisation number not provided');

    const einOrRegNum = payload.regNum.replace(/\D/g, '');
    if (!/^\d{9}$/.test(einOrRegNum)) throw new Error('Invalid EIN/registration number format');

    const ein = `${einOrRegNum.slice(0, 2)}-${einOrRegNum.slice(2)}`;

    const organisations = await prisma.organisationInfo.findMany({ where: {
      OR: [{ einOrRegNum }, { einOrRegNum: ein }],
    } });
    if (organisations.length === 0) throw new Error('Organisation info not found');
    if (organisations.length > 1) throw new Error('Multiple organizations found with the same EIN/registration number');

    return {
      success: false,
      error: 'Not implemented yet.',
    };
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Setup org failed',
    };
  }
};
