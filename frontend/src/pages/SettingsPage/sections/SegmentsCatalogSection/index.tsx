/* eslint-disable @typescript-eslint/no-explicit-any, max-len, react/jsx-one-expression-per-line, consistent-return, no-multiple-empty-lines */
import React from 'react';
import { useTranslations } from 'use-intl';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Chip,
  CircularProgress,
  Divider,
  Input,
  Tab,
  Tabs,
  Textarea,
} from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMainLayout } from '../../../../layouts/MainLayout';
import { apiClientStore } from '../../../../stores/apiClientStore';
import { app } from '../../../../helpers/app';
import { SectionHeader } from '../../components/SectionHeader';
import { SectionContent } from '../../components/SectionContent';

type SegmentsCatalogProd = {
  catalog_id: string;
  catalog_version: string;
  environment: string;
  insurance_products?: any[];
  segment_groups: any[];
  segments: any[];
  [k: string]: any;
};

type CatalogApiResponse = {
  ok: boolean;
  catalog: SegmentsCatalogProd;
  source: 'db' | 'file';
  overrideUpdatedAt?: string;
  overrideMeta?: { notes?: string; updatedBy?: string } | null;
};

function deepClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

function safeJsonStringify(v: unknown): string {
  try { return JSON.stringify(v, null, 2); } catch { return ''; }
}

function normalize(s: unknown): string {
  return String(s ?? '').toLowerCase().trim();
}

function pickLabel(v: any, fallbackKey: string): string {
  return String(v?.segment_name_he || v?.group_name_he || v?.package_name_he || v?.product_name_he || v?.name || v?.[fallbackKey] || '').trim();
}

const COVERAGE_OPTIONS: Array<{ key: string; labelHe: string }> = [
  { key: 'building', labelHe: 'מבנה' },
  { key: 'contents', labelHe: 'תכולה' },
  { key: 'stock', labelHe: 'מלאי' },
  { key: 'burglary', labelHe: 'פריצה / שוד' },
  { key: 'money', labelHe: 'כספים' },
  { key: 'transit', labelHe: 'רכוש בהעברה' },
  { key: 'business_interruption_daily_compensation', labelHe: 'אובדן הכנסה' },
  { key: 'third_party', labelHe: 'צד ג׳' },
  { key: 'employers_liability', labelHe: 'חבות מעבידים' },
  { key: 'product_liability', labelHe: 'אחריות מוצר' },
  { key: 'electronic_equipment', labelHe: 'ציוד אלקטרוני' },
  { key: 'cyber', labelHe: 'סייבר' },
  { key: 'terror', labelHe: 'טרור' },
  // Optional extras (from CSV)
  { key: 'professional_indemnity', labelHe: 'אחריות מקצועית' },
  { key: 'medical_malpractice', labelHe: 'רשלנות רפואית' },
];

const SITE_TYPE_OPTIONS_HE: string[] = [
  'משרד',
  'חנות',
  'קליניקה',
  'סטודיו',
  'גלריה',
  'בית מלאכה',
  'בית חרושת',
  'מפעל',
  'מחסן',
  'מטבח',
  'אולם',
];

function makeNewId(prefix: string): string {
  return `${prefix}${Date.now()}`;
}

