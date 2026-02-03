import React, { useState, useEffect } from 'react';
import { Button, Chip, Card, CardBody } from '@heroui/react';
import { CheckIcon, ClockIcon, ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import moment from 'moment';
import { apiClientStore } from '../../../stores/apiClientStore';
import classNames from '../../../helpers/classNames';

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

interface FlowStage {
  slug: string;
  name?: string;
  isCompleted: boolean;
}

interface Flow {
  name: string;
  slug: string;
  isCompleted: boolean;
  sessionId: string;
  stages: FlowStage[];
}

interface ImprovedFlowViewProps {
  activeFlow: Flow | null;
  completedFlows: Flow[];
  conversationId: string;
}

export const ImprovedFlowView: React.FC<ImprovedFlowViewProps> = ({
  activeFlow,
  completedFlows,
  conversationId,
}) => {
  const [traces, setTraces] = useState<FlowTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(
    new Set(activeFlow ? [activeFlow.sessionId] : []),
  );

  const loadTrace = async () => {
    if (!conversationId) return;

    setLoading(true);
    try {
      const response = await apiClientStore.fetch(`/api/v1/admin/flows/${conversationId}/trace`);
      const data = await response.json();
      if (data.ok) {
        setTraces(data.traces || []);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading trace:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (conversationId) {
      loadTrace();
    }
  }, [conversationId]);

  const flowHistory = activeFlow ? [activeFlow, ...completedFlows] : completedFlows;

  // Group traces by flow and stage
  const tracesByFlow = traces.reduce((acc, trace) => {
    if (!acc[trace.flowSlug]) {
      acc[trace.flowSlug] = {};
    }
    if (!acc[trace.flowSlug][trace.stageSlug]) {
      acc[trace.flowSlug][trace.stageSlug] = [];
    }
    acc[trace.flowSlug][trace.stageSlug].push(trace);
    return acc;
  }, {} as Record<string, Record<string, FlowTrace[]>>);

  const getTraceForStage = (flowSlug: string, stageSlug: string): FlowTrace | null => {
    const flowTraces = tracesByFlow[flowSlug]?.[stageSlug];
    if (!flowTraces || flowTraces.length === 0) return null;
    // Return the most recent trace (last one)
    return flowTraces[flowTraces.length - 1];
  };

  const toggleFlow = (sessionId: string) => {
    const newExpanded = new Set(expandedFlows);
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedFlows(newExpanded);
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h3 className="text-sm font-semibold">Flow Timeline</h3>
        <Button size="sm" onClick={loadTrace} isLoading={loading}>
          Refresh
        </Button>
      </div>

      {flowHistory.length === 0 && traces.length === 0 && (
        <div className="text-center text-gray-500 py-8">
          <p>No flow data available</p>
        </div>
      )}

      <div className="space-y-3">
        {flowHistory.map((flow) => {
          const flowSlug = flow.slug;
          const isExpanded = expandedFlows.has(flow.sessionId);
          const flowTraces = traces.filter((t) => t.flowSlug === flowSlug);

          return (
            <Card key={flow.sessionId} className="border border-default-200">
              <CardBody className="p-0">
                <button
                  onClick={() => toggleFlow(flow.sessionId)}
                  className="w-full p-3 flex items-center justify-between hover:bg-default-50 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <Chip
                      size="sm"
                      color={flow.isCompleted ? 'success' : 'warning'}
                      variant="flat"
                    >
                      {flow.isCompleted ? 'Completed' : 'Active'}
                    </Chip>
                    <span className="font-medium">{flow.name}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-500">
                    {flowTraces.length > 0 && (
                      <span>
                        {flowTraces.length}
                        {' '}
                        stage
                        {flowTraces.length !== 1 ? 's' : ''}
                      </span>
                    )}
                    {isExpanded ? (
                      <span className="text-xs">▼</span>
                    ) : (
                      <span className="text-xs">▶</span>
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="border-t border-default-200 p-4 space-y-1">
                    {flow.stages.map((stage, stageIdx) => {
                      const trace = getTraceForStage(flowSlug, stage.slug);
                      const hasTrace = !!trace;
                      const isLastStage = stageIdx === flow.stages.length - 1;

                      return (
                        <div
                          key={stage.slug}
                          className={classNames(
                            'relative pl-7 pb-5',
                            !isLastStage && 'border-l-2 border-default-200',
                          )}
                        >
                          {/* Timeline dot */}
                          <div
                            className={classNames(
                              'absolute left-0 top-2 w-3 h-3 rounded-full border-2 -translate-x-[8px] z-10',
                              stage.isCompleted
                                ? 'bg-success border-success shadow-sm'
                                : 'bg-warning border-warning shadow-sm',
                            )}
                          />

                          {/* Stage header */}
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              {stage.isCompleted ? (
                                <CheckIcon className="size-4 text-success flex-shrink-0" />
                              ) : (
                                <ClockIcon className="size-4 text-warning flex-shrink-0" />
                              )}
                              <span className="font-medium text-sm truncate">
                                {stage.name || stage.slug}
                              </span>
                            </div>
                            <Chip
                              size="sm"
                              color={stage.isCompleted ? 'success' : 'warning'}
                              variant="flat"
                              className="flex-shrink-0"
                            >
                              {stage.isCompleted ? 'Done' : 'In Progress'}
                            </Chip>
                          </div>

                          {/* Trace details */}
                          {hasTrace && trace && (
                            <div className="mt-2 ml-6 space-y-2 text-xs">
                              {/* Timestamps */}
                              <div className="text-gray-500">
                                <span>
                                  Entered:
                                  {moment(trace.enteredAt).format('MMM D, h:mm A')}
                                </span>
                                {trace.completedAt && (
                                  <span className="ml-2">
                                    • Completed:
                                    {' '}
                                    {moment(trace.completedAt).format('MMM D, h:mm A')}
                                  </span>
                                )}
                              </div>

                              {/* Fields collected */}
                              {trace.fieldsCollected.length > 0 && (
                                <div>
                                  <span className="text-gray-600 font-medium">Fields:</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {trace.fieldsCollected.map((field, idx) => (
                                      <Chip key={idx} size="sm" variant="flat" className="text-xs">
                                        {field}
                                      </Chip>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Tools executed */}
                              {trace.toolsExecuted.length > 0 && (
                                <div>
                                  <span className="text-gray-600 font-medium">Tools:</span>
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {trace.toolsExecuted.map((tool, idx: number) => (
                                      <Chip
                                        key={idx}
                                        size="sm"
                                        color={tool.success ? 'success' : 'danger'}
                                        variant="flat"
                                        className="text-xs"
                                      >
                                        {tool.toolName}
                                        {' '}
                                        {tool.success ? '✓' : '✗'}
                                      </Chip>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {/* Errors */}
                              {trace.errorsEncountered.length > 0 && (
                                <div className="bg-danger-50 border border-danger-200 rounded p-2">
                                  <div className="flex items-center gap-1 text-danger-600 font-medium mb-1">
                                    <ExclamationTriangleIcon className="size-3" />
                                    <span>Errors</span>
                                  </div>
                                  <ul className="list-disc list-inside space-y-0.5 text-xs text-danger-700">
                                    {trace.errorsEncountered.map((error, idx: number) => (
                                      <li key={idx}>{error.error}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* No trace data message - only show if stage is in progress */}
                          {!hasTrace && !stage.isCompleted && (
                            <div className="mt-1 ml-6 text-xs text-gray-400 italic">
                              Waiting for stage activity...
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardBody>
            </Card>
          );
        })}
      </div>
    </div>
  );
};
