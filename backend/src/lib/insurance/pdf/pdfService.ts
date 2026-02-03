import crypto from 'crypto';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { prisma } from '../../../core';
import { flattenJsonToTextEntries } from './jsonFlatten';

type MappingSpec = {
  schemaId?: string;
  pdf?: { file?: string; mode?: 'coordinates' | 'acroform'; note?: string };
  fields?: Array<{
    sourcePath: string;
    target: { page: number; x: number; y: number; fontSize?: number };
    type?: 'text' | 'number' | 'date' | 'checkbox';
  }>;
  appendix?: { enabled?: boolean; title?: string };
};

function getByPath(obj: any, pathStr: string): any {
  // Minimal JSONPath-like: dot notation + [index]
  if (!pathStr) return undefined;
  const parts = pathStr
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function formatValue(v: any): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function sha256(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

async function drawCoordinateFields(params: {
  pdf: PDFDocument;
  payload: any;
  mapping: MappingSpec;
}) {
  const { pdf, payload, mapping } = params;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fields = mapping.fields || [];
  for (const f of fields) {
    const v = getByPath(payload, f.sourcePath);
    const text = formatValue(v);
    if (!text) continue;
    const page = pdf.getPage(f.target.page);
    page.drawText(text, {
      x: f.target.x,
      y: f.target.y,
      size: f.target.fontSize ?? 10,
      font,
      color: rgb(0, 0, 0),
    });
  }
}

async function appendAppendix(params: {
  pdf: PDFDocument;
  payload: any;
  title?: string;
}) {
  const { pdf, payload, title } = params;
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const entries = flattenJsonToTextEntries(payload, { maxEntries: 4000 });
  const lines = entries.map((e) => `${e.path}: ${e.value}`);

  const pageWidth = 595.28; // A4
  const pageHeight = 841.89;
  const margin = 40;
  const lineHeight = 12;
  const maxLinesPerPage = Math.floor((pageHeight - margin * 2 - 40) / lineHeight);

  let i = 0;
  while (i < lines.length) {
    const page = pdf.addPage([pageWidth, pageHeight]);
    let y = pageHeight - margin;

    const header = title || 'Appendix';
    page.drawText(header, { x: margin, y, size: 14, font: bold });
    y -= 24;

    page.drawText(`GeneratedAt: ${new Date().toISOString()}`, { x: margin, y, size: 10, font });
    y -= 20;

    for (let c = 0; c < maxLinesPerPage && i < lines.length; c += 1, i += 1) {
      const line = lines[i];
      // Truncate very long lines to keep PDF reasonable
      const trimmed = line.length > 180 ? `${line.slice(0, 177)}...` : line;
      page.drawText(trimmed, { x: margin, y, size: 9, font });
      y -= lineHeight;
    }
  }
}

export async function generatePdfForCase(params: {
  caseId: string;
  templateId: string;
  payload: any;
}): Promise<{ ok: true; documentId: string } | { ok: false; error: string }> {
  const template = await prisma.pdfTemplate.findUnique({
    where: { id: params.templateId },
    select: { id: true, name: true, version: true, fileBytes: true, fieldMapping: true },
  });
  if (!template) return { ok: false, error: 'Template not found' };

  const mapping = (template.fieldMapping || {}) as MappingSpec;

  const pdf = await PDFDocument.load(Buffer.from(template.fileBytes), { ignoreEncryption: true });

  // Flat PDFs: we overlay by coordinates (if configured), and always add an appendix in MVP.
  if (mapping.pdf?.mode === 'coordinates') {
    await drawCoordinateFields({ pdf, payload: params.payload, mapping });
  }

  if (mapping.appendix?.enabled !== false) {
    await appendAppendix({ pdf, payload: params.payload, title: mapping.appendix?.title });
  }

  const outBytes = Buffer.from(await pdf.save());
  const digest = sha256(outBytes);
  const fileName = `${template.name}_v${template.version}_${params.caseId}.pdf`;

  const doc = await prisma.pdfDocument.create({
    data: {
      caseId: params.caseId,
      templateId: template.id,
      status: 'generated',
      fileName,
      mimeType: 'application/pdf',
      sizeBytes: outBytes.length,
      sha256: digest,
      fileBytes: outBytes,
    },
    select: { id: true },
  });

  return { ok: true, documentId: doc.id };
}
