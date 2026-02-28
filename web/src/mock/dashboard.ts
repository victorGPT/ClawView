import type { DashboardData } from '../types/dashboard';

export const dashboardData: DashboardData = {
  meta: {
    contractVersion: 'v1',
    generatedAt: '2026-02-27T09:30:00+09:00',
    dataUpdatedAt: '2026-02-27T09:28:00+09:00',
    freshnessDelayMin: { readiness: 'Derived', value: 2, display: '2 分钟' },
    integrityStatus: { readiness: 'Derived', value: 'partial', display: '部分缺失' },
    windowDisplay: 'Rolling 24h / Tokyo 当日',
    p0CoreCoverageRatio: { readiness: 'Derived', value: 0.636, display: '63.6%' },
    topN: { skill: 6, cron: 5, api: 5 },
  },
  healthOverview: {
    serviceStatusNow: { readiness: 'Ready', value: 'running', display: '运行中' },
    restartUnexpected24h: { readiness: 'Derived', value: 1, display: '1' },
    api429Ratio24h: { readiness: 'Gap', value: null, display: '--', note: '数据未接入' },
    activeErrorCount: { readiness: 'Derived', value: 7, display: '7' },
    lastRestartAt: { readiness: 'Derived', value: null, display: '--' },
    lastRestartReason: { readiness: 'Derived', value: null, display: '--' },
    openclawSystemAnomaly: false,
    clawviewPipelineAnomaly: false,
  },
  trends: {
    triggerSeries24h: [10, 14, 18, 23, 19, 29, 31, 27, 24, 28],
    apiSeries24h: [0, 0, 1, 0, 0, 2, 0, 1, 0, 0],
    throttleSeries24h: [0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
  },
  skillSummary: {
    totalSkills: { readiness: 'Ready', value: 23, display: '23' },
    healthySkills: { readiness: 'Derived', value: 21, display: '21' },
    calls24h: { readiness: 'Derived', value: 4218, display: '4,218' },
    callsTokyoToday: { readiness: 'Derived', value: 3102, display: '3,102' },
    top: [
      { name: 'lark_channel_sync', calls24h: 1247 },
      { name: 'msg_reply_handler', calls24h: 892 },
      { name: 'event_dispatcher', calls24h: 634 },
      { name: 'webhook_receiver', calls24h: 521 },
      { name: 'cron_scheduler', calls24h: 324 },
      { name: 'daily_report_gen', calls24h: 218 },
    ],
  },
  cronSummary: {
    totalTasks: { readiness: 'Ready', value: 47, display: '47' },
    enabledTasks: { readiness: 'Ready', value: 38, display: '38' },
    triggerTotal24h: { readiness: 'Ready', value: 2104, display: '2,104' },
    triggerTokyoToday: { readiness: 'Ready', value: 1847, display: '1,847' },
    riskTop: [
      { name: 'lark_sync_channel', count: 342, risk: 'red' },
      { name: 'msg_handler_main', count: 187, risk: 'yellow' },
      { name: 'event_dispatcher', count: 124, risk: 'yellow' },
      { name: 'webhook_listener', count: 89, risk: 'green' },
      { name: 'cron_daily_report', count: 56, risk: 'green' },
    ],
  },
  apiSummary: {
    callTotal24h: { readiness: 'Gap', value: null, display: '--', note: '数据未接入' },
    callTokyoToday: { readiness: 'Gap', value: null, display: '--', note: '数据未接入' },
    errorRate24h: { readiness: 'Gap', value: null, display: '--', note: '数据未接入' },
    throttleRate24h: { readiness: 'Gap', value: null, display: '--', note: '数据未接入' },
    endpointTop: [
      { name: '--', calls24h: 0, note: '数据未接入' },
      { name: '--', calls24h: 0, note: '数据未接入' },
      { name: '--', calls24h: 0, note: '数据未接入' },
      { name: '--', calls24h: 0, note: '数据未接入' },
      { name: '--', calls24h: 0, note: '数据未接入' },
    ],
  },
};
