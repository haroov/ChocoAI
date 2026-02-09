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

export type SegmentsCatalogPackage = {
  package_key: string;
  package_name_he?: string;
  insurer_code?: string;
  product_key?: string;
  currency?: string;
  defaults_source?: string;
  segment_id?: string;
  default_limits?: Record<string, unknown>;
  default_deductibles?: Record<string, unknown>;
  included_extensions?: Record<string, unknown>;
  selected_coverages?: Record<string, unknown>;
  notes_he?: string;
  important_logic_he?: string[];
};

export type SegmentsCatalogSegment = {
  segment_id: string;
  segment_name_he?: string;
  segment_group_id?: string;
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
  packages: Record<string, SegmentsCatalogPackage>;
  segments: SegmentsCatalogSegment[];
};
