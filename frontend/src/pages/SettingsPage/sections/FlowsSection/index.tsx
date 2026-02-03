import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  CircularProgress, Tooltip,
} from '@heroui/react';
import { Link } from '@heroui/link';
import { useTranslations } from 'use-intl';
import { ArrowUpOnSquareIcon, ExclamationTriangleIcon, PencilSquareIcon, PlusIcon } from '@heroicons/react/24/outline';
import { TrashIcon } from '@heroicons/react/16/solid';
import { useMainLayout } from '../../../../layouts/MainLayout';
import { flowStore } from '../../../../stores/flowStore';
import { app } from '../../../../helpers/app';
import { SectionHeader } from '../../components/SectionHeader';
import { SectionContent } from '../../components/SectionContent';
import { CreateFlowModal } from './CreateFlowModal';
import { ImportTemplateModal } from './ImportTemplateModal';

export const FlowsSection: React.FC = () => {
  const t = useTranslations('SettingsPage');
  const tCommon = useTranslations('Common');

  useMainLayout({ title: t('flows') });

  const queryClient = useQueryClient();

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['flows', 'list'],
    queryFn: async () => flowStore.loadList(),
  });
  const flows = data || [];

  const [isCreateOpen, setCreateOpen] = useState(false);
  const [isImportOpen, setImportOpen] = useState(false);

  const deleteFlow = async (flowId: string) => {
    await app.dialog.confirm(tCommon('confirmAction'), tCommon('confirmDeletionMsg'));

    app.preloader.show();
    try {
      await flowStore.delete(flowId);
      await queryClient.invalidateQueries({ queryKey: ['flows', 'list'] });
    } catch (err) {
      let errorMessage: string;

      if (err instanceof Error) errorMessage = err.message;
      else if (err && typeof err === 'object' && 'error' in err) errorMessage = err.error as string;
      else if (err && typeof err === 'object' && 'message' in err) errorMessage = err.message as string;
      else errorMessage = t('failedToDeleteFlow');

      app.notification.error(errorMessage);
    } finally {
      app.preloader.hide();
    }

  };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title={t('flows')}
        actions={[
          {
            id: 'import-template',
            variant: 'flat',
            onPress: () => setImportOpen(true),
            children: 'Import Template',
          },
          {
            id: 'new-flow',
            color: 'primary',
            onPress: () => setCreateOpen(true),
            startContent: <PlusIcon className="size-4" />,
            children: t('newFlow'),
          },
        ]}
      />

      <SectionContent>
        {isLoading && (
          <div className="flex justify-center items-center h-full">
            <CircularProgress aria-label={`${tCommon('loading')}...`} />
          </div>
        )}

        {isError && (
          <div className="flex flex-col justify-center items-center h-full text-danger">
            <ExclamationTriangleIcon className="size-10" />
            <span>{t('failedToLoadFlows')}</span>
            <Button
              className="mt-4"
              color="primary"
              variant="flat"
              onPress={() => refetch()}
              size="sm"
            >
              {tCommon('tryAgain')}
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-4">
          {flows.map((f) => (
            <Card key={f.id} shadow="sm" className="border border-default-200 bg-default-50 w-96">
              <CardHeader className="flex items-center justify-between">
                <div>
                  <h5 className="text-lg line-clamp-1">{f.name}</h5>
                  <div className="text-tiny text-default-500 flex items-center">
                    {`#${f.slug}`}
                    <span className="inline-block w-1 h-1 mx-2 rounded-full bg-primary" />
                    {`v${f.version}`}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip content={tCommon('edit')}>
                    <Button
                      as={Link}
                      size="sm"
                      href={`/settings/flows/${f.id}`}
                      isIconOnly
                      variant="flat"
                    >
                      <PencilSquareIcon className="size-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={t('export')}>
                    <Button
                      size="sm"
                      isIconOnly
                      variant="flat"
                    >
                      <ArrowUpOnSquareIcon className="size-4" />
                    </Button>
                  </Tooltip>
                  <Tooltip content={tCommon('delete')}>
                    <Button
                      size="sm"
                      color="danger"
                      variant="flat"
                      onPress={() => deleteFlow(f.id).catch(() => null)}
                      isIconOnly
                    >
                      <TrashIcon className="size-4" />
                    </Button>
                  </Tooltip>
                </div>
              </CardHeader>
              <CardBody className="line-clamp-2 text-label text-sm">
                {f.description}
              </CardBody>
            </Card>
          ))}
        </div>
      </SectionContent>

      <CreateFlowModal isOpen={isCreateOpen} onClose={() => setCreateOpen(false)} />
      <ImportTemplateModal isOpen={isImportOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
};
