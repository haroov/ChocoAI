import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import {
  Avatar,
  Dropdown,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
} from '@heroui/react';
import { DropdownItem, DropdownMenu, DropdownTrigger } from '@heroui/dropdown';
import { ArrowLeftStartOnRectangleIcon, InformationCircleIcon } from '@heroicons/react/24/outline';
import { apiClientStore } from '../../../stores/apiClientStore';
import { app } from '../../../helpers/app';

export const UserMenu: React.FC = observer(() => {
  const [isAboutModalOpen, setIsAboutModalOpen] = React.useState(false);

  const t = useTranslations('MainLayout');

  return (
    <>
      <Dropdown>
        <DropdownTrigger>
          <Avatar
            className="cursor-pointer"
            isBordered
            as="button"
            name="Admin"
            color="primary"
            size="sm"
          />
        </DropdownTrigger>

        <DropdownMenu>
          <DropdownItem
            key="app-info"
            onClick={() => setIsAboutModalOpen(true)}
            startContent={<InformationCircleIcon className="size-5" />}
            showDivider
          >
            {t('about')}
          </DropdownItem>
          <DropdownItem
            key="logout"
            onClick={() => apiClientStore.logout()}
            startContent={<ArrowLeftStartOnRectangleIcon className="size-5" />}
          >
            {t('logout')}
          </DropdownItem>
        </DropdownMenu>
      </Dropdown>

      <Modal isOpen={isAboutModalOpen} onOpenChange={() => setIsAboutModalOpen(false)}>
        <ModalContent>
          <ModalHeader className="flex flex-col gap-1">{t('about')}</ModalHeader>
          <ModalBody>
            {t('version', { version: app.version })}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
});
