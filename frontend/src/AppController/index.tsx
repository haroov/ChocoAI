import React, { useEffect, useState } from 'react';
import { observer } from 'mobx-react-lite';
import { apiClientStore } from '../stores/apiClientStore';
import { AuthorizedRoutes } from './AuthorizedRoutes';
import { UnauthorizedRoutes } from './UnauthorizedRoutes';

export const AppController: React.FC = observer(() => {
  const [checkedSession, setCheckedSession] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await apiClientStore.fetch('/api/v1/auth/me');
        if (!cancelled && res.ok) {
          apiClientStore.setAuthorized(true);
        }
      } catch {
        // Network errors should not crash routing; treat as unauthorized.
        if (!cancelled) apiClientStore.setAuthorized(false);
      } finally {
        if (!cancelled) setCheckedSession(true);
      }
    })();

    return () => { cancelled = true; };
  }, []);

  // Avoid flashing authorized UI before we know session status.
  if (!checkedSession) return null;

  return apiClientStore.isAuthorized ? <AuthorizedRoutes /> : <UnauthorizedRoutes />;
});

AppController.displayName = 'AppController';
