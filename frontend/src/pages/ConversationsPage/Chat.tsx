import React from 'react';
import { observer } from 'mobx-react-lite';
import { ChatHeader } from './components/ChatHeader';
import { ChatContainer } from './components/ChatContainer';
import { Message } from './queries/useConversation';

export interface ChatProps {
  messages: Message[];
  onSend: (text: string) => void | Promise<void>;
  isSendingDisabled?: boolean;
  isTyping?: boolean;
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

export const Chat: React.FC<ChatProps> = observer(({
  messages,
  onSend,
  isSendingDisabled = false,
  isTyping,
  title = 'Conversation',
  actions,
}) => (
  <div className="flex flex-col min-h-0 min-w-0 h-full w-full">
    <ChatHeader title={title} actions={actions} />
    <ChatContainer
      messages={messages}
      onSend={onSend}
      isSendingDisabled={isSendingDisabled}
      isTyping={isTyping}
    />
  </div>
));

Chat.displayName = 'Chat';
