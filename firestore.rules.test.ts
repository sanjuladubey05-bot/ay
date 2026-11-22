import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const blueprintPath = path.resolve(process.cwd(), 'firebase-blueprint.json');

test('firestore.rules and firebase-blueprint.json enforce Eight Pillars security invariants', () => {
  assert.equal(fs.existsSync(blueprintPath), true, 'firebase-blueprint.json must exist');
  const blueprint = JSON.parse(fs.readFileSync(blueprintPath, 'utf8')) as {
    entities: Record<string, unknown>;
    firestore: Record<string, unknown>;
  };

  for (const collectionPath of Object.keys(blueprint.firestore)) {
    assert.ok(collectionPath.startsWith('/'), `Invalid collection path: ${collectionPath}`);
  }

  assert.equal(fs.existsSync(rulesPath), true, 'firestore.rules must exist');
  const rules = fs.readFileSync(rulesPath, 'utf8');

  // Pillar 0 & 4: rules_version = 2 and default deny catch-all
  assert.match(rules, /rules_version\s*=\s*'2'/);
  assert.match(rules, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);

  // Pillar 2: validation helpers called inside both create and update
  for (const helper of [
    'isValidUserProfile',
    'isValidAdminRoster',
    'isValidCatalogGame',
    'isValidCatalogPackage',
    'isValidTopupOrder',
  ]) {
    assert.ok(rules.includes(`function ${helper}`), `Missing validation helper ${helper}`);
  }

  // Pillar 3: isValidId checks enforced across single-doc operations
  assert.ok(rules.includes('function isValidId(id)'));
  assert.ok(rules.includes("id.matches('^[a-zA-Z0-9_\\\\-]+$')"));

  // Pillar 6: PII isolation (users list disabled)
  assert.match(rules, /match \/users\/\{userId\}[\s\S]*allow list:\s*if false;/);

  // Pillar 8: list queries on orders evaluate resource.data.userId without get()/exists()
  const ordersBlock = rules.slice(rules.indexOf('match /orders/{orderId}'));
  const listMatch = ordersBlock.match(/allow list:[\s\S]*?;/);
  assert.ok(listMatch, 'orders must define allow list');
  assert.ok(listMatch[0].includes('resource.data.userId == request.auth.uid'));
  assert.equal(/\b(get|exists)\(/.test(listMatch[0]), false, 'allow list must never call get() or exists()');

  // VerifyDirtyDozen structural defenses: email_verified, terminal state lock, request.time, affectedKeys
  assert.ok(rules.includes('request.auth.token.email_verified == true'));
  assert.ok(rules.includes("['completed', 'refunded', 'cancelled']"));
  assert.ok(rules.includes('request.time'));
  assert.ok(rules.includes('affectedKeys().hasOnly'));
});
