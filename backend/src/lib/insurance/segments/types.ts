export type SegmentsCatalogInsuranceProduct = {
  product_key: string;
  product_name_he?: string;
  insurer_code?: string;
  channel?: string;
  notes_he?: string;
};

export type SegmentsCatalogSegmentGroup = {
  group_id: string;
  group_name_he?: string;
  default_site_type_he?: string;
  default_package_key?: string;
  clal?: {
    is_express?: boolean;
    product_key?: string;
    collective_code?: number | null;
    collective_code_rules?: Array<{
      collective_code: number;
      collective_name_he?: string;
      when_he?: string;
    }>;
  };
};

export type SegmentsCatalogSegment = {
  segment_id: string;
  segment_name_he?: string;
  segment_group_id?: string;
  /**
   * When multiple catalog rows represent the same logical segment (duplicate name within same group),
   * we keep the non-canonical rows but point them to the canonical segment_id.
   * Admin UI should hide duplicates by default and the resolver should return the canonical id.
   */
  duplicate_of?: string;
  /**
   * Optional alias / keyword phrases to improve segment matching.
   * Intended for free-text resolution (Hebrew/English/etc).
   */
  keywords?: string[];
  /**
   * Coverage toggles per segment (agent-configured).
   * Keys are normalized semantic IDs (e.g. "building", "contents", "third_party", "cyber", ...).
   * Values represent the default inclusion (on/off) for this segment.
   */
  coverages?: Record<string, boolean>;
  /**
   * Optional linkage to Choco "insurance-products" catalog rows (CSV import).
   */
  choco_product_slugs?: string[];
  business_profile_defaults?: {
    segment_group_he?: string;
    site_type_he?: string;
    primary_activity_he?: string;
    has_physical_location?: boolean;
  };
  clal_mapping?: {
    mapping_status?: string;
    insurer_code?: string;
    product_key?: string;
    risk_symbol_code?: number;
    collective_code?: number | null;
    collective_code_rules?: Array<{
      collective_code: number;
      collective_name_he?: string;
      when_he?: string;
    }>;
  };
  default_package_key?: string;
  relevant_insurance_types?: string[];
  recommended_products?: Array<{
    product_key: string;
    package_key?: string;
    priority?: string;
    notes_he?: string;
  }>;
};

export type SegmentsCatalogProd = {
  catalog_id: string;
  catalog_version: string;
  environment: 'production' | string;
  generated_at_iso?: string;
  locale?: string;
  currency?: string;
  insurer?: {
    insurer_code?: string;
    insurer_name_he?: string;
  };
  insurance_products?: SegmentsCatalogInsuranceProduct[];
  segment_groups: SegmentsCatalogSegmentGroup[];
  segments: SegmentsCatalogSegment[];
};
