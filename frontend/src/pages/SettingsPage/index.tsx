import React from 'react';
import { useTranslations } from 'use-intl';
import { ScrollShadow, Link } from '@heroui/react';
import { Outlet, useLocation } from 'react-router-dom';
import { useMainLayout } from '../../layouts/MainLayout';
import classNames from '../../helpers/classNames';
import notFoundPicture from '../../assets/404.svg';
import ErrorLayout from '../../layouts/ErrorLayout';

export const SettingsPage: React.FC = () => {
  const t = useTranslations('SettingsPage');
  useMainLayout({ title: t('settings') });

  const location = useLocation();
  const section = location.pathname.split('/')[2] || SettingsSection.Dashboard;

  const nav = [
    { key: SettingsSection.Dashboard, label: t('dashboard') },
    { key: SettingsSection.AIProvider, label: t('aiProvider') },
    { key: SettingsSection.Flows, label: t('flows') },
    { key: SettingsSection.Whatsapp, label: t('whatsapp') },
    { key: SettingsSection.Email, label: t('email') },
    { key: SettingsSection.WebWidget, label: t('webWidget') },
    { key: SettingsSection.Users, label: 'Users' }, // Hardcoded label for now or add to translations
    { key: SettingsSection.System, label: t('system') },
  ];

  const isSectionExisting = nav.some((item) => item.key === section);

  return (
    <div className="h-full flex bg-default-50">
      <aside className="w-60 border-r border-default-200 bg-default-50 flex flex-col">
        <ScrollShadow hideScrollBar className="flex-1">
          <nav className="py-2">
            {nav.map((item) => (
              <Link
                key={item.key}
                href={`/settings/${item.key}`}
                className={classNames(
                  'w-full text-left px-4 py-2.5 flex items-center gap-3',
                  section === item.key ? 'bg-active font-medium border-l-2 border-primary' : 'hover:bg-hover',
                )}
              >
                <span className="text-small text-foreground">{item.label}</span>
              </Link>
            ))}
          </nav>
        </ScrollShadow>
      </aside>

      <ScrollShadow
        className="flex-1 bg-content1 flex flex-col min-w-0"
        as="section"
        hideScrollBar
        visibility="bottom"
      >
        {isSectionExisting ? <Outlet /> : (
          <ErrorLayout
            title={t('sectionWasNotFound')}
            description=""
            pictureSrc={notFoundPicture}
            hideGoHomeLink
          />
        )}
      </ScrollShadow>
    </div>
  );
};

enum SettingsSection {
  Dashboard = 'dashboard',
  AIProvider = 'ai-provider',
  Flows = 'flows',
  FlowEditor = 'flow-editor',
  Whatsapp = 'whatsapp',
  Email = 'email',
  WebWidget = 'web-widget',
  Users = 'users',
  System = 'system',
}
