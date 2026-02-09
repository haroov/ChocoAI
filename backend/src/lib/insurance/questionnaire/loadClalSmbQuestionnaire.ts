import fs from 'fs';
import path from 'path';
import { Questionnaire } from './types';

function firstExistingPath(candidates: string[], relativePaths: string[]): string | null {
  for (const base of candidates) {
    for (const rel of relativePaths) {
      const p = path.join(base, rel);
      if (fs.existsSync(p)) return p;
    }
  }
  return null;
}

function getRepoCandidates(): string[] {
  const cwd = process.cwd();
  return [
    cwd,
    path.join(cwd, '..'),
    path.join(cwd, '..', '..'),
  ];
}

export function loadClalSmbQuestionnaire(): Questionnaire {
  const candidates = getRepoCandidates();
  const p = firstExistingPath(candidates, [
    path.join('forms', 'Clal_SMB_Dynamic_Smart_Questionnaire.json'),
  ]);
  if (!p) {
    throw new Error('Clal SMB questionnaire JSON not found (expected forms/Clal_SMB_Dynamic_Smart_Questionnaire.json)');
  }
  const raw = fs.readFileSync(p, 'utf8');
  return JSON.parse(raw) as Questionnaire;
}

interface ManifestProcess {
  order: number;
  process_key: string;
  file: string;
  title_he: string;
  description_he: string;
  ask_if: string | null;
  audience: string;
  question_count: number;
  field_keys: string[];
  module_keys: string[];
  contains_attachments: boolean;
  contains_tables: boolean;
}

interface Manifest {
  meta: any;
  runtime?: {
    engine_contract?: any;
    conversation_policies?: any;
  };
  global_policies?: any;
  engine_contract?: any;
  process_order: string[];
  processes: ManifestProcess[];
}

export function loadClalSmbQuestionnaireProd(): Questionnaire {
  const candidates = getRepoCandidates();
  // Manifest path
  const p = firstExistingPath(candidates, [
    path.join('backend', 'docs', 'MANIFEST.PROD.json'),
    path.join('docs', 'MANIFEST.PROD.json'),
  ]);

  if (!p) {
    throw new Error('Clal SMB PROD questionnaire Manifest not found (expected backend/docs/MANIFEST.PROD.json)');
  }

  const manifestRaw = fs.readFileSync(p, 'utf8');
  const manifest = JSON.parse(manifestRaw) as Manifest;
  const docsDir = path.dirname(p);

  // Initialize Questionnaire Object
  const questionnaire: Questionnaire = {
    meta: manifest.meta,
    runtime: {
      engine_contract: manifest.engine_contract || manifest.runtime?.engine_contract,
      conversation_policies: manifest.global_policies || manifest.runtime?.conversation_policies,
    },
    stages: [],
    questions: [],
    handoff_triggers: [],
    attachments_checklist: [],
    modules_catalog: [], // Populated below if found, or empty if dependent on questions/processes
    production_validations: [],
  };

  // 1. Reconstruct Stages & Load Questions from Process Files
  if (Array.isArray(manifest.process_order) && Array.isArray(manifest.processes)) {
    const processMap = new Map<string, ManifestProcess>();
    for (const proc of manifest.processes) {
      processMap.set(proc.process_key, proc);
    }

    for (const processKey of manifest.process_order) {
      const processDef = processMap.get(processKey);
      if (!processDef) {
        console.warn(`Process key ${processKey} in order list but not in processes definition.`);
        continue;
      }

      // Load Process File
      const processFilePath = path.join(docsDir, processDef.file);
      if (!fs.existsSync(processFilePath)) {
        console.warn(`Process file not found: ${processFilePath}`);
        continue;
      }

      const processFileContent = JSON.parse(fs.readFileSync(processFilePath, 'utf8'));

      // Determine Stage Key - Override with Process Key to ensure alignment
      const stageKey = processKey;

      // Create Stage
      const stage: any = {
        stage_key: stageKey,
        title_he: processDef.title_he || processFileContent.process?.title_he,
        description_he: processDef.description_he || processFileContent.process?.description_he, // Map description to something if needed
        ask_if: processDef.ask_if || processFileContent.process?.ask_if,
        question_ids: [],
        intro_he: processDef.description_he, // Fallback: use description as intro? Or maybe default intro
      };

      // If the individual file has a "process" object with more fields, we could merge them.

      // Extract Questions
      if (Array.isArray(processFileContent.questions)) {
        for (const q of processFileContent.questions) {
          // IMPORTANT: Overwrite stage_key to match the Process Key
          // This ensures the engine finds them in this stage.
          q.stage_key = stageKey;

          questionnaire.questions.push(q);
          const qId = q.q_id;
          if (qId) stage.question_ids.push(qId);
        }
      }

      // Merge other arrays if present in process file
      if (Array.isArray(processFileContent.handoff_triggers)) {
        if (!questionnaire.handoff_triggers) questionnaire.handoff_triggers = [];
        questionnaire.handoff_triggers.push(...processFileContent.handoff_triggers);
      }
      if (Array.isArray(processFileContent.attachments_checklist)) {
        if (!questionnaire.attachments_checklist) questionnaire.attachments_checklist = [];
        questionnaire.attachments_checklist.push(...processFileContent.attachments_checklist);
      }
      if (Array.isArray(processFileContent.validators)) {
        if (!questionnaire.production_validations) questionnaire.production_validations = [];
        questionnaire.production_validations.push(...processFileContent.validators);
      }

      questionnaire.stages.push(stage);
    }
  }

  // 2. Modules Catalog
  // If the manifest doesn't have it, we might infer it or leave it empty if the engine relies on 'ask_if'
  // logic at the stage/question level instead of module toggle.
  // Given the extensive 'ask_if' logic seen in the manifest, explicit module catalog might be less critical
  // but let's check if we can populate it for completeness.
  // The 'modules' folder might still contain module definitions but the user deleted the main file.

  return questionnaire;
}
