export interface SessionData {
  id: string;
  channel: ChatChannel;
  createdAt: number;
  lastActivity: number;
  messageCount: number;
  metadata: {
    ip?: string;
    userAgent?: string;
    [key: string]: any;
  };
}

export interface SessionStore {
  get(sessionId: string): Promise<SessionData | null>;
  set(sessionId: string, data: SessionData): Promise<void>;
  delete(sessionId: string): Promise<void>;
  cleanup(): Promise<void>;
}

export type ChatChannel = 'web' | 'whatsapp';

export interface RequestContext {
  requestId: string;
  sessionId: string;
  channel: ChatChannel;
  ip: string;
  userAgent?: string;
  timestamp: number;
}
