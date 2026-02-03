import React from 'react';
import { HeroUIProvider } from '@heroui/system';
import { IntlProvider } from 'use-intl';
import { en } from '../../helpers/localization';

export const WidgetProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <IntlProvider messages={en} locale="en">
    <HeroUIProvider data-theme="light">
      {children}
    </HeroUIProvider>
  </IntlProvider>
);

