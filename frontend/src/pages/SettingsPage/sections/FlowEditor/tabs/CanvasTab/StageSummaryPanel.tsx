import React from 'react';
import { Button, Card, CardBody, CardHeader, Chip, Code, Divider, Tooltip } from '@heroui/react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import { PencilSquareIcon } from '@heroicons/react/24/outline';
import { flowStore } from '../../../../../../stores/flowStore';

type StageSummaryPanelProps = {
  openEditor: () => void;
}

export const StageSummaryPanel: React.FC<StageSummaryPanelProps> = observer(({ openEditor }) => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  if (!flowStore.editorState) return null;

  if (!flowStore.editorState.selectedStage) {
    return (
      <Card shadow="sm" className="border border-default-200">
        <CardHeader className="text-small font-semibold">{t('stage')}</CardHeader>
        <Divider />
        <CardBody className="text-small text-default-500">
          {t('selectStageToSeeDetails')}
        </CardBody>
      </Card>
    );
  }

  const stage = flowStore.editorState.flow.definition.stages[flowStore.editorState.selectedStage];

  return (
    <Card shadow="sm" className="border border-default-200">
      <CardHeader className="flex items-center justify-between gap-2">
        <span className="text-small font-semibold truncate">{flowStore.editorState.selectedStage}</span>

        <Tooltip content={tCommon('edit')}>
          <Button className="flex-1 max-w-fit" size="sm" variant="flat" onPress={openEditor} isIconOnly>
            <PencilSquareIcon className="size-4" />
          </Button>
        </Tooltip>
      </CardHeader>

      <Divider />

      <CardBody className="gap-4 text-small">
        <div>
          <div className="text-tiny text-default-500 mb-1">{t('description')}</div>
          <div className="text-default-600">{stage.description}</div>
        </div>

        <div>
          <div className="text-tiny text-default-500 mb-1">{t('action')}</div>
          {stage.action ? (
            <div className="flex flex-col gap-2">
              <Chip size="sm" color="primary" variant="flat">{stage.action.toolName}</Chip>
              {stage.action.condition && (
                <div>
                  <span className="text-default-600 font-medium block text-xs">{t('when')}</span>
                  <Code size="sm">
                    {stage.action.condition}
                  </Code>
                </div>
              )}
            </div>
          ) : (
            <div className="text-default-500">—</div>
          )}
        </div>

        <div>
          <div className="text-tiny text-default-500 mb-1">{t('fieldsToCollect')}</div>
          {stage.fieldsToCollect.length > 0 ? (
            <div className="flex flex-wrap -m-0.5">
              {stage.fieldsToCollect.map((fieldSlug) => (
                <Chip
                  key={fieldSlug}
                  size="sm"
                  variant="flat"
                  className="mr-1 mb-1"
                >
                  {fieldSlug}
                </Chip>
              ))}
            </div>
          ) : (
            <div className="text-default-500">—</div>
          )}
        </div>

        <div>
          <div className="text-tiny text-default-500 mb-1">{t('transition')}</div>
          <div className="flex items-center gap-2">
            {!stage.nextStage && <span className="text-default-500">—</span>}
            {typeof stage.nextStage === 'string' && (
              <Button
                size="sm"
                variant="ghost"
                onPress={() => flowStore.selectStage(stage.nextStage as string)}
              >
                {stage.nextStage}
              </Button>
            )}
            {typeof stage.nextStage === 'object' && (
              <div className="flex flex-col gap-4">
                {stage.nextStage.conditional.map((c) => (
                  <div key={[c.condition, c.ifTrue, c.ifFalse].join('.')} className="flex flex-col gap-1">
                    <div>
                      <span className="text-default-600 font-medium mr-2">{t('if')}</span>
                      <Code>{c.condition}</Code>
                    </div>
                    <div className="pl-2">
                      <span className="text-default-600 font-medium mr-2">{t('true')}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        onPress={() => flowStore.selectStage(c.ifTrue)}
                      >
                        {c.ifTrue}
                      </Button>
                    </div>
                    {c.ifFalse && (
                      <div className="pl-2">
                        <span className="text-default-600 font-medium mr-2">{t('false')}</span>
                        <Button
                          size="sm"
                          variant="ghost"
                          onPress={() => flowStore.selectStage(c.ifFalse || null)}
                        >
                          {c.ifFalse}
                        </Button>
                      </div>
                    )}
                  </div>
                ))}

                <div>
                  <span className="text-default-600 font-medium mr-2">{t('fallback')}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onPress={() => flowStore.selectStage((stage.nextStage as { fallback: string }).fallback)}
                  >
                    {stage.nextStage.fallback}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
});
