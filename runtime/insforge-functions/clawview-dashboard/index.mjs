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

function normalizeSnapshotRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : row;
  const generatedAt = row.generated_at || row.generatedAt || null;
  return {
    ...payload,
    generated_at: generatedAt,
  };
}

function normalizeApiEventRow(row) {
  if (!row || typeof row !== 'object') return null;
  const payload = row.payload && typeof row.payload === 'object' ? row.payload : row;
  const generatedAt = row.generated_at || row.generatedAt || payload.generated_at || payload.generatedAt || null;
  const ts = toISOStringSafe(payload.ts || generatedAt);
  if (!ts) return null;

  const providerRaw = String(payload.provider || '').trim().toLowerCase();
  const endpointRaw = String(payload.endpoint_group || payload.endpointGroup || '').trim().toLowerCase();
  const provider = providerRaw === 'other' || providerRaw === 'others' ? 'unknown' : (providerRaw || 'unknown');
  const endpointGroup =
    endpointRaw === 'other' || endpointRaw === 'others' ? 'unknown' : (endpointRaw || 'unknown');

  const statusCode =
    typeof payload.status_code === 'number' && Number.isFinite(payload.status_code)
      ? payload.status_code
      : null;
  const is429 =
    typeof payload.is_429 === 'boolean'
      ? payload.is_429
      : typeof payload.is_rate_limited === 'boolean'
        ? payload.is_rate_limited
        : statusCode === 429;
  const isFailure =
    typeof payload.is_failure === 'boolean'
      ? payload.is_failure
      : statusCode != null
        ? statusCode >= 400
        : false;

  return {
    ...payload,
    ts,
    provider,
    endpoint_group: endpointGroup,
    status_code: statusCode,
    is_429: is429,
    is_failure: isFailure,
    generated_at: generatedAt,
  };
}

async function tryLoadLatestSnapshot(baseUrl, apiKey, tenantId, projectId) {
  for (const table of SNAPSHOT_TABLE_CANDIDATES) {
    const filter = joinFilter([
      `tenant_id=eq.${encodeURIComponent(tenantId)}`,
      `project_id=eq.${encodeURIComponent(projectId)}`,
      'order=generated_at.desc',
      'limit=1',
      'select=*',
    ]);
    const url = `${baseUrl}/api/database/records/${table}?${filter}`;
    const res = await fetchJson(url, apiKey);

    if (!res.ok) continue;
    if (!Array.isArray(res.body)) continue;

    return { table, row: normalizeSnapshotRow(res.body[0] ?? null) };
  }

  return { table: null, row: null };
}

async function tryLoadRecentEvents(baseUrl, apiKey, tenantId, projectId, sinceIso) {
  for (const table of API_EVENT_TABLE_CANDIDATES) {
    const filter = joinFilter([
      `tenant_id=eq.${encodeURIComponent(tenantId)}`,
      `project_id=eq.${encodeURIComponent(projectId)}`,
      `generated_at=gte.${encodeURIComponent(sinceIso)}`,
      'order=generated_at.asc',
      'limit=5000',
      'select=*',
    ]);
    const url = `${baseUrl}/api/database/records/${table}?${filter}`;
    const res = await fetchJson(url, apiKey);

    if (!res.ok) continue;
    if (!Array.isArray(res.body)) continue;

    return { table, rows: res.body.map(normalizeApiEventRow).filter(Boolean) };
  }

  return { table: null, rows: [] };
}

