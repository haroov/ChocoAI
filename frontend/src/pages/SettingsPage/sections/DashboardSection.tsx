import React from 'react';
import { useTranslations } from 'use-intl';
import { useMainLayout } from '../../../layouts/MainLayout';
import { SectionHeader } from '../components/SectionHeader';

export const DashboardSection: React.FC = () => {
  const t = useTranslations('SettingsPage');

  useMainLayout({ title: t('dashboard') });

  return (
    <div>
      <SectionHeader title={t('dashboard')} />
    </div>
  );
};
