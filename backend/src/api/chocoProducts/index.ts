import { registerRoute } from '../../utils/routesRegistry';
import {
  getLatestChocoProductsSegmentListFromDb,
  importChocoProductsSegmentListCsvToDb,
} from '../../lib/chocoProducts/importChocoProductsSegmentListCsv';

registerRoute('get', '/api/v1/choco-products/segment-list', async (_req, res) => {
  try {
    const latest = await getLatestChocoProductsSegmentListFromDb();
    if (!latest) return res.json({ ok: true, list: null });
    return res.json({
      ok: true,
      createdAt: latest.createdAt.toISOString(),
      rowCount: latest.rows.length,
      rows: latest.rows,
    });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Failed to load choco products list', message: e?.message });
  }
}, { protected: true });

registerRoute('post', '/api/v1/choco-products/segment-list/import', async (_req, res) => {
  try {
    const result = await importChocoProductsSegmentListCsvToDb();
    return res.json({ ok: true, ...result });
  } catch (e: any) {
    return res.status(500).json({ ok: false, error: 'Failed to import CSV', message: e?.message });
  }
}, { protected: true });