function buildApiTop(events, topN) {
  const grouped = new Map();

  for (const ev of events) {
    const providerRaw = String(ev.provider || '').trim().toLowerCase();
    const endpointRaw = String(ev.endpoint_group || '').trim().toLowerCase();
    const provider = providerRaw === 'other' || providerRaw === 'others' ? 'unknown' : (providerRaw || 'unknown');
    const endpoint = endpointRaw === 'other' || endpointRaw === 'others' ? 'unknown' : (endpointRaw || 'unknown');
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

  const skillComponents = Array.isArray(snapshot?.skills_components)
    ? snapshot.skills_components
        .map((x) => ({
          name: String(x?.name || '').trim(),
          eligible: Boolean(x?.eligible),
          disabled: Boolean(x?.disabled),
        }))
        .filter((x) => x.name.length > 0)
    : [];

  const skillTopFromSnapshot = Array.isArray(snapshot?.skills_top_24h)
    ? snapshot.skills_top_24h
        .map((x) => ({
          name: String(x?.name || '').trim(),
          calls_24h: asNumber(x?.calls_24h ?? x?.calls24h, 0),
        }))
        .filter((x) => x.name.length > 0)
    : [];

  const skillTop = skillTopFromSnapshot.slice(0, topN.skill);
  const skillCollectionMode =
    typeof snapshot?.skill_calls_collection_mode === 'string' && snapshot.skill_calls_collection_mode.trim()
      ? snapshot.skill_calls_collection_mode
      : (skillTop.length > 0 ? 'fact-event-structured' : 'fact-only-not-connected');
  const openclawSystemAnomaly =
    typeof snapshot?.openclaw_system_anomaly === 'boolean'
      ? snapshot.openclaw_system_anomaly
      : (String(snapshot?.service_status_now || 'running') === 'down' || asNumber(snapshot?.restart_unexpected_count_24h, 0) > 0);
  const clawviewPipelineAnomaly =
    typeof snapshot?.clawview_pipeline_anomaly === 'boolean'
      ? snapshot.clawview_pipeline_anomaly
      : skillCollectionMode !== 'fact-event-structured';

  const totalSkillsValue = skillComponents.length > 0 ? skillComponents.length : asNumber(snapshot?.skills_total, 0);
  const healthySkillsValue =
    skillComponents.length > 0
      ? skillComponents.filter((x) => x.eligible && !x.disabled).length
      : asNumber(snapshot?.healthy_skills ?? snapshot?.skills_healthy ?? snapshot?.skills_healthy_total, 0);

  const triggerSeries = events.length
    ? buildTenBins(events, now.getTime(), (row) => (row.kind === 'snapshot' ? 0 : 1))
    : buildTenBins(Array.isArray(snapshot?.history) ? snapshot.history : [], now.getTime());

  const apiSeries = buildTenBins(events, now.getTime());
  const throttleSeries = buildTenBins(events.filter((e) => e.is_429), now.getTime());

  const apiCollectionMode =
    typeof snapshot?.api_collection_mode === 'string' && snapshot.api_collection_mode.trim()
      ? snapshot.api_collection_mode
      : 'fact-only-not-connected';
  const apiFactConnected = apiCollectionMode === 'fact-event-structured';
  const apiTotal24h = events.length;
  const apiTotalTokyoToday =
    typeof snapshot?.api_call_total_today_tokyo === 'number'
      ? asNumber(snapshot.api_call_total_today_tokyo, 0)
      : apiTotal24h;
  const apiErr24h = events.filter((e) => e.is_failure).length;
  const api42924h = events.filter((e) => e.is_429).length;
  const apiUnknown24h = events.filter(
    (e) => String(e.provider || "").toLowerCase() === "unknown" || String(e.endpoint_group || "").toLowerCase() === "unknown",
  ).length;
  const apiErrorRate24h = apiTotal24h > 0 ? apiErr24h / apiTotal24h : 0;
  const api429Ratio24h = apiTotal24h > 0 ? api42924h / apiTotal24h : 0;
  const apiUnknownRate24h = apiTotal24h > 0 ? apiUnknown24h / apiTotal24h : 0;

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
      data_updated_at: snapshot?.ts || snapshot?.generated_at || nowIso,
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
      openclaw_system_anomaly: openclawSystemAnomaly,
      clawview_pipeline_anomaly: clawviewPipelineAnomaly,
      api_429_ratio_24h:
        apiFactConnected
          ? metric('Derived', api429Ratio24h, `${(api429Ratio24h * 100).toFixed(1)}%`)
          : metricGap(),
    },
    trends: {
      trigger_total_24h: metric('Derived', asNumber(snapshot?.cron_runs_24h_total, 0), String(asNumber(snapshot?.cron_runs_24h_total, 0))),
      trigger_series_24h: triggerSeries.map((value, i) => ({
        ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(),
        value,
      })),
      api_calls_series_24h:
        apiFactConnected
          ? { readiness: 'Derived', series: apiSeries.map((value, i) => ({ ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(), value })) }
          : { readiness: 'Gap', series: [], display: '--', note: GAP_NOTE },
      api_429_series_24h:
        apiFactConnected
          ? { readiness: 'Derived', series: throttleSeries.map((value, i) => ({ ts: new Date(now.getTime() - (9 - i) * (24 * 60 * 60 * 1000) / 10).toISOString(), value })) }
          : { readiness: 'Gap', series: [], display: '--', note: GAP_NOTE },
    },
    skill_summary: {
      total_skills:
        totalSkillsValue > 0 || typeof snapshot?.skills_total === 'number' || skillComponents.length > 0
          ? metric('Derived', totalSkillsValue, String(totalSkillsValue))
          : metricGap(),
      healthy_skills:
        (skillComponents.length > 0) || typeof snapshot?.healthy_skills === 'number' || typeof snapshot?.skills_healthy === 'number' || typeof snapshot?.skills_healthy_total === 'number'
          ? metric('Derived', healthySkillsValue, String(healthySkillsValue))
          : metricGap(),
      calls_24h:
        typeof snapshot?.skill_calls_total_24h === 'number'
          ? metric('Derived', asNumber(snapshot?.skill_calls_total_24h, 0), String(asNumber(snapshot?.skill_calls_total_24h, 0)))
          : metricGap(),
      calls_tokyo_today: metricGap(),
      collection_mode: skillCollectionMode,
      top: skillTop,
    },
    cron_summary: {
      total_tasks:
        typeof snapshot?.cron_jobs_total === 'number'
          ? metric('Derived', asNumber(snapshot?.cron_jobs_total, 0), String(asNumber(snapshot?.cron_jobs_total, 0)))
          : metricGap(),
      enabled_tasks:
        typeof snapshot?.cron_jobs_enabled === 'number'
          ? metric('Derived', asNumber(snapshot?.cron_jobs_enabled, 0), String(asNumber(snapshot?.cron_jobs_enabled, 0)))
          : metricGap(),
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
        apiFactConnected ? metric('Derived', apiTotal24h, String(apiTotal24h)) : metricGap(),
      api_call_total_tokyo_today:
        apiFactConnected ? metric('Derived', apiTotalTokyoToday, String(apiTotalTokyoToday)) : metricGap(),
      api_error_rate_24h:
        apiFactConnected ? metric('Derived', apiErrorRate24h, `${(apiErrorRate24h * 100).toFixed(1)}%`) : metricGap(),
      api_429_ratio_24h:
        apiFactConnected ? metric('Derived', api429Ratio24h, `${(api429Ratio24h * 100).toFixed(1)}%`) : metricGap(),
      api_unknown_rate_24h:
        apiFactConnected ? metric('Derived', apiUnknownRate24h, `${(apiUnknownRate24h * 100).toFixed(1)}%`) : metricGap(),
      endpoint_group_top:
        apiFactConnected
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
    (bearerMatch ? bearerMatch[1] : '') ||
    String(fromHeaderApiKey || '') ||
    process.env.INSFORGE_SERVICE_ROLE_KEY ||
    process.env.INSFORGE_ANON_KEY ||
    process.env.CLAWVIEW_SYNC_API_KEY;

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
