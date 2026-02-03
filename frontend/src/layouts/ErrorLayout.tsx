import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslations } from 'use-intl';

interface ErrorLayoutProps {
  title: string;
  description: string;
  pictureSrc?: string;
  hideGoHomeLink?: boolean;
}

const ErrorLayout: React.FC<ErrorLayoutProps> = ({
  title,
  description,
  pictureSrc,
  hideGoHomeLink,
}) => {
  const t = useTranslations('ApplicationError');

  return (
    <div className="w-full h-full flex justify-center items-center">
      <div className="flex flex-wrap md:flex-nowrap justify-center items-center gap-5
                      max-w-screen-xl px-6 w-full md:w-10/12"
      >
        <div className="order-2 md:order-1">
          <h1 className="text-title text-3xl md:text-5xl mb-2">{title}</h1>
          <p className="text-label whitespace-pre-wrap">{description}</p>

          {!hideGoHomeLink && (
            <Link
              to="/"
              className="inline-flex items-center rounded-md border border-transparent bg-primary
                       mt-4 px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-70
                       focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              {t('goToHomeScreen')}
            </Link>
          )}
        </div>

        {pictureSrc && <img className="block order-1 md:order-2 w-96" src={pictureSrc} alt="" />}
      </div>
    </div>
  );
};

ErrorLayout.displayName = 'ErrorLayout';

export default ErrorLayout;
