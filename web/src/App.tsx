import { useEffect, useReducer, useState } from 'react';
import { Block } from 'baseui/block';
import { dashboardData } from './mock/dashboard';
import { loadDashboardDataFromInsforge } from './services/dashboard-from-insforge';
import type { RiskLevel } from './types/dashboard';

type Profile = 'desktop' | 'tablet' | 'mobile';

const NAV_ITEMS = ['DASHBOARD', 'TASK MONITOR', 'API STATUS', 'ERRORS', 'SETTINGS'];
const TABS = ['HOME', 'SKILLS', 'APIS', 'ERRORS'];
const AXIS = ['-24h', '-18h', '-12h', '-6h', 'NOW'];

function resolveProfile(): Profile {
  const w = window.innerWidth;
  if (w < 768) return 'mobile';
  if (w < 1024) return 'tablet';
  return 'desktop';
}

function useProfile(): Profile {
  const [profile, setProfile] = useState<Profile>(() => resolveProfile());

  useEffect(() => {
    const onResize = () => setProfile(resolveProfile());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return profile;
}

function formatRisk(risk: RiskLevel): string {
  if (risk === 'red') return 'RED';
  if (risk === 'yellow') return 'YLW';
  return 'GRN';
}

function riskClass(risk: RiskLevel): string {
  if (risk === 'red') return 'cv-risk cv-risk-red';
  if (risk === 'yellow') return 'cv-risk cv-risk-yellow';
  return 'cv-risk cv-risk-green';
}

interface ChartPoint {
  x: number;
  y: number;
}

function buildLinePoints(values: number[], max: number, width: number, height: number, left: number, top: number): ChartPoint[] {
  const step = values.length > 1 ? width / (values.length - 1) : width;

  return values.map((value, index) => ({
    x: Math.round(left + index * step),
    y: Math.round(top + height - (value / max) * height),
  }));
}

function buildSmoothPath(points: ChartPoint[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const curr = points[i];
    const cx = Math.round((prev.x + curr.x) / 2);
    path += ` C ${cx} ${prev.y}, ${cx} ${curr.y}, ${curr.x} ${curr.y}`;
  }
  return path;
}

function buildAreaPath(points: ChartPoint[], height: number): string {
  if (points.length === 0) return '';
  const line = buildSmoothPath(points);
  const first = points[0];
  const last = points[points.length - 1];
  return `${line} L ${last.x} ${height} L ${first.x} ${height} Z`;
}

function LineChart({ values, tone }: { values: number[]; tone: 'green' | 'orange' }) {
  const width = 560;
  const height = 90;
  const left = 34;
  const top = 6;
  const plotWidth = width - left - 8;
  const plotHeight = height - top - 12;
  const maxValue = Math.max(...values, 1);
  const midValue = Math.round(maxValue / 2);
  const baseY = top + plotHeight;
  const points = buildLinePoints(values, maxValue, plotWidth, plotHeight, left, top);
  const linePath = buildSmoothPath(points);
  const areaPath = buildAreaPath(points, baseY);
  const gradientId = tone === 'green' ? 'chart-area-green' : 'chart-area-orange';
  const yTicks = [
    { value: maxValue, y: top },
    { value: midValue, y: top + Math.round(plotHeight / 2) },
    { value: 0, y: baseY },
  ];

  return (
    <div className={`cv-linechart cv-linechart-${tone}`}>
      <svg className="cv-linechart-svg" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            {tone === 'green' ? (
              <>
                <stop offset="0%" stopColor="#00ff8855" />
                <stop offset="100%" stopColor="#00ff8800" />
              </>
            ) : (
              <>
                <stop offset="0%" stopColor="#ff880055" />
                <stop offset="100%" stopColor="#ff880000" />
              </>
            )}
          </linearGradient>
        </defs>
        <line x1={left} y1={top} x2={left} y2={baseY} className="cv-chart-axis" />
        <line x1={left} y1={baseY} x2={left + plotWidth} y2={baseY} className="cv-chart-axis" />
        {yTicks.map((tick) => (
          <g key={`y-${tick.value}-${tick.y}`}>
            <line x1={left} y1={tick.y} x2={left + plotWidth} y2={tick.y} className="cv-chart-grid-line" />
            <text x={left - 4} y={tick.y + 3} textAnchor="end" className="cv-chart-tick-text">
              {tick.value}
            </text>
          </g>
        ))}
        <path d={areaPath} className="cv-linechart-area" fill={`url(#${gradientId})`} />
        <path d={linePath} className="cv-linechart-path" />
      </svg>
    </div>
  );
}

function AxisRow() {
  return (
    <div className="cv-axis-row">
      {AXIS.map((label) => (
        <span key={label} className={label === 'NOW' ? 'cv-axis-now' : 'cv-axis-label'}>
          {label}
        </span>
      ))}
    </div>
  );
}

function Sidebar({ compact }: { compact: boolean }) {
  return (
    <aside className={compact ? 'cv-sidebar cv-sidebar-compact' : 'cv-sidebar'}>
      <div className="cv-logo-row">
        <span className="cv-icon-dot" />
        {!compact ? <span className="cv-logo-text">CLAWVIEW</span> : null}
      </div>
      {!compact ? <div className="cv-nav-label">// NAVIGATION</div> : null}
      <div className="cv-nav-list">
        {NAV_ITEMS.map((item, idx) => (
          <div key={item} className={idx === 0 ? 'cv-nav-item cv-nav-item-active' : 'cv-nav-item'}>
            <span className="cv-nav-icon" />
            {!compact ? <span>{item}</span> : null}
          </div>
        ))}
      </div>
    </aside>
  );
}

function DesktopTopBar({ mobile }: { mobile: boolean }) {
  return (
    <header className={mobile ? 'cv-topbar cv-topbar-mobile' : 'cv-topbar'}>
      <div className="cv-top-left">
        <h1>系统总览</h1>
        <p>// OPENCLAW 运行状态</p>
      </div>
      <div className="cv-top-right">
        <span className="cv-live-pill">
          <span className="cv-live-dot" />
          {mobile ? 'LIVE' : '[RUNNING]'}
        </span>
        {!mobile ? <span className="cv-time">TOKYO 00:00-23:59 JST</span> : null}
      </div>
    </header>
  );
}

function DesktopDataQuality() {
  return (
    <section className="cv-card cv-quality-row">
      <div className="cv-meta-block">
        <span>数据更新时间</span>
        <strong>{dashboardData.meta.dataUpdatedAt}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-meta-block">
        <span>数据完整性</span>
        <strong className="cv-warn">{dashboardData.meta.integrityStatus.display}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-meta-block cv-meta-wide">
        <span>统计口径</span>
        <strong className="cv-muted2">{dashboardData.meta.windowDisplay}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-meta-block">
        <span>最近重启时间</span>
        <strong>{dashboardData.healthOverview.lastRestartAt.display}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-meta-block">
        <span>最近重启原因</span>
        <strong>{dashboardData.healthOverview.lastRestartReason.display}</strong>
      </div>
    </section>
  );
}

function DesktopHealthBar() {
  return (
    <section className="cv-card cv-health-row">
      <div className="cv-health-status">
        <span className="cv-live-dot" />
        <span className="cv-ok">系统健康</span>
      </div>
      <span className="cv-sep" />
      <div className="cv-health-item">
        <span className="cv-label">异常重启（24h）</span>
        <strong className="cv-num cv-warn">{dashboardData.healthOverview.restartUnexpected24h.display}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-health-item">
        <span className="cv-label">限速比例（429）</span>
        <strong className="cv-num cv-warn">{dashboardData.healthOverview.api429Ratio24h.display}</strong>
      </div>
      <span className="cv-sep" />
      <div className="cv-health-item">
        <span className="cv-label">活跃错误</span>
        <strong className="cv-num cv-bad">{dashboardData.healthOverview.activeErrorCount.display}</strong>
      </div>
    </section>
  );
}

function DesktopTriggerCard() {
  return (
    <section className="cv-card cv-trend-card">
      <div className="cv-card-head">
        <span>Cron 触发（24h）</span>
        <span className="cv-mini">ROLLING 24H</span>
      </div>
      <div className="cv-chart-wrap cv-chart-wrap-main">
        <LineChart values={dashboardData.trends.triggerSeries24h} tone="green" />
      </div>
      <AxisRow />
    </section>
  );
}

function DesktopApiCard() {
  const call = dashboardData.trends.apiSeries24h.map((v) => v + 1);
  const throttle = dashboardData.trends.throttleSeries24h.map((v) => v + 1);

  return (
    <section className="cv-card cv-trend-card">
      <div className="cv-card-head">
        <span>24h API 调用 / 限速趋势</span>
        <span className="cv-mini">ROLLING 24H</span>
      </div>
      <div className="cv-legend">
        <span><i className="cv-line cv-line-green" />调用</span>
        <span><i className="cv-line cv-line-orange" />429 限速</span>
      </div>
      <div className="cv-chart-wrap cv-chart-wrap-half">
        <LineChart values={call} tone="green" />
      </div>
      <div className="cv-chart-wrap cv-chart-wrap-half cv-chart-wrap-half-second">
        <LineChart values={throttle} tone="orange" />
      </div>
      <AxisRow />
    </section>
  );
}

function SkillCard({ mobile }: { mobile: boolean }) {
  const top = dashboardData.skillSummary.top.slice(0, mobile ? 5 : 6);

  return (
    <section className="cv-card cv-summary">
      <div className="cv-summary-head">
        <span>{mobile ? 'SKILL SUMMARY' : 'Skill 摘要'}</span>
        <span className="cv-link">查看全部 →</span>
      </div>
      <div className="cv-stats-2">
        <div>
          <span>总数</span>
          <strong>{dashboardData.skillSummary.totalSkills.display}</strong>
        </div>
        <div>
          <span>健康</span>
          <strong className="cv-ok">{dashboardData.skillSummary.healthySkills.display}</strong>
        </div>
      </div>
      <div className="cv-calls">
        <span>CALLS</span>
        <span>24h</span>
        <strong>{dashboardData.skillSummary.calls24h.display}</strong>
        <em>|</em>
        <span>今日</span>
        <strong className="cv-muted2">{dashboardData.skillSummary.callsTokyoToday.display}</strong>
      </div>
      <div className="cv-list-head">{mobile ? 'TOP 5 BY 24H CALLS' : '24h 调用 Top6'}</div>
      {top.map((item, idx) => (
        <div className="cv-list-row" key={item.name}>
          <span>{item.name}</span>
          <strong className={idx === 0 ? 'cv-bad' : idx === 1 ? 'cv-warn' : ''}>{item.calls24h.toLocaleString()}</strong>
        </div>
      ))}
    </section>
  );
}

function CronCard({ mobile }: { mobile: boolean }) {
  const top = dashboardData.cronSummary.riskTop.slice(0, mobile ? 3 : 5);

  return (
    <section className="cv-card cv-summary">
      <div className="cv-summary-head">
        <span>{mobile ? 'CRON SUMMARY' : 'Cron 摘要'}</span>
        <span className="cv-link">查看全部 →</span>
      </div>
      <div className="cv-stats-2">
        <div>
          <span>总数</span>
          <strong>{dashboardData.cronSummary.totalTasks.display}</strong>
        </div>
        <div>
          <span>已启用</span>
          <strong className="cv-ok">{dashboardData.cronSummary.enabledTasks.display}</strong>
        </div>
      </div>
      <div className="cv-calls">
        <span>TRIGGERS</span>
        <span>24h</span>
        <strong>{dashboardData.cronSummary.triggerTotal24h.display}</strong>
        <em>|</em>
        <span>今日</span>
        <strong className="cv-muted2">{dashboardData.cronSummary.triggerTokyoToday.display}</strong>
      </div>
      <div className="cv-list-head">{mobile ? 'RISK TOP 3' : '风险 Top5'}</div>
      {top.map((item) => (
        <div className="cv-list-row" key={item.name}>
          <span>{item.name}</span>
          <div className="cv-tail">
            <strong>{item.count.toLocaleString()}</strong>
            <span className={riskClass(item.risk)}>{formatRisk(item.risk)}</span>
          </div>
        </div>
      ))}
    </section>
  );
}

function ApiCard({ mobile }: { mobile: boolean }) {
  const top = dashboardData.apiSummary.endpointTop.slice(0, mobile ? 3 : 5);

  return (
    <section className="cv-card cv-summary">
      <div className="cv-summary-head">
        <span>{mobile ? 'API SUMMARY' : 'API 摘要'}</span>
        <span className="cv-link">查看全部 →</span>
      </div>
      <div className="cv-stats-2">
        <div>
          <span>错误率</span>
          <strong className="cv-warn">{dashboardData.apiSummary.errorRate24h.display}</strong>
        </div>
        <div>
          <span>限速比例（429）</span>
          <strong className="cv-warn">{dashboardData.apiSummary.throttleRate24h.display}</strong>
        </div>
      </div>
      <div className="cv-calls">
        <span>CALLS</span>
        <span>24h</span>
        <strong>{dashboardData.apiSummary.callTotal24h.display}</strong>
        <em>|</em>
        <span>今日</span>
        <strong className="cv-muted2">{dashboardData.apiSummary.callTokyoToday.display}</strong>
      </div>
      <div className="cv-list-head">{mobile ? 'TOP 3 BY 24H CALLS' : 'API 分组 Top5（24h）'}</div>
      {top.map((item, idx) => (
        <div className="cv-list-row" key={`${item.name}-${idx}`}>
          <span>{item.name}</span>
          <div className="cv-tail">
            <strong>{item.calls24h > 0 ? item.calls24h.toLocaleString() : '--'}</strong>
            {item.note ? (
              <span className={idx === 0 ? 'cv-risk cv-risk-yellow' : 'cv-risk cv-risk-green'}>{item.note}</span>
            ) : null}
          </div>
        </div>
      ))}
    </section>
  );
}

function DesktopLayout({ tablet }: { tablet: boolean }) {
  return (
    <Block className="cv-shell">
      <Sidebar compact={tablet} />
      <main className="cv-main">
        <DesktopTopBar mobile={false} />
        <section className="cv-content cv-content-desktop">
          <DesktopDataQuality />
          <DesktopHealthBar />
          <div className={tablet ? 'cv-one' : 'cv-two'}>
            <DesktopTriggerCard />
            <DesktopApiCard />
          </div>
          <div className={tablet ? 'cv-one' : 'cv-three'}>
            <SkillCard mobile={false} />
            <CronCard mobile={false} />
            <ApiCard mobile={false} />
          </div>
        </section>
      </main>
    </Block>
  );
}

function MobileHealth() {
  return (
    <section className="cv-card cv-mobile-health">
      <span className="cv-ok">HEALTHY</span>
      <span className="cv-vsep" />
      <span>RESTARTS: {dashboardData.healthOverview.restartUnexpected24h.display}</span>
      <span className="cv-vsep" />
      <span className="cv-warn">429: {dashboardData.healthOverview.api429Ratio24h.display}</span>
      <span className="cv-vsep" />
      <span className="cv-bad">ERRORS: {dashboardData.healthOverview.activeErrorCount.display}</span>
    </section>
  );
}

function MobileQuality() {
  return (
    <section className="cv-card cv-mobile-quality">
      <h3>数据质量与重启信息</h3>
      <div><span>数据更新时间</span><strong>{dashboardData.meta.dataUpdatedAt}</strong></div>
      <div><span>数据完整性</span><strong className="cv-warn">{dashboardData.meta.integrityStatus.display}</strong></div>
      <div><span>统计口径</span><strong className="cv-muted2">24h / Tokyo</strong></div>
      <div><span>最近重启时间</span><strong>{dashboardData.healthOverview.lastRestartAt.display}</strong></div>
      <div><span>最近重启原因</span><strong>{dashboardData.healthOverview.lastRestartReason.display}</strong></div>
    </section>
  );
}

function MobileTrigger() {
  return (
    <section className="cv-card cv-mobile-trend">
      <div className="cv-mobile-card-head">
        <span>CRON TRIGGER (24H)</span>
        <span className="cv-muted2">{dashboardData.cronSummary.triggerTotal24h.display} total</span>
      </div>
      <div className="cv-chart-wrap cv-mobile-chart">
        <LineChart values={dashboardData.trends.triggerSeries24h} tone="green" />
      </div>
      <AxisRow />
    </section>
  );
}

function MobileApiTrend() {
  const call = dashboardData.trends.apiSeries24h.map((v) => v + 1);
  const throttle = dashboardData.trends.throttleSeries24h.map((v) => v + 1);

  return (
    <section className="cv-card cv-mobile-trend">
      <div className="cv-mobile-card-head">
        <span>24H API CALLS / THROTTLE</span>
        <span className="cv-muted2">{dashboardData.apiSummary.callTotal24h.display}</span>
      </div>
      <div className="cv-legend cv-legend-mobile">
        <span><i className="cv-line cv-line-green" />调用</span>
        <span><i className="cv-line cv-line-orange" />429 限速</span>
      </div>
      <div className="cv-chart-wrap cv-mobile-chart-half">
        <LineChart values={call} tone="green" />
      </div>
      <div className="cv-chart-wrap cv-mobile-chart-half cv-chart-wrap-half-second">
        <LineChart values={throttle} tone="orange" />
      </div>
      <AxisRow />
    </section>
  );
}

function MobileTabBar() {
  return (
    <footer className="cv-tabbar">
      {TABS.map((tab, idx) => (
        <div key={tab} className={idx === 0 ? 'cv-tab cv-tab-active' : 'cv-tab'}>
          <span className="cv-tab-icon" />
          <span>{tab}</span>
        </div>
      ))}
    </footer>
  );
}

function MobileLayout() {
  return (
    <Block className="cv-mobile-shell">
      <DesktopTopBar mobile />
      <section className="cv-content cv-content-mobile">
        <MobileHealth />
        <MobileQuality />
        <MobileTrigger />
        <MobileApiTrend />
        <SkillCard mobile />
        <CronCard mobile />
        <ApiCard mobile />
      </section>
      <MobileTabBar />
    </Block>
  );
}

function App() {
  const profile = useProfile();
  const [, forceRefresh] = useReducer((value: number) => value + 1, 0);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const next = await loadDashboardDataFromInsforge();
        if (!next || disposed) return;
        Object.assign(dashboardData, next);
        // Keep a visible trace in devtools while verifying backend linkage.
        console.info('[clawview] loaded dashboard from insforge', {
          generatedAt: next.meta.generatedAt,
          dataUpdatedAt: next.meta.dataUpdatedAt,
          cron24h: next.cronSummary.triggerTotal24h.display,
        });
        forceRefresh();
      } catch (error) {
        // Keep local mock data as fallback when backend is unavailable.
        console.error('[clawview] failed to load insforge dashboard, fallback to mock', error);
      }
    })();

    return () => {
      disposed = true;
    };
  }, [forceRefresh]);

  if (profile === 'mobile') {
    return <MobileLayout />;
  }

  return <DesktopLayout tablet={profile === 'tablet'} />;
}

export default App;
