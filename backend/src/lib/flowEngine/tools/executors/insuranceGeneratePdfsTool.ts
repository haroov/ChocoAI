import { prisma } from '../../../../core';
import { generatePdfForCase } from '../../../insurance/pdf/pdfService';
import { ToolExecutor, ToolResult } from '../types';

function chooseTemplateName(productLine: string | undefined): string {
  if (productLine === 'cyber') return 'clal_cyber';
  if (productLine === 'med_pi') return 'clal_med_pi';
  return 'clal_smb_15943';
}

/**
 * insurance.generatePdfs
 * Generates one PDF document (MVP) for the selected product_line using the latest intake payload.
 */
export const insuranceGeneratePdfsTool: ToolExecutor = async (
  payload: Record<string, unknown>,
  { conversationId },
): Promise<ToolResult> => {
  try {
    const caseId = String(payload.insurance_case_id || '').trim();
    if (!caseId) {
      return { success: false, error: 'Missing insurance_case_id', errorCode: 'MISSING_CASE' };
    }

    const insuranceCase = await prisma.insuranceCase.findUnique({
      where: { id: caseId },
      include: { latestIntake: true },
    });
    if (!insuranceCase) return { success: false, error: 'Case not found', errorCode: 'CASE_NOT_FOUND' };
    if (!insuranceCase.latestIntake) {
      return { success: false, error: 'No latest intake found for case', errorCode: 'MISSING_INTAKE' };
    }

    const productLine = String(payload.product_line || '').trim();
    const templateName = chooseTemplateName(productLine || undefined);

    const template = await prisma.pdfTemplate.findFirst({
      where: {
        carrierId: insuranceCase.carrierId,
        active: true,
        name: templateName,
      },
      select: { id: true, name: true, version: true },
    });

    if (!template) {
      return {
        success: false,
        error: `Active PDF template not found for ${templateName}`,
        errorCode: 'TEMPLATE_NOT_FOUND',
      };
    }

    const gen = await generatePdfForCase({
      caseId: insuranceCase.id,
      templateId: template.id,
      payload: insuranceCase.latestIntake.payload,
    });
    if (!gen.ok) {
      return { success: false, error: gen.error, errorCode: 'PDF_GENERATION_FAILED' };
    }

    // Optional: tie the action to conversation for audit (minimal event)
    await prisma.event.create({
      data: {
        conversationId,
        kind: 'timeline',
        label: 'insurance.pdf.generated',
        data: {
          caseId: insuranceCase.id,
          templateName: template.name,
          templateVersion: template.version,
          documentId: gen.documentId,
        },
        channel: 'web',
      },
    }).catch(() => undefined);

    return {
      success: true,
      data: { documentIds: [gen.documentId] },
      saveResults: {
        insurance_pdf_document_ids: JSON.stringify([gen.documentId]),
      },
    };
  } catch (e: any) {
    return { success: false, error: e?.message || 'Failed to generate PDFs' };
  }
};
