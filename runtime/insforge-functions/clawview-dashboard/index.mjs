const SNAPSHOT_TABLE_CANDIDATES = ['clawview_snapshots', 'snapshots'];
const API_EVENT_TABLE_CANDIDATES = ['clawview_api_events', 'api_events'];

const GAP_NOTE = '数据未接入';

function json(status, body) {
  return {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body,
  };
}

function metric(readiness, value, display, note) {
  return {
    readiness,
    value,
    display,
    ...(note ? { note } : {}),
  };
}

function metricGap() {
  return metric('Gap', null, '--', GAP_NOTE);
}

function asNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function toISOStringSafe(value) {
  const d = new Date(value);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

function getTopN(profile) {
  if (profile === 'mobile') return { skill: 5, cron: 3, api: 3 };
  return { skill: 6, cron: 5, api: 5 };
}

function buildTenBins(rows, nowMs, valueSelector) {
  const bins = new Array(10).fill(0);
  const windowMs = 24 * 60 * 60 * 1000;
  const start = nowMs - windowMs;
  const step = windowMs / 10;

  for (const row of rows) {
    const ts = Date.parse(String(row.ts ?? row.started_at ?? ''));
    if (!Number.isFinite(ts) || ts < start || ts > nowMs) continue;
    const idx = Math.min(9, Math.floor((ts - start) / step));
    bins[idx] += valueSelector ? valueSelector(row) : 1;
  }

  return bins;
}

async function fetchJson(url, apiKey) {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      'content-type': 'application/json',
    },
  });

  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }

  return { ok: res.ok, status: res.status, body };
}

function joinFilter(queryParts) {
  return queryParts.filter(Boolean).join('&');
}

async function tryLoadLatestSnapshot(baseUrl, apiKey, tenantId, projectId) {
  for (const table of SNAPSHOT_TABLE_CANDIDATES) {
    const filter = joinFilter([
      `tenant_id=eq.${encodeURIComponent(tenantId)}`,
      `project_id=eq.${encodeURIComponent(projectId)}`,
      'order=ts.desc',
      'limit=1',
      'select=*',
    ]);
    const url = `${baseUrl}/api/database/records/${table}?${filter}`;
    const res = await fetchJson(url, apiKey);

    if (!res.ok) continue;
    if (!Array.isArray(res.body)) continue;

    return { table, row: res.body[0] ?? null };
  }

  return { table: null, row: null };
}

async function tryLoadRecentEvents(baseUrl, apiKey, tenantId, projectId, sinceIso) {
  for (const table of API_EVENT_TABLE_CANDIDATES) {
    const filter = joinFilter([
      `tenant_id=eq.${encodeURIComponent(tenantId)}`,
      `project_id=eq.${encodeURIComponent(projectId)}`,
      `ts=gte.${encodeURIComponent(sinceIso)}`,
      'order=ts.asc',
      'limit=5000',
      'select=*',
    ]);
    const url = `${baseUrl}/api/database/records/${table}?${filter}`;
    const res = await fetchJson(url, apiKey);

    if (!res.ok) continue;
    if (!Array.isArray(res.body)) continue;

    return { table, rows: res.body };
  }

  return { table: null, rows: [] };
}

function buildApiTop(events, topN) {
  const grouped = new Map();

  for (const ev of events) {
    const provider = ev.provider || 'other';
    const endpoint = ev.endpoint_group || 'others';
    const key = `${provider}/${endpoint}`;
    grouped.set(key, (grouped.get(key) || 0) + 1);
  }

  return [...grouped.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([name, calls_24h]) => ({ endpoint_group: name, calls_24h }));
}

