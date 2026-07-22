import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveOverallStatus } from './launchAudit';

test('deriveOverallStatus marks a critical finding as not ready', () => {
  const status = deriveOverallStatus([
    {
      category: 'APIs',
      checkName: 'Provider health',
      status: 'Fail',
      severity: 'Critical',
      evidence: 'Primary provider offline',
      expectedResult: 'Healthy provider',
      actualResult: 'Offline',
      recommendedAction: 'Restore provider',
      relatedService: 'API-Tennis',
      timestamp: '2026-07-22T00:00:00.000Z',
    },
  ]);

  assert.equal(status, 'Not Ready');
});

test('deriveOverallStatus returns ready with warnings for non-blocking issues', () => {
  const status = deriveOverallStatus([
    {
      category: 'APIs',
      checkName: 'Provider health',
      status: 'Warning',
      severity: 'Medium',
      evidence: 'Latency above target',
      expectedResult: 'Healthy provider',
      actualResult: 'Slightly degraded',
      recommendedAction: 'Monitor latency',
      relatedService: 'API-Tennis',
      timestamp: '2026-07-22T00:00:00.000Z',
    },
  ]);

  assert.equal(status, 'Ready With Warnings');
});
