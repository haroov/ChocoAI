import fs from 'fs';
import path from 'path';
import { evaluateCondition } from '../../lib/insurance/questionnaire/conditions';

function loadManifest(): any {
  const p = path.resolve(
    __dirname,
    '../../lib/flowEngine/builtInFlows/chocoClalSmbTopicSplit/MANIFEST.PROD.json',
  );
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw);
}

describe('MANIFEST.PROD.json ask_if expressions (03–06)', () => {
  test('ask_if for processes 03–06 evaluate as expected', () => {
    const manifest = loadManifest();
    const processes: any[] = Array.isArray(manifest?.processes) ? manifest.processes : [];

    const keys = new Set([
      '03_premises_building_characteristics',
      '04_premises_environment_and_water',
      '05_premises_security_fire_and_burglary',
      '06_premises_licenses_and_liens',
    ]);

    const byKey = new Map(processes.map((p: any) => [String(p.process_key), p]));

    // Sanity: ensure we are testing real manifest entries
    for (const k of keys) {
      expect(byKey.has(k)).toBe(true);
      expect(typeof byKey.get(k)?.ask_if).toBe('string');
      expect(String(byKey.get(k)?.ask_if)).toContain('OR');
    }

    // Use a minimal set of boolean fields referenced by 03–06 ask_if
    const allFalse = {
      has_physical_premises: false,
      ch1_contents_selected: false,
      ch2_building_selected: false,
      ch4_burglary_selected: false,
      ch5_money_selected: false,
      ch10_electronic_selected: false,
    };

    // If the user has physical premises, these processes should be relevant.
    for (const k of keys) {
      const askIf = String(byKey.get(k)?.ask_if || '');
      expect(evaluateCondition(askIf, { ...allFalse, has_physical_premises: true })).toBe(true);
    }

    // If everything is false, these processes should not be relevant.
    for (const k of keys) {
      const askIf = String(byKey.get(k)?.ask_if || '');
      expect(evaluateCondition(askIf, allFalse)).toBe(false);
    }

    // If contents coverage was selected, they should be relevant even without physical premises.
    for (const k of keys) {
      const askIf = String(byKey.get(k)?.ask_if || '');
      expect(evaluateCondition(askIf, { ...allFalse, ch1_contents_selected: true })).toBe(true);
    }
  });
});

