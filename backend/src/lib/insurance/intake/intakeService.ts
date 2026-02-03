import { prisma } from '../../../core';
import { validateCanonicalIntakePayload } from '../forms/validationService';

export type CreateIntakeResult =
  | { ok: true; intakeId: string; schemaId: string; version: number }
  | { ok: false; error: string; schemaId?: string | null; details?: any };

export async function createInsuranceIntake(params: {
  caseId: string;
  payload: any;
  createdByUserId?: string | null;
  source?: string;
}): Promise<CreateIntakeResult> {
  const { caseId, payload, createdByUserId, source } = params;

  const validation = validateCanonicalIntakePayload(payload);
  if (!validation.ok) {
    return {
      ok: false,
      error: validation.message,
      schemaId: validation.schemaId,
      details: validation.errors,
    };
  }

  const agg = await prisma.insuranceIntake.aggregate({
    where: { caseId },
    _max: { version: true },
  });
  const nextVersion = (agg._max.version ?? 0) + 1;

  const intake = await prisma.insuranceIntake.create({
    data: {
      caseId,
      schemaId: validation.schemaId,
      version: nextVersion,
      payload: validation.normalizedPayload,
      source: source || 'api',
      createdByUserId: createdByUserId || null,
    },
    select: { id: true, version: true },
  });

  await prisma.insuranceCase.update({
    where: { id: caseId },
    data: { latestIntakeId: intake.id },
  });

  return { ok: true, intakeId: intake.id, schemaId: validation.schemaId, version: intake.version };
}
