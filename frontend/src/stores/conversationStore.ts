import { makeAutoObservable, runInAction } from 'mobx';
import { Message } from '../pages/ConversationsPage/queries/useConversation';

class ConversationStore {
  messages: {
    [conversationId: string]: Message[];
  };
  errors: {
    [conversationId: string]: string;
  };
  activeConnections: {
    [conversationId: string]: EventSource | null;
  };

  constructor() {
    this.messages = {};
    this.errors = {};
    this.activeConnections = {};

    makeAutoObservable(this);
  }

  sendMessage(conversationId: string, message: string) {
    return new Promise((resolve, reject) => {
      const idleTimeoutMs = 45_000;
      // Close any existing connection for this conversation
      if (this.activeConnections[conversationId]) {
        try {
          this.activeConnections[conversationId]?.close();
        } catch {
          // Ignore errors when closing
        }
        this.activeConnections[conversationId] = null;
      }

      const url = new URL('/api/v1/agent/chat-stream', window.location.origin);
      url.searchParams.set('message', message);
      url.searchParams.set('conversationId', conversationId);

      const source = new EventSource(url.toString());
      this.activeConnections[conversationId] = source;

      // Track if we've resolved/rejected to prevent multiple calls
      let isResolved = false;
      let isCleanedUp = false;
      let idleTimer: ReturnType<typeof setTimeout> | null = null;

      const armIdleTimer = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (isResolved || isCleanedUp) return;
          isResolved = true;
          runInAction(() => {
            this.errors[conversationId] = 'Stream timed out waiting for a response';
          });
          cleanup();
          // Soft-resolve: allow UI to refresh conversation via polling without showing a hard error.
          resolve({ conversationId, finalText: '', timedOut: true });
        }, idleTimeoutMs);
      };

      this.messages[conversationId] = [{
        id: crypto.randomUUID(),
        content: message,
        role: 'user',
        createdAt: new Date(),
      }];

      const cleanup = () => {
        if (isCleanedUp) return;
        isCleanedUp = true;

        if (idleTimer) {
          clearTimeout(idleTimer);
          idleTimer = null;
        }

        // Only cleanup if this is still the active connection
        if (this.activeConnections[conversationId] !== source) {
          return; // Another connection has replaced this one
        }

        // Remove all listeners before closing to prevent "message channel closed" errors
        try {
          source.removeEventListener('token', tokenHandler);
          source.removeEventListener('done', doneHandler);
          source.removeEventListener('debug', debugHandler);
          source.removeEventListener('ping', pingHandler);
        } catch {
          // Ignore errors removing listeners
        }

        try {
          if (source.readyState !== EventSource.CLOSED && source.readyState !== EventSource.CONNECTING) {
            source.close();
          }
        } catch {
          // Ignore errors when closing
        }

        // Only clear if this is still the active connection
        if (this.activeConnections[conversationId] === source) {
          this.activeConnections[conversationId] = null;
        }
      };

      const pingHandler = () => {
        if (isResolved || isCleanedUp) return;
        armIdleTimer();
      };

      const tokenHandler = (event: MessageEvent) => {
        if (isResolved || isCleanedUp) return;
        armIdleTimer();

        try {
          const data = JSON.parse(event.data);

          // Check again after parsing to ensure we haven't been cleaned up
          if (isCleanedUp || isResolved) return;

          runInAction(() => {
            // Final check inside action to prevent race conditions
            if (isCleanedUp || isResolved) return;
            if (this.messages[conversationId].length === 1) {
              this.messages[conversationId].push({
                id: crypto.randomUUID(),
                content: data.textChunk,
                role: 'assistant',
                createdAt: new Date(),
              });
            } else if (this.messages[conversationId].length > 1) {
              this.messages[conversationId][1] = {
                ...this.messages[conversationId][1],
                content: this.messages[conversationId][1].content + data.textChunk,
              };
            }
          });
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Error parsing token event:', e);
        }
      };

      const doneHandler = (event: MessageEvent) => {
        if (isResolved || isCleanedUp) return;
        isResolved = true;

        try {
          const data = JSON.parse(event.data);

          // Check again after parsing to ensure we haven't been cleaned up
          if (isCleanedUp) {
            cleanup();
            return;
          }

          runInAction(() => {
            // Final check inside action to prevent race conditions
            if (isCleanedUp) return;
            if (this.messages[conversationId].length > 1) {
              this.messages[conversationId][1].content = data.finalText;
            }
          });

          cleanup();
          resolve(data);
        } catch {
          cleanup();
          reject(new Error('Failed to parse done event'));
        }
      };

      const debugHandler = (event: MessageEvent) => {
        if (isCleanedUp) return;
        armIdleTimer();
        try {
          const data = JSON.parse(event.data);
          const { level, message, data: debugData, timestamp } = data;

          // Log to browser console with appropriate level
          const logMessage = `[${timestamp}] ${message}`;
          if (debugData) {
            if (level === 'error') {
              // eslint-disable-next-line no-console
              console.error(logMessage, debugData);
            } else if (level === 'warn') {
              // eslint-disable-next-line no-console
              console.warn(logMessage, debugData);
            } else {
              // eslint-disable-next-line no-console
              console.log(logMessage, debugData);
            }
          } else {
            if (level === 'error') {
              // eslint-disable-next-line no-console
              console.error(logMessage);
            } else if (level === 'warn') {
              // eslint-disable-next-line no-console
              console.warn(logMessage);
            } else {
              // eslint-disable-next-line no-console
              console.log(logMessage);
            }
          }
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('Error parsing debug event:', e);
        }
      };

      source.addEventListener('token', tokenHandler);
      source.addEventListener('done', doneHandler);
      source.addEventListener('debug', debugHandler);
      source.addEventListener('ping', pingHandler);

      // Use only onerror to avoid duplicate handlers
      // The 'error' event listener can conflict with onerror
      // Remove event listeners before closing to prevent "message channel closed" errors
      const errorHandler = () => {
        // Only handle if not already resolved
        if (isResolved || isCleanedUp) return;

        // Check connection state before handling
        if (source.readyState === EventSource.CLOSED) {
          // Already closed, don't handle
          return;
        }

        isResolved = true;
        runInAction(() => {
          this.errors[conversationId] = 'Connection failed';
        });
        // Remove all listeners before cleanup to prevent channel errors
        try {
          source.removeEventListener('token', tokenHandler);
          source.removeEventListener('done', doneHandler);
          source.removeEventListener('debug', debugHandler);
          source.removeEventListener('ping', pingHandler);
        } catch {
          // Ignore errors removing listeners
        }
        cleanup();
        reject(new Error('Connection failed'));
      };

      // Arm the idle timer immediately, and re-arm on open/events.
      // This prevents the UI from staying in "typing" forever if SSE stalls silently.
      armIdleTimer();
      source.onopen = () => {
        if (isResolved || isCleanedUp) return;
        armIdleTimer();
      };
      source.onerror = errorHandler;
    });
  }

  cancelMessage(conversationId: string) {
    if (this.activeConnections[conversationId]) {
      try {
        this.activeConnections[conversationId]?.close();
      } catch {
        // Ignore errors when closing
      }
      this.activeConnections[conversationId] = null;
    }
  }

  resetMessages(conversationId: string) {
    this.messages[conversationId] = [];
  }
}

export const conversationStore = new ConversationStore();
