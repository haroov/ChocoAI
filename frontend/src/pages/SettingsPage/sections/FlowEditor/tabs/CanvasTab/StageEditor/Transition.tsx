import React from 'react';
import { observer } from 'mobx-react-lite';
import { useTranslations } from 'use-intl';
import {
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Input,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
} from '@heroui/react';
import { PlusIcon } from '@heroicons/react/24/outline';
import { TrashIcon } from '@heroicons/react/16/solid';
import { flowStore } from '../../../../../../../stores/flowStore';
import { ConditionalItem, NextStageWithConditions } from '../../../../../../../types/flow';

const EMPTY_STAGE = '—';

export const Transition: React.FC = observer(() => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');

  if (!flowStore.editorState?.selectedStage) return null;

  const { selectedStage } = flowStore.editorState;
  const stage = flowStore.editorState.flow.definition.stages[selectedStage];

  const availableStages = Object.keys(flowStore.editorState.flow.definition.stages);

  const transitionType = typeof stage.nextStage === 'object' ? 'conditional' : 'fixed';

  const updateConditional = (index: number, data: Partial<ConditionalItem>) => {
    if (typeof stage.nextStage !== 'object') return;
    flowStore.updateStage(selectedStage, {
      nextStage: {
        ...stage.nextStage,
        conditional: stage.nextStage.conditional.map((c, i) => (i === index ? { ...c, ...data } : c)),
      },
    });
  };
  const addConditional = () => {
    if (typeof stage.nextStage !== 'object') return;
    flowStore.updateStage(selectedStage, {
      nextStage: {
        ...stage.nextStage,
        conditional: [
          ...stage.nextStage.conditional,
          { condition: '', ifTrue: '', ifFalse: '' },
        ],
      },
    });
  };
  const deleteConditional = (index: number) => {
    if (typeof stage.nextStage !== 'object') return;
    flowStore.updateStage(selectedStage, {
      nextStage: {
        ...stage.nextStage,
        conditional: stage.nextStage.conditional.filter((_, i) => i !== index),
      },
    });
  };

  return (
    <div className="grid gap-3">
      <RadioGroup
        label={t('transitionType')}
        value={transitionType}
        onValueChange={(v) => {
          if (v === transitionType) return;
          if (v === 'fixed') flowStore.updateStage(selectedStage, { nextStage: undefined });
          else flowStore.updateStage(selectedStage, { nextStage: { fallback: selectedStage, conditional: [] } });
        }}
        orientation="horizontal"
      >
        <Radio value="fixed">{t('fixed')}</Radio>
        <Radio value="conditional">{t('conditional')}</Radio>
      </RadioGroup>

      {transitionType === 'fixed' ? (
        <Select
          label={t('nextStage')}
          selectedKeys={[stage.nextStage as string || EMPTY_STAGE]}
          onSelectionChange={(selection) => flowStore.updateStage(selectedStage, { nextStage: selection.anchorKey })}
        >
          <SelectItem key={EMPTY_STAGE}>{EMPTY_STAGE}</SelectItem>
          {availableStages
            .filter((stageSlug) => stageSlug !== selectedStage)
            .map((stageSlug) => (
              <SelectItem key={stageSlug}>{stageSlug}</SelectItem>
            )) as never}
        </Select>
      ) : (
        <div className="flex flex-col gap-4 items-start">
          <Select
            label={t('fallback')}
            selectedKeys={[(stage.nextStage as { fallback: string }).fallback]}
            onSelectionChange={(selection) => flowStore.updateStage(selectedStage, { nextStage: {
              ...(stage.nextStage as NextStageWithConditions),
              fallback: selection.anchorKey as string,
            } })}
          >
            {availableStages.map((stageSlug) => (
              <SelectItem key={stageSlug}>{stageSlug}</SelectItem>
            )) as never}
          </Select>

          {(stage.nextStage as NextStageWithConditions).conditional.map(({ condition, ifTrue, ifFalse }, index) => (
            <Card
              key={[ifTrue, ifFalse, index].join('-')}
              shadow="none"
              className="border border-default-200 w-full"
            >
              <CardHeader>
                <Input
                  label={t('condition')}
                  value={condition}
                  className="font-mono"
                  onValueChange={(v) => updateConditional(index, { condition: v })}
                />
              </CardHeader>
              <CardBody className="pl-8 gap-2">
                <Select
                  label={t('ifTrue')}
                  selectedKeys={[ifTrue || EMPTY_STAGE]}
                  onSelectionChange={(selection) => updateConditional(index, { ifTrue: selection.anchorKey })}
                >
                  {availableStages
                    .filter((stageSlug) => stageSlug !== selectedStage)
                    .map((stageSlug) => (
                      <SelectItem key={stageSlug}>{stageSlug}</SelectItem>
                    )) as never}
                </Select>
                <Select
                  label={t('ifFalse')}
                  selectedKeys={[ifFalse || EMPTY_STAGE]}
                  onSelectionChange={(selection) => updateConditional(index, { ifFalse: selection.anchorKey })}
                >
                  <SelectItem key={EMPTY_STAGE}>{EMPTY_STAGE}</SelectItem>
                  {availableStages
                    .filter((stageSlug) => stageSlug !== selectedStage)
                    .map((stageSlug) => (
                      <SelectItem key={stageSlug}>{stageSlug}</SelectItem>
                    )) as never}
                </Select>
              </CardBody>
              <CardFooter className="flex justify-end">
                <Button
                  size="sm"
                  startContent={<TrashIcon className="size-4" />}
                  variant="flat"
                  color="danger"
                  onPress={() => deleteConditional(index)}
                >
                  {tCommon('delete')}
                </Button>
              </CardFooter>
            </Card>
          ))}

          <Button
            startContent={<PlusIcon className="size-4" />}
            onPress={addConditional}
          >
            {t('addCondition')}
          </Button>
        </div>
      )}
    </div>
  );
});
