import React from 'react';
import { useTranslations } from 'use-intl';
import { useMainLayout } from '../../layouts/MainLayout';
import { ConversationList } from './ConversationList';

export const ConversationsPage: React.FC = () => {
  const t = useTranslations('ConversationsPage');

  useMainLayout({ title: t('conversations') });

  return (
    <div className="h-full">
      <ConversationList />
    </div>
  );
};

ConversationsPage.displayName = 'ConversationsPage';
