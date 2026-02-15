import { registerRoute } from '../../utils/routesRegistry';

registerRoute('get', '/api/v1/auth/me', async (req, res) => {
  // Populated by `adminAuthMiddleware` (protected route)
  const { admin } = req;
  res.json({ ok: true, admin });
}, { protected: true });
