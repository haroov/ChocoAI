import { prisma, config } from '../../core';
import { registerRoute } from '../../utils/routesRegistry';
import { makeCookieOptions, signAdminJwt, verifyPassword } from '../../middleware/auth';

registerRoute('post', '/api/v1/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ ok: false, error: 'username and password are required' });
    const admin = await prisma.admin.findUnique({ where: { username } });
    // To prevent user enumeration, use generic error
    if (!admin || !verifyPassword(password, admin.passwordHash)) {
      return res.status(401).json({ ok: false, error: 'Invalid credentials' });
    }
    await prisma.admin.update({ where: { id: admin.id }, data: { lastLoginAt: new Date() } });
    const token = signAdminJwt({ sub: admin.id, username: admin.username, role: admin.role });
    res.cookie(config.auth.adminCookieName, token, makeCookieOptions());
    return res.json({ ok: true, admin: { id: admin.id, username: admin.username, role: admin.role } });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Login failed' });
  }
});
