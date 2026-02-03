import React, { useEffect, useState } from 'react';
import { useTranslations } from 'use-intl';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import slugify from 'slug';
import {
  Button, Input,
  Modal, ModalBody,
  ModalContent, ModalFooter,
  ModalHeader, Textarea,
} from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { useMainLayout } from '../../../../layouts/MainLayout';
import { flowStore } from '../../../../stores/flowStore';

type CreateFlowModalProps = {
  isOpen: boolean;
  onClose: () => void;
}

export const CreateFlowModal: React.FC<CreateFlowModalProps> = observer(({ isOpen, onClose }) => {
  const t = useTranslations('SettingsPage');
  const tCommon = useTranslations('Common');

  useMainLayout({ title: t('flows') });

  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');

  const [error, setError] = useState<string>();

  useEffect(() => () => {
    setName('');
    setSlug('');
    setDescription('');

    setError(undefined);
  }, [isOpen]);

  const createFlow = async () => {
    flowStore.create({ name, slug: slug || slugify(name), description })
      .then((res) => {
        navigate(`/settings/flows/${res.flow.id}`);
        void queryClient.invalidateQueries({ queryKey: ['flows', 'list'] });
      })
      .catch((err) => setError(err?.error || t('failedToCreateFlow')));
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={onClose} placement="center">
      <ModalContent>
        <ModalHeader className="text-medium font-semibold">{t('createFlow')}</ModalHeader>
        <ModalBody className="gap-3">
          <Input label={t('name')} value={name} onValueChange={setName} autoFocus />
          <Input
            label={t('slug')}
            value={slug}
            placeholder={!slug && name ? slugify(name) : undefined}
            onValueChange={setSlug}
          />
          <Textarea label={t('description')} value={description} onValueChange={setDescription} minRows={3} />

          {error && <p className="text-danger text-sm">{error}</p>}
        </ModalBody>
        <ModalFooter>
          <Button
            variant="flat"
            onPress={onClose}
            isDisabled={flowStore.isCreationPending}
          >
            {tCommon('cancel')}
          </Button>
          <Button
            color="primary"
            onPress={createFlow}
            isDisabled={!name || !description}
            isLoading={flowStore.isCreationPending}
          >
            {tCommon('create')}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
});
