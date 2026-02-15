import { chocoClalSmbTopicSplitProcessFlows } from '../../lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitProcessFlows';
import type { JsonValue } from '../../utils/json';
import { asJsonObject } from '../../utils/json';

function collectSystemPromptHookConditions(flowDef: any): Array<{ label: string; condition: string }> {
  const out: Array<{ label: string; condition: string }> = [];
  const defObj = asJsonObject(flowDef.definition ?? null);
  const stagesObj = asJsonObject(defObj?.stages ?? null) || {};

  for (const [stageSlug, stageVal] of Object.entries(stagesObj)) {
    const stageObj = asJsonObject(stageVal);
    const orchestrationObj = asJsonObject(stageObj?.orchestration ?? null);
    const hooksObj = asJsonObject(orchestrationObj?.systemPromptHooks ?? null);
    const before = Array.isArray(hooksObj?.beforePrompt) ? hooksObj.beforePrompt : [];
    const after = Array.isArray(hooksObj?.afterPrompt) ? hooksObj.afterPrompt : [];
    for (const hook of [...before, ...after]) {
      const hookObj = asJsonObject(hook as JsonValue);
      const condition = String(hookObj?.condition || '').trim();
      if (!condition) continue;
      const label = `${String(flowDef?.slug || flowDef?.name || 'flow')}:${String(stageSlug)}`;
      out.push({ label, condition });
    }
  }

  return out;
}

describe('systemPromptHooks condition syntax', () => {
  test('all systemPromptHooks conditions compile as valid JS', () => {
    const flows = Array.isArray(chocoClalSmbTopicSplitProcessFlows) ? chocoClalSmbTopicSplitProcessFlows : [];
    const all = (flows as any[]).flatMap((f) => collectSystemPromptHookConditions(f));

    // Ensure we are actually validating something (avoid false-green test if flows change).
    expect(all.length).toBeGreaterThan(0);

    for (const { label, condition } of all) {
      expect(() => {
        // Only compile (no execution): catches SyntaxError like "Unexpected identifier 'as'".
        // Note: hooks are evaluated with kseval using { userData, templateContext, stage }.
        // We compile with these identifiers available to match runtime expectations.
        // eslint-disable-next-line no-new-func
        new Function('userData', 'templateContext', 'stage', `return (${condition});`);
      }).not.toThrow(`Condition failed to compile for ${label}:\n${condition}`);
    }
  });
});

