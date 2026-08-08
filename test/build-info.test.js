'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createBuildInfo } = require('../src/release/build-info.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-build-info-'));

function git(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

try {
  git(['init', '-q']);
  git(['config', 'user.name', 'ShowSlate Test']);
  git(['config', 'user.email', 'test@showslate.invalid']);
  fs.writeFileSync(path.join(root, 'tracked.txt'), 'clean\n');
  git(['add', 'tracked.txt']);
  git(['commit', '-q', '-m', 'fixture']);

  const clean = createBuildInfo(root, new Date('2026-07-20T18:00:00Z'));
  assert.strictEqual(clean.dirty, false);
  assert.match(clean.commit, /^[a-f0-9]+$/);
  assert.match(clean.commitFull, /^[a-f0-9]{40}$/);
  assert.strictEqual(clean.buildTimestamp, '2026-07-20T18:00:00.000Z');
  console.log('BUILD_INFO_CLEAN_SOURCE_OK=true');

  fs.appendFileSync(path.join(root, 'tracked.txt'), 'modified\n');
  const dirty = createBuildInfo(root);
  assert.strictEqual(dirty.dirty, true);
  assert.match(dirty.commit, /^[a-f0-9]+-dirty$/);
  assert.strictEqual(dirty.commitFull, clean.commitFull);
  console.log('BUILD_INFO_DIRTY_SOURCE_DISCLOSED_OK=true');

  fs.writeFileSync(path.join(root, 'untracked.txt'), 'untracked\n');
  const untracked = createBuildInfo(root);
  assert.strictEqual(untracked.dirty, true);
  assert.match(untracked.commit, /-dirty$/);
  console.log('BUILD_INFO_UNTRACKED_SOURCE_DISCLOSED_OK=true');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}

console.log('BUILD_INFO_TESTS_OK count=3');
