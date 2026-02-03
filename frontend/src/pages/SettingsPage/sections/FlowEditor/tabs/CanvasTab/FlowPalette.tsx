import React from 'react';
import { Button, Card, CardBody, CardHeader, Divider } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { flowStore } from '../../../../../../stores/flowStore';

export const FlowPalette: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  return (
    <Card shadow="sm" className="border border-default-200">
      <CardHeader className="text-small font-semibold">{t('palette')}</CardHeader>
      <Divider />
      <CardBody className="gap-2">
        <Button
          size="sm"
          variant="flat"
          color="primary"
          onPress={() => flowStore.addStage()}
        >
          {t('addStage')}
        </Button>

        {flowStore.editorState?.selectedStage ? (
          <>
            <Divider className="my-2" />
            <div className="grid grid-cols-2 gap-2">
              <Button
                size="sm"
                variant="flat"
                onPress={() => flowStore.setInitialStage(flowStore.editorState!.selectedStage!)}
              >
                {t('setInitial')}
              </Button>
              <Button
                size="sm"
                color="danger"
                variant="flat"
                onPress={() => {
                  flowStore.deleteStage(flowStore.editorState!.selectedStage!);
                  flowStore.selectStage(null);
                }}
              >
                {tCommon('delete')}
              </Button>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  );
});
