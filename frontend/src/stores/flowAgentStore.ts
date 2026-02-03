import { makeAutoObservable, runInAction } from 'mobx';
import { FlowSchema } from '../types/flow';
import { apiClientStore } from './apiClientStore';

export type AgentSuggestion = {
  id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  modifications: any;
  preview: FlowSchema;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  diff: any;
  description: string;
  timestamp: Date;
};

class FlowAgentStore {
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
  pendingSuggestions: AgentSuggestion[] = [];
  isProcessing: boolean = false;
  draftMode: boolean = false;

  constructor() {
    makeAutoObservable(this);
  }

  async sendMessage(flowId: string, message: string) {
    this.isProcessing = true;
    this.conversationHistory.push({ role: 'user', content: message });

    try {
      const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/agent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ instructions: message }),
      });

      const res = await resp.json();
      if (!res.ok) throw res;

      const suggestion: AgentSuggestion = {
        id: `suggestion-${Date.now()}`,
        modifications: res.modifications,
        preview: res.preview,
        diff: res.diff,
        description: res.modifications.description,
        timestamp: new Date(),
      };

      runInAction(() => {
        this.pendingSuggestions.push(suggestion);
        this.conversationHistory.push({
          role: 'assistant',
          content: `I've prepared changes: ${suggestion.description}. Review the preview below.`,
        });
      });

      return suggestion;
    } catch (error) {
      runInAction(() => {
        this.conversationHistory.push({
          role: 'assistant',
          // @ts-ignore
          content: `Sorry, I encountered an error: ${error?.error || error?.message || 'Unknown error'}`,
        });
      });
      throw error;
    } finally {
      runInAction(() => {
        this.isProcessing = false;
      });
    }
  }

  async applySuggestion(flowId: string, suggestionId: string, saveAsDraft: boolean = false) {
    const suggestion = this.pendingSuggestions.find((s) => s.id === suggestionId);
    if (!suggestion) throw new Error('Suggestion not found');

    try {
      const resp = await apiClientStore.fetch(`/api/v1/flows/${flowId}/agent/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          modifications: suggestion.modifications,
          saveAsDraft,
        }),
      });

      const res = await resp.json();
      if (!res.ok) throw res;

      runInAction(() => {
        this.pendingSuggestions = this.pendingSuggestions.filter((s) => s.id !== suggestionId);
        this.conversationHistory.push({
          role: 'assistant',
          content: saveAsDraft
            ? 'Changes saved as draft successfully.'
            : 'Changes applied successfully.',
        });
      });

      return res.flow;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
      runInAction(() => {
        this.conversationHistory.push({
          role: 'assistant',
          content: `Failed to apply changes: ${error?.error || error?.message || 'Unknown error'}`,
        });
      });
      throw error;
    }
  }

  rejectSuggestion(suggestionId: string) {
    runInAction(() => {
      this.pendingSuggestions = this.pendingSuggestions.filter((s) => s.id !== suggestionId);
      this.conversationHistory.push({
        role: 'assistant',
        content: 'Changes rejected. What would you like to modify instead?',
      });
    });
  }

  setDraftMode(enabled: boolean) {
    this.draftMode = enabled;
  }

  clearHistory() {
    this.conversationHistory = [];
    this.pendingSuggestions = [];
  }
}

export const flowAgentStore = new FlowAgentStore();
