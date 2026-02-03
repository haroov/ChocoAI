import React from 'react';
import { useTranslations } from 'use-intl';
import { useMainLayout } from '../../../layouts/MainLayout';
import { SectionHeader } from '../components/SectionHeader';

export const EmailSection: React.FC = () => {
  const t = useTranslations('SettingsPage');

  useMainLayout({ title: t('email') });

  return (
    <div>
      <SectionHeader title={t('email')} />
    </div>
  );
};
