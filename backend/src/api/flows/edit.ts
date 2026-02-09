import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { FlowSchema } from '../../lib/flowEngine';
import { validateFlowSchemaPayload } from './helpers/validateFlowSchemaPayload';
import { syncFlowToFiles } from './helpers/syncFlowToFiles';
import fs from 'node:fs';
import { buildTopicSplitProcessPrompt } from '../../lib/flowEngine/builtInFlows/chocoClalSmbTopicSplitProcessFlows';

registerRoute('put', '/api/v1/flows/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const body = req.body as any;
    const schema = body as FlowSchema;

    const metaFieldRenames: Record<string, string> | undefined = body?.__meta?.fieldRenames;

    const ZERO_WIDTH_AND_BIDI_RE = /[\u200B-\u200F\u202A-\u202E\u2060\u2066-\u2069\uFEFF]/g;
    const canonicalizeSlug = (v: unknown): string => String(v ?? '')
      .normalize('NFKC')
      .replace(ZERO_WIDTH_AND_BIDI_RE, '')
      .trim();

    const normalizeRenames = (renames?: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [fromRaw, toRaw] of Object.entries(renames || {})) {
        const from = canonicalizeSlug(fromRaw);
        const to = canonicalizeSlug(toRaw);
        if (!from || !to || from === to) continue;
        out[from] = to;
      }
      return out;
    };

    const mergeFieldDefs = (a: any, b: any) => {
      // Prefer "real" definitions over placeholders; keep truthy values.
      const out: any = { ...(a || {}) };
      for (const [k, v] of Object.entries(b || {})) {
        if (v === undefined) continue;
        if (k === 'description') {
          const cur = String(out.description ?? '').trim();
          const next = String(v ?? '').trim();
          const curIsAuto = cur.startsWith('[AUTO');
          const nextIsAuto = next.startsWith('[AUTO');
          if ((!cur && next) || (curIsAuto && next && !nextIsAuto)) out.description = next;
          continue;
        }
        if (out[k] === undefined || out[k] === null || out[k] === '') out[k] = v;
      }
      return out;
    };

    const composeRenames = (renames: Record<string, string>): Record<string, string> => {
      const out: Record<string, string> = {};
      for (const [from0, to0] of Object.entries(renames || {})) {
        const from = canonicalizeSlug(from0);
        const to = canonicalizeSlug(to0);
        if (!from || !to || from === to) continue;
        // Collapse chains (A->B and B->C becomes A->C).
        for (const [k, v] of Object.entries(out)) {
          if (v === from) out[k] = to;
        }
        out[from] = to;
      }
      return out;
    };

    const repairFlowSchemaInPlace = (flow: FlowSchema, renamesRaw: Record<string, string>) => {
      if (!flow?.definition || typeof flow.definition !== 'object') return { canonicalRenames: {} as Record<string, string> };

      const renames = composeRenames(normalizeRenames(renamesRaw));
      const canonicalRenames: Record<string, string> = {};

      // 1) Canonicalize field keys + merge duplicates
      const oldFields = (flow.definition as any).fields && typeof (flow.definition as any).fields === 'object'
        ? (flow.definition as any).fields as Record<string, any>
        : {};

      const canonicalizedFields: Record<string, any> = {};
      for (const [rawKey, def] of Object.entries(oldFields)) {
        const from = String(rawKey);
        const canon = canonicalizeSlug(rawKey);
        const key = canon || from;
        if (canon && canon !== from) canonicalRenames[from] = canon;
        canonicalizedFields[key] = canonicalizedFields[key] ? mergeFieldDefs(canonicalizedFields[key], def) : def;
      }
      (flow.definition as any).fields = canonicalizedFields;

      // 2) Apply explicit renames to field keys (move/merge)
      for (const [from, to] of Object.entries(renames)) {
        const f = canonicalizeSlug(from);
        const t = canonicalizeSlug(to);
        if (!f || !t || f === t) continue;
        const fields = (flow.definition as any).fields as Record<string, any>;
        if (!(f in fields)) continue;
        if (t in fields) {
          fields[t] = mergeFieldDefs(fields[t], fields[f]);
          delete fields[f];
        } else {
          fields[t] = fields[f];
          delete fields[f];
        }
      }

      // 3) Canonicalize + rename stage.fieldsToCollect
      const stages = (flow.definition as any).stages && typeof (flow.definition as any).stages === 'object'
        ? (flow.definition as any).stages as Record<string, any>
        : {};
      for (const stage of Object.values(stages)) {
        if (!stage || typeof stage !== 'object') continue;
        const list = Array.isArray(stage.fieldsToCollect) ? stage.fieldsToCollect : [];
        const mapped = list
          .map((x: any) => canonicalizeSlug(x))
          .filter(Boolean)
          .map((f: string) => renames[f] || f);
        stage.fieldsToCollect = Array.from(new Set(mapped));
      }

      // 4) Ensure every referenced field exists (create placeholders)
      const fields = (flow.definition as any).fields as Record<string, any>;
      for (const [stageSlug, stage] of Object.entries(stages)) {
        const list = Array.isArray(stage?.fieldsToCollect) ? stage.fieldsToCollect : [];
        for (const f of list) {
          if (typeof f !== 'string' || !f) continue;
          if (!(f in fields)) {
            fields[f] = { type: 'string', description: `[AUTO] Missing field referenced by stage '${stageSlug}'` };
          }
        }
      }

      return { canonicalRenames };
    };

    const migrateUserDataKeys = async (flowId: string, renames: Record<string, string>) => {
      const pairs = Object.entries(renames);
      if (pairs.length === 0) return;

      for (const [from, to] of pairs) {
        // Fetch all rows we may need to move
        const fromRows = await prisma.userData.findMany({
          where: { flowId, key: from },
          select: { id: true, userId: true },
        });
        if (fromRows.length === 0) continue;

        const existingTo = await prisma.userData.findMany({
          where: { flowId, key: to, userId: { in: fromRows.map((r) => r.userId) } },
          select: { userId: true },
        });
        const hasTo = new Set(existingTo.map((r) => r.userId));

        // If target already exists for that user, keep target and drop source.
        // Otherwise, rename the key in-place.
        await prisma.$transaction([
          ...fromRows
            .filter((r) => hasTo.has(r.userId))
            .map((r) => prisma.userData.delete({ where: { id: r.id } })),
          ...fromRows
            .filter((r) => !hasTo.has(r.userId))
            .map((r) => prisma.userData.update({ where: { id: r.id }, data: { key: to } })),
        ]);
      }
    };

    // Repair incoming schema so saves never get stuck on "unknown field".
    // This also strips invisible chars (zero-width/bidi marks) that can cause slugs to look identical in the UI.
    const renamesFromMeta = normalizeRenames(metaFieldRenames);
    const { canonicalRenames } = repairFlowSchemaInPlace(schema, renamesFromMeta);

    const v = validateFlowSchemaPayload(schema);
    if (!v.ok) return res.status(400).json({ ok: false, error: v.error });

    // Ensure slug uniqueness if changed
    const current = await prisma.flow.findUnique({ where: { id } });
    if (!current) return res.status(404).json({ ok: false, error: 'Flow not found' });
    if (current.slug !== schema.slug) {
      const dup = await prisma.flow.findUnique({ where: { slug: schema.slug } });
      if (dup) return res.status(409).json({ ok: false, error: 'Another flow with this slug exists' });
    }

    // Best-effort DB migration for renamed field slugs (user_data table).
    // This keeps historical collected data aligned after UI field renames.
    const renames = composeRenames({ ...canonicalRenames, ...renamesFromMeta });
    if (Object.keys(renames).length > 0) {
      // Only migrate to slugs that exist in the incoming schema (avoid renaming into nowhere)
      const allowedTargets = new Set(Object.keys(schema.definition?.fields || {}));
      const filtered: Record<string, string> = {};
      for (const [from, to] of Object.entries(renames)) {
        if (allowedTargets.has(to)) filtered[from] = to;
      }
      await migrateUserDataKeys(id, filtered);
    }

    const flow = await prisma.flow.update({
      where: { id },
      data: {
        name: schema.name,
        slug: schema.slug,
        version: schema.version + 1,
        description: schema.description,
        definition: schema.definition,
      },
    });

    const shouldSyncToFiles = (() => {
      const v = String(process.env.FLOW_SYNC_TO_FILES ?? '').trim();
      if (v) return v === '1' || v.toLowerCase() === 'true';
      const env = String(process.env.CHOCO_ENV || process.env.NODE_ENV || '').toLowerCase();
      return env !== 'production' && env !== 'staging';
    })();
    let fileSync: any = { ok: false, skipped: true, reason: 'disabled' };
    if (shouldSyncToFiles) {
      fileSync = syncFlowToFiles({ flowId: id, schema, renames });
    }

    // Live prompt regeneration for Topic-Split process flows:
    // When a user edits a flow in Settings (e.g., priorities/descriptions),
    // we sync to the process JSON file and then re-generate the `main.prompt`
    // so the runtime behavior updates immediately without requiring a server restart.
    try {
      const slug = String(schema?.slug || '').trim();
      const isTopicSplit = /^flow_(0[1-9]|1[0-9]|2[0-3])_/.test(slug);
      if (isTopicSplit && fileSync?.ok === true && Array.isArray(fileSync?.writtenFiles)) {
        const processKey = slug.slice('flow_'.length);
        const procPath = (fileSync.writtenFiles as string[])
          .find((p: string) => p.endsWith(`${processKey}.json`) && p.includes('chocoClalSmbTopicSplit'));
        if (procPath && fs.existsSync(procPath)) {
          const raw = fs.readFileSync(procPath, 'utf8');
          const procFile = JSON.parse(raw);
          const prompt = buildTopicSplitProcessPrompt(procFile);
          const currentMain = (schema as any)?.definition?.stages?.main || {};
          (schema as any).definition.stages.main = { ...currentMain, prompt };

          // Persist the regenerated prompt immediately.
          await prisma.flow.update({
            where: { id },
            data: {
              definition: (schema as any).definition,
            },
          });
        }
      }
    } catch {
      // best-effort; never block saving
    }

    if (fileSync?.ok === false && !fileSync?.skipped) {
      // eslint-disable-next-line no-console
      console.warn('[FlowSyncToFiles] failed', { flowId: id, slug: schema.slug, fileSync });
    }

    res.json({ ok: true, flow, fileSync });
  } catch (error: any) {
    res.status(500).json({ ok: false, error: 'Failed to update flow', message: error?.message });
  }
}, { protected: true });
