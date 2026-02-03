import React, { useState, useEffect } from 'react';
import { Button, Chip } from '@heroui/react';
import {
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  WrenchScrewdriverIcon,
  QuestionMarkCircleIcon,
  XMarkIcon,
} from '@heroicons/react/24/outline';
import moment from 'moment';
import { apiClientStore } from '../../../stores/apiClientStore';
import classNames from '../../../helpers/classNames';

type ToolExecution = {
  toolName: string;
  success: boolean;
  error?: string;
  timestamp?: string;
};

type TraceError = {
  error: string;
  toolName?: string;
  errorCode?: string;
  timestamp?: string;
  flowSlug?: string;
  stageSlug?: string;
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
  userDataSnapshot?: Record<string, unknown>;
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

interface FlowDetailsViewProps {
  activeFlow: Flow | null;
  completedFlows: Flow[];
  conversationId: string;
  userData?: Record<string, unknown>;
}

export const FlowDetailsView: React.FC<FlowDetailsViewProps> = ({
  activeFlow,
  completedFlows,
  conversationId,
  userData = {},
}) => {
  const [traces, setTraces] = useState<FlowTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());

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
      // Auto-expand active flow
      if (activeFlow) {
        setExpandedFlows(new Set([activeFlow.sessionId]));
      }
    }
  }, [conversationId, activeFlow?.sessionId]);

  const flowHistory = activeFlow ? [activeFlow, ...completedFlows] : completedFlows;

  // Calculate overall progress
  const totalStages = flowHistory.reduce((sum, flow) => sum + flow.stages.length, 0);
  const completedStages = flowHistory.reduce(
    (sum, flow) => sum + flow.stages.filter((s) => s.isCompleted).length,
    0,
  );

  // Get current stage
  const currentStage = activeFlow?.stages.find((s) => !s.isCompleted);
  const currentStageName = currentStage?.name || currentStage?.slug || '';

  // Get trace for a specific stage
  const getTraceForStage = (flowSlug: string, stageSlug: string): FlowTrace | null => {
    const stageTraces = traces.filter(
      (t) => t.flowSlug === flowSlug && t.stageSlug === stageSlug,
    );
    if (stageTraces.length === 0) return null;
    // Return the most recent trace
    return stageTraces.sort((a, b) =>
      new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
    )[0];
  };

  // Get all traces for a flow, sorted chronologically
  const getTracesForFlow = (flowSlug: string): FlowTrace[] => traces
    .filter((t) => t.flowSlug === flowSlug)
    .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());

  // Get recent errors (from traces)
  const recentErrors = traces
    .flatMap((trace) =>
      trace.errorsEncountered.map((error) => ({
        ...error,
        timestamp: trace.enteredAt,
        flowSlug: trace.flowSlug,
        stageSlug: trace.stageSlug,
        toolName: error.toolName || trace.toolsExecuted?.[0]?.toolName,
      })),
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
    .slice(0, 5);

  const toggleFlow = (sessionId: string) => {
    const newExpanded = new Set(expandedFlows);
    if (newExpanded.has(sessionId)) {
      newExpanded.delete(sessionId);
    } else {
      newExpanded.add(sessionId);
    }
    setExpandedFlows(newExpanded);
  };

  const toggleStage = (stageKey: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageKey)) {
      newExpanded.delete(stageKey);
    } else {
      newExpanded.add(stageKey);
    }
    setExpandedStages(newExpanded);
  };

  // Get flow start and end times from traces
  const getFlowTimes = (flowSlug: string) => {
    const flowTraces = getTracesForFlow(flowSlug);
    if (flowTraces.length === 0) return { start: null, end: null };

    const start = flowTraces[0].enteredAt;
    const completedTraces = flowTraces.filter((t) => t.completedAt);
    const end = completedTraces.length > 0
      ? completedTraces[completedTraces.length - 1].completedAt
      : null;

    return { start, end };
  };

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="space-y-3">
        <h2 className="text-lg font-semibold">Flows in this conversation</h2>

        {/* Flow Status Tags */}
        <div className="flex flex-wrap gap-2">
          {flowHistory.map((flow) => (
            <Chip
              key={flow.sessionId}
              size="sm"
              className={classNames(
                'rounded-full',
                flow.isCompleted
                  ? 'bg-black text-white'
                  : 'bg-gray-100 text-gray-700 border border-gray-300',
              )}
              startContent={
                flow.isCompleted ? (
                  <CheckIcon className="w-3 h-3" />
                ) : (
                  <ClockIcon className="w-3 h-3" />
                )
              }
            >
              {flow.slug}
              {' '}
              ·
              {flow.isCompleted ? 'Completed' : 'In progress'}
            </Chip>
          ))}
        </div>

        {/* Overall Progress */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">Overall Progress</span>
            <span className="text-gray-600">
              {completedStages}
              /
              {totalStages}
              {' '}
              stages
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-gray-800 h-2 rounded-full transition-all"
              style={{ width: `${(completedStages / totalStages) * 100}%` }}
            />
          </div>
        </div>

        {/* Current Stage Indicator */}
        {currentStage && activeFlow && (
          <div className="bg-gray-100 rounded-lg px-3 py-2">
            <span className="text-sm font-medium text-gray-800">
              Current:
              {' '}
              {activeFlow.slug}
              {' '}
              ·
              {' '}
              {currentStageName}
            </span>
          </div>
        )}
      </div>

      {/* Individual Flow Sections */}
      <div className="space-y-3">
        {flowHistory.map((flow) => {
          const isExpanded = expandedFlows.has(flow.sessionId);
          const { start, end } = getFlowTimes(flow.slug);
          const completedStagesCount = flow.stages.filter((s) => s.isCompleted).length;

          return (
            <div key={flow.sessionId} className="border border-gray-200 rounded-lg overflow-hidden">
              {/* Flow Header */}
              <button
                onClick={() => toggleFlow(flow.sessionId)}
                className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 flex-1">
                  {isExpanded ? (
                    <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                  ) : (
                    <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                  )}
                  <span className="font-medium text-left">{flow.name}</span>
                </div>
                <Chip
                  size="sm"
                  className={classNames(
                    'rounded-full',
                    flow.isCompleted
                      ? 'bg-black text-white'
                      : 'bg-gray-100 text-gray-700',
                  )}
                >
                  {flow.isCompleted ? 'Completed' : 'In progress'}
                </Chip>
              </button>

              {/* Flow Summary (when collapsed) */}
              {!isExpanded && (
                <div className="px-4 pb-3 text-sm text-gray-600">
                  <div>
                    slug:
                    {flow.slug}
                    {' '}
                    ·
                    {completedStagesCount}
                    /
                    {flow.stages.length}
                    {' '}
                    stages
                  </div>
                  {start && (
                    <div>
                      Started
                      {' '}
                      {moment(start).format('M/D/YYYY h:mm A')}
                      {end && ` · Completed ${moment(end).format('M/D/YYYY h:mm A')}`}
                    </div>
                  )}
                </div>
              )}

              {/* Flow Details (when expanded) */}
              {isExpanded && (
                <div className="border-t border-gray-200 px-4 py-3 space-y-1 bg-gray-50">
                  <div className="text-sm text-gray-600 mb-3">
                    <div>
                      slug:
                      {flow.slug}
                      {' '}
                      ·
                      {completedStagesCount}
                      /
                      {flow.stages.length}
                      {' '}
                      stages
                    </div>
                    {start && (
                      <div>
                        Started
                        {' '}
                        {moment(start).format('M/D/YYYY h:mm A')}
                        {end && ` · Completed ${moment(end).format('M/D/YYYY h:mm A')}`}
                      </div>
                    )}
                  </div>

                  {/* Stage Items */}
                  <div className="space-y-2">
                    {flow.stages.map((stage) => {
                      const trace = getTraceForStage(flow.slug, stage.slug);
                      const stageKey = `${flow.sessionId}-${stage.slug}`;
                      const isStageExpanded = expandedStages.has(stageKey);
                      const hasDetails = trace && (
                        trace.fieldsCollected.length > 0 ||
                        trace.toolsExecuted.length > 0 ||
                        trace.errorsEncountered.length > 0
                      );

                      return (
                        <div
                          key={stage.slug}
                          className="bg-white border border-gray-200 rounded-lg p-3 relative pl-8"
                        >
                          {/* Timeline dot */}
                          <div className="absolute left-3 top-4 w-2 h-2 bg-gray-400 rounded-full" />

                          {/* Stage Header */}
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                {trace?.toolsExecuted && trace.toolsExecuted.length > 0 && (
                                  <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                )}
                                <span className="text-sm font-medium">
                                  <span className="text-gray-500">{flow.slug}</span>
                                  {' / '}
                                  <span className="font-semibold">{stage.slug}</span>
                                </span>
                              </div>
                              {trace && (
                                <div className="text-xs text-gray-500 mt-1">
                                  {moment(trace.enteredAt).format('M/D/YYYY, h:mm:ss A')}
                                  {trace.completedAt && (
                                    <>
                                      {' → '}
                                      {moment(trace.completedAt).format('M/D/YYYY, h:mm:ss A')}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                            <div className="flex items-center gap-2 flex-shrink-0">
                              {stage.isCompleted && (
                                <Chip
                                  size="sm"
                                  className="bg-green-500 text-white rounded-full"
                                  startContent={<CheckIcon className="w-3 h-3" />}
                                >
                                  Completed
                                </Chip>
                              )}
                              {hasDetails && (
                                <button
                                  onClick={() => toggleStage(stageKey)}
                                  className="text-gray-400 hover:text-gray-600"
                                >
                                  {isStageExpanded ? (
                                    <ChevronDownIcon className="w-4 h-4" />
                                  ) : (
                                    <ChevronRightIcon className="w-4 h-4" />
                                  )}
                                </button>
                              )}
                            </div>
                          </div>

                          {/* Stage Details (expanded) */}
                          {isStageExpanded && trace && (
                            <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                              {/* Fields Collected */}
                              {trace.fieldsCollected.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-700 mb-2">
                                    Fields Collected
                                  </div>
                                  <div className="grid grid-cols-2 gap-2 text-xs">
                                    {trace.fieldsCollected.map((field) => {
                                      const value = trace.userDataSnapshot?.[field] ?? userData[field];
                                      const displayValue = value !== undefined && value !== null && value !== ''
                                        ? (typeof value === 'string' || typeof value === 'number'
                                          ? String(value)
                                          : JSON.stringify(value))
                                        : '–';
                                      return (
                                        <div key={field} className="space-y-1">
                                          <div className="text-gray-500 font-mono text-xs">
                                            {field}
                                            :
                                          </div>
                                          <div className="text-gray-800 break-words text-xs">
                                            {displayValue}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              )}

                              {/* Tools Executed */}
                              {trace.toolsExecuted.length > 0 && (
                                <div>
                                  <div className="text-xs font-semibold text-gray-700 mb-2">
                                    Tools Executed
                                  </div>
                                  <div className="space-y-2">
                                    {trace.toolsExecuted.map((tool, idx: number) => (
                                      <div
                                        key={idx}
                                        className={[
                                          'flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200',
                                        ].join(' ')}
                                      >
                                        <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                        <div className="flex-1 min-w-0">
                                          <div className="text-xs font-medium text-gray-800">
                                            {tool.toolName}
                                          </div>
                                          {tool.timestamp && (
                                            <div className="text-xs text-gray-500">
                                              {moment(tool.timestamp).format('M/D/YYYY, h:mm:ss A')}
                                            </div>
                                          )}
                                        </div>
                                        <div className="flex items-center gap-1 flex-shrink-0">
                                          {tool.success !== false ? (
                                            <div
                                              className={[
                                                'w-4 h-4 rounded-full bg-green-500',
                                                'flex items-center justify-center',
                                              ].join(' ')}
                                            >
                                              <CheckIcon className="w-3 h-3 text-white" />
                                            </div>
                                          ) : (
                                            <div
                                              className={[
                                                'w-4 h-4 rounded-full bg-red-500',
                                                'flex items-center justify-center',
                                              ].join(' ')}
                                            >
                                              <XMarkIcon className="w-3 h-3 text-white" />
                                            </div>
                                          )}
                                          <QuestionMarkCircleIcon className="w-4 h-4 text-gray-400" />
                                        </div>
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Recent Technical Events */}
      {recentErrors.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-sm font-semibold">Recent Technical Events</h3>
          {recentErrors.map((error, idx) => (
            <div
              key={idx}
              className="bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3"
            >
              <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                <ExclamationTriangleIcon className="w-3 h-3 text-white" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm text-gray-800">
                  {moment(error.timestamp).format('h:mm A')}
                  {' '}
                  ·
                  {error.toolName || `${error.flowSlug}.${error.stageSlug}`}
                  {' '}
                  · Failed
                </div>
                {error.errorCode && (
                  <div className="text-xs text-red-600 font-medium mt-1">
                    {error.errorCode}
                  </div>
                )}
                {error.error && typeof error.error === 'string' && (
                  <div className="text-xs text-red-600 mt-1">{error.error}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Refresh Button */}
      <div className="flex justify-end">
        <Button size="sm" onClick={loadTrace} isLoading={loading}>
          Refresh
        </Button>
      </div>
    </div>
  );
};
