import { registerRoute } from '../../utils/routesRegistry';
import {
  getSettings,
  updateSettings,
  getProjectSettings,
  updateSettings as updateProjectSettings,
  getToolsList,
} from './_handlers';
import { getMetricsData } from './helpers/getMetricsData';

registerRoute('get', '/api/v1/settings', getSettings, { protected: true });
registerRoute('put', '/api/v1/settings', updateSettings, { protected: true });
registerRoute('get', '/api/v1/project-settings', getProjectSettings, { protected: true });
registerRoute('post', '/api/v1/project-settings', updateProjectSettings, { protected: true });
registerRoute('get', '/api/v1/tools', getToolsList, { protected: true });

registerRoute('get', '/api/v1/settings/metrics', async (_, res) => {
  try {
    // Fetch metrics from database
    const metrics = await getMetricsData();

    const payload = {
      window: '24h',
      successRatePct: Number(metrics.kpi?.success_rate_pct || 0),
      avgResponseSec: Number(metrics.kpi?.avg_response_sec || 0),
      avgTokensPerConversation: Number(
        metrics.kpi?.avg_tokens_per_conversation || 0,
      ),
      avgCostPerConversationUsd: Number(
        metrics.kpi?.avg_cost_per_conversation_usd || 0,
      ),
      channelMix: metrics.channelMix.map((r: any) => ({
        channel: r.channel || 'unknown',
        count: Number(r.conversations || 0),
      })),
      activity: metrics.activity.map((a: any) => ({
        name: (a.test_name || '').replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase() || 'Unknown Test'),
        status: a.status || 'ok',
        at: a.created_at,
      })),
      updatedAt: new Date().toISOString(),
      errors: metrics.errors || [],
    };

    res.json(payload);
  } catch (error) {
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch metrics',
      details: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}, { protected: true });
