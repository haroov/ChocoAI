import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Card,
  CardBody,
  CircularProgress,
} from '@heroui/react';
import { useTranslations } from 'use-intl';
import { useNavigate } from 'react-router-dom';
import { apiClientStore } from '../../../../stores/apiClientStore';
import { app } from '../../../../helpers/app';

type ImportTemplateModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export const ImportTemplateModal: React.FC<ImportTemplateModalProps> = ({ isOpen, onClose }) => {
  const tCommon = useTranslations('Common');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [selectedTemplate, setSelectedTemplate] = useState<string | null>(null);

  const { data: templatesData, isLoading } = useQuery({
    queryKey: ['flows', 'templates'],
    queryFn: async () => {
      const resp = await apiClientStore.fetch('/api/v1/flows/templates');
      const res = await resp.json();
      if (!res.ok) throw res;
      return res.templates as Array<{ name: string; slug: string; description: string }>;
    },
    enabled: isOpen,
  });

  const importMutation = useMutation({
    mutationFn: async (templateSlug: string) => {
      const resp = await apiClientStore.fetch('/api/v1/flows/import-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateSlug }),
      });
      const res = await resp.json();
      if (!res.ok) throw res;
      return res.flow as { id: string };
    },
    onSuccess: async (flow) => {
      await queryClient.invalidateQueries({ queryKey: ['flows', 'list'] });
      app.notification.success('Template imported successfully');
      onClose();
      navigate(`/settings/flows/${flow.id}`);
    },
    onError: (error) => {
      // @ts-ignore
      app.notification.error(error?.error || error?.message || 'Failed to import template');
    },
  });

  const templates = templatesData || [];

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl">
      <ModalContent>
        <ModalHeader>Import Flow Template</ModalHeader>
        <ModalBody>
          {isLoading && (
            <div className="flex justify-center py-8">
              <CircularProgress aria-label="Loading templates..." />
            </div>
          )}
          {!isLoading && templates.length === 0 && (
            <div className="text-center py-8 text-default-500">No templates available</div>
          )}
          {!isLoading && templates.length > 0 && (
            <div className="flex flex-col gap-3">
              {templates.map((template) => (
                <Card
                  key={template.slug}
                  className={`cursor-pointer border-2 ${
                    selectedTemplate === template.slug
                      ? 'border-primary'
                      : 'border-default-200'
                  }`}
                  onPress={() => setSelectedTemplate(template.slug)}
                >
                  <CardBody>
                    <div className="font-semibold">{template.name}</div>
                    <div className="text-sm text-default-500">{template.description}</div>
                    <div className="text-xs text-default-400 mt-1">
                      #
                      {template.slug}
                    </div>
                  </CardBody>
                </Card>
              ))}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <Button variant="flat" onPress={onClose}>
            {tCommon('cancel')}
          </Button>
          <Button
            color="primary"
            onPress={() => {
              if (selectedTemplate) {
                importMutation.mutate(selectedTemplate);
              }
            }}
            isDisabled={!selectedTemplate || importMutation.isPending}
            isLoading={importMutation.isPending}
          >
            Import
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};
