'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { migrateLegacyUserData } = require('../src/brand/migrate-user-data.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-brand-migration-'));
const appData = path.join(root, 'app-data');
const legacy = path.join(appData, 'ProTimer Studio');
const current = path.join(appData, 'ShowSlate');

try {
  fs.mkdirSync(path.join(legacy, 'shows'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'media'), { recursive: true });
  fs.mkdirSync(path.join(legacy, 'Local Storage', 'leveldb'), { recursive: true });
  fs.writeFileSync(path.join(legacy, 'shows', 'current.json'), 'legacy-show');
  fs.writeFileSync(path.join(legacy, 'media', 'logo.png'), 'legacy-media');
  fs.writeFileSync(path.join(legacy, 'Local Storage', 'leveldb', '000001.log'), 'legacy-local-storage');
  fs.mkdirSync(path.join(current, 'shows'), { recursive: true });
  fs.writeFileSync(path.join(current, 'shows', 'current.json'), 'new-show');

  const first = migrateLegacyUserData({ appDataDir: appData, currentUserDataDir: current });
  assert.strictEqual(first.migrated, true);
  assert.strictEqual(fs.readFileSync(path.join(current, 'shows', 'current.json'), 'utf8'), 'new-show');
  assert.strictEqual(fs.readFileSync(path.join(current, 'media', 'logo.png'), 'utf8'), 'legacy-media');
  assert.strictEqual(fs.readFileSync(path.join(current, 'Local Storage', 'leveldb', '000001.log'), 'utf8'), 'legacy-local-storage');
  assert(fs.existsSync(path.join(current, 'showslate-migration-v1.json')));
  console.log('SHOWSLATE_USER_DATA_MIGRATION_OK=true');

  const second = migrateLegacyUserData({ appDataDir: appData, currentUserDataDir: current });
  assert.strictEqual(second.migrated, false);
  assert.strictEqual(second.copiedFiles, 0);
  console.log('SHOWSLATE_USER_DATA_MIGRATION_IDEMPOTENT_OK=true');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('SHOWSLATE_BRAND_MIGRATION_TESTS_OK count=2');
