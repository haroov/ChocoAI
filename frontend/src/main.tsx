import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { IntlProvider } from 'use-intl';
import { QueryClientProvider, QueryClient } from '@tanstack/react-query';
import { observer } from 'mobx-react-lite';
import { ToastProvider } from '@heroui/react';
import { Provider } from './provider';
import { en, he } from './helpers/localization';
import ErrorBoundary from './layouts/ErrorBoundary';
import './styles/globals.css';
import { appSettingsStore } from './stores/appSettingsStore';
import { AppController } from './AppController';
import { app, DialogContainer } from './helpers/app';

const queryClient = new QueryClient();

// @ts-ignore
if (import.meta.env.DEV) window.app = app;

const Root = observer(() => {
  let messages = en;
  if (appSettingsStore.language === 'he') messages = he;

  return (
    <React.StrictMode>
      <IntlProvider messages={messages} locale={appSettingsStore.language}>
        <QueryClientProvider client={queryClient}>
          <ErrorBoundary>
            <BrowserRouter>
              <Provider>
                <AppController />

                <DialogContainer />
                <ToastProvider placement="top-right" />
              </Provider>
            </BrowserRouter>
          </ErrorBoundary>
        </QueryClientProvider>
      </IntlProvider>
    </React.StrictMode>
  );
});

ReactDOM.createRoot(document.getElementById('root')!).render(<Root />);
