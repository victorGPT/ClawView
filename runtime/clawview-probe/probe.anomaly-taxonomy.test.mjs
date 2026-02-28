import test from 'node:test';
import assert from 'node:assert/strict';

import { __test } from './probe.mjs';

test('computeAnomalyFlags splits OpenClaw system and ClawView pipeline anomalies', () => {
  const normal = __test.computeAnomalyFlags({
    serviceStatusNow: 'degraded',
    restartUnexpectedCount24h: 0,
    skillCallsCollectionMode: 'fact-event-structured',
  });
  assert.deepEqual(normal, {
    openclaw_system_anomaly: false,
    clawview_pipeline_anomaly: false,
  });

  const systemOnly = __test.computeAnomalyFlags({
    serviceStatusNow: 'down',
    restartUnexpectedCount24h: 0,
    skillCallsCollectionMode: 'fact-event-structured',
  });
  assert.equal(systemOnly.openclaw_system_anomaly, true);
  assert.equal(systemOnly.clawview_pipeline_anomaly, false);

  const pipelineOnly = __test.computeAnomalyFlags({
    serviceStatusNow: 'running',
    restartUnexpectedCount24h: 0,
    skillCallsCollectionMode: 'fact-only-not-connected',
  });
  assert.equal(pipelineOnly.openclaw_system_anomaly, false);
  assert.equal(pipelineOnly.clawview_pipeline_anomaly, true);
});
