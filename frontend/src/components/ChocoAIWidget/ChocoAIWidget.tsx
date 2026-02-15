/* eslint-disable no-console */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { button } from '@heroui/react';
import { ChatContainer } from '../../pages/ConversationsPage/components';
import classNames from '../../helpers/classNames';
import { WidgetMessage, WidgetConfig, StreamTokenEvent, StreamDoneEvent } from './types';

export interface ChocoAIWidgetProps {
  config: WidgetConfig;
  previewMode?: boolean;
}

export const ChocoAIWidget: React.FC<ChocoAIWidgetProps> = ({ config, previewMode }) => {
  const [isOpen, setIsOpen] = useState(!!previewMode);
  const [isConnecting, setIsConnecting] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<WidgetMessage[]>([
    {
      id: 'welcome',
      content: 'Hello! I\'m your ChocoAI assistant. How can I help you today?',
      role: 'assistant',
      createdAt: new Date(),
    },
  ]);

  const streamSourceRef = useRef<EventSource | null>(null);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    // @ts-ignore
    window.ChocoAI = {
      open: () => setIsOpen(true),
      close: () => setIsOpen(false),
      toggle: () => setIsOpen((prev) => !prev),
      isOpen: () => {
        let open = isOpen;
        setIsOpen((prev) => {
          open = prev;
          return prev;
        });
        return open;
      },
    };
  }, []);

  useEffect(() => {
    const checkMobile = () => {
      const isMobileDevice = window.innerWidth < 768 || window.innerHeight < 650;
      setIsMobile(isMobileDevice);

      if (!widgetContainerRef.current) return;

      if (isMobileDevice) {
        const viewportHeight = window.visualViewport?.height || window.innerHeight;
        widgetContainerRef.current.style.height = `${viewportHeight}px`;
      } else widgetContainerRef.current.style.removeProperty('height');
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.visualViewport?.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.visualViewport?.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  const handleClose = useCallback(() => {
    if (!previewMode) {
      setIsOpen(false);
    }
  }, [previewMode]);

  const handleToggle = useCallback(() => {
    if (!previewMode) setIsOpen((prev) => !prev);
  }, [previewMode]);

  // Cleanup EventSource connection when component unmounts
  useEffect(() => () => {
    if (streamSourceRef.current) {
      try {
        if (streamSourceRef.current.readyState !== EventSource.CLOSED) {
          streamSourceRef.current.close();
        }
      } catch {
        // Ignore errors when closing
      }
      streamSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    const abortController = new AbortController();

    if (isOpen) {
      widgetContainerRef.current?.querySelector('textarea')?.focus();

      const escapeHandler = (e: KeyboardEvent) => {
        if (e.key === 'Escape') handleClose();
      };
      widgetContainerRef.current?.addEventListener('keydown', escapeHandler, { signal: abortController.signal });
      document.addEventListener('keydown', escapeHandler, { signal: abortController.signal });
    }

    return () => abortController.abort();
  }, [isOpen, handleClose]);

  const streamWithSSE = useCallback((message: string): Promise<StreamDoneEvent> => new Promise((resolve, reject) => {
    // Close existing stream if any
    if (streamSourceRef.current) {
      try {
        if (streamSourceRef.current.readyState !== EventSource.CLOSED) {
          streamSourceRef.current.close();
        }
      } catch {
        // Ignore errors when closing
      }
      streamSourceRef.current = null;
    }

    // Build streaming URL
    const url = new URL(`${config.rootUrl}/api/v1/agent/chat-stream`);
    url.searchParams.set('message', message);
    if (conversationId) {
      url.searchParams.set('conversationId', conversationId);
    }
    url.searchParams.set('channel', 'web');

    const source = new EventSource(url.toString());
    streamSourceRef.current = source;

    let buffer = '';
    let streamingMessageId: string | null = null;
    let isResolved = false;
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;

      // Only cleanup if this is still the active source
      if (streamSourceRef.current !== source) {
        return; // Another source has replaced this one
      }

      // Remove all listeners before closing to prevent "message channel closed" errors
      try {
        source.removeEventListener('token', tokenHandler);
        source.removeEventListener('done', doneHandler);
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

      // Only clear if this is still the active source
      if (streamSourceRef.current === source) {
        streamSourceRef.current = null;
      }
    };

    const tokenHandler = (event: MessageEvent) => {
      if (isResolved || isCleanedUp) return;

      try {
        const data: StreamTokenEvent = JSON.parse(event.data);

        // Check again after parsing to ensure we haven't been cleaned up
        if (isCleanedUp || isResolved) return;

        // Create streaming message on first token
        if (!streamingMessageId) {
          streamingMessageId = `streaming-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          if (isCleanedUp || isResolved) return;
          setMessages((prev) => [
            ...prev,
            {
              id: streamingMessageId!,
              content: '',
              role: 'assistant',
              createdAt: new Date(),
            },
          ]);
        }

        // Update message content
        if (data.textChunk && !isCleanedUp && !isResolved) {
          buffer += data.textChunk;
          setMessages((prev) => prev.map((msg) =>
            msg.id === streamingMessageId
              ? { ...msg, content: buffer }
              : msg,
          ));
        }
      } catch (error) {
        console.error('Error parsing token data:', error);
      }
    };

    const doneHandler = (event: MessageEvent) => {
      if (isResolved || isCleanedUp) return;
      isResolved = true;

      try {
        const data: StreamDoneEvent = JSON.parse(event.data);

        // Check again after parsing to ensure we haven't been cleaned up
        if (isCleanedUp) {
          cleanup();
          return;
        }

        // Update conversation ID if provided
        if (data.conversationId && !isCleanedUp) {
          setConversationId(data.conversationId);
        }

        // Update final message content
        if (data.finalText && streamingMessageId && !isCleanedUp) {
          setMessages((prev) => prev.map((msg) =>
            msg.id === streamingMessageId
              ? { ...msg, content: data.finalText || msg.content }
              : msg,
          ));
        }

        cleanup();
        resolve(data);
      } catch (error) {
        cleanup();
        reject(error);
      }
    };

    source.addEventListener('token', tokenHandler);
    source.addEventListener('done', doneHandler);

    source.onerror = (err) => {
      if (isResolved || isCleanedUp) return;
      cleanup();
      reject(err);
    };
  }), [config.rootUrl, conversationId]);

  const sendMessage = useCallback(async (message: string) => {
    if (!message.trim()) return;

    setIsConnecting(true);
    try {
      const userMessage: WidgetMessage = {
        id: `user-${Date.now()}`,
        content: message,
        role: 'user',
        createdAt: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      await streamWithSSE(message);
    } finally {
      setIsConnecting(false);
    }
  }, [streamWithSSE]);

  // Basic widget UI (keep existing styling by reusing shared ChatContainer)
  const WidgetButton = (
    <button
      type="button"
      data-widget-button
      aria-label="Open ChocoAI chat"
      aria-expanded={isOpen}
      onClick={handleToggle}
      className={classNames(
        'fixed bottom-5 right-5 z-[9999] flex h-14 w-14 items-center justify-center rounded-full shadow-lg',
        'bg-[#882DD7] text-white',
      )}
    >
      <span className="sr-only">Open chat</span>
      <span className="text-lg font-bold">C</span>
    </button>
  );

  const titleId = 'choco-widget-title-text';

  return (
    <>
      {!config.noWidgetButton && !previewMode ? WidgetButton : null}

      <div
        ref={widgetContainerRef}
        className={classNames(
          'fixed z-[9999] flex flex-col bg-white shadow-xl border border-gray-200',
          isMobile ? 'inset-0 rounded-none' : 'bottom-5 right-5 w-[380px] h-[560px] rounded-2xl',
          isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
          'transition-opacity duration-150',
        )}
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <span id={titleId} className={`font-semibold ${isMobile ? 'text-sm' : 'text-base'}`}>
            ChocoAI Assistant
          </span>
          <button
            type="button"
            className={button({ isIconOnly: true, variant: 'light', size: 'sm' })}
            onClick={handleClose}
            aria-label="Close"
          >
            <XMarkIcon className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          <ChatContainer
            messages={messages}
            onSend={sendMessage}
            isTyping={isConnecting}
            isSendingDisabled={isConnecting}
          />
        </div>
      </div>
    </>
  );
};

