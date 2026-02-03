import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { Button, ButtonGroup, Tooltip } from '@heroui/react';
import { ComputerDesktopIcon, MoonIcon, SunIcon } from '@heroicons/react/24/outline';
import { appSettingsStore, AppTheme } from '../../../stores/appSettingsStore';

export const ThemeSwitch: React.FC = observer(() => {
  const t = useTranslations('MainLayout');

  const themes = [
    { theme: AppTheme.Auto, label: t('systemTheme'), icon: ComputerDesktopIcon },
    { theme: AppTheme.Light, label: t('lightTheme'), icon: SunIcon },
    { theme: AppTheme.Dark, label: t('darkTheme'), icon: MoonIcon },
  ];

  return (
    <ButtonGroup size="sm" variant="ghost">
      {themes.map(({ theme, label, icon }) => (
        <Tooltip key={theme} content={label}>
          <Button
            variant={appSettingsStore.theme === theme ? 'solid' : 'ghost'}
            color={appSettingsStore.theme === theme ? 'primary' : 'default'}
            onPress={() => appSettingsStore.applyTheme(theme)}
            isIconOnly
            aria-label={label}
          >
            {React.createElement(icon, { className: 'size-4' })}
          </Button>
        </Tooltip>
      ))}
    </ButtonGroup>
  );
});
