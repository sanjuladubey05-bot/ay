import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSensitiveFieldForbidden,
  mapCustomerOrderStatusLabel,
  mapDeliveryStatusLabel,
  sanitizeAndValidatePlayerFields,
  validateRegexPattern,
} from './playerFields';
import type { PlayerFieldDefinition } from '../types/database';

test('sanitizeAndValidatePlayerFields validates required dynamic fields and trims input', () => {
  const schema: PlayerFieldDefinition[] = [
    { key: 'riot_id', label: 'Riot ID', type: 'text', required: true },
    { key: 'tagline', label: 'Tagline', type: 'text', required: true },
    { key: 'server', label: 'Server', type: 'select', required: true, options: ['AP', 'EU'] },
  ];

  const bad = sanitizeAndValidatePlayerFields(schema, {
    riot_id: '   ',
    tagline: '#IND1',
    server: 'INVALID',
  });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.riot_id, 'Riot ID is required.');
  assert.equal(bad.errors.server, 'Please choose a valid Server.');

  const ok = sanitizeAndValidatePlayerFields(schema, {
    riot_id: '  Striker  ',
    tagline: '#IND1',
    server: 'AP',
  });
  assert.equal(ok.valid, true);
  assert.equal(ok.targetPlayerUid, 'Striker');
  assert.deepEqual(ok.sanitizedDetails, {
    riot_id: 'Striker',
    tagline: '#IND1',
    server: 'AP',
  });
});

test('isSensitiveFieldForbidden blocks passwords, OTPs, PINs, and tokens', () => {
  assert.equal(isSensitiveFieldForbidden('account_password'), true);
  assert.equal(isSensitiveFieldForbidden('OTP Code'), true);
  assert.equal(isSensitiveFieldForbidden('player_id'), false);

  const schema: PlayerFieldDefinition[] = [
    { key: 'otp_code', label: 'OTP Code', type: 'text', required: true },
  ];
  const res = sanitizeAndValidatePlayerFields(schema, { otp_code: '123456' });
  assert.equal(res.valid, false);
  assert.match(res.errors.otp_code, /not permitted/i);
});

test('order and delivery status mappers return exact customer-facing labels', () => {
  assert.equal(mapCustomerOrderStatusLabel('pending'), 'Pending');
  assert.equal(mapCustomerOrderStatusLabel('awaiting_payment'), 'Processing');
  assert.equal(mapCustomerOrderStatusLabel('completed'), 'Completed');
  assert.equal(mapCustomerOrderStatusLabel('failed'), 'Failed');
  assert.equal(mapCustomerOrderStatusLabel('cancelled'), 'Cancelled');

  assert.equal(mapDeliveryStatusLabel('pending'), 'Pending');
  assert.equal(mapDeliveryStatusLabel('queued'), 'Processing');
  assert.equal(mapDeliveryStatusLabel('delivered'), 'Delivered');
  assert.equal(mapDeliveryStatusLabel('failed'), 'Failed');
});

test('validateRegexPattern rejects dangerous backtracking, backreferences, and oversized patterns', () => {
  assert.equal(validateRegexPattern('').valid, true);
  assert.equal(validateRegexPattern('^[0-9]{6,12}$').valid, true);
  assert.equal(validateRegexPattern('(.+)+').valid, false);
  assert.equal(validateRegexPattern('(foo|bar)+').valid, false);
  assert.equal(validateRegexPattern('^([a-z])\\1$').valid, false);
  assert.equal(validateRegexPattern('[invalid').valid, false);
  assert.equal(validateRegexPattern('a'.repeat(121)).valid, false);

  const schema: PlayerFieldDefinition[] = [
    {
      key: 'player_id',
      label: 'Player UID',
      type: 'text',
      required: true,
      validationRegex: '^[0-9]{6,12}$',
      validationMessage: 'Player UID must be 6 to 12 digits.',
    },
  ];
  const bad = sanitizeAndValidatePlayerFields(schema, { player_id: 'abc' });
  assert.equal(bad.valid, false);
  assert.equal(bad.errors.player_id, 'Player UID must be 6 to 12 digits.');

  const good = sanitizeAndValidatePlayerFields(schema, { player_id: '12345678' });
  assert.equal(good.valid, true);
  assert.equal(good.targetPlayerUid, '12345678');
});
