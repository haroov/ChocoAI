import { Request, Response } from 'express';
import { registerRoute } from '../../utils/routesRegistry';
import { prisma } from '../../core';
import { createInsuranceIntake } from '../../lib/insurance/intake/intakeService';

registerRoute(
  'post',
  '/api/v1/insurance/cases/:caseId/intakes',
  async (req: Request<{ caseId: string }>, res: Response) => {
    try {
      const { caseId } = req.params;
      const existing = await prisma.insuranceCase.findUnique({ where: { id: caseId }, select: { id: true } });
      if (!existing) {
        return res.status(404).json({ ok: false, error: 'InsuranceCase not found' });
      }

      const result = await createInsuranceIntake({
        caseId,
        payload: req.body,
        source: 'api',
      });

      if (!result.ok) {
        return res.status(400).json({ ok: false, error: result.error, schemaId: result.schemaId, details: result.details });
      }

      return res.json({ ok: true, intakeId: result.intakeId, schemaId: result.schemaId, version: result.version });
    } catch (error: any) {
      return res.status(500).json({ ok: false, error: 'Failed to create intake', message: error?.message });
    }
  },
  { protected: true },
);