function buildDashboardContract({ snapshot, events, profile }) {
  const now = new Date();
  const nowIso = now.toISOString();
  const topN = getTopN(profile);

  const triggerSeries = events.length
    ? buildTenBins(events, now.getTime(), (row) => (row.kind === 'snapshot' ? 0 : 1))
    : buildTenBins(Array.isArray(snapshot?.history) ? snapshot.history : [], now.getTime());

  const apiSeries = buildTenBins(events, now.getTime());
  const throttleSeries = buildTenBins(events.filter((e) => e.is_rate_limited), now.getTime());

  const apiTotal24h = events.length;
  const apiErr24h = events.filter((e) => e.is_failure).length;
  const api42924h = events.filter((e) => e.is_rate_limited).length;

  const cronStormTop = Array.isArray(snapshot?.cron_storm_top5_5m)
    ? snapshot.cron_storm_top5_5m.map((x) => ({
        task_name: x.job_name || x.task_name || '--',
        count: asNumber(x.runs_5m, 0),
        risk_level: asNumber(x.runs_5m, 0) >= 5 ? 'red' : asNumber(x.runs_5m, 0) >= 2 ? 'yellow' : 'green',
      }))
    : [];

  const endpointTop = buildApiTop(events, topN.api);

  return {
    meta: {
      contract_version: 'v1',
      generated_at: nowIso,
      data_updated_at: snapshot?.ts || nowIso,
      freshness_delay_min: metric('Derived', asNumber(snapshot?.data_freshness_delay_min, 0), `${asNumber(snapshot?.data_freshness_delay_min, 0)} 分钟`),
      integrity_status: metric('Derived', 'partial', '部分缺失'),
      window: {
        primary: 'rolling_24h',
        secondary: 'tokyo_today',
        timezone: 'Asia/Tokyo',
        display: 'Rolling 24h / Tokyo 当日',
      },
      p0_core_coverage_ratio: metric(
        'Derived',
        typeof snapshot?.p0_core_coverage_ratio === 'number' ? snapshot.p0_core_coverage_ratio : 0,
        `${((typeof snapshot?.p0_core_coverage_ratio === 'number' ? snapshot.p0_core_coverage_ratio : 0) * 100).toFixed(1)}%`,
      ),
      topn: topN,
    },
    health_overview: {
      service_status_now: metric('Ready', snapshot?.service_status_now || 'running', snapshot?.service_status_now || 'running'),
      service_uptime_ratio_24h: metric('Derived', asNumber(snapshot?.service_uptime_ratio_24h, 0), `${(asNumber(snapshot?.service_uptime_ratio_24h, 0) * 100).toFixed(1)}%`),
      restart_unexpected_count_24h: metric('Derived', asNumber(snapshot?.restart_unexpected_count_24h, 0), String(asNumber(snapshot?.restart_unexpected_count_24h, 0))),
      last_restart_at: metric('Derived', toISOStringSafe(snapshot?.last_restart_at), toISOStringSafe(snapshot?.last_restart_at) || '--'),
      last_restart_reason: metric('Derived', snapshot?.last_restart_reason || null, snapshot?.last_restart_reason || '--'),
      active_error_count: metric('Derived', asNumber(snapshot?.errors_active_count, 0), String(asNumber(snapshot?.errors_active_count, 0))),
      api_429_ratio_24h:
        apiTotal24h > 0
          ? metric('Derived', api42924h / apiTotal24h, `${((api42924h / apiTotal24h) * 100).toFixed(1)}%`)
          : metricGap(),
    },
    trends: {
      trigger_total_24h: metric('Derived', asNumber(snapshot?.cron_runs_24h_total, 0), String(asNumber(snapshot?.cron_runs_24h_total, 0))),
      trigger_series_24h: triggerSeries.map((value, i) => ({
        ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(),
        value,
      })),
      api_calls_series_24h:
        apiSeries.some((x) => x > 0)
          ? { readiness: 'Derived', series: apiSeries.map((value, i) => ({ ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(), value })) }
          : { readiness: 'Gap', series: [], display: '--', note: GAP_NOTE },
      api_429_series_24h:
        throttleSeries.some((x) => x > 0)
          ? { readiness: 'Derived', series: throttleSeries.map((value, i) => ({ ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(), value })) }
          : { readiness: 'Gap', series: [], display: '--', note: GAP_NOTE },
    },
    skill_summary: {
      total_skills: metric('Gap', null, '--', GAP_NOTE),
      healthy_skills: metric('Gap', null, '--', GAP_NOTE),
      calls_24h: metric('Derived', asNumber(snapshot?.cron_runs_24h_total, 0), String(asNumber(snapshot?.cron_runs_24h_total, 0))),
      calls_tokyo_today: metric('Derived', asNumber(snapshot?.cron_runs_today_tokyo_total, 0), String(asNumber(snapshot?.cron_runs_today_tokyo_total, 0))),
      top: [],
    },
    cron_summary: {
      total_tasks: metric('Gap', null, '--', GAP_NOTE),
      enabled_tasks: metric('Gap', null, '--', GAP_NOTE),
      trigger_total_24h: metric('Derived', asNumber(snapshot?.cron_runs_24h_total, 0), String(asNumber(snapshot?.cron_runs_24h_total, 0))),
      trigger_total_tokyo_today: metric('Derived', asNumber(snapshot?.cron_runs_today_tokyo_total, 0), String(asNumber(snapshot?.cron_runs_today_tokyo_total, 0))),
      trigger_storm_task_top5_5m: {
        readiness: cronStormTop.length ? 'Derived' : 'Gap',
        top: cronStormTop,
        ...(cronStormTop.length ? {} : { display: '--', note: GAP_NOTE }),
      },
    },
    api_summary: {
      api_call_total_24h:
        apiTotal24h > 0 ? metric('Derived', apiTotal24h, String(apiTotal24h)) : metricGap(),
      api_call_total_tokyo_today:
        apiTotal24h > 0 ? metric('Derived', apiTotal24h, String(apiTotal24h)) : metricGap(),
      api_error_rate_24h:
        apiTotal24h > 0 ? metric('Derived', apiErr24h / apiTotal24h, `${((apiErr24h / apiTotal24h) * 100).toFixed(1)}%`) : metricGap(),
      api_429_ratio_24h:
        apiTotal24h > 0 ? metric('Derived', api42924h / apiTotal24h, `${((api42924h / apiTotal24h) * 100).toFixed(1)}%`) : metricGap(),
      endpoint_group_top:
        endpointTop.length > 0
          ? { readiness: 'Derived', top: endpointTop }
          : { readiness: 'Gap', top: [], display: '--', note: GAP_NOTE },
    },
    gaps: [],
  };
}

