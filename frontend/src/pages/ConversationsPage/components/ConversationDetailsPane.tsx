import React, { useState, useEffect, useMemo, useRef } from 'react';
import { Button, Chip, Select, SelectItem } from '@heroui/react';
import {
  CheckIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  WrenchScrewdriverIcon,
  QuestionMarkCircleIcon,
  EyeIcon,
  EyeSlashIcon,
  XMarkIcon,
  FlagIcon,
} from '@heroicons/react/24/outline';
import moment from 'moment';
import { Link as RouterLink } from 'react-router-dom';
import { apiClientStore } from '../../../stores/apiClientStore';
import classNames from '../../../helpers/classNames';
import { ConversationDetails } from '../queries/useConversation';
import { BugReportForm } from './BugReportForm';

type ToolExecution = {
  toolName: string;
  success: boolean;
  error?: string;
  timestamp?: string;
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
  userDataSnapshot?: Record<string, unknown>;
}

interface FlowStage {
  slug: string;
  name?: string;
  description?: string;
  isCompleted: boolean;
  fieldsToCollect?: string[];
  kind?: 'user' | 'system' | 'error';
}

interface Flow {
  name: string;
  slug: string;
  isCompleted: boolean;
  sessionId: string;
  stages: FlowStage[];
}

interface TechnicalEvent {
  timestamp: string;
  flowSlug: string;
  stageSlug: string;
  toolName?: string;
  error: string;
  errorCode?: string;
  traceId?: string;
}

interface CollectedEntityType {
  type: string;
  label: string;
  instances: Array<{
    id: string;
    data: Record<string, unknown>;
    metadata?: Record<string, unknown>;
  }>;
}

type ViewMode = 'timeline' | 'data' | 'log';

interface ConversationDetailsPaneProps {
  conversationDetails: ConversationDetails;
  conversationId: string;
  onClose: () => void;
}

