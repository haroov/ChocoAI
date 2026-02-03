import { makeAutoObservable, runInAction } from 'mobx';
import {
  FlowGraphEdge,
  FlowGraphNode,
  FlowSchema, FlowStageDefinition,
  FlowSummary,
  NewFlowPayload,
} from '../../types/flow';
import gentleAssign from '../../helpers/gentleAssign';
import { apiClientStore } from '../apiClientStore';
import { definitionToGraph } from './definitionToGraph';
import { ensureGraphLayout } from './ensureGraphLayout';
import { GraphValidationIssue, validateGraph } from './validateGraph';

class FlowStore {
  flows: FlowSummary[];
  isCreationPending: boolean;
  editorState?: {
    flow: FlowSchema;
    graphNodes: FlowGraphNode[];
    graphEdges: FlowGraphEdge[];
    graphIssues: GraphValidationIssue[];
    selectedStage: string | null;
    touched: boolean;
  };

  constructor() {
    this.flows = [];
    this.isCreationPending = false;
    this.editorState = undefined;

    makeAutoObservable(this);
  }

  async create(payload: NewFlowPayload) {
    this.isCreationPending = true;

    try {
      const resp = await apiClientStore.fetch('/api/v1/flows', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          definition: {
            stages: {
              intro: {
                description: 'Intro',
                fieldsToCollect: [],
              },
            },
            fields: {},
            config: {
              initialStage: 'intro',
            },
          },
        }),
      });
      const { status } = resp;
      const res = await resp.json();

      if (status !== 201) throw res;
      return res as { ok: boolean; flow: { id: string } };
    } finally {
      runInAction(() => { this.isCreationPending = false; });
    }
  }

  async loadList() {
    const resp = await apiClientStore.fetch('/api/v1/flows');

    const { status } = resp;
    const res = await resp.json();

    if (status !== 200 || !res.ok) throw res;

    const flows = res.flows as FlowSummary[];
    runInAction(() => { this.flows = flows; });

    return flows;
  }

  async delete(id: string) {
    const resp = await apiClientStore.fetch(`/api/v1/flows/${id}`, { method: 'DELETE' });

    const { status } = resp;
    const res = await resp.json();

    if (status !== 200 || !res.ok) throw res;

    runInAction(() => {
      this.flows = this.flows.filter((f) => f.id !== id);
    });
  }

  async loadFlow(id: string) {
    const resp = await apiClientStore.fetch(`/api/v1/flows/${id}`);

    const { status } = resp;
    const res = await resp.json();

    if (status !== 200 || !res.ok) throw res;

    const flow = res.flow as FlowSchema;
    runInAction(() => {
      const [rawGraphNodes, graphEdges] = definitionToGraph(flow.definition.stages);
      const graphNodes = ensureGraphLayout(rawGraphNodes, graphEdges, flow.definition.config.initialStage);

      this.editorState = {
        flow,
        graphNodes,
        graphEdges,
        graphIssues: validateGraph({
          nodes: graphNodes,
          edges: graphEdges,
          initial: flow.definition.config.initialStage,
        }),
        selectedStage: null,
        touched: false,
      };
    });

    return flow;
  }

  setEditorStateValue(value: DeepPartial<Omit<FlowSchema, 'id' | 'version'>>) {
    if (!this.editorState) return;

    this.editorState.flow = gentleAssign(this.editorState.flow, value);
    this.editorState.touched = true;
  }

  rewriteEditorStateValue(value: Partial<Omit<FlowSchema, 'id' | 'version'>>) {
    if (!this.editorState) return;

    for (const key of Object.keys(value)) {
      this.editorState.flow[key as never] = value[key as never] as never;
    }
    this.editorState.touched = true;
  }

  moveNode(nodeId: string, dx: number, dy: number) {
    if (!this.editorState) return;

    const node = this.editorState.graphNodes.find((n) => n.stageSlug === nodeId);
    if (!node) return;

    node.x += dx;
    node.y += dy;
  }

  addStage() {
    if (!this.editorState) return;

    let newStageSlug = 'stage_1';
    let ind = 1;

    while (this.editorState.flow.definition.stages[newStageSlug]) {
      ind += 1;
      newStageSlug = `stage_${ind}`;
    }

    this.editorState.flow.definition.stages[newStageSlug] = {
      description: '',
      fieldsToCollect: [],
    };

    this.editorState.graphNodes.push({
      stageSlug: newStageSlug,
      isFinal: true,
      x: 80 + (this.editorState.graphNodes.length % 3) * 240,
      y: 80 + Math.floor(this.editorState.graphNodes.length / 3) * 160,
    });

    this.editorState.touched = true;

    this.selectStage(newStageSlug);
  }

  setInitialStage(stageSlug: string) {
    if (!this.editorState) return;
    this.editorState.flow.definition.config.initialStage = stageSlug;
    this.editorState.touched = true;
  }

  deleteStage(stageSlug: string) {
    if (!this.editorState) return;
    delete this.editorState.flow.definition.stages[stageSlug];
    this.editorState.graphNodes = this.editorState.graphNodes
      .filter((n) => n.stageSlug !== stageSlug);
    this.editorState.graphEdges = this.editorState.graphEdges
      .filter((e) => e.from !== stageSlug && e.to !== stageSlug);
    this.editorState.touched = true;
  }

  selectStage(stageSlug: string | null) {
    if (!this.editorState) return;
    this.editorState.selectedStage = stageSlug;
  }

  changeStageSlug(stageSlug: string, newSlug: string) {
    if (!this.editorState) return;
    this.editorState.flow.definition.stages[newSlug] = this.editorState.flow.definition.stages[stageSlug];
    this.editorState.graphNodes = this.editorState.graphNodes
      .map((n) => n.stageSlug === stageSlug ? { ...n, stageSlug: newSlug } : n);
    this.editorState.graphEdges = this.editorState.graphEdges
      .map((e) => e.from === stageSlug ? { ...e, from: newSlug } : e)
      .map((e) => e.to === stageSlug ? { ...e, to: newSlug } : e);
    if (stageSlug === this.editorState.selectedStage) this.editorState.selectedStage = newSlug;
    delete this.editorState.flow.definition.stages[stageSlug];
    this.editorState.touched = true;
  }

  updateStage(stageSlug: string, data: Partial<FlowStageDefinition>) {
    if (!this.editorState) return;
    this.editorState.flow.definition.stages[stageSlug] = {
      ...this.editorState.flow.definition.stages[stageSlug],
      ...data,
    };
    if ('nextStage' in data) {
      const [, graphEdges] = definitionToGraph(this.editorState.flow.definition.stages);
      this.editorState.graphEdges = graphEdges;
    }
    this.editorState.touched = true;
  }

  // Draft management methods
  async saveDraft(flowId: string) {
    if (!this.editorState) return undefined;
    const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/draft`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ definition: this.editorState.flow.definition }),
    });
    const res = await resp.json();
    if (!res.ok) throw res;
    return res;
  }

  async loadDraft(flowId: string) {
    const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/draft`);
    const res = await resp.json();
    if (!res.ok) throw res;
    if (res.draft && this.editorState) {
      this.editorState.flow.definition = res.draft as FlowSchema['definition'];
      this.editorState.touched = true;
    }
    return res.draft;
  }

  async discardDraft(flowId: string) {
    const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/draft`, {
      method: 'DELETE',
    });
    const res = await resp.json();
    if (!res.ok) throw res;
    return res;
  }

  async applyDraft(flowId: string) {
    const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/draft/apply`, {
      method: 'POST',
    });
    const res = await resp.json();
    if (!res.ok) throw res;
    if (res.flow) {
      await this.loadFlow(flowId);
    }
    return res.flow;
  }
}

export const flowStore = new FlowStore();

type DeepPartial<Type> = {
  [Key in keyof Type]?: Type[Key] extends object ? DeepPartial<Type[Key]> : Type[Key];
};
