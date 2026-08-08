#!/usr/bin/env node
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
const profileDir = path.join(os.tmpdir(), 'showslate-lt-soak-profile');
const artifactDir = path.join(os.tmpdir(), 'showslate-lt-soak-artifacts');
fs.rmSync(profileDir, { recursive: true, force: true });
fs.rmSync(artifactDir, { recursive: true, force: true });
fs.mkdirSync(profileDir, { recursive: true });
fs.mkdirSync(artifactDir, { recursive: true });

const electron = path.join(root, 'node_modules', '.bin', 'electron');
const result = spawnSync(electron, [
  '.',
  '--smoke',
  '--lt2-soak-only',
  '--smoke-user-data-dir=' + profileDir
], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, SHOWSLATE_TEST_ARTIFACT_DIR: artifactDir }
});

process.exit(result.status == null ? 1 : result.status);
