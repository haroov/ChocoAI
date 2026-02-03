import React from 'react';
import { useTranslations } from 'use-intl';
import { useMainLayout } from '../../../layouts/MainLayout';
import { SectionHeader } from '../components/SectionHeader';

export const WhatsappSection: React.FC = () => {
  const t = useTranslations('SettingsPage');

  useMainLayout({ title: t('whatsapp') });

  return (
    <div>
      <SectionHeader title={t('whatsapp')} />
    </div>
  );
};
