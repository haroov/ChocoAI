import { getSegmentsCatalogProd } from './loadSegmentsCatalog';
import { ResolvedSegment } from './resolveSegmentFromText';
import { SegmentsCatalogSegment, SegmentsCatalogSegmentGroup } from './types';
import type { JsonObject } from '../../../utils/json';

export type QuestionnairePrefillDefaults = {
  // Mirrors the existing questionnaire vars used by insuranceQuestionnaireInit/Answer
  has_physical_premises?: boolean;
  business_site_type?: string[];
  business_site_type_other?: string;
  business_used_for?: string;
  business_activity_and_products?: string;
};

export type SegmentDefaultsResult = {
  prefill: QuestionnairePrefillDefaults;
  userData: JsonObject;
  debug?: JsonObject;
};

const ALLOWED_SITE_TYPES = new Set([
  'משרד',
  'חנות',
  'בית מלאכה',
  'מפעל/ביח"ר',
  'מחסן',
  'אחר',
]);

function normalizeHe(s: string): string {
  return String(s || '').trim();
}

function mapSiteTypeHeToQuestionnaire(siteTypeHeRaw?: string): { business_site_type?: string[]; business_site_type_other?: string } {
  const siteTypeHe = normalizeHe(siteTypeHeRaw || '');
  if (!siteTypeHe) return {};

  // Direct allowed match
  if (ALLOWED_SITE_TYPES.has(siteTypeHe)) {
    return { business_site_type: [siteTypeHe] };
  }

  // Heuristic mapping
  if (/משרד/.test(siteTypeHe)) return { business_site_type: ['משרד'] };
  if (/חנות/.test(siteTypeHe)) return { business_site_type: ['חנות'] };
  if (/בית\s*מלאכה/.test(siteTypeHe)) return { business_site_type: ['בית מלאכה'] };
  if (/מפעל|ביח/.test(siteTypeHe)) return { business_site_type: ['מפעל/ביח"ר'] };
  if (/מחסן/.test(siteTypeHe)) return { business_site_type: ['מחסן'] };

  // Everything else must map to "אחר" + details.
  return {
    business_site_type: ['אחר'],
    business_site_type_other: siteTypeHe,
  };
}

function findSegmentAndGroup(segment_id?: string, segment_group_id?: string): {
  seg?: SegmentsCatalogSegment;
  group?: SegmentsCatalogSegmentGroup;
} {
  const catalog = getSegmentsCatalogProd();
  const seg = segment_id ? catalog.segments.find((s) => s.segment_id === segment_id) : undefined;
  const groupId = seg?.segment_group_id || segment_group_id;
  const group = groupId ? catalog.segment_groups.find((g) => g.group_id === groupId) : undefined;
  return { seg, group };
}

function deriveHasPhysicalPremises(seg?: SegmentsCatalogSegment, group?: SegmentsCatalogSegmentGroup): boolean | undefined {
  const v = seg?.business_profile_defaults?.has_physical_location;
  if (typeof v === 'boolean') return v;

  const gSite = String(group?.default_site_type_he || '').trim();
  if (!gSite) return undefined;
  if (/ללא\s*מקום\s*פיזי/.test(gSite)) return false;
  return true;
}

function buildActivitySummary(seg?: SegmentsCatalogSegment, group?: SegmentsCatalogSegmentGroup): { usedFor?: string; activity?: string } {
  const primary = String(seg?.business_profile_defaults?.primary_activity_he || '').trim();
  const segName = String(seg?.segment_name_he || '').trim();
  const groupName = String(group?.group_name_he || '').trim();

  const usedFor = primary || segName || groupName || '';
  const activity = primary || segName || '';

  return {
    usedFor: usedFor || undefined,
    activity: activity || undefined,
  };
}

/**
 * Convert a resolved segment/group into questionnaire prefills + userData metadata.
 * IMPORTANT: The caller should apply these only if missing (non-destructive precedence).
 */
export function buildQuestionnaireDefaultsFromResolution(resolved: ResolvedSegment): SegmentDefaultsResult {
  const { seg, group } = findSegmentAndGroup(resolved.segment_id, resolved.segment_group_id);

  const siteTypeFromSeg = seg?.business_profile_defaults?.site_type_he;
  const siteTypeFromGroup = group?.default_site_type_he;
  const siteTypeHe = String(siteTypeFromSeg || siteTypeFromGroup || '').trim() || undefined;

  const mappedSite = mapSiteTypeHeToQuestionnaire(siteTypeHe);
  const has_physical_premises = deriveHasPhysicalPremises(seg, group);
  const { usedFor, activity } = buildActivitySummary(seg, group);

  const prefill: QuestionnairePrefillDefaults = {
    ...(has_physical_premises !== undefined ? { has_physical_premises } : {}),
    ...(mappedSite.business_site_type ? { business_site_type: mappedSite.business_site_type } : {}),
    ...(mappedSite.business_site_type_other ? { business_site_type_other: mappedSite.business_site_type_other } : {}),
    ...(usedFor ? { business_used_for: usedFor } : {}),
    ...(activity ? { business_activity_and_products: activity } : {}),
  };

  const userData: JsonObject = {
    ...(resolved.segment_group_id ? { segment_group_id: resolved.segment_group_id } : {}),
    ...(resolved.segment_id ? { segment_id: resolved.segment_id } : {}),
    ...(resolved.default_package_key ? { default_package_key: resolved.default_package_key } : {}),
    ...(resolved.segment_name_he ? { segment_name_he: resolved.segment_name_he } : {}),
    ...(resolved.group_name_he ? { segment_group_name_he: resolved.group_name_he } : {}),
    segment_resolution_source: resolved.source,
    segment_resolution_confidence: resolved.match_confidence,
  };

  return {
    prefill,
    userData,
    debug: {
      site_type_he: siteTypeHe,
      segment_found: !!seg,
      group_found: !!group,
    },
  };
}
