import React, { useState } from 'react';
import { useTranslations } from 'use-intl';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from '@heroui/react';
import dialogsStore from './dialogsStore';

export type DialogBaseProps = React.PropsWithChildren & {
  id: string;
  title?: string;
  message: string;
  onOk: () => void;
  onCancel?: () => void;
  okButtonLabel?: string;
  cancelButtonLabel?: string;
}

export const DialogBase: React.FC<DialogBaseProps> = ({
  id,
  title,
  message,
  onOk,
  onCancel,
  okButtonLabel,
  cancelButtonLabel,
}) => {
  const t = useTranslations('Common');

  const [isOpen, setIsOpen] = useState(true);

  const close = () => {
    setIsOpen(false);
    setTimeout(() => dialogsStore.remove(id), 500);
  };
  const okHandler = () => {
    onOk();
    close();
  };
  const cancelHandler = () => {
    if (onCancel) onCancel();
    else onOk();

    close();
  };

  return (
    <Modal isOpen={isOpen} onClose={cancelHandler} backdrop="blur" placement="center">
      <ModalContent>
        <ModalHeader>{title || import.meta.env.VITE_APP_NAME}</ModalHeader>
        <ModalBody>{message}</ModalBody>
        <ModalFooter>
          {typeof onCancel === 'function' && (
            <Button color="default" variant="flat" onPress={cancelHandler}>
              {cancelButtonLabel || t('cancel')}
            </Button>
          )}
          <Button color="primary" onPress={okHandler}>
            {okButtonLabel || (typeof onCancel === 'function' ? t('confirm') : t('ok'))}
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

DialogBase.displayName = 'DialogBase';
