import { flowHandoffTool } from './flowHandoffTool';
import { ToolExecutor, ToolResult } from '../types';

/**
 * insurance.handoffToProposalForm
 * Explicitly hands off to proposalForm to continue with the PROD dynamic questionnaire.
 *
 * This is preferred over relying on flow.onComplete in cases where we want deterministic,
 * immediate continuation in the same turn.
 */
export const insuranceHandoffToProposalFormTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  ctx,
): Promise<ToolResult> => {
  // Preserve the same fields defined in needsDiscovery.onComplete to keep compatibility.
  const preserveFields = Array.isArray(payload?.__preserveFieldsForProposalForm)
    ? (payload.__preserveFieldsForProposalForm as string[])
    : [
      'business_name',
      'legal_id_type',
      'legal_id',
      'first_name',
      'last_name',
      'phone',
      'email',
      'product_line',
      'coverages_needed',
      'special_risks',
      'industry',
      'activity_description',
      'annual_turnover_ils',
      'employees_count',
      'already_registered',
      // product-specific extras
      'med_pi_profession',
      'med_pi_years_experience',
      'med_pi_licensed',
      'med_pi_works_with_children',
      'med_pi_sessions_per_week',
      'cyber_backups_exist',
      'cyber_backup_frequency',
      'cyber_backup_frequency_other',
      'cyber_antivirus_installed',
      'cyber_firewall_installed',
      'cyber_incident_last_5_years',
      'cyber_incident_last_5_years_details',
      // stage 02 gate / questionnaire vars (if already collected elsewhere)
      'segment_description',
      'segment_group_id',
      'segment_id',
      'default_package_key',
      'segment_name_he',
      'segment_group_name_he',
      'segment_resolution_source',
      'segment_resolution_confidence',
      // Questionnaire prefill vars (when inferred early)
      'has_physical_premises',
      'business_site_type',
      'business_site_type_other',
      'business_used_for',
      'business_activity_and_products',
    ];

  return flowHandoffTool({ targetFlowSlug: 'proposalForm', preserveFields }, ctx);
};
