import React from 'react';
import { useTranslations } from 'use-intl';
import { Button, CircularProgress } from '@heroui/react';
import { InformationCircleIcon } from '@heroicons/react/24/outline';
import { observer } from 'mobx-react-lite';
import { conversationStore } from '../../stores/conversationStore';
import { containsRTL } from '../../helpers/containsRTL';
import { Chat } from './Chat';
import { useConversation } from './queries/useConversation';
import { getConversationTitle } from './helpers/getConversationTitle';
import { ConversationDetailsPanel } from './ConversationDetailsPanel';

export const ConversationChat: React.FC<{ conversationId: string }> = observer(({ conversationId }) => {
  const t = useTranslations('ConversationsPage');
  const tCommon = useTranslations('Common');

  const [isDetailsOpen, setIsDetailsOpen] = React.useState(false);
  const [errorMsg, setErrorMsg] = React.useState('');

  const { isPending, isError, data, invalidateQueries } = useConversation(conversationId);

  // Cleanup EventSource connection when component unmounts or conversationId changes
  React.useEffect(() => () => {
    conversationStore.cancelMessage(conversationId);
  }, [conversationId]);

  // IMPORTANT: Hooks must be called unconditionally.
  // Keep any hook (effects/memos) above conditional returns, and gate logic inside the hook.
  const apiMessages = data?.conversation?.messages ?? [];
  const storeMessages = conversationStore.messages[conversationId] || [];
  const pendingUserMessage = storeMessages.length === 1 && storeMessages[0]?.role === 'user'
    ? storeMessages[0]
    : null;

  // If the server already persisted a newer assistant message (via polling),
  // but SSE didn't deliver tokens/done (tab suspend/network hiccup),
  // stop showing "typing" and clear the pending local message.
  React.useEffect(() => {
    if (!pendingUserMessage) return;
    if (!apiMessages || apiMessages.length === 0) return;

    const pendingAt = new Date(pendingUserMessage.createdAt).getTime();
    const lastAssistant = [...apiMessages].reverse().find((m) => m.role === 'assistant');
    const lastAssistantAt = lastAssistant ? new Date(lastAssistant.createdAt).getTime() : 0;
    if (lastAssistantAt > pendingAt) {
      conversationStore.cancelMessage(conversationId);
      conversationStore.resetMessages(conversationId);
    }
  }, [conversationId, apiMessages.length, pendingUserMessage?.createdAt]);

  if (isPending) {
    return (
      <div className="flex h-full justify-center items-center">
        <CircularProgress aria-label={`${tCommon('loading')}...`} />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <p className="text-danger text-center py-12">
        {t('failedToFetchConversation')}
      </p>
    );
  }

  const { conversation } = data;

  // Deduplicate messages: filter out store messages that already exist in API messages
  // Match by content and role (timestamp may differ slightly due to auto-refresh timing)
  const apiMessageKeys = new Set(
    apiMessages.map((m) => `${m.content.trim()}|${m.role}`),
  );

  const uniqueStoreMessages = storeMessages.filter(
    (storeMsg) => !apiMessageKeys.has(`${storeMsg.content.trim()}|${storeMsg.role}`),
  );

  return (
    <div className="w-full h-full flex">
      <Chat
        title={getConversationTitle({ channel: conversation.channel, user: data.user, userData: (conversation as any).userData || data.userData })}
        messages={[
          ...apiMessages,
          ...uniqueStoreMessages,
          ...(errorMsg ? [{
            id: `error${crypto.randomUUID()}`,
            content: errorMsg,
            createdAt: new Date(),
            role: 'assistant',
          }] : []),
        ]}
        actions={(
          <Button
            isIconOnly
            variant="light"
            size="sm"
            onPress={() => setIsDetailsOpen(!isDetailsOpen)}
          >
            <InformationCircleIcon className="size-6" />
          </Button>
        )}
        onSend={(message) => {
          setErrorMsg('');
          conversationStore
            .sendMessage(conversationId, message)
            .then(() => invalidateQueries().then(() => conversationStore.resetMessages(conversationId)))
            .catch(() => invalidateQueries().then(() => {
              setErrorMsg(containsRTL(message)
                ? 'סליחה, נתקלתי בשגיאה. בבקשה נסה שוב.'
                : 'Sorry, I encountered an error. Please try again.');
              conversationStore.resetMessages(conversationId);
            }));
        }}
        isTyping={!!conversationStore.activeConnections[conversationId] && storeMessages.length === 1}
        isSendingDisabled={conversationStore.messages[conversationId]?.length > 0}
      />

      {isDetailsOpen && (
        <ConversationDetailsPanel
          conversationDetails={data}
          conversationId={conversationId}
          onClose={() => setIsDetailsOpen(false)}
        />
      )}
    </div>
  );
});
