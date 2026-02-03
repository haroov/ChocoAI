import fs from 'fs';
import path from 'path';
import { prisma } from '../../../../core';
import { createInsuranceIntake } from '../../../insurance/intake/intakeService';
import { ToolExecutor, ToolResult } from '../types';

function findRepoRootWithForms(): string {
  const candidates = [process.cwd(), path.join(process.cwd(), '..')];
  const found = candidates.find((p) => fs.existsSync(path.join(p, 'forms', 'clal_exampleform.json')));
  return found || process.cwd();
}

function toNumberOrUndefined(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function setIfDefined(obj: any, pathParts: Array<string | number>, value: any) {
  if (value === undefined) return;
  let cur = obj;
  for (let i = 0; i < pathParts.length - 1; i += 1) {
    const k = pathParts[i];
    if (cur[k] == null) cur[k] = typeof pathParts[i + 1] === 'number' ? [] : {};
    cur = cur[k];
  }
  cur[pathParts[pathParts.length - 1]] = value;
}

function mapProductLineToMeta(productLine: string | undefined): { form_catalog_number: string; form_version_date: string } {
  if (productLine === 'cyber') return { form_catalog_number: 'cyber', form_version_date: '2025-01' };
  if (productLine === 'med_pi') return { form_catalog_number: 'med-pi', form_version_date: '2025-08' };
  return { form_catalog_number: '15943', form_version_date: '2025-07' }; // business_package default
}

/**
 * insurance.saveIntake
 * Builds a canonical-ish JSON payload (MVP) by starting from `forms/clal_exampleform.json`
 * and overriding fields collected in the flow, then creates a versioned InsuranceIntake.
 */
export const insuranceSaveIntakeTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { userId: true },
    });
    if (!conversation?.userId) {
      return { success: false, error: 'Conversation or user not found', errorCode: 'CONVERSATION_NOT_FOUND' };
    }

    const caseId = String(payload.insurance_case_id || '').trim();
    if (!caseId) {
      return { success: false, error: 'Missing insurance_case_id', errorCode: 'MISSING_CASE' };
    }

    const repoRoot = findRepoRootWithForms();
    const basePath = path.join(repoRoot, 'forms', 'clal_exampleform.json');
    const base = JSON.parse(fs.readFileSync(basePath, 'utf8'));

    // Meta
    const productLine = String(payload.product_line || 'business_package');
    const meta = mapProductLineToMeta(productLine);
    base.meta = {
      ...(base.meta || {}),
      insurer: 'clal',
      ...meta,
      created_at: new Date().toISOString(),
      status: 'draft',
    };

    // Agent
    base.agent = {
      ...(base.agent || {}),
      agent_name: 'ChocoAI (שוקו)',
    };

    // Applicant
    setIfDefined(base, ['applicant', 'person', 'first_name'], String(payload.first_name || '').trim() || undefined);
    setIfDefined(base, ['applicant', 'person', 'last_name'], String(payload.last_name || '').trim() || undefined);
    setIfDefined(base, ['applicant', 'person', 'national_id'], String(payload.national_id || '').trim() || undefined);
    const contactMobile = String(payload.contact_mobile || payload.phone || '').trim();
    const contactEmail = String(payload.contact_email || payload.email || '').trim();
    setIfDefined(base, ['applicant', 'contact', 'mobile'], contactMobile || undefined);
    setIfDefined(base, ['applicant', 'contact', 'email'], contactEmail || undefined);

    // Business
    setIfDefined(base, ['business', 'name'], String(payload.business_name || '').trim() || undefined);
    setIfDefined(base, ['business', 'registration_id'], String(payload.legal_id || '').trim() || undefined);
    setIfDefined(base, ['business', 'business_use'], String(payload.business_use || '').trim() || undefined);
    setIfDefined(base, ['business', 'contact', 'mobile'], contactMobile || undefined);
    setIfDefined(base, ['business', 'contact', 'email'], contactEmail || undefined);

    // Location 0 address (MVP)
    setIfDefined(base, ['locations', 0, 'address', 'city'], String(payload.business_city || '').trim() || undefined);
    setIfDefined(base, ['locations', 0, 'address', 'street'], String(payload.business_street || '').trim() || undefined);
    setIfDefined(base, ['locations', 0, 'address', 'house_number'], String(payload.business_house_number || '').trim() || undefined);

    // Key underwriting numbers (MVP)
    const employeesCount = toNumberOrUndefined(payload.employees_count);
    const contentsSum = toNumberOrUndefined(payload.contents_sum_insured_ils);
    const stockSum = toNumberOrUndefined(payload.stock_sum_insured_ils);
    const thirdPartyLimit = toNumberOrUndefined(payload.third_party_limit_ils);

    // Contents/stock
    setIfDefined(base, ['coverages', 'property', 'by_location', 0, 'chapter_1_contents', 'sum_insured_contents_excl_stock_ils'], contentsSum);
    setIfDefined(base, ['coverages', 'property', 'by_location', 0, 'chapter_1_contents', 'sum_insured_stock_ils'], stockSum);

    // Third party
    setIfDefined(base, ['coverages', 'liability', 'chapter_7_third_party', 'limit_per_event_ils'], thirdPartyLimit);
    setIfDefined(base, ['coverages', 'liability', 'chapter_7_third_party', 'limit_aggregate_ils'], thirdPartyLimit);

    // Employers liability employees
    if (employeesCount !== undefined) {
      setIfDefined(base, ['coverages', 'liability', 'chapter_8_employers_liability', 'employees', 0, 'employee_count'], employeesCount);
    }

    // Cyber annex selection (MVP toggle)
    if (productLine === 'cyber') {
      setIfDefined(base, ['coverages', 'annexes', 'annex_a_cyber', 'selected'], true);
    }

    const result = await createInsuranceIntake({
      caseId,
      payload: base,
      createdByUserId: conversation.userId,
      source: 'flow',
    });

    if (!result.ok) {
      return {
        success: false,
        error: result.error,
        errorCode: 'INTAKE_VALIDATION_FAILED',
        data: { schemaId: result.schemaId, details: result.details },
      };
    }

    return {
      success: true,
      data: { intakeId: result.intakeId, schemaId: result.schemaId, version: result.version },
      saveResults: {
        insurance_latest_intake_id: result.intakeId,
        insurance_latest_intake_schema_id: result.schemaId,
        insurance_latest_intake_version: String(result.version),
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to save intake' };
  }
};

