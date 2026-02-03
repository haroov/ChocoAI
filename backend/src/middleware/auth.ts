import crypto from 'crypto';
import path from 'path';
import express from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../core';

export const makeCookieOptions = () => {
  const isProd = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true as const,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000,
  };
};

export const hashPassword = (password: string, salt?: string) => {
  const s = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, s, 64).toString('hex');
  return `${s}:${hash}`;
};

export const verifyPassword = (password: string, stored: string): boolean => {
  try {
    const [s, h] = stored.split(':');
    const newHash = crypto.scryptSync(password, s, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(h, 'hex'), Buffer.from(newHash, 'hex'));
  } catch (_e) {
    return false;
  }
};

export const signAdminJwt = (payload: { sub: string; username: string; role: string }) => jwt.sign(payload, config.auth.jwtSecret, { expiresIn: config.auth.adminJwtTtl as never });

export const verifyAdminJwt = (token: string): { sub: string; username: string; role: string } | null => {
  try {
    return jwt.verify(token, config.auth.jwtSecret) as any;
  } catch (_e) { return null; }
};

export const respondUnauthorized = (res: express.Response) => res
  .status(401)
  .json({ ok: false, error: 'Unauthorized' });

export const adminAuthMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const token = (req as any).cookies?.[config.auth.adminCookieName] || req.headers['x-admin-token'];
  if (!token || typeof token !== 'string') return respondUnauthorized(res);
  const payload = verifyAdminJwt(token);
  if (!payload) return respondUnauthorized(res);
  (req as any).admin = payload;
  next();
};
