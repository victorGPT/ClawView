export type Readiness = 'Ready' | 'Derived' | 'Gap';
export type RiskLevel = 'green' | 'yellow' | 'red';

export interface MetricValue<T = number | string | null> {
  readiness: Readiness;
  value: T;
  display: string;
  note?: string;
}

export interface DashboardData {
  meta: {
    contractVersion: string;
    generatedAt: string;
    dataUpdatedAt: string;
    freshnessDelayMin: MetricValue<number>;
    integrityStatus: MetricValue<'full' | 'partial' | 'delayed'>;
    windowDisplay: string;
    p0CoreCoverageRatio: MetricValue<number>;
    topN: {
      skill: number;
      cron: number;
      api: number;
    };
  };
  healthOverview: {
    serviceStatusNow: MetricValue<'running' | 'degraded' | 'down'>;
    restartUnexpected24h: MetricValue<number>;
    api429Ratio24h: MetricValue<number | null>;
    activeErrorCount: MetricValue<number>;
    lastRestartAt: MetricValue<string | null>;
    lastRestartReason: MetricValue<string | null>;
    openclawSystemAnomaly: boolean;
    clawviewPipelineAnomaly: boolean;
  };
  trends: {
    triggerSeries24h: number[];
    apiSeries24h: number[];
    throttleSeries24h: number[];
  };
  skillSummary: {
    totalSkills: MetricValue<number>;
    healthySkills: MetricValue<number>;
    calls24h: MetricValue<number>;
    callsTokyoToday: MetricValue<number>;
    top: Array<{ name: string; calls24h: number }>;
  };
  cronSummary: {
    totalTasks: MetricValue<number>;
    enabledTasks: MetricValue<number>;
    triggerTotal24h: MetricValue<number>;
    triggerTokyoToday: MetricValue<number>;
    riskTop: Array<{ name: string; count: number; risk: RiskLevel }>;
  };
  apiSummary: {
    callTotal24h: MetricValue<number | null>;
    callTokyoToday: MetricValue<number | null>;
    errorRate24h: MetricValue<number | null>;
    throttleRate24h: MetricValue<number | null>;
    endpointTop: Array<{ name: string; calls24h: number; note?: string }>;
  };
}
