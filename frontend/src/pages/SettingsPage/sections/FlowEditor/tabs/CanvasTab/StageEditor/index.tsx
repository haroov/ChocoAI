import React, { useState } from 'react';
import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader, Tab, Tabs } from '@heroui/react';
import { useTranslations } from 'use-intl';
import { observer } from 'mobx-react-lite';
import { useParams } from 'react-router-dom';
import { SparklesIcon } from '@heroicons/react/24/outline';
import { flowStore } from '../../../../../../../stores/flowStore';
import { flowAgentStore } from '../../../../../../../stores/flowAgentStore';
import { Basics } from './Basics';
import { FieldsToCollect } from './FieldsToCollect';
import { Action } from './Action';
import { Transition } from './Transition';

type StageEditorProps = {
  open: boolean;
  onClose: () => void;
}

export const StageEditor: React.FC<StageEditorProps> = observer(({ open, onClose }) => {
  const t = useTranslations('FlowEditor');
  const tCommon = useTranslations('Common');
  const { flowId } = useParams<{ flowId: string }>();
  const [agentMessage, setAgentMessage] = useState('');

  const handleAskAgent = async () => {
    if (!flowId || !flowStore.editorState?.selectedStage || !agentMessage.trim()) return;
    const stageSlug = flowStore.editorState.selectedStage;
    const message = `Modify the stage "${stageSlug}": ${agentMessage}`;
    setAgentMessage('');
    await flowAgentStore.sendMessage(flowId, message);
  };

  if (!flowStore.editorState?.selectedStage) return null;

  return (
    <Modal
      isOpen={open}
      onOpenChange={(o) => !o && onClose()}
      backdrop="opaque"
      size="3xl"
      className="max-w-[840px]"
      scrollBehavior="inside"
    >
      <ModalContent>
        <ModalHeader className="flex flex-col gap-1">
          <div className="flex items-center justify-between w-full">
            <div>
              <div className="text-medium font-semibold">{t('stageSettings')}</div>
              <div className="text-tiny text-default-500">{flowStore.editorState.selectedStage}</div>
            </div>
            {flowId && (
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Ask agent to modify this stage..."
                  value={agentMessage}
                  onChange={(e) => setAgentMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAskAgent();
                    }
                  }}
                  className="px-2 py-1 text-sm border border-default-200 rounded"
                  style={{ minWidth: '200px' }}
                />
                <Button
                  size="sm"
                  color="primary"
                  variant="flat"
                  onPress={handleAskAgent}
                  isDisabled={!agentMessage.trim() || flowAgentStore.isProcessing}
                  startContent={<SparklesIcon className="size-4" />}
                >
                  Ask Agent
                </Button>
              </div>
            )}
          </div>
        </ModalHeader>
        <ModalBody className="gap-4">
          <Tabs aria-label={t('stageSettings')} variant="bordered">
            <Tab key="basics" title={t('basics')}><Basics /></Tab>

            <Tab key="collect" title={t('fieldsToCollect')}><FieldsToCollect /></Tab>

            <Tab key="action" title={t('action')}><Action /></Tab>

            <Tab key="transition" title={t('transition')}><Transition /></Tab>
          </Tabs>
        </ModalBody>
        <ModalFooter>
          <Button color="primary" onPress={onClose}>{tCommon('ok')}</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
});
