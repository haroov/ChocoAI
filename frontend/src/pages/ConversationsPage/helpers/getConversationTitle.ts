import { User } from '../queries/useConversations';

export const getConversationTitle = (conversation: { channel: string, user?: User, userData?: Record<string, unknown> }) => {
  const { user, userData } = conversation;

  let firstName = user?.firstName;
  let lastName = user?.lastName;

  const normalizeNamePart = (v: unknown): string | undefined => {
    const s = String(v ?? '').trim();
    if (!s) return undefined;
    const lowered = s.toLowerCase();
    if (lowered === 'null' || lowered === ':null' || lowered === 'undefined' || lowered === ':undefined') return undefined;
    return s;
  };

  // Fallback to userData if user object is missing or empty
  if (!firstName && userData) {
    firstName = normalizeNamePart(userData.user_first_name)
      || normalizeNamePart(userData.proposer_first_name)
      || normalizeNamePart(userData.first_name);
  }
  if (!lastName && userData) {
    lastName = normalizeNamePart(userData.user_last_name)
      || normalizeNamePart(userData.proposer_last_name)
      || normalizeNamePart(userData.last_name);
  }

  const fullName = [firstName, lastName].filter(Boolean).join(' ').trim();

  if (fullName.length > 0) {
    if (fullName.length > 25) {
      return `${fullName.slice(0, 25)}...`;
    }
    return fullName;
  }

  return conversation.channel;
};
