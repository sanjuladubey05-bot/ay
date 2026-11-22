import test from 'node:test';
import assert from 'node:assert/strict';
import type { EnvReadinessSummary } from '../types/api';
import {
  buildChecklistState,
  evaluateLiveModeEligibility,
  RAZORPAY_CHECKLIST_DEFINITIONS,
} from './checklist';

const EMPTY_ENV: EnvReadinessSummary = {
  supabaseUrlConfigured: false,
  supabaseAnonKeyConfigured: false,
  supabaseServiceRoleConfigured: false,
  databaseUrlConfigured: false,
  razorpayKeyIdConfigured: false,
  razorpayKeySecretConfigured: false,
  razorpayWebhookSecretConfigured: false,
  razorpayKeyType: 'missing',
};

test('checklist exposes all 12 official Razorpay readiness items', () => {
  assert.equal(RAZORPAY_CHECKLIST_DEFINITIONS.length, 12);
  const items = buildChecklistState({}, EMPTY_ENV);
  assert.equal(items.length, 12);
  assert.ok(items.every((i) => i.status === 'not_started'));
});

test('missing server credentials override completed status to requires_attention', () => {
  const items = buildChecklistState(
    {
      test_api_keys_configured: { status: 'completed', updatedAt: '2026-01-01T00:00:00Z', note: '' },
      webhook_configured: { status: 'completed', updatedAt: '2026-01-01T00:00:00Z', note: '' },
    },
    EMPTY_ENV
  );

  const testKeys = items.find((i) => i.key === 'test_api_keys_configured');
  const webhook = items.find((i) => i.key === 'webhook_configured');
  assert.equal(testKeys?.status, 'requires_attention');
  assert.equal(webhook?.status, 'requires_attention');
});

test('evaluateLiveModeEligibility blocks live mode until credentials and checklist are complete', () => {
  const items = buildChecklistState({}, EMPTY_ENV);
  const evalEmpty = evaluateLiveModeEligibility(items, EMPTY_ENV);
  assert.equal(evalEmpty.eligible, false);
  assert.ok(evalEmpty.blockers.length >= 3);
});
