import React, { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button, Input, Skeleton } from '@heroui/react';
import {
  ChatBubbleOvalLeftEllipsisIcon,
  ExclamationTriangleIcon, GlobeAltIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
} from '@heroicons/react/24/outline';
import { Link } from '@heroui/link';
import moment from 'moment';
import { useNavigate, useParams } from 'react-router-dom';
import classNames from '../../helpers/classNames';
import { InfinityScroll } from '../../components/InfinityScroll';
import { app } from '../../helpers/app';
import { apiClientStore } from '../../stores/apiClientStore';
import { useConversations } from './queries/useConversations';
import { ConversationChat } from './ConversationChat';
import { getConversationTitle } from './helpers/getConversationTitle';

const getChatIconOrSymbol = ({ channel }: { channel: string }) => {
  if (channel === 'web') return <GlobeAltIcon className="size-6" />;
  if (channel === 'whatsapp') return <img src="/assets/whatsapp-logo.svg" alt="WhatsApp Logo" className="size-8" />;
  return channel.slice(0, 2).toUpperCase();
};

export const ConversationList: React.FC = () => {
  const t = useTranslations('ConversationsPage');
  const tCommon = useTranslations('Common');

  const { conversationId } = useParams();
  const navigate = useNavigate();

  const [limit, setLimit] = useState(50);

  const { isPending, isError, refetch, data, invalidateQueries } = useConversations(limit);

  const createNewConversation = () => {
    app.preloader.show();
    apiClientStore.fetch('/api/v1/conversations/new', { method: 'POST' })
      .then((res) => res.json())
      .then((res) => {
        if (!res.ok) throw res;
        navigate(`/conversations/${res.conversation.id}`);
        void invalidateQueries();
      })
      .catch((err) => {
        app.notification.error(err.error || err.message || t('failedToCreateConversation'));
      })
      .finally(() => app.preloader.hide());
  };

  return (
    <div className="h-full flex">
      <aside className="w-96 bg-default-50 border-r border-default-200 h-full overflow-auto flex-shrink-0">
        <header className="px-2 py-2 flex gap-2 sticky top-0 bg-default-50 z-10">
          <Input
            classNames={{
              inputWrapper: 'border border-neutral',
            }}
            startContent={<MagnifyingGlassIcon className="size-4" />}
            size="sm"
            placeholder={tCommon('search')}
          />
          <Button
            className="flex-shrink-0"
            startContent={<PencilSquareIcon className="size-4" />}
            color="primary"
            size="sm"
            onPress={createNewConversation}
          >
            {t('new')}
          </Button>
        </header>

        <div className="pt-2">
          <InfinityScroll
            loading={isPending}
            canLoadMore={Array.isArray(data) && limit <= data.length}
            onLoadMore={() => setLimit((prev) => prev + 30)}
            preloader={(
              <article className="flex gap-2 p-2">
                <Skeleton className="w-10 h-10 rounded-lg" />
                <div className="flex-1 flex flex-col">
                  <div className="flex gap-6 mb-2">
                    <Skeleton className="flex-1 h-3 rounded-md" />
                    <Skeleton className="w-12 h-3 rounded-md" />
                  </div>
                  <Skeleton className="w-full h-2 rounded-md mb-1" />
                  <Skeleton className="w-full h-2 rounded-md" />
                </div>
              </article>
            )}
          >
            {Array.isArray(data) && data.length > 0 && data.map((conversation) => (
              <Link
                key={conversation.id}
                className={classNames(
                  'flex gap-2 p-2 items-start',
                  conversation.id === conversationId ? 'bg-active border-l-2 border-primary' : 'hover:bg-hover',
                )}
                href={`/conversations/${conversation.id}`}
              >
                <span className="size-10 rounded-full bg-[#882DD7]/10 flex justify-center items-center text-[#882DD7]">
                  {getChatIconOrSymbol(conversation)}
                </span>
                <div className="flex-1 flex flex-col">
                  <div className="flex gap-6 mb-0.5">
                    <span className="flex-1 text-title">
                      {getConversationTitle(conversation)}
                    </span>
                    <span className="w-12 h-3 text-xs text-label/80 whitespace-nowrap text-right">
                      {moment(conversation.updatedAt).isSame(moment(), 'day')
                        ? moment(conversation.updatedAt).format('h:mm A')
                        : moment(conversation.updatedAt).format('MMM D')}
                    </span>
                  </div>
                  <p className="text-sm text-label/70 whitespace-pre-wrap line-clamp-1">
                    {conversation.messages[0]?.content || t('noMessagesYet')}
                  </p>
                </div>
              </Link>
            ))}

            {Array.isArray(data) && data.length === 0 && (
              <div className="flex flex-col items-center justify-center py-4">
                <ChatBubbleOvalLeftEllipsisIcon className="size-12 text-label/60" />
                <span className="text-lg text-label">
                  {t('noConversationsYet')}
                </span>
              </div>
            )}

            {(isError || (!Array.isArray(data) && !isPending)) && (
              <div className="flex flex-col items-center justify-center py-4">
                <ExclamationTriangleIcon className="size-12 text-danger" />
                <span className="text-danger text-lg">
                  {t('failedToLoadConversations')}
                </span>
                <Button
                  className="mt-4"
                  color="primary"
                  onPress={() => refetch()}
                  size="sm"
                >
                  {tCommon('tryAgain')}
                </Button>
              </div>
            )}
          </InfinityScroll>
        </div>
      </aside>

      <div className="w-full h-full">
        {conversationId ? (
          <ConversationChat key={conversationId} conversationId={conversationId} />
        ) : (
          <span className="block text-center py-12 text-label/80">
            {t('selectConversation')}
          </span>
        )}
      </div>
    </div>
  );
};
