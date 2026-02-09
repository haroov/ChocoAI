export type WidgetRole = 'user' | 'assistant';

export type WidgetMessage = {
  id: string;
  content: string;
  role: WidgetRole;
  createdAt: Date;
};

export type WidgetConfig = {
  rootUrl: string;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  noWidgetButton?: boolean;
};

export type StreamTokenEvent = {
  type: 'token';
  textChunk?: string;
};

export type StreamDoneEvent = {
  type: 'done';
  conversationId?: string;
  finalText?: string;
};


