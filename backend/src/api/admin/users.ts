import { z } from 'zod';
import { prisma } from '../../core';
import { registerRoute } from '../../utils/routesRegistry';
import { hashPassword } from '../../middleware/auth';
import { logger } from '../../utils/logger';

// List Users
registerRoute('get', '/api/v1/admin/users', async (req, res) => {
  try {
    const users = await prisma.admin.findMany({
      select: {
        id: true,
        username: true,
        role: true,
        lastLoginAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ ok: true, users });
  } catch (error) {
    logger.error('[admin/users] List error:', error);
    res.status(500).json({ ok: false, error: 'Failed to list users' });
  }
}, { protected: true });

// Create User
const CreateUserSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
});

registerRoute('post', '/api/v1/admin/users', async (req, res) => {
  try {
    const body = CreateUserSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ ok: false, error: 'Invalid input', details: body.error.flatten() });
    }

    const { username, password } = body.data;

    const existing = await prisma.admin.findUnique({ where: { username } });
    if (existing) {
      return res.status(409).json({ ok: false, error: 'User already exists' });
    }

    const passwordHash = hashPassword(password);
    const newUser = await prisma.admin.create({
      data: {
        username,
        passwordHash,
        role: 'admin', // Default role
      },
      select: { id: true, username: true, role: true, createdAt: true },
    });

    res.json({ ok: true, user: newUser });
  } catch (error) {
    logger.error('[admin/users] Create error:', error);
    res.status(500).json({ ok: false, error: 'Failed to create user' });
  }
}, { protected: true });

// Reset Password
const ResetPasswordSchema = z.object({
  newPassword: z.string().min(6),
});

registerRoute('post', '/api/v1/admin/users/:id/reset-password', async (req, res) => {
  try {
    const { id } = req.params;
    const body = ResetPasswordSchema.safeParse(req.body);
    if (!body.success) {
      return res.status(400).json({ ok: false, error: 'Invalid password', details: body.error.flatten() });
    }

    // Optional: Prevent changing own password via this endpoint if desired, but usually admins can reset their own.

    const passwordHash = hashPassword(body.data.newPassword);
    await prisma.admin.update({
      where: { id },
      data: { passwordHash },
    });

    res.json({ ok: true });
  } catch (error) {
    logger.error('[admin/users] Reset password error:', error);
    res.status(500).json({ ok: false, error: 'Failed to reset password' });
  }
}, { protected: true });

// Delete User
registerRoute('delete', '/api/v1/admin/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const requestingUser = req.admin; // Populated by middleware

    if (requestingUser?.sub === id) {
      return res.status(400).json({ ok: false, error: 'Cannot delete yourself' });
    }

    await prisma.admin.delete({ where: { id } });
    res.json({ ok: true });
  } catch (error) {
    logger.error('[admin/users] Delete error:', error);
    res.status(500).json({ ok: false, error: 'Failed to delete user' });
  }
}, { protected: true });
