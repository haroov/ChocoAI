import { prisma } from '../prisma';
import { hashPassword } from '../../middleware/auth';

export const ensureAdmins = async () => {
  if (await prisma.admin.count() === 0) {
    const seedPassword = process.env.ADMIN_SEED_PASSWORD || 'admin';

    await prisma.admin.create({ data: {
      username: 'admin',
      passwordHash: hashPassword(seedPassword),
      role: 'admin',
    } });
  }
};
