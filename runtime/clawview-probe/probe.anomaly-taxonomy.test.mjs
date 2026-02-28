import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './probe.mjs';

test('computeAnomalyFlags splits OpenClaw system and ClawView pipeline anomalies', () => {
  const normal = __test.computeAnomalyFlags({
    serviceStatusNow: 'running',
    restartUnexpectedCount24h: 0,
    criticalSystemErrorActiveCount: 0,
    skillCallsCollectionMode: 'fact-event-structured',
  });
  assert.deepEqual(normal, {
    openclaw_system_anomaly: false,
    clawview_pipeline_anomaly: false,
  });

  const systemOnly = __test.computeAnomalyFlags({
    serviceStatusNow: 'running',
    restartUnexpectedCount24h: 0,
    criticalSystemErrorActiveCount: 1,
    skillCallsCollectionMode: 'fact-event-structured',
  });
  assert.equal(systemOnly.openclaw_system_anomaly, true);
  assert.equal(systemOnly.clawview_pipeline_anomaly, false);

  const pipelineOnly = __test.computeAnomalyFlags({
    serviceStatusNow: 'running',
    restartUnexpectedCount24h: 0,
    criticalSystemErrorActiveCount: 0,
    skillCallsCollectionMode: 'fact-only-not-connected',
  });
  assert.equal(pipelineOnly.openclaw_system_anomaly, false);
  assert.equal(pipelineOnly.clawview_pipeline_anomaly, true);
});

test('computeServiceStatusNow ignores generic warn/error noise but degrades on restart/critical', () => {
  assert.equal(
    __test.computeServiceStatusNow({
      gatewayRpcOk: true,
      restartUnexpectedCount24h: 0,
      criticalSystemErrorActiveCount: 0,
    }),
    'running',
  );

  assert.equal(
    __test.computeServiceStatusNow({
      gatewayRpcOk: true,
      restartUnexpectedCount24h: 1,
      criticalSystemErrorActiveCount: 0,
    }),
    'degraded',
  );

  assert.equal(
    __test.computeServiceStatusNow({
      gatewayRpcOk: true,
      restartUnexpectedCount24h: 0,
      criticalSystemErrorActiveCount: 2,
    }),
    'degraded',
  );

  assert.equal(
    __test.computeServiceStatusNow({
      gatewayRpcOk: false,
      restartUnexpectedCount24h: 0,
      criticalSystemErrorActiveCount: 0,
    }),
    'down',
  );
});

test('isCriticalSystemErrorMessage only flags hard system failures', () => {
  assert.equal(__test.isCriticalSystemErrorMessage('[plugins] plugins.allow is empty'), false);
  assert.equal(__test.isCriticalSystemErrorMessage('[tools] message failed: Cannot execute action on this channel type'), false);
  assert.equal(__test.isCriticalSystemErrorMessage('Gateway failed to start: another gateway instance is already listening'), true);
  assert.equal(__test.isCriticalSystemErrorMessage('panic: runtime error: index out of range'), true);
});
