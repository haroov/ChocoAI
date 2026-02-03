import { registerRoute } from '../../utils/routesRegistry';
import { config } from '../../core';
import { makeCookieOptions } from '../../middleware/auth';

registerRoute('post', '/api/v1/auth/logout', (req, res) => {
  res.clearCookie(config.auth.adminCookieName, makeCookieOptions());
  res.json({ ok: true });
});
