export interface WidgetMessage {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  createdAt: Date;
}

export interface WidgetConfig {
  rootUrl: string;
  position: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  noWidgetButton: boolean;
}

export interface WidgetState {
  isOpen: boolean;
  isConnecting: boolean;
  sessionId: string | null;
  conversationId: string | null;
  messages: WidgetMessage[];
  messageCount: number;
  lastActivity: number;
  conversationTitle: string;
}

export interface StreamTokenEvent {
  textChunk: string;
}

export interface StreamDoneEvent {
  conversationId?: string;
  finalText?: string;
  fields?: Record<string, unknown>;
  delta?: Record<string, unknown>;
  flowState?: string;
  metadata?: Record<string, unknown>;
}

export interface StreamErrorEvent {
  message: string;
}

