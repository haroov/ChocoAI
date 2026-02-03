import React from 'react';
import { useTranslations } from 'use-intl';
import notFoundPicture from '../assets/404.svg';
import ErrorLayout from '../layouts/ErrorLayout';
import { useMainLayout } from '../layouts/MainLayout';

const NotFoundPage: React.FC = () => {
  const t = useTranslations('ApplicationError');

  useMainLayout({ title: t('pageWasNotFound') });

  return (
    <ErrorLayout
      title={t('pageWasNotFound')}
      description={t('pageProbablyWasDeletedOrMoved')}
      pictureSrc={notFoundPicture}
    />
  );
};

NotFoundPage.displayName = 'NotFoundPage';

export default NotFoundPage;
