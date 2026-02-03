import React, { useCallback, useState } from 'react';
import {
  Button,
  Textarea,
} from '@heroui/react';
import {
  ArrowUpTrayIcon,
  MicrophoneIcon,
  PaperAirplaneIcon,
} from '@heroicons/react/24/outline';
import { useTranslations } from 'use-intl';
import { containsRTL } from '../../../helpers/containsRTL';

export interface ChatInputProps {
  onSend: (text: string) => void | Promise<void>;
  isSendingDisabled?: boolean;
  placeholder?: string;
}

export const ChatInput: React.FC<ChatInputProps> = ({
  onSend,
  isSendingDisabled = false,
  placeholder,
}) => {
  const t = useTranslations('ConversationsPage');
  const [input, setInput] = useState('');

  const send = useCallback(async () => {
    if (isSendingDisabled) return;

    const text = input.trim();
    if (!text) return;
    setInput('');
    await onSend(text);
  }, [input, onSend, isSendingDisabled]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  return (
    <div className="px-4 py-3" dir="ltr">
      <form
        onSubmit={(e) => { e.preventDefault(); void send(); }}
        className="flex items-end gap-3"
      >
        <Textarea
          value={input}
          onValueChange={setInput}
          placeholder={placeholder || `${t('typeAMessage')}...`}
          minRows={1}
          maxRows={8}
          dir={containsRTL(input) ? 'rtl' : 'ltr'}
          radius="full"
          color="primary"
          onKeyDown={onKeyDown}
          classNames={{
            inputWrapper: [
              'fixed-shadow shadow-primary-100 border-[1px]',
              'data-[hover=true]:border-[1px] data-[hover=true]:border-default-200',
              'group-data-[focus=true]:border-[1px]',
            ].join(' '),
            input: 'text-[16px]',
            innerWrapper: 'items-center',
          }}
          variant="bordered"
          startContent={(
            <Button
              size="sm"
              radius="full"
              color="default"
              type="button"
              variant="light"
              isIconOnly
              isDisabled={isSendingDisabled}
              onPress={() => input.trim() ? send() : null}
            >
              <ArrowUpTrayIcon className="size-5" />
            </Button>
          )}
          endContent={(
            <Button
              size="sm"
              radius="full"
              color="primary"
              type={input.trim() ? 'submit' : 'button'}
              variant={input.trim() ? undefined : 'light'}
              isIconOnly
              isDisabled={isSendingDisabled}
              onPress={() => input.trim() ? send() : null}
            >
              {input.trim() ? <PaperAirplaneIcon className="size-4" /> : <MicrophoneIcon className="size-5" />}
            </Button>
          )}
        />
      </form>
    </div>
  );
};

ChatInput.displayName = 'ChatInput';
