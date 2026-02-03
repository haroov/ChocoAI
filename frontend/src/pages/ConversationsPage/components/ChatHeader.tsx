import React from 'react';
import { ChatBubbleLeftEllipsisIcon } from '@heroicons/react/24/outline';

export interface ChatHeaderProps {
  title?: React.ReactNode;
  actions?: React.ReactNode;
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
  title = 'Conversation',
  actions,
}) => (
  <div className="flex items-center gap-3 px-4 py-3 border-b border-default-200">
    <div className="flex-1 min-w-0">
      <div className="text-medium font-semibold text-foreground truncate">
        <ChatBubbleLeftEllipsisIcon className="size-4 mr-2 inline-block" />
        {title}
      </div>
    </div>
    <div className="flex items-center gap-2">
      {actions}
    </div>
  </div>
);

ChatHeader.displayName = 'ChatHeader';
