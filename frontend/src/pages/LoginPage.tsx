import React, { useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Input,
} from '@heroui/react';
import { useTranslations } from 'use-intl';
import { Link } from '@heroui/link';
import { apiClientStore } from '../stores/apiClientStore';

export const LoginPage: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const t = useTranslations('LoginPage');

  const doLogin = async () => {
    setError(null);
    const u = username.trim();
    const p = password;

    if (!u || !p) {
      setError(t('fillUsernameAndPassword'));
      return;
    }

    setLoading(true);
    try {
      const resp = await apiClientStore.fetch('/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
      const data = await resp.json().catch(() => ({ ok: false, error: 'Invalid response' }));
      if (!resp.ok || !data?.ok) {
        setError(data?.message || t('loginFailed'));
      } else {
        apiClientStore.setAuthorized(true);
      }
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void doLogin();
  };

  return (
    <div className="min-h-screen grid place-items-center bg-gradient-to-b from-default-50 to-default-100 px-4">
      <div className="w-full max-w-md">
        <div className="flex items-center justify-center gap-3 mb-4">
          <img src="/favicon.svg" alt="Choco AI" className="size-8" />
          <span className="font-semibold text-lg text-primary">Choco AI Admin</span>
        </div>

        <Card shadow="md" className="border border-default-200">
          <CardHeader className="flex flex-col items-start gap-1">
            <div className="text-base font-semibold text-foreground">{t('signIn')}</div>
            <div className="text-small text-default-500">{t('authorizedAccessRequired')}</div>
          </CardHeader>
          <Divider />
          <CardBody as="form" onSubmit={onSubmit} className="gap-3">
            <Input
              isRequired
              label={t('username')}
              labelPlacement="outside"
              placeholder="admin"
              value={username}
              onValueChange={setUsername}
              autoComplete="username"
              variant="bordered"
            />

            <Input
              isRequired
              label={t('password')}
              labelPlacement="outside"
              placeholder="••••••••"
              value={password}
              onValueChange={setPassword}
              autoComplete="current-password"
              type="password"
              variant="bordered"
            />

            {error ? (
              <div className="text-tiny text-danger min-h-4 my-2" role="alert" aria-live="polite">
                {error}
              </div>
            ) : null}

            <div className="flex items-center justify-center gap-2">
              <Button color="primary" type="submit" isDisabled={loading} isLoading={loading} size="sm">
                {loading ? t('signInBtnLoading') : t('signInBtn')}
              </Button>
            </div>
          </CardBody>
        </Card>

        <div className="text-center text-tiny text-default-500 mt-3">
          {t.rich('needHelpMsg', {
            link: (chunks) => <Link color="primary" href="#" underline="hover">{chunks}</Link>,
          })}
        </div>
      </div>
    </div>
  );
};
