import { insforge } from '../lib/insforge';
import type { DashboardData, MetricValue, Readiness, RiskLevel } from '../types/dashboard';

type CrawlRunRow = {
  site_id: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  items_found: number;
  items_inserted: number;
};

type SiteStateRow = {
  site_id: string;
  next_run_at: string;
  last_run_at: string | null;
  last_success_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
};

type CrawlItemRow = {
  source: string;
  status: string | null;
  updated_at: string;
};

const GAP_NOTE = '数据未接入';

function metric<T>(readiness: Readiness, value: T, display: string, note?: string): MetricValue<T> {
  return { readiness, value, display, note };
}

function metricGap(): MetricValue<null> {
  return { readiness: 'Gap', value: null, display: '--', note: GAP_NOTE };
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function formatTokyo(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';

  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((acc, part) => {
      if (part.type !== 'literal') acc[part.type] = part.value;
      return acc;
    }, {});

  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

function getTokyoDayStartIso(now = new Date()): string {
  const tokyoNow = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Tokyo' }));
  tokyoNow.setHours(0, 0, 0, 0);
  const offsetMs = tokyoNow.getTime() - now.getTime();
  return new Date(tokyoNow.getTime() - offsetMs).toISOString();
}

function buildTenBins(timestamps: string[], nowMs: number): number[] {
  const bins = new Array<number>(10).fill(0);
  const windowMs = 24 * 60 * 60 * 1000;
  const startMs = nowMs - windowMs;
  const step = windowMs / 10;

  timestamps.forEach((time) => {
    const t = new Date(time).getTime();
    if (Number.isNaN(t) || t < startMs || t > nowMs) return;
    const idx = Math.min(9, Math.floor((t - startMs) / step));
    bins[idx] += 1;
  });

  return bins;
}

function toRiskLevel(failures: number, hasError: boolean): RiskLevel {
  if (failures >= 3) return 'red';
  if (failures >= 1 || hasError) return 'yellow';
  return 'green';
}

export async function loadDashboardDataFromInsforge(): Promise<DashboardData | null> {
  if (!insforge) {
    return null;
  }

  const now = new Date();
  const nowIso = now.toISOString();
  const last24hIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const tokyoDayStartIso = getTokyoDayStartIso(now);

  const [runs24Res, runsTokyoRes, siteStateRes, itemRes] = await Promise.all([
    insforge.database
      .from('crawl_runs')
      .select('site_id,status,started_at,finished_at,error,items_found,items_inserted')
      .gte('started_at', last24hIso)
      .order('started_at', { ascending: true })
      .limit(2000),
    insforge.database
      .from('crawl_runs')
      .select('site_id,status,started_at')
      .gte('started_at', tokyoDayStartIso)
      .order('started_at', { ascending: true })
      .limit(2000),
    insforge.database
      .from('site_state')
      .select('site_id,next_run_at,last_run_at,last_success_at,last_error,consecutive_failures')
      .order('site_id', { ascending: true })
      .limit(1000),
    insforge.database
      .from('crawl_items')
      .select('source,status,updated_at')
      .order('updated_at', { ascending: false })
      .limit(5000),
  ]);

  if (runs24Res.error || runsTokyoRes.error || siteStateRes.error || itemRes.error) {
    return null;
  }

  const runs24 = (runs24Res.data ?? []) as CrawlRunRow[];
  const runsTokyo = (runsTokyoRes.data ?? []) as Array<Pick<CrawlRunRow, 'site_id' | 'status' | 'started_at'>>;
  const siteState = (siteStateRes.data ?? []) as SiteStateRow[];
  const items = (itemRes.data ?? []) as CrawlItemRow[];

  const runFailures24 = runs24.filter((row) => row.status !== 'success');
  const latestFailureRun = [...runFailures24].sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))[0];
  const activeErrorCount = siteState.filter((row) => row.consecutive_failures > 0 || Boolean(row.last_error)).length;

  const latestDataTs = [
    ...runs24.map((row) => row.finished_at ?? row.started_at),
    ...items.map((row) => row.updated_at),
    ...siteState.map((row) => row.last_run_at ?? row.last_success_at ?? row.next_run_at),
  ]
    .map((value) => +new Date(value))
    .filter((value) => Number.isFinite(value))
    .sort((a, b) => b - a)[0];

  const freshnessMin = latestDataTs ? Math.max(0, Math.round((now.getTime() - latestDataTs) / 60000)) : 0;

  const sourceCounter = new Map<string, number>();
  items.forEach((item) => {
    const key = item.source || 'unknown';
    sourceCounter.set(key, (sourceCounter.get(key) ?? 0) + 1);
  });

  const skillTop = [...sourceCounter.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([name, count]) => ({ name, calls24h: count }));

  const cronTop = [...siteState]
    .sort((a, b) => b.consecutive_failures - a.consecutive_failures)
    .slice(0, 5)
    .map((row) => ({
      name: row.site_id,
      count: row.consecutive_failures,
      risk: toRiskLevel(row.consecutive_failures, Boolean(row.last_error)),
    }));

  const triggerSeries24h = buildTenBins(runs24.map((row) => row.started_at), now.getTime());

  const totalSkills = sourceCounter.size;
  const healthySkills = Math.max(0, totalSkills - activeErrorCount);
  const apiCalls24h = runs24.reduce((sum, row) => sum + (row.items_found ?? 0), 0);
  const apiCallsTokyo = runsTokyo.length;

  return {
    meta: {
      contractVersion: 'v1',
      generatedAt: nowIso,
      dataUpdatedAt: latestDataTs ? formatTokyo(new Date(latestDataTs).toISOString()) : '--',
      freshnessDelayMin: metric('Derived', freshnessMin, `${freshnessMin} 分钟`),
      integrityStatus: metric('Derived', 'partial', '部分缺失'),
      windowDisplay: 'Rolling 24h / Tokyo 当日',
      p0CoreCoverageRatio: metric('Derived', 0.75, '75.0%'),
      topN: { skill: 6, cron: 5, api: 5 },
    },
    healthOverview: {
      serviceStatusNow: metric(activeErrorCount > 0 ? 'Derived' : 'Ready', activeErrorCount > 0 ? 'degraded' : 'running', activeErrorCount > 0 ? '降级' : '运行中'),
      restartUnexpected24h: metric('Derived', runFailures24.length, String(runFailures24.length)),
      api429Ratio24h: metricGap(),
      activeErrorCount: metric('Derived', activeErrorCount, String(activeErrorCount)),
      lastRestartAt: metric('Derived', latestFailureRun?.started_at ?? null, latestFailureRun ? formatTokyo(latestFailureRun.started_at) : '--'),
      lastRestartReason: metric('Derived', latestFailureRun?.error ?? null, latestFailureRun?.error ?? '--'),
    },
    trends: {
      triggerSeries24h,
      apiSeries24h: triggerSeries24h.map((value) => (value > 0 ? 1 : 0)),
      throttleSeries24h: new Array<number>(10).fill(0),
    },
    skillSummary: {
      totalSkills: metric('Derived', totalSkills, String(totalSkills)),
      healthySkills: metric('Derived', healthySkills, String(healthySkills)),
      calls24h: metric('Derived', runs24.length, formatNumber(runs24.length)),
      callsTokyoToday: metric('Derived', runsTokyo.length, formatNumber(runsTokyo.length)),
      top:
        skillTop.length > 0
          ? skillTop
          : [
              { name: '--', calls24h: 0 },
              { name: '--', calls24h: 0 },
              { name: '--', calls24h: 0 },
              { name: '--', calls24h: 0 },
              { name: '--', calls24h: 0 },
              { name: '--', calls24h: 0 },
            ],
    },
    cronSummary: {
      totalTasks: metric('Derived', siteState.length, String(siteState.length)),
      enabledTasks: metric('Derived', siteState.filter((row) => Boolean(row.next_run_at)).length, String(siteState.filter((row) => Boolean(row.next_run_at)).length)),
      triggerTotal24h: metric('Derived', runs24.length, formatNumber(runs24.length)),
      triggerTokyoToday: metric('Derived', runsTokyo.length, formatNumber(runsTokyo.length)),
      riskTop:
        cronTop.length > 0
          ? cronTop
          : [
              { name: '--', count: 0, risk: 'green' },
              { name: '--', count: 0, risk: 'green' },
              { name: '--', count: 0, risk: 'green' },
              { name: '--', count: 0, risk: 'green' },
              { name: '--', count: 0, risk: 'green' },
            ],
    },
    apiSummary: {
      callTotal24h: metric('Derived', apiCalls24h, formatNumber(apiCalls24h)),
      callTokyoToday: metric('Derived', apiCallsTokyo, formatNumber(apiCallsTokyo)),
      errorRate24h: metricGap(),
      throttleRate24h: metricGap(),
      endpointTop: [
        { name: '--', calls24h: 0, note: GAP_NOTE },
        { name: '--', calls24h: 0, note: GAP_NOTE },
        { name: '--', calls24h: 0, note: GAP_NOTE },
        { name: '--', calls24h: 0, note: GAP_NOTE },
        { name: '--', calls24h: 0, note: GAP_NOTE },
      ],
    },
  };
}
