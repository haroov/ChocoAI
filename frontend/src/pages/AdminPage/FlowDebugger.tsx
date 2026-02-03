import React, { useState, useEffect } from 'react';
import {
  Card,
  CardBody,
  CardHeader,
  Button,
  Input,
  Table,
  TableHeader,
  TableColumn,
  TableBody,
  TableRow,
  TableCell,
  Chip,
} from '@heroui/react';
import { apiClientStore } from '../../stores/apiClientStore';

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

interface StuckFlow {
  id: string;
  conversationId: string;
  flowSlug: string;
  stageSlug: string;
  enteredAt: string;
  conversation: {
    id: string;
    userId: string | null;
    channel: string;
  };
}

interface ErrorFrequency {
  stage: string;
  tool?: string;
  count: number;
}

export const FlowDebugger: React.FC = () => {
  const [conversationId, setConversationId] = useState('');
  const [traces, setTraces] = useState<FlowTrace[]>([]);
  const [stuckFlows, setStuckFlows] = useState<StuckFlow[]>([]);
  const [errorFrequency, setErrorFrequency] = useState<ErrorFrequency[]>([]);
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

  const loadStuckFlows = async () => {
    try {
      const response = await apiClientStore.fetch('/api/v1/admin/flows/stuck?minutes=30');
      const data = await response.json();
      if (data.ok) {
        setStuckFlows(data.stuckFlows || []);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading stuck flows:', error);
    }
  };

  const loadErrorFrequency = async () => {
    try {
      const response = await apiClientStore.fetch('/api/v1/admin/flows/errors');
      const data = await response.json();
      if (data.ok) {
        setErrorFrequency(data.errorFrequency || []);
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading error frequency:', error);
    }
  };

  // Combined function to load both stuck flows and error frequency concurrently
  const loadDashboardData = async () => {
    setLoading(true);
    try {
      // Run both operations concurrently and wait for both to complete
      await Promise.all([loadStuckFlows(), loadErrorFrequency()]);
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Error loading dashboard data:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();
    // Auto-refresh every 5 seconds
    const interval = setInterval(loadDashboardData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Auto-refresh traces when conversationId changes
  useEffect(() => {
    if (!conversationId) return undefined;

    loadTrace();
    const interval = setInterval(loadTrace, 3000);
    return () => clearInterval(interval);
  }, [conversationId]);

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">Flow Debugger</h1>

      {/* Conversation Trace */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Conversation Trace</h2>
        </CardHeader>
        <CardBody>
          <div className="flex gap-2 mb-4">
            <Input
              placeholder="Enter conversation ID"
              value={conversationId}
              onChange={(e) => setConversationId(e.target.value)}
              className="flex-1"
            />
            <Button onClick={loadTrace} isLoading={loading}>
              Load Trace
            </Button>
          </div>

          {traces.length > 0 && (
            <div className="space-y-4">
              {traces.map((trace) => {
                const isCurrentStage = currentFlowSlug === trace.flowSlug && currentStageSlug === trace.stageSlug;
                const hasError = trace.errorsEncountered && trace.errorsEncountered.length > 0;

                let chipColor: 'success' | 'warning' | 'danger' | 'default' = 'default';
                let chipText = 'Not Started';

                if (hasError) {
                  chipColor = 'danger';
                  chipText = 'Error';
                } else if (trace.completedAt) {
                  chipColor = 'success';
                  chipText = 'Completed';
                } else if (isCurrentStage) {
                  chipColor = 'warning';
                  chipText = 'In Progress';
                } else {
                  chipColor = 'default';
                  chipText = 'Not Started';
                }

                return (
                  <div key={trace.id} className="border rounded p-4">
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <strong>{trace.flowSlug}</strong>
                        {' '}
                        /
                        <strong>{trace.stageSlug}</strong>
                      </div>
                      <Chip size="sm" color={chipColor}>
                        {chipText}
                      </Chip>
                    </div>
                    <div className="text-sm text-gray-600 mb-2">
                      Entered:
                      {' '}
                      {new Date(trace.enteredAt).toLocaleString()}
                      {trace.completedAt && ` | Completed: ${new Date(trace.completedAt).toLocaleString()}`}
                    </div>
                    {trace.fieldsCollected.length > 0 && (
                      <div className="text-sm mb-2">
                        <strong>Fields:</strong>
                        {' '}
                        {trace.fieldsCollected.join(', ')}
                      </div>
                    )}
                    {trace.toolsExecuted.length > 0 && (
                      <div className="text-sm mb-2">
                        <strong>Tools:</strong>
                        {' '}
                        {trace.toolsExecuted.map((tool, idx: number) => (
                          <Chip key={idx} size="sm" color={tool.success ? 'success' : 'danger'} className="mr-1">
                            {tool.toolName}
                            {' '}
                            {tool.success ? '✓' : '✗'}
                          </Chip>
                        ))}
                      </div>
                    )}
                    {trace.errorsEncountered.length > 0 && (
                      <div className="text-sm text-red-600">
                        <strong>Errors:</strong>
                        <ul className="list-disc list-inside">
                          {trace.errorsEncountered.map((error, idx: number) => (
                            <li key={idx}>{error.error}</li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardBody>
      </Card>

      {/* Stuck Flows */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Stuck Flows</h2>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHeader>
              <TableColumn>Conversation ID</TableColumn>
              <TableColumn>Flow</TableColumn>
              <TableColumn>Stage</TableColumn>
              <TableColumn>Entered At</TableColumn>
              <TableColumn>Channel</TableColumn>
            </TableHeader>
            <TableBody>
              {stuckFlows.map((flow) => (
                <TableRow key={flow.id}>
                  <TableCell>
                    {flow.conversationId.substring(0, 8)}
                    ...
                  </TableCell>
                  <TableCell>{flow.flowSlug}</TableCell>
                  <TableCell>{flow.stageSlug}</TableCell>
                  <TableCell>{new Date(flow.enteredAt).toLocaleString()}</TableCell>
                  <TableCell>{flow.conversation.channel}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {stuckFlows.length === 0 && (
            <div className="text-center text-gray-500 py-4">No stuck flows found</div>
          )}
        </CardBody>
      </Card>

      {/* Error Frequency */}
      <Card>
        <CardHeader>
          <h2 className="text-xl font-semibold">Error Frequency</h2>
        </CardHeader>
        <CardBody>
          <Table>
            <TableHeader>
              <TableColumn>Stage</TableColumn>
              <TableColumn>Tool</TableColumn>
              <TableColumn>Count</TableColumn>
            </TableHeader>
            <TableBody>
              {errorFrequency.map((error, idx) => (
                <TableRow key={idx}>
                  <TableCell>{error.stage}</TableCell>
                  <TableCell>{error.tool || 'N/A'}</TableCell>
                  <TableCell>
                    <Chip color="danger">{error.count}</Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {errorFrequency.length === 0 && (
            <div className="text-center text-gray-500 py-4">No errors recorded</div>
          )}
        </CardBody>
      </Card>
    </div>
  );
};
