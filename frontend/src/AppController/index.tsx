import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { CircularProgress } from '@heroui/react';
import { useQuery } from '@tanstack/react-query';
import ErrorLayout from '../layouts/ErrorLayout';
import networkError from '../assets/503.svg';
import { apiClientStore } from '../stores/apiClientStore';
import { AuthorizedRoutes } from './AuthorizedRoutes';
import { UnauthorizedRoutes } from './UnauthorizedRoutes';

export const AppController: React.FC = observer(() => {
  const t = useTranslations('ApplicationError');
  const tCommon = useTranslations('Common');

  const { isPending, isError } = useQuery({
    queryKey: ['auth-me'],
    queryFn: async () => {
      const res = await apiClientStore.fetch('/api/v1/auth/me');
      const data = await res.json().catch(() => ({ ok: false }));
      apiClientStore.setAuthorized(!!data?.ok);
      return data;
    },
  });

  if (isPending) {
    return (
      <div className="flex h-full justify-center items-center">
        <CircularProgress aria-label={`${tCommon('loading')}...`} />
      </div>
    );
  }

  if (isError) {
    return (
      <ErrorLayout
        title={t('networkError')}
        description={t('networkErrorMsg')}
        pictureSrc={networkError}
        hideGoHomeLink
      />
    );
  }

  return apiClientStore.isAuthorized ? <AuthorizedRoutes /> : <UnauthorizedRoutes />;
});

AppController.displayName = 'AppController';
