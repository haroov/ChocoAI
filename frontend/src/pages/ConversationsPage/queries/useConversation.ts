import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiClientStore } from '../../../stores/apiClientStore';
import { ConversationListItem, User } from './useConversations';

export const useConversation = (conversationId: string) => {
  const queryClient = useQueryClient();

  const res = useQuery<ConversationDetails>({
    queryKey: ['conversations', conversationId],
    queryFn: async () => {
      const resp = await apiClientStore.fetch(`/api/v1/conversations/${conversationId}`).then((r) => r.json());
      if (!resp.ok) throw new Error();
      return resp;
    },
    // Auto-refresh every 3 seconds to stay reactive
    refetchInterval: 3000,
  });

  if (!res.data) {
    return {
      ...res,
      invalidateQueries: () => queryClient.invalidateQueries({ queryKey: ['conversations', conversationId] }),
    };
  }

  res.data.conversation.updatedAt = new Date(res.data.conversation.updatedAt);
  res.data.conversation.messages.forEach((m) => m.createdAt = new Date(m.createdAt));

  return {
    ...res,
    invalidateQueries: () => queryClient.invalidateQueries({ queryKey: ['conversations', conversationId] }),
  };
};

export type ConversationDetails = {
  user?: User;
  conversation: Omit<ConversationListItem, 'messages' | 'user'> & { messages: Message[] };
  userData?: Record<string, unknown>;
  activeFlow: {
    name: string;
    slug: string;
    isCompleted: boolean;
    sessionId: string;
    stages: Array<{
      slug: string;
      name?: string;
      description?: string;
      isCompleted: boolean;
      fieldsToCollect?: string[];
      kind?: 'user' | 'system' | 'error';
    }>;
  } | null;
  completedFlows: Array<{
    name: string;
    slug: string;
    isCompleted: boolean;
    sessionId: string;
    stages: Array<{
      slug: string;
      name?: string;
      description?: string;
      isCompleted: boolean;
      fieldsToCollect?: string[];
      kind?: 'user' | 'system' | 'error';
    }>;
  }>;
  log: Array<{
    id: string;
    provider: string;
    request: Record<string, unknown>;
    response: Record<string, unknown>;
    latencyMs: number;
    createdAt: string;
  }>;
  organisations: Array<{
    id: string;
    region: string;
    einOrRegNum: string;
    data: Record<string, unknown>;
  }>;
};

export type Message = {
  id: string;
  content: string;
  createdAt: Date;
  role: string;
}
