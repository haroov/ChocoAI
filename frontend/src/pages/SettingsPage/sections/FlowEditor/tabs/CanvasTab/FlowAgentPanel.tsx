import React, { useState } from 'react';
import { observer } from 'mobx-react-lite';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  Switch,
  Textarea,
} from '@heroui/react';
import { useParams } from 'react-router-dom';
import { CheckIcon, XMarkIcon, PaperAirplaneIcon } from '@heroicons/react/24/outline';
import { flowAgentStore, AgentSuggestion } from '../../../../../../stores/flowAgentStore';
import { flowStore } from '../../../../../../stores/flowStore';

export const FlowAgentPanel: React.FC = observer(() => {
  const { flowId } = useParams<{ flowId: string }>();
  const [message, setMessage] = useState('');

  const handleSend = async () => {
    if (!message.trim() || !flowId) return;
    const msg = message;
    setMessage('');
    await flowAgentStore.sendMessage(flowId, msg);
  };

  const handleApply = async (suggestionId: string) => {
    if (!flowId) return;
    const flow = await flowAgentStore.applySuggestion(flowId, suggestionId, flowAgentStore.draftMode);
    if (flow && !flowAgentStore.draftMode) {
      // Reload flow if not draft mode
      await flowStore.loadFlow(flowId);
    }
  };

  const handleReject = (suggestionId: string) => {
    flowAgentStore.rejectSuggestion(suggestionId);
  };

  return (
    <Card shadow="sm" className="border border-default-200">
      <CardHeader className="flex items-center justify-between">
        <span className="text-small font-semibold">Flow Agent</span>
        <div className="flex items-center gap-2">
          <span className="text-tiny text-default-500">Draft</span>
          <Switch
            size="sm"
            isSelected={flowAgentStore.draftMode}
            onValueChange={(val) => flowAgentStore.setDraftMode(val)}
          />
        </div>
      </CardHeader>
      <Divider />
      <CardBody className="flex flex-col gap-3 max-h-[600px] overflow-y-auto">
        {/* Conversation History */}
        <div className="flex flex-col gap-2">
          {flowAgentStore.conversationHistory.map((msg, idx) => (
            <div
              key={idx}
              className={`p-2 rounded-lg text-sm ${
                msg.role === 'user'
                  ? 'bg-primary-50 text-primary-900 ml-auto max-w-[80%]'
                  : 'bg-default-100 text-default-700 mr-auto max-w-[80%]'
              }`}
            >
              {msg.content}
            </div>
          ))}
          {flowAgentStore.isProcessing && (
            <div className="p-2 rounded-lg text-sm bg-default-100 text-default-700 mr-auto max-w-[80%]">
              Processing...
            </div>
          )}
        </div>

        {/* Pending Suggestions */}
        {flowAgentStore.pendingSuggestions.map((suggestion) => (
          <SuggestionCard
            key={suggestion.id}
            suggestion={suggestion}
            onApply={() => handleApply(suggestion.id)}
            onReject={() => handleReject(suggestion.id)}
          />
        ))}

        {/* Input */}
        <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-default-200">
          <Textarea
            placeholder="Describe what you want to change in the flow..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSend();
              }
            }}
            minRows={2}
            maxRows={4}
          />
          <Button
            color="primary"
            size="sm"
            onPress={handleSend}
            isDisabled={!message.trim() || flowAgentStore.isProcessing}
            startContent={<PaperAirplaneIcon className="size-4" />}
          >
            Send
          </Button>
        </div>
      </CardBody>
    </Card>
  );
});

const SuggestionCard: React.FC<{
  suggestion: AgentSuggestion;
  onApply: () => void;
  onReject: () => void;
}> = ({ suggestion, onApply, onReject }) => (
  <Card className="bg-default-50 border border-default-200">
    <CardHeader className="text-tiny font-semibold">
      Suggested Changes
    </CardHeader>
    <CardBody className="gap-2">
      <p className="text-sm text-default-600">{suggestion.description}</p>
      <div className="flex gap-2">
        <Button
          size="sm"
          color="success"
          variant="flat"
          onPress={onApply}
          startContent={<CheckIcon className="size-4" />}
        >
          Apply
        </Button>
        <Button
          size="sm"
          color="danger"
          variant="flat"
          onPress={onReject}
          startContent={<XMarkIcon className="size-4" />}
        >
          Reject
        </Button>
      </div>
      {suggestion.diff && suggestion.diff.changes && (
        <div className="mt-2 p-2 bg-default-100 rounded text-xs">
          <div className="font-semibold mb-1">Changes:</div>
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          {suggestion.diff.changes.slice(0, 3).map((change: any, idx: number) => (
            <div key={idx} className="text-default-600">
              {change.type}
              :
              {change.path}
            </div>
          ))}
          {suggestion.diff.changes.length > 3 && (
            <div className="text-default-500">
              +
              {suggestion.diff.changes.length - 3}
              {' '}
              more
            </div>
          )}
        </div>
      )}
    </CardBody>
  </Card>
);

FlowAgentPanel.displayName = 'FlowAgentPanel';
