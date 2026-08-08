#!/usr/bin/env node
// Portable smoke launcher that pins all test windows to a chosen display.
//   node tools/run-smoke-on-display.js --display "Built-in Retina Display" --source
//   node tools/run-smoke-on-display.js --display "Built-in Retina Display" --packaged
//   node tools/run-smoke-on-display.js --source --output-routing-only
// No arg-parsing dependency; forwards the display selector to main.js via --smoke-display.
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const argv = process.argv.slice(2);
function val(flag) { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : null; }
const display = val('--display');
const displayId = val('--display-id');
const packaged = argv.includes('--packaged');
const root = path.join(__dirname, '..');
let config = {};
for (const name of ['.showslate-smoke-display.json', '.protimer-smoke-display.json']) {
  try { config = JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')); break; } catch (e) {}
}

const smokeArgs = ['--smoke'];
if (argv.includes('--output-routing-only')) smokeArgs.push('--output-routing-only');
const smokeProfileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-smoke-'));
const artifactDir = path.join(root, 'artifacts', 'generated', packaged ? 'packaged' : 'source');
fs.mkdirSync(artifactDir, { recursive: true });
smokeArgs.push('--smoke-user-data-dir=' + smokeProfileDir, '--artifact-dir=' + artifactDir);
const wantedId = displayId || (config && config.id);
const wantedLabel = display || (config && config.labelContains);
if (wantedId) smokeArgs.push('--smoke-display-id=' + wantedId);
else if (wantedLabel) smokeArgs.push('--smoke-display=' + wantedLabel);

let cmd, cmdArgs;
if (packaged) {
  // find the built .app and run its binary directly
  const appDir = path.join(root, 'dist-installers', 'mac-arm64', 'ShowSlate.app', 'Contents', 'MacOS', 'ShowSlate');
  if (!fs.existsSync(appDir)) {
    console.error('Packaged app not found: ' + appDir + '\nRun `npm run dist:mac` first.');
    process.exit(2);
  }
  cmd = appDir; cmdArgs = smokeArgs;
} else {
  cmd = path.join(root, 'node_modules', '.bin', 'electron');
  cmdArgs = ['.', ...smokeArgs];
}

console.log('SMOKE PROFILE: ' + smokeProfileDir);
console.log('SMOKE ARTIFACTS: ' + artifactDir);
console.log('LAUNCH ' + (packaged ? 'packaged' : 'source') + ' smoke: ' + cmd + ' ' + cmdArgs.join(' '));
const r = spawnSync(cmd, cmdArgs, { cwd: root, stdio: 'inherit' });
process.exit(r.status == null ? 1 : r.status);
