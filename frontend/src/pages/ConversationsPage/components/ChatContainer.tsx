import React from 'react';
import { Message } from '../queries/useConversation';
import { ChatMessages } from './ChatMessages';
import { ChatInput } from './ChatInput';

export interface ChatContainerProps {
  messages: Message[];
  onSend: (text: string) => void | Promise<void>;
  isSendingDisabled?: boolean;
  isTyping?: boolean;
  placeholder?: string;
}

export const ChatContainer: React.FC<ChatContainerProps> = ({
  messages,
  onSend,
  isSendingDisabled = false,
  isTyping,
  placeholder,
}) => (
  <div className="flex flex-col min-h-0 min-w-0 h-full w-full">
    <ChatMessages messages={messages} isTyping={isTyping} />
    <ChatInput
      onSend={onSend}
      isSendingDisabled={isSendingDisabled}
      placeholder={placeholder}
    />
  </div>
);

ChatContainer.displayName = 'ChatContainer';
