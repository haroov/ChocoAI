import React, { useState, useEffect } from 'react';
import { Chip, Accordion, AccordionItem } from '@heroui/react';
import { apiClientStore } from '../../../stores/apiClientStore';

type ToolExecution = {
  toolName: string;
  success: boolean;
  error?: string;
};

type TraceError = {
  error: string;
  toolName?: string;
  errorCode?: string;
};

interface FlowTrace {
  id: string;
  conversationId: string;
  flowSlug: string;
  stageSlug: string;
  enteredAt: string;
  completedAt: string | null;
  fieldsCollected: string[];
  toolsExecuted: ToolExecution[];
  errorsEncountered: TraceError[];
}

interface FlowTraceViewProps {
  conversationId: string;
}

export const FlowTraceView: React.FC<FlowTraceViewProps> = ({ conversationId }) => {
  const [traces, setTraces] = useState<FlowTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentFlowSlug, setCurrentFlowSlug] = useState<string | null>(null);
  const [currentStageSlug, setCurrentStageSlug] = useState<string | null>(null);

  const loadTrace = async () => {
    if (!conversationId) return;

    setLoading(true);
    try {
      const response = await apiClientStore.fetch(`/api/v1/admin/flows/${conversationId}/trace`);
      const data = await response.json();
      if (data.ok) {
        setTraces(data.traces || []);
        setCurrentFlowSlug(data.currentFlowSlug || null);
        setCurrentStageSlug(data.currentStageSlug || null);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading trace:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!conversationId) return undefined;

    loadTrace();
    // Auto-refresh every 3 seconds to stay reactive
    const interval = setInterval(loadTrace, 3000);
    return () => clearInterval(interval);
  }, [conversationId]);

  if (loading) {
    return <div className="text-center text-gray-500 py-4">Loading trace...</div>;
  }

  if (traces.length === 0) {
    return (
      <div className="text-center text-gray-500 py-4">
        <p>No flow trace available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center mb-2">
        <h3 className="text-sm font-semibold">Flow Timeline</h3>
        {loading && <span className="text-xs text-gray-400">Updating...</span>}
      </div>

      <Accordion variant="splitted">
        {traces.map((trace) => {
          // Determine if this trace is for the current stage
          const isCurrentStage = currentFlowSlug === trace.flowSlug && currentStageSlug === trace.stageSlug;
          // Check if there are errors
          const hasError = trace.errorsEncountered && trace.errorsEncountered.length > 0;

          // Determine status: error > completed > in-progress (only if current) > not-started
          let statusColor: 'success' | 'warning' | 'danger' | 'default';
          let statusText: string;

          if (hasError) {
            statusColor = 'danger';
            statusText = 'Error';
          } else if (trace.completedAt) {
            statusColor = 'success';
            statusText = 'Completed';
          } else if (isCurrentStage) {
            // Only show as "in-progress" if it's actually the current stage
            statusColor = 'warning';
            statusText = 'In Progress';
          } else {
            // Not current, not completed, no error = not started
            statusColor = 'default';
            statusText = 'Not Started';
          }

          return (
            <AccordionItem
              key={trace.id}
              aria-label={`${trace.flowSlug} / ${trace.stageSlug} - ${statusText}`}
              title={
                <div className="flex items-center gap-2">
                  <span className="font-medium">{trace.flowSlug}</span>
                  <span className="text-gray-500">/</span>
                  <span>{trace.stageSlug}</span>
                  <Chip size="sm" color={statusColor} className="ml-auto">
                    {statusText}
                  </Chip>
                </div>
              }
            >
              <div className="space-y-2 text-sm">
                <div className="text-gray-600">
                  <strong>Entered:</strong>
                  {' '}
                  {new Date(trace.enteredAt).toLocaleString()}
                  {trace.completedAt && (
                    <>
                      <br />
                      <strong>Completed:</strong>
                      {' '}
                      {new Date(trace.completedAt).toLocaleString()}
                    </>
                  )}
                </div>

                {trace.fieldsCollected.length > 0 && (
                  <div>
                    <strong>Fields Collected:</strong>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {trace.fieldsCollected.map((field, idx) => (
                        <Chip key={idx} size="sm" variant="flat">
                          {field}
                        </Chip>
                      ))}
                    </div>
                  </div>
                )}

                {trace.toolsExecuted.length > 0 && (
                  <div>
                    <strong>Tools Executed:</strong>
                    <div className="space-y-1 mt-1">
                      {trace.toolsExecuted.map((tool, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Chip size="sm" color={tool.success ? 'success' : 'danger'}>
                            {tool.toolName}
                            {' '}
                            {tool.success ? '✓' : '✗'}
                          </Chip>
                          {tool.error && (
                            <span className="text-xs text-red-600">{tool.error}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {trace.errorsEncountered.length > 0 && (
                  <div className="text-red-600">
                    <strong>Errors:</strong>
                    <ul className="list-disc list-inside mt-1">
                      {trace.errorsEncountered.map((error, idx: number) => (
                        <li key={idx} className="text-xs">{error.error}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
};