async function coreHandle(requestLike) {
  const method = (requestLike.method || 'GET').toUpperCase();
  if (method !== 'GET') return json(405, { ok: false, error: 'Method not allowed' });

  const url = new URL(requestLike.url || 'http://local');
  const fromHeaderAuth =
    requestLike.headers?.authorization ||
    requestLike.headers?.Authorization ||
    requestLike.headers?.get?.('authorization') ||
    requestLike.headers?.get?.('Authorization') ||
    '';
  const fromHeaderApiKey =
    requestLike.headers?.apikey ||
    requestLike.headers?.get?.('apikey') ||
    '';
  const bearerMatch = String(fromHeaderAuth).match(/^Bearer\s+(.+)$/i);

  const baseUrl =
    process.env.INSFORGE_BASE_URL ||
    process.env.CLAWVIEW_INSFORGE_BASE_URL ||
    `${url.protocol}//${url.host}`;

  const apiKey =
    process.env.INSFORGE_SERVICE_ROLE_KEY ||
    process.env.INSFORGE_ANON_KEY ||
    process.env.CLAWVIEW_SYNC_API_KEY ||
    (bearerMatch ? bearerMatch[1] : '') ||
    String(fromHeaderApiKey || '');

  if (!baseUrl || !apiKey) {
    return json(401, {
      ok: false,
      error: 'Missing API key in env or request headers',
    });
  }

  const profile = url.searchParams.get('profile') === 'mobile' ? 'mobile' : 'desktop';
  const tenantId = url.searchParams.get('tenant_id') || process.env.CLAWVIEW_TENANT_ID || 'default';
  const projectId = url.searchParams.get('project_id') || process.env.CLAWVIEW_PROJECT_ID || 'openclaw';
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const snapshotRes = await tryLoadLatestSnapshot(baseUrl, apiKey, tenantId, projectId);
  const eventsRes = await tryLoadRecentEvents(baseUrl, apiKey, tenantId, projectId, sinceIso);

  const payload = buildDashboardContract({
    snapshot: snapshotRes.row,
    events: eventsRes.rows,
    profile,
  });

  return json(200, payload);
}

function toWebResponse(result) {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: result.headers,
  });
}

export default async function handler(req, res) {
  const result = await coreHandle(req);

  // Node/Express style
  if (res && typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(result.status).set(result.headers).json(result.body);
  }

  // Fetch API style
  return toWebResponse(result);
}