export const ConversationDetailsPane: React.FC<ConversationDetailsPaneProps> = ({
  conversationDetails,
  conversationId,
  onClose,
}) => {
  const [viewMode, setViewMode] = useState<ViewMode>('timeline');
  const [traces, setTraces] = useState<FlowTrace[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedFlows, setExpandedFlows] = useState<Set<string>>(new Set());
  const [expandedStages, setExpandedStages] = useState<Set<string>>(new Set());
  const [expandedApiCalls, setExpandedApiCalls] = useState<Set<string>>(new Set());
  const [expandedEntities, setExpandedEntities] = useState<Set<string>>(new Set());
  const [expandedEntityInstances, setExpandedEntityInstances] = useState<Set<string>>(new Set());
  const [fieldOrderByContainer, setFieldOrderByContainer] = useState<Record<string, string[]>>({});
  const [scrollToStageId, setScrollToStageId] = useState<string | null>(null);
  const [maskedFields, setMaskedFields] = useState<Set<string>>(new Set([
    'phone',
    'mobile_phone',
    'user_phone',
    'user_id',
    'password',
    'ssn',
    'creditcard',
  ]));
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const DEFAULT_DETAILS_WIDTH_PX = 384;
  const DETAILS_WIDTH_STORAGE_KEY = 'choco.conversationDetails.widthPx';
  const [detailsWidthPx, setDetailsWidthPx] = useState<number>(() => {
    try {
      const raw = window.localStorage.getItem(DETAILS_WIDTH_STORAGE_KEY);
      const n = raw ? Number(raw) : NaN;
      if (Number.isFinite(n) && n >= 320 && n <= 1200) return n;
    } catch {
      // ignore
    }
    return DEFAULT_DETAILS_WIDTH_PX;
  });
  const resizeStateRef = useRef<{
    isResizing: boolean;
    startX: number;
    startWidth: number;
  }>({ isResizing: false, startX: 0, startWidth: DEFAULT_DETAILS_WIDTH_PX });

  const stageRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const {
    userData = {},
    activeFlow,
    completedFlows,
    log = [],
    fieldProvenance,
  } = conversationDetails;

  // Canonicalize legacy keys for display.
  // Internally we may still store proposer_* / first_name keys (TopicSplit + compatibility),
  // but in the UI we prefer user_* for "User" contact details.
  const canonicalizeUserDataForDisplay = (ud: Record<string, unknown>) => {
    const out: Record<string, unknown> = { ...ud };
    const pickNonEmpty = (...vals: unknown[]) => vals.find(
      (v) => v !== null && v !== undefined && String(v).trim() !== '',
    );

    const userFirst = pickNonEmpty(ud.user_first_name, ud.first_name, ud.proposer_first_name);
    const userLast = pickNonEmpty(ud.user_last_name, ud.last_name, ud.proposer_last_name);
    const userPhone = pickNonEmpty(
      ud.user_phone,
      ud.phone,
      ud.mobile_phone,
      ud.proposer_mobile_phone,
      ud.proposer_phone,
    );
    const userEmail = pickNonEmpty(ud.user_email, ud.email, ud.proposer_email);

    if (out.user_first_name == null && userFirst != null) out.user_first_name = userFirst;
    if (out.user_last_name == null && userLast != null) out.user_last_name = userLast;
    if (out.user_phone == null && userPhone != null) out.user_phone = userPhone;
    if (out.user_email == null && userEmail != null) out.user_email = userEmail;

    // Hide legacy keys to avoid duplicate/confusing display.
    delete out.proposer_first_name;
    delete out.proposer_last_name;
    delete out.proposer_mobile_phone;
    delete out.proposer_phone;
    delete out.proposer_email;
    delete out.mobile_phone;
    delete out.first_name;
    delete out.last_name;
    delete out.phone;
    delete out.email;

    return out;
  };

  const displayUserData = canonicalizeUserDataForDisplay(userData);

  const isPresentValue = (v: unknown): boolean => {
    if (v === undefined || v === null) return false;
    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return false;
      const lowered = s.toLowerCase();
      if (
        lowered === 'null'
        || lowered === ':null'
        || lowered === 'undefined'
        || lowered === ':undefined'
      ) return false;
      return true;
    }
    if (Array.isArray(v)) return v.length > 0;
    // boolean false is a valid answer
    return true;
  };

  type FieldContributor = 'user' | 'system';
  type FieldProvenance = {
    ts: string | null;
    // Optional ordering within the same timestamp (when provided by the API).
    seq?: number;
    contributor: FieldContributor;
    traceId?: string;
    flowSlug?: string;
    stageSlug?: string;
    method: 'fieldsCollected' | 'snapshot';
  };

  const contributorFromStageSlug = (stageSlug: string | null | undefined): FieldContributor => {
    const slug = String(stageSlug || '').trim().toLowerCase();
    if (!slug) return 'system';
    if (['route', 'resolvesegment', 'decidenextstep', 'prefillcoverages', 'error'].includes(slug)) return 'system';
    return 'user';
  };

  const tracesChrono = useMemo(
    () => [...traces].sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime()),
    [traces],
  );

  const fieldsCollectedProvenanceBySlug = useMemo(() => {
    const map = new Map<string, FieldProvenance>();
    tracesChrono.forEach((trace) => {
      const ts = trace.completedAt || trace.enteredAt || null;
      const fields = Array.isArray(trace.fieldsCollected) ? trace.fieldsCollected : [];
      fields.forEach((fieldSlug) => {
        const k = String(fieldSlug || '').trim();
        if (!k) return;
        if (map.has(k)) return;
        map.set(k, {
          ts,
          contributor: contributorFromStageSlug(trace.stageSlug),
          traceId: trace.id,
          flowSlug: trace.flowSlug,
          stageSlug: trace.stageSlug,
          method: 'fieldsCollected',
        });
      });
    });
    return map;
  }, [tracesChrono]);

  const snapshotFirstSeenProvenanceBySlug = useMemo(() => {
    const map = new Map<string, FieldProvenance>();
    tracesChrono.forEach((trace) => {
      const snap = trace.userDataSnapshot;
      if (!snap || typeof snap !== 'object') return;
      Object.entries(snap).forEach(([k, v]) => {
        const key = String(k || '').trim();
        if (!key) return;
        if (map.has(key)) return;
        if (!isPresentValue(v)) return;
        map.set(key, {
          ts: trace.enteredAt || null,
          contributor: contributorFromStageSlug(trace.stageSlug),
          traceId: trace.id,
          flowSlug: trace.flowSlug,
          stageSlug: trace.stageSlug,
          method: 'snapshot',
        });
      });
    });
    return map;
  }, [tracesChrono]);

  const provenanceForField = (fieldSlug: string): FieldProvenance | null => (
    (() => {
      const fromApi = fieldProvenance?.[fieldSlug];
      if (fromApi) return fromApi as FieldProvenance;
      return fieldsCollectedProvenanceBySlug.get(fieldSlug)
        || snapshotFirstSeenProvenanceBySlug.get(fieldSlug)
        || null;
    })()
  );

  const getDebugBundle = () => ({
    conversationId,
    timestamp: new Date().toISOString(),
    detailsSnapshot: {
      userData,
      activeFlow,
      completedFlowsSummary: completedFlows.map((f) => f.slug),
    },
    tracesSnapshot: traces.slice(0, 50), // Last 50 traces
    url: window.location.href,
    userAgent: navigator.userAgent,
  });

  // Combine all flows: completed flows first, then active flow
  // This ensures completed flows are always visible and active flow is always shown
  // Filter out any completed flow that has the same slug as the active flow (to avoid duplicates)
  const flowHistory = completedFlows.filter((f) => !activeFlow || f.slug !== activeFlow.slug);
  if (activeFlow) {
    // Always add active flow at the end
    flowHistory.push(activeFlow);
  }

  const [currentFlowSlug, setCurrentFlowSlug] = useState<string | null>(null);
  const [currentStageSlug, setCurrentStageSlug] = useState<string | null>(null);

  // Load traces
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

  useEffect(() => {
    if (!conversationId) return undefined;

    loadTrace();
    // Auto-refresh every 3 seconds to stay reactive
    const interval = setInterval(loadTrace, 3000);
    return () => clearInterval(interval);
  }, [conversationId]);

  useEffect(() => {
    try {
      window.localStorage.setItem(DETAILS_WIDTH_STORAGE_KEY, String(detailsWidthPx));
    } catch {
      // ignore
    }
  }, [detailsWidthPx]);

  useEffect(() => {
    const onMove = (ev: MouseEvent) => {
      if (!resizeStateRef.current.isResizing) return;
      const dx = resizeStateRef.current.startX - ev.clientX; // panel is on the right; dragging left increases width
      const next = resizeStateRef.current.startWidth + dx;
      const max = Math.min(1200, Math.floor(window.innerWidth * 0.85));
      const clamped = Math.max(320, Math.min(max, next));
      setDetailsWidthPx(clamped);
    };

    const onUp = () => {
      if (!resizeStateRef.current.isResizing) return;
      resizeStateRef.current.isResizing = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Auto-expand active flow and collapse completed flows
  useEffect(() => {
    const expanded = new Set<string>();
    if (activeFlow) {
      // Use a unique key: slug + sessionId to ensure uniqueness
      const activeFlowKey = `${activeFlow.slug}-${activeFlow.sessionId}`;
      expanded.add(activeFlowKey);
    }
    // Collapse all completed flows (they're not in the expanded set)
    setExpandedFlows(expanded);
  }, [activeFlow?.sessionId, activeFlow?.slug, completedFlows.length]);

  // Auto-expand errored stages
  useEffect(() => {
    const erroredStages = new Set<string>();
    traces.forEach((trace) => {
      if (trace.errorsEncountered.length > 0) {
        const stageKey = `${trace.flowSlug}-${trace.stageSlug}`;
        erroredStages.add(stageKey);
      }
    });
    if (erroredStages.size > 0) {
      setExpandedStages((prev) => new Set([...prev, ...erroredStages]));
    }
  }, [traces]);

  // Scroll to stage when scrollToStageId changes
  useEffect(() => {
    if (scrollToStageId && stageRefs.current[scrollToStageId]) {
      stageRefs.current[scrollToStageId]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      setScrollToStageId(null);
    }
  }, [scrollToStageId]);

  const isFieldSatisfied = (field: string, value: unknown): boolean => {
    if (!isPresentValue(value)) return false;
    const key = String(field || '').trim();

    if (key === 'user_id') {
      const raw = String(value ?? '').trim();
      if (!/^[0-9\s\-.]+$/.test(raw)) return false;
      const digits = raw.replace(/\D/g, '');
      return digits.length === 9;
    }
    if (key === 'insured_relation_to_business') {
      const v = String(value ?? '').trim().toLowerCase();
      const allowed = new Set([
        'בעלים',
        'מורשה חתימה',
        'מנהל',
        'אחר',
        'owner',
        'authorized signer',
        'manager',
        'other',
      ]);
      return allowed.has(v);
    }
    if (key === 'referral_source') {
      return String(value ?? '').trim().length >= 2;
    }

    return true;
  };

  const FIELD_LABELS_HE: Record<string, string> = {
    is_new_customer: 'סטטוס לקוח',
    first_name: 'שם פרטי',
    last_name: 'שם משפחה',
    user_first_name: 'שם פרטי',
    user_last_name: 'שם משפחה',
    mobile_phone: 'נייד',
    user_phone: 'טלפון',
    phone: 'טלפון',
    email: 'אימייל',
    user_email: 'אימייל',
    business_segment: 'עיסוק',
    business_site_type: 'סוג העסק',
    user_id: 'תעודת זהות',
    user_has_israeli_id: 'יש תעודת זהות?',
    insured_relation_to_business: 'תפקיד בעסק',
    referral_source: 'מקור הגעה',
  };

  const labelForField = (field: string): string => {
    const k = String(field || '').trim();
    return FIELD_LABELS_HE[k] || k;
  };

  const formatMissingFieldsInline = (missing: string[], maxToShow = 3) => {
    const labels = missing.map(labelForField);
    const shown = labels.slice(0, maxToShow);
    const rest = Math.max(0, labels.length - shown.length);
    return `${shown.join(', ')}${rest > 0 ? ` +${rest}` : ''}`;
  };

  const parseIsNewCustomer = (v: unknown): boolean | null => {
    if (v === true) return true;
    if (v === false) return false;
    const s = String(v ?? '').trim().toLowerCase();
    if (!s) return null;
    if (['true', '1', 'כן', 'חדש', 'new', 'y', 'yes', 'לקוח חדש'].includes(s)) return true;
    if (['false', '0', 'לא', 'קיים', 'existing', 'n', 'no', 'לקוח קיים', 'ותיק'].includes(s)) return false;
    return null;
  };

  const getStageFieldProgress = (stage: FlowStage, trace: FlowTrace | null) => {
    const rawRequired = Array.isArray(stage.fieldsToCollect) ? stage.fieldsToCollect : [];
    // Apply minimal conditional logic so "missing fields" matches actual completion semantics.
    // (Flow 01: referral_source is required only for new customers.)
    const isNewCustomer = parseIsNewCustomer(userData.is_new_customer);
    const required = rawRequired.filter((f) => !(f === 'referral_source' && isNewCustomer === false));

    if (required.length === 0) {
      return { required, collected: [] as string[], missing: [] as string[] };
    }
    const collected = required.filter((field) => {
      const value = userData[field] ?? trace?.userDataSnapshot?.[field];
      return isFieldSatisfied(field, value);
    });
    const missing = required.filter((f) => !collected.includes(f));
    return { required, collected, missing };
  };

  const getFlowFieldProgress = (flow: Flow) => {
    const rawRequired = Array.from(new Set(
      flow.stages.flatMap((s) => (Array.isArray(s.fieldsToCollect) ? s.fieldsToCollect : [])),
    ));
    const isNewCustomer = parseIsNewCustomer(userData.is_new_customer);
    const required = rawRequired.filter((f) => !(f === 'referral_source' && isNewCustomer === false));
    const collected = required.filter((field) => isFieldSatisfied(field, userData[field]));
    const missing = required.filter((f) => !collected.includes(f));
    return { required, collected, missing };
  };

  // Overall Progress (Data collection): aggregate required fields across flows, not stages.
  // Most flows have a single user stage, so stage-based progress is low-signal.
  const overallRequiredFields = Array.from(new Set(
    flowHistory.flatMap((flow) => getFlowFieldProgress(flow).required),
  ));
  const overallCollectedFields = overallRequiredFields.filter((field) => isFieldSatisfied(field, userData[field]));
  const overallMissingFields = overallRequiredFields.filter((f) => !overallCollectedFields.includes(f));

  // Get current stage
  const currentStage = activeFlow?.stages.find((s) => !s.isCompleted);
  const hiddenStageSlugs = new Set(['route', 'error', 'resolveSegment', 'decidenextstep']);
  const currentStageName = currentStageSlug && hiddenStageSlugs.has(currentStageSlug)
    ? 'System'
    : (currentStage?.name || currentStage?.slug || '');

  // Get trace for a specific stage
  const getTraceForStage = (flowSlug: string, stageSlug: string): FlowTrace | null => {
    const stageTraces = traces.filter(
      (t) => t.flowSlug === flowSlug && t.stageSlug === stageSlug,
    );
    if (stageTraces.length === 0) return null;
    return stageTraces.sort((a, b) =>
      new Date(b.enteredAt).getTime() - new Date(a.enteredAt).getTime(),
    )[0];
  };

  // Get all traces for a flow, sorted chronologically
  const getTracesForFlow = (flowSlug: string): FlowTrace[] => traces
    .filter((t) => t.flowSlug === flowSlug)
    .sort((a, b) => new Date(a.enteredAt).getTime() - new Date(b.enteredAt).getTime());

  // Get recent technical events
  const technicalEvents: TechnicalEvent[] = traces
    .flatMap((trace) =>
      trace.errorsEncountered.map((error) => ({
        timestamp: trace.enteredAt,
        flowSlug: trace.flowSlug,
        stageSlug: trace.stageSlug,
        toolName: error.toolName || trace.toolsExecuted?.[0]?.toolName,
        error: error.error || 'Unknown error',
        errorCode: error.errorCode,
        traceId: trace.id,
      })),
    )
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const pickNonEmptyKeys = (obj: Record<string, unknown>, keys: string[]) => Object.fromEntries(
    keys
      .filter((k) => k in obj)
      .map((k) => [k, obj[k]])
      .filter(([_, v]) => v !== null && v !== undefined && v !== ''),
  );

  const pickByPredicate = (
    obj: Record<string, unknown>,
    pred: (k: string, v: unknown) => boolean,
  ) => Object.fromEntries(
    Object.entries(obj).filter(([k, v]) => pred(k, v) && v !== null && v !== undefined && v !== ''),
  );

  // Split collected data into: User (contact/device) vs Insured (business + insurance payload).
  // This replaces the old "Organizations" bucket which was mainly for nonprofit/KYC.
  const userDataKeys = [
    'user_first_name',
    'user_last_name',
    'user_phone',
    'user_email',
    // onboarding / eligibility
    'is_new_customer',
    // identity
    'user_id',
    'user_has_israeli_id',
    // required in Flow 01
    'insured_relation_to_business',
    'referral_source',
    // client/device telemetry (when available)
    'client_user_agent',
    'client_device',
    'client_browser',
    'client_browser_version',
    'client_os',
    'client_os_version',
  ];
  const insuredExplicitKeys = [
    // Identity of insured business
    'business_name',
    'legal_id_type',
    'legal_id',
    'business_legal_entity_type',
    // Segment resolution (system-derived, but part of insured payload)
    'segment_id',
    'segment_name_he',
    'segment_group_id',
    'segment_group_name_he',
    'default_package_key',
    'segment_resolution_confidence',
    'segment_resolution_source',
    'segment_coverages_prefilled_v1',
    // Profile / needs
    'segment_description',
    'product_line',
    'industry',
    'activity_description',
    'employees_count',
    'annual_turnover_ils',
    'coverages_needed',
    'special_risks',
    // Address / proposal form fields
    'business_city',
    'business_street',
    'business_house_number',
    // Underwriting numbers (if already collected)
    'contents_sum_insured_ils',
    'stock_sum_insured_ils',
    'third_party_limit_ils',
  ];

  const userOnlyData = {
    ...pickNonEmptyKeys(displayUserData, userDataKeys),
    ...pickByPredicate(displayUserData, (k) => /(user_agent|browser|device|os)/i.test(k)),
  };

  const insuredData = {
    ...pickNonEmptyKeys(displayUserData, insuredExplicitKeys),
    ...pickByPredicate(displayUserData, (k) => (
      /^(business_|legal_)/.test(k)
      || /^il_/.test(k)
      || /^il_companies_registry_/.test(k)
      || /^(med_pi_|cyber_)/.test(k)
      || /^(insured_)/.test(k)
      || /(_sum_insured_|_limit_)/.test(k)
    )),
  };

  // Fields explicitly collected by any flow/stage in this conversation (union of fieldsToCollect).
  // These are conceptually part of the insured/candidate payload (not "User contact").
  const flowDefinedFieldKeys = Array.from(new Set(
    flowHistory.flatMap((f) => f.stages.flatMap((s) => (Array.isArray(s.fieldsToCollect) ? s.fieldsToCollect : []))),
  ));
  const excludeFromInsured = new Set<string>([
    ...userDataKeys,
    // Legacy/alias user-contact keys (we show them under "User")
    'first_name',
    'last_name',
    'phone',
    'mobile_phone',
    'email',
  ]);
  const flowDefinedInsuredKeys = flowDefinedFieldKeys.filter((k) => !excludeFromInsured.has(k));
  const flowDefinedInsuredData = pickNonEmptyKeys(displayUserData, flowDefinedInsuredKeys);
  const insuredDataMerged = {
    ...insuredData,
    ...flowDefinedInsuredData,
  };

  // Build collected entities
  const collectedEntities: CollectedEntityType[] = [
    {
      type: 'user',
      label: 'User',
      instances: Object.keys(userOnlyData).length > 0 ? [{
        id: 'user-data',
        data: userOnlyData,
      }] : [],
    },
    {
      type: 'insured',
      label: 'Insured',
      instances: Object.keys(insuredDataMerged).length > 0 ? [{
        id: 'insured-data',
        data: insuredDataMerged,
      }] : [],
    },
  ];

  // Get flow start and end times from traces
  const getFlowTimes = (flowSlug: string) => {
    const flowTraces = getTracesForFlow(flowSlug);
    if (flowTraces.length === 0) return { start: null, end: null };

    const start = flowTraces[0].enteredAt;
    const completedTraces = flowTraces.filter((t) => t.completedAt);
    const end = completedTraces.length > 0
      ? completedTraces[completedTraces.length - 1].completedAt
      : null;

    return { start, end };
  };

  const toggleFlow = (flowKey: string) => {
    const newExpanded = new Set(expandedFlows);
    if (newExpanded.has(flowKey)) {
      newExpanded.delete(flowKey);
    } else {
      newExpanded.add(flowKey);
    }
    setExpandedFlows(newExpanded);
  };

  const toggleStage = (stageKey: string) => {
    const newExpanded = new Set(expandedStages);
    if (newExpanded.has(stageKey)) {
      newExpanded.delete(stageKey);
    } else {
      newExpanded.add(stageKey);
    }
    setExpandedStages(newExpanded);
  };

  const toggleApiCall = (callId: string) => {
    const newExpanded = new Set(expandedApiCalls);
    if (newExpanded.has(callId)) {
      newExpanded.delete(callId);
    } else {
      newExpanded.add(callId);
    }
    setExpandedApiCalls(newExpanded);
  };

  const toggleEntity = (entityKey: string) => {
    const newExpanded = new Set(expandedEntities);
    if (newExpanded.has(entityKey)) {
      newExpanded.delete(entityKey);
    } else {
      newExpanded.add(entityKey);
    }
    setExpandedEntities(newExpanded);
  };

  const toggleEntityInstance = (instanceKey: string) => {
    const newExpanded = new Set(expandedEntityInstances);
    if (newExpanded.has(instanceKey)) {
      newExpanded.delete(instanceKey);
    } else {
      newExpanded.add(instanceKey);
    }
    setExpandedEntityInstances(newExpanded);
  };

  const formatCollectedValue = (key: string, value: unknown) => {
    if (key === 'legal_id_type') {
      const v = String(value || '').trim();
      if (v === 'AM') return 'עוסק מורשה';
      if (v === 'HP') return 'מספר חברה';
      if (v === 'TZ') return 'ת"ז';
      return v;
    }
    if (key === 'is_new_customer') {
      const v = typeof value === 'string' ? value.trim().toLowerCase() : value;
      const asBool = v === true || v === 'true' || v === 1 || v === '1';
      return asBool ? 'לקוח חדש' : 'לקוח קיים';
    }
    // Display arrays (like business_site_type) without JSON brackets.
    if (Array.isArray(value)) {
      return value.map((x) => String(x)).filter((x) => x.trim() !== '').join(', ');
    }
    // Sometimes arrays are stored as JSON strings (legacy). Pretty-print them.
    if (typeof value === 'string') {
      const s = value.trim();
      if ((s.startsWith('[') && s.endsWith(']')) || (s.startsWith('{') && s.endsWith('}'))) {
        try {
          const parsed = JSON.parse(s);
          if (Array.isArray(parsed)) {
            return parsed.map((x) => String(x)).filter((x) => x.trim() !== '').join(', ');
          }
          return parsed;
        } catch {
          // ignore
        }
      }
    }
    return value;
  };

  const handleEventClick = (event: TechnicalEvent) => {
    setViewMode('timeline');
    const stageKey = `${event.flowSlug}-${event.stageSlug}`;
    setScrollToStageId(stageKey);
    // Auto-expand the flow and stage
    const flow = flowHistory.find((f) => f.slug === event.flowSlug);
    if (flow) {
      const flowKey = `${flow.slug}-${flow.sessionId}`;
      setExpandedFlows((prev) => new Set([...prev, flowKey]));
      setExpandedStages((prev) => new Set([...prev, stageKey]));
    }
  };

  const maskValue = (key: string, value: unknown): string => {
    if (maskedFields.has(key.toLowerCase())) {
      if (typeof value === 'string' && value.length > 0) {
        return '•'.repeat(Math.min(value.length, 8));
      }
      return '•'.repeat(8);
    }
    return String(value);
  };

  const toggleMaskField = (field: string) => {
    const newMasked = new Set(maskedFields);
    if (newMasked.has(field)) {
      newMasked.delete(field);
    } else {
      newMasked.add(field);
    }
    setMaskedFields(newMasked);
  };

  // Flow Summary Header Component
  const FlowSummaryHeader = () => (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">Flows in this conversation</h2>

      {/* Flow Status Tags */}
      <div className="flex flex-wrap gap-2">
        {flowHistory.map((flow) => {
          const flowKey = `${flow.slug}-${flow.sessionId}`;
          const isCurrentActive = !!activeFlow &&
            flow.sessionId === activeFlow.sessionId &&
            flow.slug === activeFlow.slug;

          const status: 'in-progress' | 'completed' | 'transitioned' = isCurrentActive
            ? 'in-progress'
            : flow.isCompleted
              ? 'completed'
              : 'transitioned';

          const chipClassName = status === 'completed'
            ? 'bg-black text-white'
            : status === 'in-progress'
              ? 'bg-[#882DD7]/10 text-[#882DD7] border border-[#882DD7]/30'
              : 'bg-orange-100 text-orange-700 border border-orange-300';

          const statusIcon = status === 'completed'
            ? <CheckIcon className="w-3 h-3" />
            : status === 'in-progress'
              ? <ClockIcon className="w-3 h-3" />
              : <ChevronRightIcon className="w-3 h-3" />;

          const statusLabel = status === 'in-progress'
            ? 'In progress'
            : status === 'completed'
              ? 'Completed'
              : 'Transitioned';

          return (
            <Chip
              key={flowKey}
              size="sm"
              className={classNames(
                'rounded-full',
                chipClassName,
              )}
              startContent={
                statusIcon
              }
            >
              {flow.slug}
              {' '}
              ·
              {statusLabel}
            </Chip>
          );
        })}
      </div>

      {/* Overall Progress */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium">Overall Progress</span>
          <span className="text-gray-600">
            {overallCollectedFields.length}
            /
            {overallRequiredFields.length}
            {' '}
            fields
            {overallMissingFields.length > 0 ? ` (${overallMissingFields.length} missing)` : ''}
          </span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-gray-800 h-2 rounded-full transition-all"
            style={{ width: `${overallRequiredFields.length > 0 ? (overallCollectedFields.length / overallRequiredFields.length) * 100 : 0}%` }}
          />
        </div>
      </div>

      {/* Current Stage Indicator */}
      {currentStage && activeFlow && (
        <div className="bg-gray-100 rounded-lg px-3 py-2">
          <span className="text-sm font-medium text-gray-800">
            Current:
            {' '}
            {activeFlow.slug}
            {' '}
            ·
            {' '}
            {currentStageName}
          </span>
        </div>
      )}
    </div>
  );

  // Flow Section Component
  const FlowSection = ({ flow }: { flow: Flow }) => {
    // Use a unique key: slug + sessionId to ensure uniqueness
    const flowKey = `${flow.slug}-${flow.sessionId}`;
    const isExpanded = expandedFlows.has(flowKey);
    const { start, end } = getFlowTimes(flow.slug);
    const completedStagesCount = flow.stages.filter((s) => s.isCompleted).length;
    const flowFieldProgress = getFlowFieldProgress(flow);
    const isCurrentActive = !!activeFlow &&
      flow.sessionId === activeFlow.sessionId &&
      flow.slug === activeFlow.slug;
    const shouldShowStageTimeline = flow.stages.length > 1 || getTracesForFlow(flow.slug).some((t) => (
      (t.toolsExecuted?.length ?? 0) > 0 || (t.errorsEncountered?.length ?? 0) > 0
    ));

    const flowStatusLabel = isCurrentActive
      ? 'In progress'
      : flow.isCompleted
        ? 'Completed'
        : 'Transitioned';

    const flowStatusClassName = isCurrentActive
      ? 'bg-[#882DD7]/10 text-[#882DD7]'
      : flow.isCompleted
        ? 'bg-black text-white'
        : 'bg-orange-100 text-orange-700';

    return (
      <div className="border border-gray-200 rounded-lg overflow-hidden">
        {/* Flow Header */}
        <button
          onClick={() => toggleFlow(flowKey)}
          className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
        >
          <div className="flex items-center gap-2 flex-1">
            {isExpanded ? (
              <ChevronDownIcon className="w-4 h-4 text-gray-500" />
            ) : (
              <ChevronRightIcon className="w-4 h-4 text-gray-500" />
            )}
            <span className="font-medium text-left">{flow.name}</span>
          </div>
          <Chip
            size="sm"
            className={classNames(
              'rounded-full',
              flowStatusClassName,
            )}
          >
            {flowStatusLabel}
          </Chip>
        </button>

        {/* Flow Summary (when collapsed) */}
        {!isExpanded && (
          <div className="px-4 pb-3 text-sm text-gray-600">
            <div>
              slug:
              {flow.slug}
              {' '}
              ·
              {completedStagesCount}
              /
              {flow.stages.length}
              {' '}
              stages
              {flowFieldProgress.required.length > 0 && (
                <>
                  {' '}
                  ·
                  {' '}
                  fields:
                  {flowFieldProgress.collected.length}
                  /
                  {flowFieldProgress.required.length}
                </>
              )}
            </div>
            {flowFieldProgress.missing.length > 0 && (
              <div
                className="text-xs text-orange-700 mt-1"
                title={flowFieldProgress.missing.map(labelForField).join(', ')}
              >
                Missing:
                {' '}
                {formatMissingFieldsInline(flowFieldProgress.missing)}
              </div>
            )}
            {start && (
              <div>
                Started
                {' '}
                {moment(start).format('M/D/YYYY h:mm A')}
                {end && ` · Completed ${moment(end).format('M/D/YYYY h:mm A')}`}
              </div>
            )}
          </div>
        )}

        {/* Flow Details (when expanded) */}
        {isExpanded && (
          <div className="border-t border-gray-200 px-4 py-3 space-y-1 bg-gray-50">
            <div className="text-sm text-gray-600 mb-3">
              <div>
                slug:
                {flow.slug}
                {' '}
                ·
                {completedStagesCount}
                /
                {flow.stages.length}
                {' '}
                stages
                {flowFieldProgress.required.length > 0 && (
                  <>
                    {' '}
                    ·
                    {' '}
                    fields:
                    {flowFieldProgress.collected.length}
                    /
                    {flowFieldProgress.required.length}
                  </>
                )}
              </div>
              {flowFieldProgress.missing.length > 0 && (
                <div
                  className="text-xs text-orange-700 mt-1"
                  title={flowFieldProgress.missing.map(labelForField).join(', ')}
                >
                  Missing:
                  {' '}
                  {formatMissingFieldsInline(flowFieldProgress.missing)}
                </div>
              )}
              {start && (
                <div>
                  Started
                  {' '}
                  {moment(start).format('M/D/YYYY h:mm A')}
                  {end && ` · Completed ${moment(end).format('M/D/YYYY h:mm A')}`}
                </div>
              )}
            </div>

            {shouldShowStageTimeline && (
              <>
                {/* Stage Items - Chronologically sorted */}
                <div className="relative pl-6">
                  {/* Timeline line */}
                  <div className="absolute left-2.5 top-0 bottom-0 w-0.5 bg-gray-200" />

                  <div className="space-y-2">
                    {(() => {
                      // Separate stages into: completed, current (in-progress), and not started
                      const completedStages: typeof flow.stages = [];
                      const inProgressStages: typeof flow.stages = [];
                      const notStartedStages: typeof flow.stages = [];

                      flow.stages.forEach((stage) => {
                        // Option A: Use source of truth
                        const isCurrentStage = currentFlowSlug === flow.slug && currentStageSlug === stage.slug;

                        if (stage.isCompleted) {
                          completedStages.push(stage);
                        } else if (isCurrentStage) {
                          // Only the current stage (from UserFlow)
                          inProgressStages.push(stage);
                        } else {
                          // Everything else that hasn't started
                          notStartedStages.push(stage);
                        }
                      });

                      // Sort completed stages chronologically (oldest first)
                      completedStages.sort((a, b) => {
                        const traceA = getTraceForStage(flow.slug, a.slug);
                        const traceB = getTraceForStage(flow.slug, b.slug);
                        const timeA = traceA?.enteredAt ? new Date(traceA.enteredAt).getTime() : 0;
                        const timeB = traceB?.enteredAt ? new Date(traceB.enteredAt).getTime() : 0;
                        return timeA - timeB; // Chronological order (oldest first)
                      });

                      // Combine: completed first (chronological), then current (in-progress), then not started
                      const sortedStages = [...completedStages, ...inProgressStages, ...notStartedStages];

                      return sortedStages.map((stage) => {
                        const trace = getTraceForStage(flow.slug, stage.slug);
                        const stageKey = `${flow.sessionId}-${stage.slug}`;
                        const isStageExpanded = expandedStages.has(stageKey);
                        const stageFieldProgress = getStageFieldProgress(stage, trace);
                        const hasDetails = trace && (
                          trace.fieldsCollected.length > 0 ||
                          trace.toolsExecuted.length > 0 ||
                          trace.errorsEncountered.length > 0
                        );
                        // Option A: Use source of truth data
                        // Current stage: from UserFlow (via trace API)
                        const isCurrentStage = currentFlowSlug === flow.slug && currentStageSlug === stage.slug;
                        // Completed: from FlowHistory (via activeFlow.stages.isCompleted)
                        const { isCompleted } = stage;
                        // Error: from FlowTrace.errorsEncountered
                        const hasError = trace && trace.errorsEncountered && trace.errorsEncountered.length > 0;

                        // Determine status using clear priority: error > completed > current > not-started
                        let status: 'completed' | 'in-progress' | 'error' | 'not-started';
                        if (hasError) {
                          status = 'error';
                        } else if (isCompleted) {
                          status = 'completed';
                        } else if (isCurrentStage) {
                          status = 'in-progress';
                        } else {
                          status = 'not-started';
                        }

                        const isNotStarted = status === 'not-started';

                        return (
                          <div
                            key={stage.slug}
                            ref={(el) => {
                              const refKey = `${flow.slug}-${stage.slug}`;
                              stageRefs.current[refKey] = el;
                            }}
                            className={classNames(
                              'bg-white border rounded-lg p-3 relative',
                              isNotStarted ? 'bg-gray-50 border-gray-200' : 'border-gray-200',
                              isCurrentStage && !isNotStarted ? 'border-[#882DD7]/30 bg-[#882DD7]/10' : '',
                            )}
                          >
                            {/* Timeline dot */}
                            <div className={classNames(
                              'absolute left-[-21px] top-4 w-2.5 h-2.5 rounded-full border-2 z-10',
                              status === 'completed' ? 'bg-green-500 border-green-500' :
                                status === 'error' ? 'bg-red-500 border-red-500' :
                                  status === 'in-progress' ? 'bg-[#882DD7] border-[#882DD7]' :
                                    'bg-white border-gray-400',
                            )}
                            />

                            {/* Stage Header */}
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  {trace?.toolsExecuted && trace.toolsExecuted.length > 0 && (
                                    <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                  )}
                                  <span className="text-sm font-medium">
                                    <span className="text-gray-500">{flow.slug}</span>
                                    {' / '}
                                    <span className="font-semibold">{stage.name || stage.slug}</span>
                                  </span>
                                </div>
                                {trace ? (
                                  <div className="mt-1 space-y-1">
                                    <div className="text-xs text-gray-500">
                                      {moment(trace.enteredAt).format('M/D/YYYY, h:mm:ss A')}
                                      {trace.completedAt && (
                                        <>
                                          {' → '}
                                          {moment(trace.completedAt).format('M/D/YYYY, h:mm:ss A')}
                                        </>
                                      )}
                                    </div>
                                  </div>
                                ) : isNotStarted ? null : (
                                  <div className="text-xs text-gray-400 mt-1 italic">
                                    No timestamp available
                                  </div>
                                )}
                              </div>
                              <div className="flex items-center gap-2 flex-shrink-0">
                                {/* Status Badge */}
                                {status === 'completed' && (
                                  <Chip
                                    size="sm"
                                    className="bg-green-100 text-green-700 border border-green-300 rounded-full"
                                    startContent={<CheckIcon className="w-3 h-3 text-green-600" />}
                                  >
                                    Completed
                                  </Chip>
                                )}
                                {status === 'in-progress' && (
                                  <Chip
                                    size="sm"
                                    className="bg-[#882DD7]/10 text-[#882DD7] border border-[#882DD7]/30 rounded-full"
                                    startContent={<ClockIcon className="w-3 h-3 text-[#882DD7]" />}
                                  >
                                    In progress
                                  </Chip>
                                )}
                                {status === 'error' && (
                                  <Chip
                                    size="sm"
                                    className="bg-red-100 text-red-700 border border-red-300 rounded-full"
                                    startContent={<ExclamationTriangleIcon className="w-3 h-3 text-red-600" />}
                                  >
                                    Error
                                  </Chip>
                                )}
                                {status === 'not-started' && (
                                  <Chip
                                    size="sm"
                                    className="bg-gray-100 text-gray-600 border border-gray-300 rounded-full"
                                    startContent={
                                      <div className="w-3 h-3 rounded-full border border-gray-400" />
                                    }
                                  >
                                    Not started
                                  </Chip>
                                )}
                                {hasDetails && (
                                  <button
                                    onClick={() => toggleStage(stageKey)}
                                    className="text-gray-400 hover:text-gray-600"
                                  >
                                    {isStageExpanded ? (
                                      <ChevronDownIcon className="w-4 h-4" />
                                    ) : (
                                      <ChevronRightIcon className="w-4 h-4" />
                                    )}
                                  </button>
                                )}
                              </div>
                            </div>

                            {/* Stage Details (expanded) */}
                            {isStageExpanded && trace && (
                              <div className="mt-3 pt-3 border-t border-gray-200 space-y-3">
                                {/* Required Fields (derived from stage definition) */}
                                {stageFieldProgress.required.length > 0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-700 mb-2">
                                      Required Fields
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      {stageFieldProgress.required.map((field) => {
                                        const value = trace.userDataSnapshot?.[field] ?? userData[field];
                                        const present = isPresentValue(value);
                                        return (
                                          <div key={field} className="flex items-center gap-2">
                                            <div className={[
                                              'w-2 h-2 rounded-full',
                                              present ? 'bg-green-500' : 'bg-gray-300',
                                            ].join(' ')}
                                            />
                                            <span className="font-mono text-gray-600">{field}</span>
                                          </div>
                                        );
                                      })}
                                    </div>
                                    {stageFieldProgress.missing.length > 0 && (
                                      <div className="text-xs text-orange-700 mt-2">
                                        Missing:
                                        {' '}
                                        {stageFieldProgress.missing.join(', ')}
                                      </div>
                                    )}
                                  </div>
                                )}

                                {/* Fields Collected */}
                                {trace.fieldsCollected.length > 0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-700 mb-2">
                                      Fields Collected
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-xs">
                                      {trace.fieldsCollected.map((field) => {
                                        const value = trace.userDataSnapshot?.[field] ?? userData[field];
                                        const isMasked = maskedFields.has(field.toLowerCase());
                                        const displayValue = value !== undefined && value !== null && value !== ''
                                          ? (typeof value === 'string' || typeof value === 'number'
                                            ? String(value)
                                            : JSON.stringify(value))
                                          : '–';
                                        return (
                                          <div key={field} className="space-y-1">
                                            <div className="flex items-center gap-1">
                                              <span className="text-gray-500 font-mono text-xs">
                                                {field}
                                                :
                                              </span>
                                              <button
                                                onClick={() => toggleMaskField(field)}
                                                className="text-gray-400 hover:text-gray-600"
                                              >
                                                {isMasked ? (
                                                  <EyeSlashIcon className="w-3 h-3" />
                                                ) : (
                                                  <EyeIcon className="w-3 h-3" />
                                                )}
                                              </button>
                                            </div>
                                            <div className="text-gray-800 break-words text-xs">
                                              {isMasked ? maskValue(field, displayValue) : displayValue}
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}

                                {/* Tools Executed */}
                                {trace.toolsExecuted.length > 0 && (
                                  <div>
                                    <div className="text-xs font-semibold text-gray-700 mb-2">
                                      Tools Executed
                                    </div>
                                    <div className="space-y-2">
                                      {trace.toolsExecuted.map((tool, idx: number) => (
                                        <div
                                          key={idx}
                                          className="flex items-center gap-2 p-2 bg-gray-50 rounded border border-gray-200"
                                        >
                                          <WrenchScrewdriverIcon className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                          <div className="flex-1 min-w-0">
                                            <div className="text-xs font-medium text-gray-800">
                                              {tool.toolName}
                                            </div>
                                            {tool.timestamp && (
                                              <div className="text-xs text-gray-500">
                                                {moment(tool.timestamp).format('M/D/YYYY, h:mm:ss A')}
                                              </div>
                                            )}
                                          </div>
                                          <div className="flex items-center gap-1 flex-shrink-0">
                                            {tool.success !== false ? (
                                              <div
                                                className={[
                                                  'w-4 h-4 rounded-full bg-green-500',
                                                  'flex items-center justify-center',
                                                ].join(' ')}
                                              >
                                                <CheckIcon className="w-3 h-3 text-white" />
                                              </div>
                                            ) : (
                                              <div
                                                className={[
                                                  'w-4 h-4 rounded-full bg-red-500',
                                                  'flex items-center justify-center',
                                                ].join(' ')}
                                              >
                                                <XMarkIcon className="w-3 h-3 text-white" />
                                              </div>
                                            )}
                                            <QuestionMarkCircleIcon className="w-4 h-4 text-gray-400" />
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  // Events Quick View Component
  const EventsQuickView = () => {
    if (technicalEvents.length === 0) return null;

    return (
      <div className="space-y-2">
        <h3 className="text-sm font-semibold">Recent Technical Events</h3>
        {technicalEvents.slice(0, 5).map((event, idx) => (
          <button
            key={idx}
            onClick={() => handleEventClick(event)}
            className={classNames(
              'w-full bg-red-50 border border-red-200 rounded-lg p-3 flex items-start gap-3',
              'hover:bg-red-100 transition-colors text-left',
            )}
          >
            <div className="w-5 h-5 rounded-full bg-red-500 flex items-center justify-center flex-shrink-0 mt-0.5">
              <ExclamationTriangleIcon className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-800">
                {moment(event.timestamp).format('h:mm A')}
                {' '}
                ·
                {event.toolName || `${event.flowSlug}.${event.stageSlug}`}
                {' '}
                · Failed
              </div>
              {event.errorCode && (
                <div className="text-xs text-red-600 font-medium mt-1">
                  {event.errorCode}
                </div>
              )}
              {event.error && typeof event.error === 'string' && (
                <div className="text-xs text-red-600 mt-1">{event.error}</div>
              )}
            </div>
          </button>
        ))}
      </div>
    );
  };

  // Auto-expand first instance when entity type is expanded
  useEffect(() => {
    collectedEntities.forEach((entityType) => {
      const entityKey = entityType.type;
      const isExpanded = expandedEntities.has(entityKey);
      // Auto-expand instances only when there are multiple instances (otherwise we render flattened).
      if (isExpanded && entityType.instances.length > 1) {
        const firstInstanceKey = `${entityKey}-${entityType.instances[0].id}`;
        if (!expandedEntityInstances.has(firstInstanceKey)) {
          setExpandedEntityInstances((prev) => new Set([...prev, firstInstanceKey]));
        }
      }
    });

  }, [expandedEntities]);

  // Stable ordering: keep existing order; append newly seen fields to the end.
  useEffect(() => {
    const containers: Array<{ id: string; keys: string[] }> = [];
    collectedEntities.forEach((entityType) => {
      const entityKey = entityType.type;
      const isFlattened = entityType.instances.length === 1;
      if (isFlattened) {
        const instance = entityType.instances[0];
        containers.push({
          id: `${entityKey}::${instance.id}`,
          keys: Object.keys(instance.data || {}),
        });
      } else {
        entityType.instances.forEach((instance) => {
          containers.push({
            id: `${entityKey}::${instance.id}`,
            keys: Object.keys(instance.data || {}),
          });
        });
      }
    });

    setFieldOrderByContainer((prev) => {
      let changed = false;
      const next: Record<string, string[]> = { ...prev };
      const active = new Set(containers.map((c) => c.id));

      // cleanup removed containers
      Object.keys(next).forEach((id) => {
        if (!active.has(id)) {
          delete next[id];
          changed = true;
        }
      });

      const arraysEqual = (a: string[], b: string[]) => (
        a.length === b.length && a.every((v, i) => v === b[i])
      );

      containers.forEach(({ id, keys }) => {
        const prevOrder = prev[id] || [];
        const keySet = new Set(keys);
        const kept = prevOrder.filter((k) => keySet.has(k));
        const keptSet = new Set(kept);
        const appended = keys.filter((k) => !keptSet.has(k));
        const order = [...kept, ...appended];
        if (!arraysEqual(prevOrder, order)) {
          next[id] = order;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [collectedEntities]);

  // Collected Data View Component
  const CollectedDataView = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Collected Data</h2>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="flat"
            onPress={() => setExpandedEntities(new Set(collectedEntities.map((e) => e.type)))}
          >
            Expand all
          </Button>
          <Button
            size="sm"
            variant="flat"
            onPress={() => setExpandedEntities(new Set())}
          >
            Collapse all
          </Button>
        </div>
      </div>
      {collectedEntities.map((entityType) => {
        const entityKey = entityType.type;
        const isExpanded = expandedEntities.has(entityKey);
        const isFlattened = entityType.instances.length === 1;
        const flattenedFieldCount = isFlattened ? Object.keys(entityType.instances[0].data || {}).length : 0;
        const chipCount = isFlattened ? flattenedFieldCount : entityType.instances.length;

        return (
          <div key={entityKey} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => toggleEntity(entityKey)}
              className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
            >
              <div className="flex items-center gap-2">
                {isExpanded ? (
                  <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                ) : (
                  <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                )}
                <span className="font-medium">{entityType.label}</span>
                <Chip size="sm" variant="flat" className="text-xs">
                  {chipCount}
                </Chip>
              </div>
            </button>

            {isExpanded && (
              <div className="border-t border-gray-200 px-4 py-3 space-y-2 bg-gray-50">
                {isFlattened ? (() => {
                  const instance = entityType.instances[0];
                  const containerId = `${entityKey}::${instance.id}`;
                  const firstSeenOrder = fieldOrderByContainer[containerId] || [];
                  const firstSeenIndex = new Map<string, number>(firstSeenOrder.map((k, idx) => [k, idx]));
                  const keys = Object.keys(instance.data || {});
                  const orderedKeys = [...keys].sort((a, b) => {
                    const pa = provenanceForField(a);
                    const pb = provenanceForField(b);
                    const ta = pa?.ts ? new Date(pa.ts).getTime() : Number.POSITIVE_INFINITY;
                    const tb = pb?.ts ? new Date(pb.ts).getTime() : Number.POSITIVE_INFINITY;
                    if (ta !== tb) return ta - tb; // oldest-first => newest ends up last
                    const sa = typeof pa?.seq === 'number' ? pa.seq : Number.POSITIVE_INFINITY;
                    const sb = typeof pb?.seq === 'number' ? pb.seq : Number.POSITIVE_INFINITY;
                    if (sa !== sb) return sa - sb;
                    const ra = firstSeenIndex.get(a) ?? Number.POSITIVE_INFINITY;
                    const rb = firstSeenIndex.get(b) ?? Number.POSITIVE_INFINITY;
                    if (ra !== rb) return ra - rb;
                    return String(a).localeCompare(String(b));
                  });

                  return (
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <div className="px-3 py-2">
                        {orderedKeys.length === 0 ? (
                          <div className="text-xs text-gray-500 italic">No fields</div>
                        ) : (
                          <div className="space-y-2">
                            {orderedKeys.map((key) => {
                              const value = (instance.data || {})[key];
                              const prov = provenanceForField(key);
                              const isMasked = maskedFields.has(String(key).toLowerCase());
                              const formattedValue = formatCollectedValue(key, value);
                              const metaText = `${prov?.ts ? moment(prov.ts).format('DD/MM/YYYY, HH:mm:ss') : '—'} · ${prov?.contributor || 'system'}`;
                              const segmentId = (() => {
                                if (key !== 'business_segment' || isMasked) return null;
                                const direct = String((instance.data as any)?.segment_id ?? '').trim();
                                if (direct) return direct;
                                const fromConversation = String((displayUserData as any)?.segment_id ?? '').trim();
                                return fromConversation || null;
                              })();

                              return (
                                <div key={key} className="flex items-start gap-2 text-xs">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-2 mb-1">
                                      <div className="flex items-center gap-1">
                                        <span className="text-gray-500 font-mono">
                                          {key}
                                          :
                                        </span>
                                        <button
                                          onClick={() => toggleMaskField(key)}
                                          className="text-gray-400 hover:text-gray-600"
                                        >
                                          {isMasked ? (
                                            <EyeSlashIcon className="w-3 h-3" />
                                          ) : (
                                            <EyeIcon className="w-3 h-3" />
                                          )}
                                        </button>
                                      </div>
                                    </div>
                                    <div className="text-gray-800 break-words">
                                      {(() => {
                                        if (isMasked) return maskValue(key, formattedValue);
                                        if (typeof formattedValue === 'object') {
                                          return JSON.stringify(formattedValue, null, 2);
                                        }
                                        if (key === 'business_segment' && segmentId) {
                                          return (
                                            <RouterLink
                                              to={`/settings/segments/${encodeURIComponent(segmentId)}`}
                                              className="text-primary underline underline-offset-2 hover:opacity-80"
                                              title={`Open segment: ${segmentId}`}
                                            >
                                              {String(formattedValue)}
                                            </RouterLink>
                                          );
                                        }
                                        return String(formattedValue);
                                      })()}
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5" title={metaText}>
                                      {metaText}
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                      {instance.metadata && Object.keys(instance.metadata).length > 0 && (
                        <div className="border-t border-gray-200 px-3 py-2">
                          <div className="text-xs font-semibold text-gray-700 mb-1">Metadata</div>
                          {Object.entries(instance.metadata).map(([k, v]) => (
                            <div key={k} className="text-xs text-gray-600">
                              <span className="font-mono">
                                {k}
                                :
                              </span>
                              {' '}
                              {String(v)}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })() : entityType.instances.map((instance) => {
                  const instanceKey = `${entityKey}-${instance.id}`;
                  const isInstanceExpanded = expandedEntityInstances.has(instanceKey);

                  return (
                    <div key={instance.id} className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <button
                        onClick={() => toggleEntityInstance(instanceKey)}
                        className={
                          'w-full px-3 py-2 flex items-center justify-between ' +
                          'hover:bg-gray-50 transition-colors'
                        }
                      >
                        <div className="flex items-center gap-2">
                          {isInstanceExpanded ? (
                            <ChevronDownIcon className="w-3 h-3 text-gray-500" />
                          ) : (
                            <ChevronRightIcon className="w-3 h-3 text-gray-500" />
                          )}
                          <span className="text-sm font-medium">{instance.id}</span>
                          {instance.metadata && Object.keys(instance.metadata).length > 0 && (
                            <Chip size="sm" variant="flat" className="text-xs">
                              {Object.keys(instance.metadata).join(', ')}
                            </Chip>
                          )}
                        </div>
                      </button>

                      {isInstanceExpanded && (
                        <div className="border-t border-gray-200 px-3 py-2 space-y-2">
                          {(() => {
                            const containerId = `${entityKey}::${instance.id}`;
                            const firstSeenOrder = fieldOrderByContainer[containerId] || [];
                            const firstSeenIndex = new Map<string, number>(firstSeenOrder.map((k, idx) => [k, idx]));
                            const keys = Object.keys(instance.data || {});
                            const orderedKeys = [...keys].sort((a, b) => {
                              const pa = provenanceForField(a);
                              const pb = provenanceForField(b);
                              const ta = pa?.ts ? new Date(pa.ts).getTime() : Number.POSITIVE_INFINITY;
                              const tb = pb?.ts ? new Date(pb.ts).getTime() : Number.POSITIVE_INFINITY;
                              if (ta !== tb) return ta - tb; // oldest-first
                              const sa = typeof pa?.seq === 'number' ? pa.seq : Number.POSITIVE_INFINITY;
                              const sb = typeof pb?.seq === 'number' ? pb.seq : Number.POSITIVE_INFINITY;
                              if (sa !== sb) return sa - sb;
                              const ra = firstSeenIndex.get(a) ?? Number.POSITIVE_INFINITY;
                              const rb = firstSeenIndex.get(b) ?? Number.POSITIVE_INFINITY;
                              if (ra !== rb) return ra - rb;
                              return String(a).localeCompare(String(b));
                            });
                            return orderedKeys.map((key) => {
                              const value = (instance.data || {})[key];
                              const prov = provenanceForField(key);
                              const isMasked = maskedFields.has(key.toLowerCase());
                              const formattedValue = formatCollectedValue(key, value);
                              const metaText = `${prov?.ts ? moment(prov.ts).format('DD/MM/YYYY, HH:mm:ss') : '—'} · ${prov?.contributor || 'system'}`;
                              const segmentId = (() => {
                                if (key !== 'business_segment' || isMasked) return null;
                                // Prefer explicit resolved segment_id if present in this entity snapshot.
                                const direct = String((instance.data as any)?.segment_id ?? '').trim();
                                if (direct) return direct;
                                // Fallback: use the conversation-level resolved segment_id (written by the backend flow router).
                                const fromConversation = String((displayUserData as any)?.segment_id ?? '').trim();
                                return fromConversation || null;
                              })();
                              return (
                                <div key={key} className="flex items-start gap-2 text-xs">
                                  <div className="flex-1">
                                    <div className="flex items-center gap-1 mb-1">
                                      <span className="text-gray-500 font-mono">
                                        {key}
                                        :
                                      </span>
                                      <button
                                        onClick={() => toggleMaskField(key)}
                                        className="text-gray-400 hover:text-gray-600"
                                      >
                                        {isMasked ? (
                                          <EyeSlashIcon className="w-3 h-3" />
                                        ) : (
                                          <EyeIcon className="w-3 h-3" />
                                        )}
                                      </button>
                                    </div>
                                    <div className="text-gray-800 break-words">
                                      {(() => {
                                        if (isMasked) return maskValue(key, formattedValue);
                                        if (typeof formattedValue === 'object') {
                                          return JSON.stringify(formattedValue, null, 2);
                                        }
                                        if (key === 'business_segment' && segmentId) {
                                          return (
                                            <RouterLink
                                              to={`/settings/segments/${encodeURIComponent(segmentId)}`}
                                              className="text-primary underline underline-offset-2 hover:opacity-80"
                                              title={`Open segment: ${segmentId}`}
                                            >
                                              {String(formattedValue)}
                                            </RouterLink>
                                          );
                                        }
                                        return String(formattedValue);
                                      })()}
                                    </div>
                                    <div className="text-[10px] text-gray-400 mt-0.5" title={metaText}>
                                      {metaText}
                                    </div>
                                  </div>
                                </div>
                              );
                            });
                          })()}
                          {instance.metadata && Object.keys(instance.metadata).length > 0 && (
                            <div className="pt-2 border-t border-gray-200">
                              <div className="text-xs font-semibold text-gray-700 mb-1">Metadata</div>
                              {Object.entries(instance.metadata).map(([key, value]) => (
                                <div key={key} className="text-xs text-gray-600">
                                  <span className="font-mono">
                                    {key}
                                    :
                                  </span>
                                  {' '}
                                  {String(value)}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );

  // API Log View Component
  const APILogView = () => {
    const sortedLogs = [...log].sort((a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );

    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">API Log</h2>
        {sortedLogs.length === 0 ? (
          <div className="text-center text-gray-500 py-8">No API calls recorded</div>
        ) : (
          <div className="space-y-2">
            {sortedLogs.map((call) => {
              const isExpanded = expandedApiCalls.has(call.id);
              return (
                <div key={call.id} className="border border-gray-200 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleApiCall(call.id)}
                    className="w-full px-4 py-3 flex items-center justify-between hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="flex-1 text-left">
                        <div className="font-medium text-sm">{call.provider}</div>
                        <div className="text-xs text-gray-500">
                          {moment(call.createdAt).format('M/D/YYYY, h:mm:ss A')}
                        </div>
                      </div>
                      <Chip size="sm" variant="flat" className="text-xs">
                        {call.latencyMs}
                        {' '}
                        ms
                      </Chip>
                    </div>
                    {isExpanded ? (
                      <ChevronDownIcon className="w-4 h-4 text-gray-500" />
                    ) : (
                      <ChevronRightIcon className="w-4 h-4 text-gray-500" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-gray-200 px-4 py-3 space-y-3 bg-gray-50">
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2">Request</div>
                        <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-auto max-h-64">
                          {JSON.stringify(call.request || {}, null, 2)}
                        </pre>
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-gray-700 mb-2">Response</div>
                        <pre className="text-xs bg-white p-2 rounded border border-gray-200 overflow-auto max-h-64">
                          {JSON.stringify(call.response || {}, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      className="relative flex-shrink-0 border-l border-default-200 flex flex-col bg-white"
      style={{ width: detailsWidthPx }}
    >
      {/* Resize handle */}
      <div
        role="separator"
        aria-orientation="vertical"
        title="Drag to resize"
        className={[
          'absolute left-0 top-0 h-full w-1',
          'cursor-col-resize',
          'hover:bg-default-200/70',
          'active:bg-default-300/80',
        ].join(' ')}
        onMouseDown={(ev) => {
          resizeStateRef.current.isResizing = true;
          resizeStateRef.current.startX = ev.clientX;
          resizeStateRef.current.startWidth = detailsWidthPx;
          document.body.style.cursor = 'col-resize';
          document.body.style.userSelect = 'none';
        }}
        onDoubleClick={() => setDetailsWidthPx(DEFAULT_DETAILS_WIDTH_PX)}
      />
      {/* Header */}
      <header className="border-b border-default-200 px-4 py-3 flex justify-between items-center gap-2">
        <span className="truncate block font-semibold">Conversation details</span>
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            color="danger"
            variant="flat"
            startContent={<FlagIcon className="w-4 h-4" />}
            onPress={() => setIsBugReportOpen(true)}
          >
            Report
          </Button>
          <Button
            size="sm"
            variant="light"
            isIconOnly
            radius="full"
            onPress={onClose}
          >
            <XMarkIcon className="size-4" />
          </Button>
        </div>
      </header>

      {/* View Mode Selector */}
      <div className="border-b border-default-200 px-4 py-2">
        <Select
          aria-label="Select view mode"
          selectedKeys={[viewMode]}
          onSelectionChange={(keys) => {
            const selected = Array.from(keys)[0] as ViewMode;
            setViewMode(selected);
          }}
          size="sm"
          className="w-full"
        >
          <SelectItem key="timeline">Timeline</SelectItem>
          <SelectItem key="data">Collected Data</SelectItem>
          <SelectItem key="log">API Log</SelectItem>
        </Select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        {viewMode === 'timeline' && (
          <div className="space-y-4">
            <FlowSummaryHeader />
            <div className="space-y-3">
              {flowHistory.map((flow) => {
                const flowKey = `${flow.slug}-${flow.sessionId}`;
                return <FlowSection key={flowKey} flow={flow} />;
              })}
            </div>
            <EventsQuickView />
            {loading && (
              <div className="flex justify-end">
                <span className="text-xs text-gray-400">Updating...</span>
              </div>
            )}
          </div>
        )}

        {viewMode === 'data' && <CollectedDataView />}

        {viewMode === 'log' && <APILogView />}
      </div>

      <BugReportForm
        conversationId={conversationId}
        isOpen={isBugReportOpen}
        onClose={() => setIsBugReportOpen(false)}
        getDebugBundle={getDebugBundle}
      />
    </div>
  );
};
