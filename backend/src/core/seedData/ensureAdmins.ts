import { prisma } from '../prisma';
import { hashPassword, verifyPassword } from '../../middleware/auth';

export const ensureAdmins = async () => {
  const username = process.env.ADMIN_SEED_USERNAME || 'admin';
  const seedPasswordFromEnv = process.env.ADMIN_SEED_PASSWORD;

  // Never ship a real password in source control.
  // In production, require an explicit seed password; in dev, default to "admin".
  if (!seedPasswordFromEnv && process.env.NODE_ENV === 'production') {
    throw new Error('ADMIN_SEED_PASSWORD is required in production');
  }

  const seedPassword = seedPasswordFromEnv || 'admin';

  const existing = await prisma.admin.findUnique({ where: { username } });

  if (!existing) {
    await prisma.admin.create({
      data: {
        username,
        passwordHash: hashPassword(seedPassword),
        role: 'admin',
      },
    });
    return;
  }

  // If the seeded password changed, update the admin so login works immediately after restart.
  if (!verifyPassword(seedPassword, existing.passwordHash)) {
    await prisma.admin.update({
      where: { id: existing.id },
      data: { passwordHash: hashPassword(seedPassword) },
    });
  }
};
