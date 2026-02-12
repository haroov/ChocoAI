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
    }

    // Use a minimal set of boolean fields referenced by 03–06 ask_if
    const allFalse = {
      ch2_building_selected: false,
    };

    // If everything is false, these processes should not be relevant.
    for (const k of keys) {
      const askIf = String(byKey.get(k)?.ask_if || '');
      expect(evaluateCondition(askIf, allFalse)).toBe(false);
    }

    // They should become relevant only when building coverage was selected.
    for (const k of keys) {
      const askIf = String(byKey.get(k)?.ask_if || '');
      expect(evaluateCondition(askIf, { ...allFalse, ch2_building_selected: true })).toBe(true);
    }
  });
});

