import type { DashboardData, MetricValue, Readiness, RiskLevel } from '../types/dashboard';

const baseUrl = import.meta.env.VITE_INSFORGE_BASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_INSFORGE_ANON_KEY as string | undefined;

const DASHBOARD_PATHS = ['/api/v1/clawview/dashboard', '/functions/clawview-dashboard'] as const;
const GAP_NOTE = '数据未接入';

type Dict = Record<string, unknown>;

function isObj(v: unknown): v is Dict {
  return typeof v === 'object' && v !== null;
}

function readStr(v: unknown, fallback = '--'): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

function readNum(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function readBool(v: unknown, fallback = false): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function normalizeReadiness(v: unknown): Readiness {
  if (v === 'Ready' || v === 'Derived' || v === 'Gap') return v;
  if (v === 'ready') return 'Ready';
  if (v === 'derived') return 'Derived';
  if (v === 'gap') return 'Gap';
  return 'Derived';
}

function parseMetric<T>(
  input: unknown,
  fallback: MetricValue<T>,
  parseValue: (raw: unknown) => T,
): MetricValue<T> {
  if (!isObj(input)) return fallback;

  return {
    readiness: normalizeReadiness(input.readiness),
    value: input.value !== undefined ? parseValue(input.value) : fallback.value,
    display: typeof input.display === 'string' && input.display ? input.display : fallback.display,
    note: typeof input.note === 'string' ? input.note : fallback.note,
  };
}

function metricGap(): MetricValue<null> {
  return {
    readiness: 'Gap',
    value: null,
    display: '--',
    note: GAP_NOTE,
  };
}

function pickProfile(): 'desktop' | 'mobile' {
  if (typeof window === 'undefined') return 'desktop';
  return window.innerWidth < 768 ? 'mobile' : 'desktop';
}

function parseSeries(input: unknown): number[] {
  if (Array.isArray(input) && input.every((x) => typeof x === 'number')) {
    return input.map((x) => readNum(x, 0));
  }

  if (Array.isArray(input)) {
    const values = input
      .map((row) => (isObj(row) ? readNum(row.value, NaN) : NaN))
      .filter((x) => Number.isFinite(x));
    return values.length > 0 ? values : new Array<number>(10).fill(0);
  }

  if (isObj(input) && Array.isArray(input.series)) {
    return parseSeries(input.series);
  }

  return new Array<number>(10).fill(0);
}

function toRiskLevel(v: unknown): RiskLevel {
  if (v === 'red' || v === 'yellow' || v === 'green') return v;
  return 'green';
}

function toNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function toStringOrNull(v: unknown): string | null {
  return typeof v === 'string' ? v : null;
}

function toIntegrity(v: unknown): 'full' | 'partial' | 'delayed' {
  return v === 'full' || v === 'partial' || v === 'delayed' ? v : 'partial';
}

function toServiceStatus(v: unknown): 'running' | 'degraded' | 'down' {
  return v === 'running' || v === 'degraded' || v === 'down' ? v : 'running';
}

function mapDashboardContract(raw: unknown): DashboardData | null {
  if (!isObj(raw)) return null;

  const meta = isObj(raw.meta) ? raw.meta : {};
  const health = isObj(raw.health_overview)
    ? raw.health_overview
    : isObj(raw.healthOverview)
      ? raw.healthOverview
      : {};
  const trends = isObj(raw.trends) ? raw.trends : {};
  const skill = isObj(raw.skill_summary)
    ? raw.skill_summary
    : isObj(raw.skillSummary)
      ? raw.skillSummary
      : {};
  const cron = isObj(raw.cron_summary)
    ? raw.cron_summary
    : isObj(raw.cronSummary)
      ? raw.cronSummary
      : {};
  const api = isObj(raw.api_summary)
    ? raw.api_summary
    : isObj(raw.apiSummary)
      ? raw.apiSummary
      : {};

  const skillTop: Array<{ name: string; calls24h: number }> = Array.isArray(skill.top)
    ? skill.top
        .map((row) => {
          if (!isObj(row)) return null;
          return {
            name: readStr(row.skill_name ?? row.name, '--'),
            calls24h: readNum(row.calls_24h ?? row.calls24h, 0),
          };
        })
        .filter((x): x is { name: string; calls24h: number } => x !== null)
    : [];

  const riskSourceMaybe = isObj(cron.trigger_storm_task_top5_5m)
    ? (cron.trigger_storm_task_top5_5m as Dict).top
    : cron.riskTop;

  const riskTop: Array<{ name: string; count: number; risk: RiskLevel }> = Array.isArray(riskSourceMaybe)
    ? riskSourceMaybe
        .map((row) => {
          if (!isObj(row)) return null;
          return {
            name: readStr(row.task_name ?? row.name, '--'),
            count: readNum(row.count, 0),
            risk: toRiskLevel(row.risk_level ?? row.risk),
          };
        })
        .filter((x): x is { name: string; count: number; risk: RiskLevel } => x !== null)
    : [];

  const endpointSourceMaybe = isObj(api.endpoint_group_top)
    ? (api.endpoint_group_top as Dict).top
    : api.endpointTop;

  const endpointTop: Array<{ name: string; calls24h: number; note?: string }> = Array.isArray(endpointSourceMaybe)
    ? endpointSourceMaybe
        .map((row) => {
          if (!isObj(row)) return null;
          const note = typeof row.note === 'string' ? row.note : undefined;
          return {
            name: readStr(row.endpoint_group ?? row.name, '--'),
            calls24h: readNum(row.calls_24h ?? row.calls24h, 0),
            ...(note ? { note } : {}),
          };
        })
        .filter((x): x is { name: string; calls24h: number; note?: string } => x !== null)
    : [];

  return {
    meta: {
      contractVersion: readStr(meta.contract_version ?? meta.contractVersion, 'v1'),
      generatedAt: readStr(meta.generated_at ?? meta.generatedAt, new Date().toISOString()),
      dataUpdatedAt: readStr(meta.data_updated_at ?? meta.dataUpdatedAt, '--'),
      freshnessDelayMin: parseMetric(meta.freshness_delay_min ?? meta.freshnessDelayMin, {
        readiness: 'Derived',
        value: 0,
        display: '0 分钟',
      }, readNum),
      integrityStatus: parseMetric(meta.integrity_status ?? meta.integrityStatus, {
        readiness: 'Derived',
        value: 'partial',
        display: '部分缺失',
      }, toIntegrity),
      windowDisplay: readStr(
        (isObj(meta.window) ? (meta.window as Dict).display : undefined) ?? meta.windowDisplay,
        'Rolling 24h / Tokyo 当日',
      ),
      p0CoreCoverageRatio: parseMetric(meta.p0_core_coverage_ratio ?? meta.p0CoreCoverageRatio, {
        readiness: 'Derived',
        value: 0,
        display: '0%',
      }, readNum),
      topN: {
        skill: readNum((isObj(meta.topn) ? (meta.topn as Dict).skill : undefined) ?? (isObj(meta.topN) ? (meta.topN as Dict).skill : undefined), 6),
        cron: readNum((isObj(meta.topn) ? (meta.topn as Dict).cron : undefined) ?? (isObj(meta.topN) ? (meta.topN as Dict).cron : undefined), 5),
        api: readNum((isObj(meta.topn) ? (meta.topn as Dict).api : undefined) ?? (isObj(meta.topN) ? (meta.topN as Dict).api : undefined), 5),
      },
    },
    healthOverview: {
      serviceStatusNow: parseMetric(health.service_status_now ?? health.serviceStatusNow, {
        readiness: 'Ready',
        value: 'running',
        display: '运行中',
      }, toServiceStatus),
      restartUnexpected24h: parseMetric(health.restart_unexpected_count_24h ?? health.restartUnexpected24h, {
        readiness: 'Derived',
        value: 0,
        display: '0',
      }, readNum),
      api429Ratio24h: parseMetric(health.api_429_ratio_24h ?? health.api429Ratio24h, metricGap(), toNumberOrNull),
      activeErrorCount: parseMetric(health.active_error_count ?? health.activeErrorCount, {
        readiness: 'Derived',
        value: 0,
        display: '0',
      }, readNum),
      lastRestartAt: parseMetric(health.last_restart_at ?? health.lastRestartAt, {
        readiness: 'Derived',
        value: null,
        display: '--',
      }, toStringOrNull),
      lastRestartReason: parseMetric(health.last_restart_reason ?? health.lastRestartReason, {
        readiness: 'Derived',
        value: null,
        display: '--',
      }, toStringOrNull),
      openclawSystemAnomaly: readBool(health.openclaw_system_anomaly ?? health.openclawSystemAnomaly, false),
      clawviewPipelineAnomaly: readBool(health.clawview_pipeline_anomaly ?? health.clawviewPipelineAnomaly, false),
    },
    trends: {
      triggerSeries24h: parseSeries(trends.trigger_series_24h ?? trends.triggerSeries24h),
      apiSeries24h: parseSeries(trends.api_calls_series_24h ?? trends.apiSeries24h),
      throttleSeries24h: parseSeries(trends.api_429_series_24h ?? trends.throttleSeries24h),
    },
    skillSummary: {
      totalSkills: parseMetric(skill.total_skills ?? skill.totalSkills, {
        readiness: 'Ready',
        value: 0,
        display: '0',
      }, readNum),
      healthySkills: parseMetric(skill.healthy_skills ?? skill.healthySkills, {
        readiness: 'Derived',
        value: 0,
        display: '0',
      }, readNum),
      calls24h: parseMetric(skill.calls_24h ?? skill.calls24h, {
        readiness: 'Derived',
        value: 0,
        display: '0',
      }, readNum),
      callsTokyoToday: parseMetric(skill.calls_tokyo_today ?? skill.callsTokyoToday, {
        readiness: 'Derived',
        value: 0,
        display: '0',
      }, readNum),
      top: skillTop,
    },
    cronSummary: {
      totalTasks: parseMetric(cron.total_tasks ?? cron.totalTasks, {
        readiness: 'Ready',
        value: 0,
        display: '0',
      }, readNum),
      enabledTasks: parseMetric(cron.enabled_tasks ?? cron.enabledTasks, {
        readiness: 'Ready',
        value: 0,
        display: '0',
      }, readNum),
      triggerTotal24h: parseMetric(cron.trigger_total_24h ?? cron.triggerTotal24h, {
        readiness: 'Ready',
        value: 0,
        display: '0',
      }, readNum),
      triggerTokyoToday: parseMetric(cron.trigger_total_tokyo_today ?? cron.triggerTokyoToday, {
        readiness: 'Ready',
        value: 0,
        display: '0',
      }, readNum),
      riskTop,
    },
    apiSummary: {
      callTotal24h: parseMetric(api.api_call_total_24h ?? api.callTotal24h, metricGap(), toNumberOrNull),
      callTokyoToday: parseMetric(api.api_call_total_tokyo_today ?? api.callTokyoToday, metricGap(), toNumberOrNull),
      errorRate24h: parseMetric(api.api_error_rate_24h ?? api.errorRate24h, metricGap(), toNumberOrNull),
      throttleRate24h: parseMetric(api.api_429_ratio_24h ?? api.throttleRate24h, metricGap(), toNumberOrNull),
      unknownRate24h: parseMetric(api.api_unknown_rate_24h ?? api.unknownRate24h, metricGap(), toNumberOrNull),
      endpointTop,
    },
  };
}

async function fetchDashboardByPath(path: string): Promise<DashboardData | null> {
  if (!baseUrl || !anonKey) return null;

  const url = new URL(path, baseUrl);
  url.searchParams.set('profile', pickProfile());
  url.searchParams.set('tz', 'Asia/Tokyo');
  url.searchParams.set('locale', 'zh-CN');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${anonKey}`,
      apikey: anonKey,
      'content-type': 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error(`dashboard endpoint failed ${res.status} ${res.statusText}`);
  }

  const payload = (await res.json()) as unknown;
  return mapDashboardContract(payload);
}

export async function loadDashboardDataFromInsforge(): Promise<DashboardData | null> {
  if (!baseUrl || !anonKey) return null;

  for (const path of DASHBOARD_PATHS) {
    try {
      const mapped = await fetchDashboardByPath(path);
      if (mapped) return mapped;
    } catch {
      // try next function path; UI fallback handled in App.tsx
    }
  }

  return null;
}
