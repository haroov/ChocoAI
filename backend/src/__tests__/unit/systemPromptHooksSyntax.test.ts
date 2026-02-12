import { chocoClalSmbTopicSplitProcessFlows } from '../../lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitProcessFlows';

function collectSystemPromptHookConditions(flowDef: any): Array<{ label: string; condition: string }> {
  const out: Array<{ label: string; condition: string }> = [];
  const stages = (flowDef && typeof flowDef === 'object' && flowDef.definition?.stages && typeof flowDef.definition.stages === 'object')
    ? flowDef.definition.stages
    : {};

  for (const [stageSlug, stage] of Object.entries(stages)) {
    const hooks = (stage as any)?.orchestration?.systemPromptHooks;
    const before = Array.isArray(hooks?.beforePrompt) ? hooks.beforePrompt : [];
    const after = Array.isArray(hooks?.afterPrompt) ? hooks.afterPrompt : [];
    for (const hook of [...before, ...after]) {
      const condition = String((hook as any)?.condition || '').trim();
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
    const all = flows.flatMap(collectSystemPromptHookConditions);

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

