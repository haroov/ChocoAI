import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { generatePdfForCase } from '../../lib/insurance/pdf/pdfService';

registerRoute(
  'post',
  '/api/v1/insurance/cases/:caseId/pdfs/generate',
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const { caseId } = req.params;

      const insuranceCase = await prisma.insuranceCase.findUnique({
        where: { id: caseId },
        select: { id: true, carrierId: true, latestIntakeId: true },
      });
      if (!insuranceCase) {
        return res.status(404).json({ ok: false, error: 'InsuranceCase not found' });
      }
      if (!insuranceCase.latestIntakeId) {
        return res.status(400).json({ ok: false, error: 'No intake found for case (latestIntakeId is null)' });
      }

      const intake = await prisma.insuranceIntake.findUnique({
        where: { id: insuranceCase.latestIntakeId },
        select: { payload: true, schemaId: true, version: true },
      });
      if (!intake) {
        return res.status(400).json({ ok: false, error: 'latestIntakeId points to missing intake' });
      }

      const templates = await prisma.pdfTemplate.findMany({
        where: {
          active: true,
          OR: [{ carrierId: insuranceCase.carrierId }, { carrierId: null }],
        },
        select: { id: true, name: true, version: true },
        orderBy: [{ name: 'asc' }, { version: 'desc' }],
      });
      if (templates.length === 0) {
        return res.status(404).json({ ok: false, error: 'No active PdfTemplate found for carrier' });
      }

      const results: Array<{ templateId: string; ok: boolean; documentId?: string; error?: string }> = [];
      for (const t of templates) {
        const r = await generatePdfForCase({ caseId, templateId: t.id, payload: intake.payload });
        if (r.ok) results.push({ templateId: t.id, ok: true, documentId: r.documentId });
        else results.push({ templateId: t.id, ok: false, error: r.error });
      }

      return res.json({
        ok: true,
        intake: { schemaId: intake.schemaId, version: intake.version },
        results,
      });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: 'Failed to generate PDFs', message: error?.message });
    }
  },
  { protected: true },
);
