import { config } from '../../core';
import { registerRoute } from '../../utils/routesRegistry';
import { verifyAdminJwt } from '../../middleware/auth';
import { logger } from '../../utils/logger';

registerRoute('get', '/api/v1/auth/me', (req, res) => {
  try {
    const cookieName = config.auth.adminCookieName;
    if (!cookieName) {
      logger.error('[auth/me] adminCookieName is not configured');
      return res.status(500).json({ ok: false, error: 'Auth configuration error' });
    }

    const token = (req as any).cookies?.[cookieName];
    const payload = token ? verifyAdminJwt(token) : null;
    // For UI bootstrapping: return 200 with ok=false instead of 401 to avoid noisy console errors.
    if (!payload) return res.status(200).json({ ok: false, error: 'Unauthorized' });
    res.json({ ok: true, admin: payload });
  } catch (error: any) {
    logger.error('[auth/me] Error:', error);
    res.status(500).json({ ok: false, error: 'Internal server error' });
  }
});
