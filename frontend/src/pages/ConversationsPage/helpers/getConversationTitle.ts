import { User } from '../queries/useConversations';

export const getConversationTitle = (conversation: { channel: string, user?: User }) => {
  if (!conversation.user) return conversation.channel;

  const { user } = conversation;
  const fullName = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (fullName.length > 25) {
    return `${fullName.slice(0, 25)}...`;
  }
  return fullName || conversation.channel;
};
