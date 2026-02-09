export type SegmentInference = {
    // Core gating fields
    has_physical_premises?: boolean;
    business_site_type?: string[];
    business_site_type_other?: string;
    business_used_for?: string;
    business_activity_and_products?: string;

    // Coverage defaults (best-effort)
    ch1_contents_selected?: boolean;
    ch2_building_selected?: boolean;
    ch3a_selected?: boolean;
    ch4_burglary_selected?: boolean;
    ch5_money_selected?: boolean;
    ch6_transit_selected?: boolean;
    ch7_third_party_selected?: boolean;
    ch8_employers_selected?: boolean;
    ch9_product_selected?: boolean;
    ch10_electronic_selected?: boolean;
    cyber_selected?: boolean;
    terror_selected?: boolean;
    professional_liability_selected?: boolean;
};

function norm(s: unknown): string {
  return String(s ?? '').trim();
}

/**
 * Lightweight heuristics to infer obvious questionnaire defaults from userData.
 * This is intentionally conservative: it should only fill values that reduce redundant questions
 * without risking incorrect underwriting data.
 */
export function inferClalSmbFromUserData(userData: Record<string, unknown>): SegmentInference | null {
  const segName = norm(userData.segment_name_he || userData.segment_description);
  const groupName = norm(userData.segment_group_name_he || userData.segment_group_id);
  const usedFor = norm(userData.business_used_for);
  const activity = norm(userData.business_activity_and_products || userData.business_occupation);

  const text = [segName, groupName, usedFor, activity].filter(Boolean).join(' | ');
  if (!text) return null;

  // Lawyer / legal office heuristics
  if (/עו["״׳']?ד|עורך\s*דין|משרד\s*עו["״׳']?ד/i.test(text)) {
    return {
      has_physical_premises: true,
      business_site_type: ['משרד'],
      business_used_for: usedFor || 'שירותים משפטיים',
      business_activity_and_products: activity || 'שירותים משפטיים',
      professional_liability_selected: true,
      // Other coverages remain user-selected explicitly
    };
  }

  // Pure-online businesses often have no physical premises (very conservative)
  if (/ללא\s*מקום\s*פיזי|אונליין|online|דיגיטל|digital/i.test(text)) {
    return { has_physical_premises: false };
  }

  return null;
}
