import React from 'react';
import { ConversationDetails } from './queries/useConversation';
import { ConversationDetailsPane } from './components/ConversationDetailsPane';

type ConversationDetailsProps = {
  conversationDetails: ConversationDetails;
  conversationId: string;
  onClose: () => void;
}

export const ConversationDetailsPanel: React.FC<ConversationDetailsProps> = ({
  conversationDetails,
  conversationId,
  onClose,
}) => (
  <ConversationDetailsPane
    conversationDetails={conversationDetails}
    conversationId={conversationId}
    onClose={onClose}
  />
);
