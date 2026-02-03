import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { apiClientStore } from '../../../stores/apiClientStore';

export const useConversations = (limit: number) => {
  const prevData = useRef<ConversationListItem[] | undefined>(undefined);

  const queryClient = useQueryClient();

  const res = useQuery<ConversationListItem[]>({
    queryKey: ['conversations', limit],
    queryFn: async () => {
      const resp = await apiClientStore.fetch(`/api/v1/conversations?limit=${limit}`).then((r) => r.json());
      if (!resp.ok) throw new Error();
      return resp.conversations.map((c: Record<string, never>) => ({
        id: c.id,
        channel: c.channel,
        messages: c.messages,
        updatedAt: new Date(c.updatedAt),
        user: c.user,
      }));
    },
  });

  if (res.data) prevData.current = res.data;

  return {
    ...res,
    data: prevData.current,
    invalidateQueries: () => queryClient.invalidateQueries({ queryKey: ['conversations', limit] }),
  };
};

export type ConversationListItem = {
  id: string;
  channel: string;
  messages: [{ content: string }];
  updatedAt: Date;
  user?: User;
};

export type User = {
  id: string;
  firstName: string;
  lastName: string;
}
