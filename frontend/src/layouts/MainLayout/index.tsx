import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { Link } from '@heroui/link';
import { useLocation } from 'react-router-dom';
import { useDocumentTitle } from '../../hooks/useDocumentTitle';
import classNames from '../../helpers/classNames';
import { appSettingsStore } from '../../stores/appSettingsStore';
import mainLayoutStore from './mainLayoutStore';
import { ThemeSwitch, UserMenu, LanguageSelector } from './components';

const MainLayout: React.FC<React.PropsWithChildren> = observer(({ children }) => {
  const t = useTranslations('MainLayout');

  React.useEffect(() => {
    appSettingsStore.fetchSettings();
  }, []);

  useDocumentTitle(mainLayoutStore.title);

  const { pathname } = useLocation();

  const links = [
    { href: '/', label: t('conversations'), active: pathname === '/' || pathname.startsWith('/conversations') },
    { href: '/settings', label: t('settings'), active: pathname.startsWith('/settings') },
  ];

  return (
    <div className="h-full flex flex-col overflow-auto">
      <header className="px-4 py-2 bg-default-50 border-b border-default-200 flex
                         justify-between items-center sticky top-0 z-50"
      >
        <div className="flex items-center gap-12">
          <img className="w-10" src="/favicon.svg" alt="Choco logo" />
          <nav className="flex gap-2">
            {links.map(({ href, label, active }) => (
              <Link
                key={href}
                className={classNames(
                  'block px-4 py-2 rounded-md',
                  active ? 'bg-active shadow' : 'hover:bg-hover',
                )}
                href={href}
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          <ThemeSwitch />
          <LanguageSelector />
          <UserMenu />
        </div>
      </header>

      <main className="flex-1 h-[calc(100%-4rem)]">
        {children}
      </main>
    </div>
  );
});

MainLayout.displayName = 'MainLayout';

export default MainLayout;
export { default as useMainLayout } from './useMainLayout';
export { type MainLayoutOptions } from './mainLayoutStore';
