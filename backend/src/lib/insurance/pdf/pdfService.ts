export type GeneratePdfForCaseInput = {
    caseId: string;
    templateId: string;
    payload: unknown;
};

export type GeneratePdfForCaseResult =
    | { ok: true; documentId: string }
    | { ok: false; error: string };

/**
 * MVP stub PDF generator.
 *
 * NOTE: The PDF pipeline is not implemented in this repository snapshot.
 * We keep this module to satisfy imports and to fail gracefully if invoked.
 */
export async function generatePdfForCase(_input: GeneratePdfForCaseInput): Promise<GeneratePdfForCaseResult> {
  return {
    ok: false,
    error: 'PDF generation is not implemented in this build',
  };
}
