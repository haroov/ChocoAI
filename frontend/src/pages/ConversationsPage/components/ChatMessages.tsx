import React, { useEffect, useMemo, useRef } from 'react';
import {
  Avatar,
  Card,
  CardBody,
  ScrollShadow,
} from '@heroui/react';
import Markdown from 'markdown-to-jsx';
import moment from 'moment/moment';
import classNames from '../../../helpers/classNames';
import { containsRTL } from '../../../helpers/containsRTL';
import { Message } from '../queries/useConversation';

export interface ChatMessagesProps {
  messages: Message[];
  isTyping?: boolean;
}

const isNearBottom = (el: HTMLElement | null, threshold = 80) => {
  if (!el) return true;
  const delta = el.scrollHeight - el.scrollTop - el.clientHeight;
  return delta < threshold;
};

export const ChatMessages: React.FC<ChatMessagesProps> = ({
  messages,
  isTyping,
}) => {
  const listRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const stickyToBottomRef = useRef(true);

  const messagesWithDates = useMemo(() => messages.map((m) => ({
    ...m,
    date: new Date(m.createdAt),
  })), [messages]);

  useEffect(() => {
    const el = listRef.current;
    if (!el) return () => null;

    const onScroll = () => {
      stickyToBottomRef.current = isNearBottom(el);
    };
    el.addEventListener('scroll', onScroll);
    return () => el.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (stickyToBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
  }, [messages.length]);

  return (
    <div className="flex-1 min-h-0" dir="ltr">
      <ScrollShadow ref={listRef} hideScrollBar className="h-full">
        <div className="px-4 py-4">
          {messagesWithDates.length === 0 && (
            <div className="text-center text-default-500 text-small py-20">
              No messages yet. Start the conversation.
            </div>
          )}

          {messagesWithDates.map((m) => (
            <div
              key={m.id}
              className={classNames('mb-3 flex items-end gap-2', m.role === 'user' ? 'justify-end' : 'justify-start')}
              role="listitem"
            >
              <div
                className={classNames(
                  'max-w-[80%] flex flex-col items-end',
                  m.role === 'user' ? 'items-end' : 'items-start',
                )}
                dir={containsRTL(m.content) ? 'rtl' : 'ltr'}
              >
                <Card
                  radius={m.role !== 'user' ? 'none' : undefined}
                  shadow={m.role !== 'user' ? 'none' : 'sm'}
                  className={classNames(
                    'px-3 py-2',
                    m.role === 'user'
                      ? 'bg-[#882DD7]/10 border border-[#882DD7]/15'
                      : 'border-l-2 border-primary',
                  )}
                >
                  <CardBody className="p-0">
                    <div className="whitespace-pre-wrap text-small text-foreground prose">
                      <Markdown>
                        {m.content}
                      </Markdown>
                    </div>

                    <span
                      className={classNames(
                        'mt-2 flex items-center gap-2 text-tiny text-default-400',
                        m.role === 'user' ? 'flex-row-reverse' : 'flex-row')
                      }
                      dir="ltr"
                    >
                      {moment(m.date).isSame(moment(), 'day')
                        ? moment(m.date).format('h:mm A')
                        : moment(m.date).format('MMM D h:mm A')}
                    </span>
                  </CardBody>
                </Card>
              </div>

              {m.role === 'user' && <Avatar size="sm" color="primary" showFallback />}
            </div>
          ))}

          {isTyping && (
            <div className="text-small text-default-600 flex items-center gap-2 mt-4">
              <span className="inline-flex gap-1">
                {Array.from(Array(3)).map((_, i) => (
                  <span
                    key={i}
                    className={classNames(
                      'w-1.5 h-1.5 rounded-full bg-default-400 animate-bounce',
                      i === 0 && '[animation-delay:-0.2s]',
                      i === 2 && '[animation-delay:0.2s]',
                    )}
                  />
                ))}
              </span>
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </ScrollShadow>
    </div>
  );
};

ChatMessages.displayName = 'ChatMessages';
