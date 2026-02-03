/**
 * Session Management for Choco AI Agent
 * Handles session storage, rate limiting, and cleanup
 */

import { logger } from '../../../utils/logger';
import {
  SessionData,
  SessionStore,
  ChatChannel,
  RequestContext,
} from './types';

// ============================================================================
// In-Memory Session Store (for development)
// ============================================================================

export class InMemorySessionStore implements SessionStore {
  private sessions: Map<string, SessionData> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private ttl: number = 30 * 60 * 1000) { // 30 minutes default
    // Cleanup expired sessions every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 5 * 60 * 1000);
  }

  async get(sessionId: string): Promise<SessionData | null> {
    const session = this.sessions.get(sessionId);

    if (!session) {
      return null;
    }

    // Check if session is expired
    if (Date.now() - session.lastActivity > this.ttl) {
      this.sessions.delete(sessionId);
      return null;
    }

    return session;
  }

  async set(sessionId: string, data: SessionData): Promise<void> {
    this.sessions.set(sessionId, data);
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  async cleanup(): Promise<void> {
    const now = Date.now();
    const expiredSessions: string[] = [];

    this.sessions.forEach((session, sessionId) => {
      if (now - session.lastActivity > this.ttl) {
        expiredSessions.push(sessionId);
      }
    });

    for (const sessionId of expiredSessions) {
      this.sessions.delete(sessionId);
    }

    if (expiredSessions.length > 0) {
      logger.info(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.sessions.clear();
  }

  // Additional utility methods
  getSessionCount(): number {
    return this.sessions.size;
  }

  getActiveSessions(): SessionData[] {
    const now = Date.now();
    return Array.from(this.sessions.values())
      .filter((session) => now - session.lastActivity <= this.ttl);
  }
}

// ============================================================================
// Session Manager
// ============================================================================

export class SessionManager {
  private store: SessionStore;

  constructor(
    store: SessionStore,
    private maxMessagesPerSession: number = 100,
    _sessionTtl: number = 30 * 60 * 1000, // 30 minutes
  ) {
    this.store = store;
  }

  async createSession(
    channel: ChatChannel,
    context: RequestContext,
    preferredId?: string,
  ): Promise<SessionData> {
    const sessionId = preferredId || crypto.randomUUID();
    const now = Date.now();

    const session: SessionData = {
      id: sessionId,
      channel,
      createdAt: now,
      lastActivity: now,
      messageCount: 0,
      metadata: {
        ip: context.ip,
        userAgent: context.userAgent || '',
        requestId: context.requestId,
      },
    };

    await this.store.set(sessionId, session);
    return session;
  }

  async saveSession(session: SessionData): Promise<void> {
    await this.store.set(session.id, session);
  }

  async getSession(sessionId: string): Promise<SessionData | null> {
    return await this.store.get(sessionId);
  }

  async updateSessionActivity(sessionId: string): Promise<SessionData | null> {
    const session = await this.store.get(sessionId);

    if (!session) {
      return null;
    }

    session.lastActivity = Date.now();
    session.messageCount++;

    await this.store.set(sessionId, session);
    return session;
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.store.delete(sessionId);
  }

  async updateSessionMetadata(sessionId: string, updates: Partial<SessionData['metadata']>): Promise<SessionData | null> {
    const session = await this.store.get(sessionId);
    if (!session) {
      return null;
    }
    session.metadata = {
      ...session.metadata,
      ...updates,
    };
    await this.store.set(sessionId, session);
    return session;
  }

  async isSessionValid(sessionId: string): Promise<boolean> {
    const session = await this.store.get(sessionId);
    return session !== null;
  }

  async canSendMessage(sessionId: string): Promise<{ allowed: boolean; reason?: string }> {
    const session = await this.store.get(sessionId);

    if (!session) {
      return { allowed: false, reason: 'Session not found' };
    }

    if (session.messageCount >= this.maxMessagesPerSession) {
      return { allowed: false, reason: 'Message limit exceeded' };
    }

    return { allowed: true };
  }

  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    averageMessagesPerSession: number;
  }> {
    // This would need to be implemented based on the specific store
    // For now, return mock data
    return {
      totalSessions: 0,
      activeSessions: 0,
      averageMessagesPerSession: 0,
    };
  }
}

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitRule {
  windowMs: number;
  maxRequests: number;
  keyGenerator: (context: RequestContext) => string;
}

export class RateLimiter {
  private requests: Map<string, number[]> = new Map();
  private cleanupInterval: NodeJS.Timeout;

  constructor(private rules: RateLimitRule[]) {
    // Cleanup old entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 1000);
  }

  async checkLimit(context: RequestContext): Promise<{
    allowed: boolean;
    remaining: number;
    resetTime: number;
    retryAfter?: number;
  }> {
    const now = Date.now();
    let allowed = true;
    let remaining = Infinity;
    let resetTime = now;
    let retryAfter: number | undefined;

    for (const rule of this.rules) {
      const key = rule.keyGenerator(context);
      const requests = this.requests.get(key) || [];

      // Remove old requests outside the window
      const windowStart = now - rule.windowMs;
      const recentRequests = requests.filter((timestamp) => timestamp > windowStart);

      if (recentRequests.length >= rule.maxRequests) {
        allowed = false;
        const oldestRequest = Math.min(...recentRequests);
        retryAfter = Math.ceil((oldestRequest + rule.windowMs - now) / 1000);
      }

      remaining = Math.min(remaining, rule.maxRequests - recentRequests.length);
      resetTime = Math.max(resetTime, recentRequests[0] + rule.windowMs || now);

      // Add current request
      recentRequests.push(now);
      this.requests.set(key, recentRequests);
    }

    return {
      allowed,
      remaining: Math.max(0, remaining),
      resetTime,
      ...(retryAfter && { retryAfter }),
    };
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = Math.max(...this.rules.map((rule) => rule.windowMs));

    this.requests.forEach((requests, key) => {
      const validRequests = requests.filter((timestamp) => now - timestamp <= maxAge);

      if (validRequests.length === 0) {
        this.requests.delete(key);
      } else {
        this.requests.set(key, validRequests);
      }
    });
  }

  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    this.requests.clear();
  }
}

// ============================================================================
// Default Rate Limiting Rules
// ============================================================================

export function createDefaultRateLimitRules(): RateLimitRule[] {
  return [
    // Global rate limit: 100 requests per minute per IP
    {
      windowMs: 60 * 1000,
      maxRequests: 100,
      keyGenerator: (context) => `global:${context.ip}`,
    },

    // Per-session rate limit: 20 requests per minute per session
    {
      windowMs: 60 * 1000,
      maxRequests: 20,
      keyGenerator: (context) => `session:${context.sessionId}`,
    },

    // Burst protection: 5 requests per 10 seconds per IP
    {
      windowMs: 10 * 1000,
      maxRequests: 5,
      keyGenerator: (context) => `burst:${context.ip}`,
    },
  ];
}