function parseKeywordsTextToList(text: unknown): string[] {
  return String(text || '')
    .split(/\r?\n|,|!/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export const SegmentsCatalogSection: React.FC = () => {
  const t = useTranslations('SettingsPage');
  const tCommon = useTranslations('Common');

  useMainLayout({ title: t('segments') });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { segmentId: segmentIdFromUrl } = useParams();
  const missingSegmentNotifiedRef = React.useRef<string | null>(null);

  const [draft, setDraft] = React.useState<SegmentsCatalogProd | null>(null);
  const [dirty, setDirty] = React.useState(false);

  const [searchGroups, setSearchGroups] = React.useState('');
  const [searchSegments, setSearchSegments] = React.useState('');

  const [selectedGroupId, setSelectedGroupId] = React.useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = React.useState<string | null>(null);

  const [groupJson, setGroupJson] = React.useState('');
  const [segmentJson, setSegmentJson] = React.useState('');

  const [isEditingGroupJson, setIsEditingGroupJson] = React.useState(false);
  const [isEditingSegmentJson, setIsEditingSegmentJson] = React.useState(false);

  const [keywordsText, setKeywordsText] = React.useState('');
  const [isEditingKeywordsText, setIsEditingKeywordsText] = React.useState(false);

  const [rawJson, setRawJson] = React.useState<string>('');
  const [rawJsonChanged, setRawJsonChanged] = React.useState(false);

  const [newGroupId, setNewGroupId] = React.useState('');
  const [newGroupNameHe, setNewGroupNameHe] = React.useState('');

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: ['segmentsCatalog', 'prod'],
    queryFn: async () => {
      const resp = await apiClientStore.fetch('/api/v1/segments-catalog/prod');
      const res = await resp.json();
      if (!resp.ok || !res.ok) throw res;
      return res as CatalogApiResponse;
    },
  });

  React.useEffect(() => {
    if (!data?.catalog) return;
    const cloned = deepClone(data.catalog);
    setDraft(cloned);
    setDirty(false);
    setRawJson(safeJsonStringify(cloned));
    setRawJsonChanged(false);

    // Best-effort selection defaults
    const urlSegId = String(segmentIdFromUrl || '').trim();
    const firstGroupId = String(cloned.segment_groups?.[0]?.group_id || '').trim() || null;
    const firstSegmentId = String(cloned.segments?.[0]?.segment_id || '').trim() || null;
    setSelectedGroupId((prev) => prev ?? firstGroupId);
    // When deep-linking to a segment, let the URL drive selection.
    if (!urlSegId) setSelectedSegmentId((prev) => prev ?? firstSegmentId);
  }, [data?.catalog, segmentIdFromUrl]);

  // URL -> selected segment
  React.useEffect(() => {
    if (!draft) return;
    const id = String(segmentIdFromUrl || '').trim();
    if (!id) return;
    const seg = Array.isArray(draft.segments)
      ? draft.segments.find((s: any) => String(s?.segment_id || '').trim() === id)
      : undefined;
    if (!seg) {
      if (missingSegmentNotifiedRef.current !== id) {
        missingSegmentNotifiedRef.current = id;
        app.notification.error(`Segment not found: ${id}`);
      }
      navigate('/settings/segments', { replace: true });
      return;
    }
    setSelectedSegmentId((prev) => (prev === id ? prev : id));
    const groupId = String(seg?.segment_group_id || '').trim();
    if (groupId) setSelectedGroupId(groupId);
  }, [draft, segmentIdFromUrl]);

  // Keep raw JSON view in sync with the current draft,
  // unless the user is editing the raw JSON text and hasn't applied it yet.
  React.useEffect(() => {
    if (!draft) return;
    if (rawJsonChanged) return;
    setRawJson(safeJsonStringify(draft));
  }, [draft, rawJsonChanged]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft) return;
      // Avoid fighting IME / cursor movement: keywords textarea is edited as plain text,
      // then parsed into the segment keywords array on save.
      const draftToSave = (() => {
        const segId = String(selectedSegmentId || '').trim();
        if (!segId) return draft;
        const next = deepClone(draft);
        const idx = next.segments.findIndex((s: any) => String(s?.segment_id) === segId);
        if (idx >= 0) next.segments[idx].keywords = parseKeywordsTextToList(keywordsText);
        return next;
      })();
      const resp = await apiClientStore.fetch('/api/v1/segments-catalog/prod', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...draftToSave,
          __meta: {
            // Optimistic concurrency: prevents stale tabs from wiping fields.
            baseOverrideUpdatedAt: data?.overrideUpdatedAt,
          },
        }),
      });
      const res = await resp.json();
      if (!resp.ok || !res.ok) throw res;
      return res as any;
    },
    onSuccess: async () => {
      // Verify DB is the source-of-truth by reloading after save.
      try {
        const verifyResp = await apiClientStore.fetch('/api/v1/segments-catalog/prod');
        const verifyRes = await verifyResp.json();
        if (!verifyResp.ok || !verifyRes?.ok) throw verifyRes;
        if (verifyRes?.source !== 'db') {
          app.notification.error('Saved, but catalog source is not DB. Please check server logs.');
        }
      } catch {
        // Ignore verification failures (network / parse), but keep UX smooth.
      }
      await queryClient.invalidateQueries({ queryKey: ['segmentsCatalog', 'prod'] });
      app.notification.success(tCommon('save'));
    },
    onError: (err: any) => {
      // Concurrency conflict: another admin/tab saved a newer version.
      if (err?.error === 'Conflict') {
        app.notification.error('הקטלוג עודכן בינתיים (טאב/משתמש אחר). רענן ונסה שוב.');
        queryClient.invalidateQueries({ queryKey: ['segmentsCatalog', 'prod'] });
        return;
      }
      app.notification.error(err?.error || err?.message || 'Failed to save');
    },
  });

  const setDraftPatched = (fn: (cur: SegmentsCatalogProd) => SegmentsCatalogProd) => {
    setDraft((cur) => {
      if (!cur) return cur;
      const next = fn(cur);
      setDirty(true);
      return next;
    });
  };

  const sourceBadge = data?.source === 'db'
    ? { label: 'DB override', color: 'warning' as const }
    : { label: 'File', color: 'default' as const };

  const selectedGroup = React.useMemo(() => (
    draft?.segment_groups?.find((g: any) => String(g?.group_id) === String(selectedGroupId))
  ), [draft, selectedGroupId]);

  const selectedSegment = React.useMemo(() => (
    draft?.segments?.find((s: any) => String(s?.segment_id) === String(selectedSegmentId))
  ), [draft, selectedSegmentId]);

  React.useEffect(() => {
    if (selectedGroup && !isEditingGroupJson) setGroupJson(safeJsonStringify(selectedGroup));
    if (!selectedGroupId && !isEditingGroupJson) setGroupJson('');
  }, [selectedGroupId, selectedGroup, isEditingGroupJson]);

  React.useEffect(() => {
    if (selectedSegment && !isEditingSegmentJson) setSegmentJson(safeJsonStringify(selectedSegment));
    if (!selectedSegmentId && !isEditingSegmentJson) setSegmentJson('');
  }, [selectedSegmentId, selectedSegment, isEditingSegmentJson]);

  React.useEffect(() => {
    if (!selectedSegment) {
      if (!isEditingKeywordsText) setKeywordsText('');
      return;
    }
    if (isEditingKeywordsText) return;
    setKeywordsText(String((selectedSegment.keywords || []).join('\n')));
  }, [selectedSegmentId, selectedSegment, isEditingKeywordsText]);

  const filteredGroups = React.useMemo(() => {
    const q = normalize(searchGroups);
    const items = Array.isArray(draft?.segment_groups) ? draft!.segment_groups : [];
    if (!q) return items;
    return items.filter((g: any) => {
      const hay = [g.group_id, g.group_name_he, g.default_site_type_he, g.default_package_key].map(normalize).join(' | ');
      return hay.includes(q);
    });
  }, [draft, searchGroups]);

  const filteredSegments = React.useMemo(() => {
    const q = normalize(searchSegments);
    const itemsRaw = Array.isArray(draft?.segments) ? draft!.segments : [];
    const items = itemsRaw;
    if (!q) return items;
    return items.filter((s: any) => {
      const hay = [
        s.segment_id,
        s.segment_name_he,
        s.segment_group_id,
        s.business_profile_defaults?.primary_activity_he,
        s.business_profile_defaults?.site_type_he,
        ...(Array.isArray(s.keywords) ? s.keywords : []),
      ].map(normalize).join(' | ');
      return hay.includes(q);
    });
  }, [draft, searchSegments]);

  const updateSelectedJson = (kind: 'group' | 'segment', jsonText: string) => {
    if (!draft) return;
    let parsed: any;
    try {
      parsed = JSON.parse(jsonText);
    } catch (e: any) {
      app.notification.error(`Invalid JSON: ${e?.message || 'parse error'}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      app.notification.error('JSON must be an object');
      return;
    }

    setDraftPatched((cur) => {
      const next = deepClone(cur);
      if (kind === 'group') {
        const idx = next.segment_groups.findIndex((g: any) => String(g?.group_id) === String(selectedGroupId));
        if (idx >= 0) next.segment_groups[idx] = parsed;
      } else if (kind === 'segment') {
        const idx = next.segments.findIndex((s: any) => String(s?.segment_id) === String(selectedSegmentId));
        if (idx >= 0) next.segments[idx] = parsed;
      }
      return next;
    });
  };

  const applyRawJson = () => {
    if (!rawJson) return;
    let parsed: any;
    try { parsed = JSON.parse(rawJson); } catch (e: any) {
      app.notification.error(`Invalid JSON: ${e?.message || 'parse error'}`);
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      app.notification.error('JSON must be an object');
      return;
    }
    setDraft(parsed as SegmentsCatalogProd);
    setDirty(true);
    setRawJsonChanged(false);
  };

  return (
    <div className="h-full flex flex-col">
      <SectionHeader
        title={(
          <div className="flex items-center gap-3">
            <span>{t('segments')}</span>
            <Chip size="sm" variant="flat" color={sourceBadge.color}>{sourceBadge.label}</Chip>
            {data?.overrideUpdatedAt && (
              <span className="text-tiny text-default-500">
                {new Date(data.overrideUpdatedAt).toLocaleString()}
              </span>
            )}
          </div>
        )}
        actions={[
          {
            id: 'add-segment',
            variant: 'flat',
            color: 'primary',
            onPress: () => {
              if (!draft) return;
              const groupId = String(selectedGroupId || draft.segment_groups?.[0]?.group_id || '').trim();
              const segId = makeNewId('custom_');
              setDraftPatched((cur) => {
                const next = deepClone(cur);
                next.segments = Array.isArray(next.segments) ? next.segments : [];
                next.segments.unshift({
                  segment_id: segId,
                  segment_name_he: '',
                  segment_group_id: groupId || undefined,
                  keywords: [],
                  coverages: {},
                });
                return next;
              });
              setSelectedSegmentId(segId);
              navigate(`/settings/segments/${encodeURIComponent(segId)}`, { replace: true });
              app.notification.success('New segment added to draft. Fill details, then Save.');
            },
            isDisabled: isPending || !draft || saveMutation.isPending,
            children: 'Add segment',
          },
          {
            id: 'save',
            color: 'primary',
            onPress: () => saveMutation.mutate(),
            isLoading: saveMutation.isPending,
            isDisabled: isPending || !dirty,
            children: tCommon('save'),
          },
        ]}
      />

      <SectionContent>
        {isPending && (
          <div className="flex justify-center items-center h-48">
            <CircularProgress aria-label={`${tCommon('loading')}...`} />
          </div>
        )}

        {isError && (
          <Card shadow="sm" className="border border-default-200">
            <CardBody className="text-danger">
              Failed to load segments catalog.
              <Button className="mt-3" size="sm" variant="flat" color="primary" onPress={() => refetch()}>
                {tCommon('tryAgain')}
              </Button>
            </CardBody>
          </Card>
        )}

        {!isPending && !isError && draft && (
          <Tabs aria-label="Segments catalog editor" variant="bordered" defaultSelectedKey="segments">
            <Tab key="groups" title="Segment groups">
              <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
                <Card shadow="sm" className="border border-default-200">
                  <CardHeader className="flex flex-col items-stretch gap-3">
                    <Input
                      size="sm"
                      label={tCommon('search')}
                      value={searchGroups}
                      onValueChange={setSearchGroups}
                    />
                    <Card shadow="none" className="border border-default-200">
                      <CardBody className="grid gap-2">
                        <div className="text-small font-semibold">Create new group</div>
                        <Input
                          size="sm"
                          label="group_id"
                          placeholder="e.g. business-services"
                          value={newGroupId}
                          onValueChange={setNewGroupId}
                        />
                        <Input
                          size="sm"
                          label="group_name_he"
                          value={newGroupNameHe}
                          onValueChange={setNewGroupNameHe}
                        />
                        <Button
                          size="sm"
                          color="primary"
                          variant="flat"
                          isDisabled={!String(newGroupId || '').trim()}
                          onPress={() => {
                            const id = String(newGroupId || '').trim();
                            const nameHe = String(newGroupNameHe || '').trim();
                            setDraftPatched((cur) => {
                              const next = deepClone(cur);
                              next.segment_groups = Array.isArray(next.segment_groups) ? next.segment_groups : [];
                              const exists = next.segment_groups.some((g: any) => String(g?.group_id) === id);
                              if (exists) {
                                app.notification.error('group_id already exists');
                                return next;
                              }
                              next.segment_groups.unshift({
                                group_id: id,
                                group_name_he: nameHe || undefined,
                              });
                              return next;
                            });
                            setSelectedGroupId(id);
                            setNewGroupId('');
                            setNewGroupNameHe('');
                          }}
                        >
                          Add group
                        </Button>
                      </CardBody>
                    </Card>
                    <div className="text-tiny text-default-500">
                      {filteredGroups.length} groups
                    </div>
                  </CardHeader>
                  <Divider />
                  <CardBody className="p-2 max-h-[70vh] overflow-auto">
                    <div className="flex flex-col gap-1">
                      {filteredGroups.map((g: any) => {
                        const id = String(g?.group_id || '');
                        const active = id && id === selectedGroupId;
                        return (
                          <Button
                            key={id}
                            size="sm"
                            variant={active ? 'flat' : 'light'}
                            color={active ? 'primary' : 'default'}
                            className="justify-start"
                            onPress={() => setSelectedGroupId(id)}
                          >
                            <span className="truncate">{pickLabel(g, 'group_id') || id}</span>
                            <span className="ml-2 text-tiny text-default-500 truncate">{id}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>

                <Card shadow="sm" className="border border-default-200">
                  <CardHeader className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-medium font-semibold truncate">
                        {selectedGroup ? (selectedGroup.group_name_he || selectedGroup.group_id) : '—'}
                      </div>
                      <div className="text-tiny text-default-500 truncate">
                        {selectedGroup ? selectedGroup.group_id : ''}
                      </div>
                    </div>
                  </CardHeader>
                  <Divider />
                  <CardBody className="grid gap-3">
                    {!selectedGroup && <div className="text-small text-default-500">Select a group.</div>}
                    {selectedGroup && (
                      <>
                        <Input
                          label="group_id"
                          value={String(selectedGroup.group_id || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segment_groups.findIndex((x: any) => String(x?.group_id) === String(selectedGroup.group_id));
                            if (idx < 0) return next;
                            const newId = String(v || '').trim();
                            if (!newId) return next;
                            const exists = next.segment_groups.some((x: any, i: number) => i !== idx && String(x?.group_id) === newId);
                            if (exists) {
                              app.notification.error('group_id already exists');
                              return next;
                            }
                            const oldId = String(next.segment_groups[idx].group_id || '').trim();
                            next.segment_groups[idx].group_id = newId;
                            // Update segments referencing this group id
                            if (oldId && Array.isArray(next.segments)) {
                              for (const s of next.segments) {
                                if (String(s?.segment_group_id || '') === oldId) s.segment_group_id = newId;
                              }
                            }
                            setSelectedGroupId(newId);
                            return next;
                          })}
                        />
                        <Input
                          label="group_name_he"
                          value={String(selectedGroup.group_name_he || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segment_groups.findIndex((x: any) => String(x?.group_id) === String(selectedGroup.group_id));
                            if (idx >= 0) next.segment_groups[idx].group_name_he = v;
                            return next;
                          })}
                        />
                        <Input
                          label="default_site_type_he"
                          value={String(selectedGroup.default_site_type_he || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segment_groups.findIndex((x: any) => String(x?.group_id) === String(selectedGroup.group_id));
                            if (idx >= 0) next.segment_groups[idx].default_site_type_he = v;
                            return next;
                          })}
                        />

                        <Textarea
                          label="JSON"
                          minRows={10}
                          className="font-mono"
                          value={groupJson}
                          onFocus={() => setIsEditingGroupJson(true)}
                          onValueChange={setGroupJson}
                          onBlur={() => {
                            setIsEditingGroupJson(false);
                            updateSelectedJson('group', groupJson);
                          }}
                        />
                        <div className="text-tiny text-default-500">
                          Tip: edit JSON then click outside to apply.
                        </div>
                      </>
                    )}
                  </CardBody>
                </Card>
              </div>
            </Tab>

            <Tab key="segments" title="Segments">
              <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
                <Card shadow="sm" className="border border-default-200">
                  <CardHeader className="flex flex-col items-stretch gap-3">
                    <Input
                      size="sm"
                      label={tCommon('search')}
                      value={searchSegments}
                      onValueChange={setSearchSegments}
                    />
                    <div className="text-tiny text-default-500">
                      {filteredSegments.length} segments
                    </div>
                  </CardHeader>
                  <Divider />
                  <CardBody className="p-2 max-h-[70vh] overflow-auto">
                    <div className="flex flex-col gap-1">
                      {filteredSegments.map((s: any) => {
                        const id = String(s?.segment_id || '');
                        const active = id && id === selectedSegmentId;
                        return (
                          <Button
                            key={id}
                            size="sm"
                            variant={active ? 'flat' : 'light'}
                            color={active ? 'primary' : 'default'}
                            className="justify-start"
                            onPress={() => {
                              setSelectedSegmentId(id);
                              // Avoid a race where the user clicks a segment then immediately hits Save:
                              // sync keywordsText from the clicked row now (instead of waiting for useEffect).
                              if (!isEditingKeywordsText) {
                                const nextKeywords = Array.isArray(s?.keywords) ? s.keywords : [];
                                setKeywordsText(String(nextKeywords.join('\n')));
                              }
                              navigate(`/settings/segments/${encodeURIComponent(id)}`);
                            }}
                          >
                            <span className="truncate">{pickLabel(s, 'segment_id') || id}</span>
                            <span className="ml-2 text-tiny text-default-500 truncate">{String(s?.segment_group_id || '')}</span>
                          </Button>
                        );
                      })}
                    </div>
                  </CardBody>
                </Card>

                <Card shadow="sm" className="border border-default-200">
                  <CardHeader className="flex items-center justify-between">
                    <div className="min-w-0">
                      <div className="text-medium font-semibold truncate">
                        {selectedSegment ? (selectedSegment.segment_name_he || selectedSegment.segment_id) : '—'}
                      </div>
                      <div className="text-tiny text-default-500 truncate">
                        {selectedSegment ? `${selectedSegment.segment_id} • ${selectedSegment.segment_group_id || ''}` : ''}
                      </div>
                    </div>
                  </CardHeader>
                  <Divider />
                  <CardBody className="grid gap-3">
                    {!selectedSegment && <div className="text-small text-default-500">Select a segment.</div>}
                    {selectedSegment && (
                      <>
                        <Input
                          label="segment_id"
                          value={String(selectedSegment.segment_id || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx < 0) return next;
                            const newId = String(v || '').trim();
                            if (!newId) return next;
                            const exists = next.segments.some((x: any, i: number) => i !== idx && String(x?.segment_id) === newId);
                            if (exists) {
                              app.notification.error('segment_id already exists');
                              return next;
                            }
                            next.segments[idx].segment_id = newId;
                            setSelectedSegmentId(newId);
                            return next;
                          })}
                          onBlur={() => {
                            const id = String(selectedSegmentId || '').trim();
                            if (id) navigate(`/settings/segments/${encodeURIComponent(id)}`, { replace: true });
                          }}
                        />
                        <Input
                          label="segment_name_he"
                          value={String(selectedSegment.segment_name_he || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx >= 0) next.segments[idx].segment_name_he = v;
                            return next;
                          })}
                        />
                        <Input
                          label="segment_group_id"
                          value={String(selectedSegment.segment_group_id || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx >= 0) next.segments[idx].segment_group_id = String(v || '').trim();
                            return next;
                          })}
                        />
                        <Input
                          label="business_site_type"
                          placeholder="לדוגמה: משרד / חנות / קליניקה"
                          value={String(selectedSegment.business_profile_defaults?.site_type_he || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx >= 0) {
                              next.segments[idx].business_profile_defaults = next.segments[idx].business_profile_defaults || {};
                              next.segments[idx].business_profile_defaults.site_type_he = v;
                            }
                            return next;
                          })}
                        />
                        <div className="flex flex-wrap gap-2">
                          {SITE_TYPE_OPTIONS_HE.map((opt) => (
                            <Button
                              key={opt}
                              size="sm"
                              variant="flat"
                              onPress={() => setDraftPatched((cur) => {
                                const next = deepClone(cur);
                                const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                                if (idx >= 0) {
                                  next.segments[idx].business_profile_defaults = next.segments[idx].business_profile_defaults || {};
                                  next.segments[idx].business_profile_defaults.site_type_he = opt;
                                }
                                return next;
                              })}
                            >
                              {opt}
                            </Button>
                          ))}
                        </div>
                        <Input
                          label="choco_product_slugs (comma-separated)"
                          value={String((selectedSegment.choco_product_slugs || []).join(', '))}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx >= 0) {
                              const slugs = String(v || '')
                                .split(',')
                                .map((x) => x.trim())
                                .filter(Boolean);
                              next.segments[idx].choco_product_slugs = slugs;
                            }
                            return next;
                          })}
                        />
                        <Input
                          label="primary_activity_he"
                          value={String(selectedSegment.business_profile_defaults?.primary_activity_he || '')}
                          onValueChange={(v) => setDraftPatched((cur) => {
                            const next = deepClone(cur);
                            const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                            if (idx >= 0) {
                              next.segments[idx].business_profile_defaults = next.segments[idx].business_profile_defaults || {};
                              next.segments[idx].business_profile_defaults.primary_activity_he = v;
                            }
                            return next;
                          })}
                        />

                        <Textarea
                          label="keywords / aliases (one per line)"
                          minRows={4}
                          value={keywordsText}
                          onFocus={() => setIsEditingKeywordsText(true)}
                          onValueChange={(v) => {
                            setKeywordsText(v);
                            setDirty(true);
                          }}
                          onBlur={() => {
                            setIsEditingKeywordsText(false);
                            setDraftPatched((cur) => {
                              const next = deepClone(cur);
                              const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                              if (idx >= 0) next.segments[idx].keywords = parseKeywordsTextToList(keywordsText);
                              return next;
                            });
                          }}
                        />

                        <div className="grid gap-2">
                          <div className="text-small font-semibold">Default coverages</div>
                          <div className="grid grid-cols-2 gap-2">
                            {COVERAGE_OPTIONS.map((opt) => (
                              <Checkbox
                                key={opt.key}
                                isSelected={Boolean(selectedSegment.coverages?.[opt.key])}
                                onValueChange={(checked) => setDraftPatched((cur) => {
                                  const next = deepClone(cur);
                                  const idx = next.segments.findIndex((x: any) => String(x?.segment_id) === String(selectedSegment.segment_id));
                                  if (idx >= 0) {
                                    next.segments[idx].coverages = next.segments[idx].coverages || {};
                                    next.segments[idx].coverages[opt.key] = Boolean(checked);
                                  }
                                  return next;
                                })}
                              >
                                <span className="text-small">{opt.labelHe}</span>
                              </Checkbox>
                            ))}
                          </div>
                        </div>

                        <Button
                          color="danger"
                          variant="flat"
                          onPress={() => {
                            const ok = window.confirm('Delete this segment from the catalog draft? (Remember to Save)');
                            if (!ok) return;
                            setDraftPatched((cur) => {
                              const next = deepClone(cur);
                              const id = String(selectedSegment.segment_id || '').trim();
                              if (!id) return next;
                              next.segments = Array.isArray(next.segments) ? next.segments : [];
                              next.segments = next.segments.filter((s: any) => (
                                String(s?.segment_id || '').trim() !== id
                              ));
                              const nextSelected = next.segments[0];
                              setSelectedSegmentId(nextSelected ? String(nextSelected.segment_id || '') : null);
                              return next;
                            });
                          }}
                        >
                          Delete segment
                        </Button>

                        <Textarea
                          label="JSON"
                          minRows={10}
                          className="font-mono"
                          value={segmentJson}
                          onFocus={() => setIsEditingSegmentJson(true)}
                          onValueChange={setSegmentJson}
                          onBlur={() => {
                            setIsEditingSegmentJson(false);
                            updateSelectedJson('segment', segmentJson);
                          }}
                        />
                        <div className="text-tiny text-default-500">
                          Tip: edit JSON then click outside to apply.
                        </div>
                      </>
                    )}
                  </CardBody>
                </Card>
              </div>
            </Tab>

            <Tab key="raw" title="Raw JSON">
              <Card shadow="sm" className="border border-default-200">
                <CardHeader className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">Raw catalog JSON</div>
                    <div className="text-tiny text-default-500">
                      Paste JSON, then click “Apply to draft”. Save to persist.
                    </div>
                  </div>
                  <Button size="sm" variant="flat" onPress={applyRawJson}>
                    Apply to draft
                  </Button>
                </CardHeader>
                <Divider />
                <CardBody>
                  <Textarea
                    className="font-mono"
                    minRows={20}
                    value={rawJson}
                    onValueChange={(v) => {
                      setRawJson(v);
                      setRawJsonChanged(true);
                    }}
                  />
                </CardBody>
              </Card>
            </Tab>
          </Tabs>
        )}
      </SectionContent>
    </div>
  );
};

