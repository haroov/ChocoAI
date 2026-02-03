import { prisma } from '../../../core/prisma';
import { logger } from '../../../utils/logger';

const metricsCache = new Map<string, { ts: number; metrics: any }>();

export const getMetricsData = async (refresh = false) => {
  const cacheKey = 'metrics_24h_v3';
  const cached = metricsCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < 30000 && !refresh) {
    return cached.metrics;
  }

  const errors: string[] = [];
  let kpi: any = null;
  let channelMix: any[] = [];
  let activity: any[] = [];

  try {
    // Main KPI query
    // Simplified KPI query - break it down into separate queries
    const convResult = (await prisma.$queryRaw`
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE status = 'resolved')::int AS resolved,
        COUNT(*) FILTER (WHERE status = 'handoff')::int AS handoff
      FROM conversations
      WHERE "createdAt" >= now() - interval '24 hours'
    `) as any[];

    const apiResult = (await prisma.$queryRaw`
      SELECT
        COALESCE(AVG(a."latencyMs") / 1000.0, 0)::numeric(10,2) AS avg_response_sec,
        COALESCE(AVG(a."tokensIn" + a."tokensOut"), 0)::int AS avg_tokens_per_call,
        COALESCE(SUM(
          CASE 
            WHEN a.model = 'gpt-4o-mini' THEN (a."tokensIn" * 0.00015 + a."tokensOut" * 0.00060) / 1000
            WHEN a.model = 'gpt-4o' THEN (a."tokensIn" * 0.0025 + a."tokensOut" * 0.010) / 1000
            WHEN a.model = 'claude-3.5' THEN (a."tokensIn" * 0.003 + a."tokensOut" * 0.015) / 1000
            ELSE (a."tokensIn" * 0.00015 + a."tokensOut" * 0.00060) / 1000
          END
        ), 0)::numeric(10,6) AS total_cost_usd
      FROM api_calls a
      WHERE a."createdAt" >= now() - interval '24 hours'
    `) as any[];

    const kpiResult = [
      {
        total: convResult[0]?.total || 0,
        resolved: convResult[0]?.resolved || 0,
        handoff: convResult[0]?.handoff || 0,
        success_rate_pct:
          convResult[0]?.total > 0
            ? Math.round(
              (convResult[0].resolved / convResult[0].total) * 100 * 10,
            ) / 10
            : 0,
        avg_response_sec: apiResult[0]?.avg_response_sec || 0,
        avg_tokens_per_conversation: apiResult[0]?.avg_tokens_per_call || 0,
        avg_cost_per_conversation_usd: apiResult[0]?.total_cost_usd || 0,
      },
    ];

    kpi = kpiResult[0] || {};
  } catch (error) {
    errors.push('Failed to fetch KPI data');
  }

  try {
    // Channel mix query
    const channelMixResult = /* (await prisma.$queryRaw`
      WITH w AS (
        SELECT now() - interval '24 hours' AS since
      ),
      first_msg AS (
        SELECT DISTINCT ON (m."conversationId")
          m."conversationId", m.channel
        FROM messages m, w
        WHERE m."createdAt" >= w.since
        ORDER BY m."conversationId", m."createdAt" ASC
      )
      SELECT channel, COUNT(*) AS conversations
      FROM first_msg
      GROUP BY channel
    `) */ [] as any[];

    channelMix = channelMixResult || [];
  } catch (error) {
    logger.error('Error fetching channel mix:', error);
    errors.push('Failed to fetch channel mix');
  }

  try {
    // Test activity feed query
    const activityResult = (await prisma.$queryRaw`
      WITH w AS (
        SELECT now() - interval '24 hours' AS since
      )
      SELECT
        kind AS test_name,
        (data->>'status') AS status,
        "createdAt"
      FROM events, w
      WHERE "createdAt" >= w.since
        AND kind IN ('test_llm','widget_test','whatsapp_test','flow_test')
      ORDER BY "createdAt" DESC
      LIMIT 10
    `) as any[];

    activity = activityResult || [];
  } catch (error) {
    errors.push('Failed to fetch activity feed');
  }

  const metrics = { kpi, channelMix, activity, errors };
  metricsCache.set(cacheKey, { ts: Date.now(), metrics });
  return metrics;
};
