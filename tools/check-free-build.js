#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const forbiddenFiles = ['license.js', 'tools/keygen.js', 'tools/private.key'];
const publicUiFiles = ['controller.html', 'preload.js', 'output.html', 'signal.html', 'i18n.js'];
const gatePattern = /license-status|license-activate|PTP-[A-Za-z0-9_-]+|(?:ShowSlate|ProTimer Studio)\s*[—-]\s*TRIAL/i;
const failures = [];

for (const file of forbiddenFiles) {
  if (fs.existsSync(path.join(root, file))) failures.push(`forbidden file exists: ${file}`);
}

for (const file of publicUiFiles) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  if (gatePattern.test(source)) failures.push(`activation/trial gate remains in ${file}`);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (pkg.license !== 'MIT') failures.push('package.json license is not MIT');
if ((pkg.build && pkg.build.files || []).some((file) => /license\.js|keygen|private\.key/i.test(String(file)))) {
  failures.push('build.files includes licensing material');
}

const license = fs.readFileSync(path.join(root, 'LICENSE'), 'utf8');
if (!license.startsWith('MIT License')) failures.push('LICENSE is not MIT');

if (failures.length) {
  console.error('FREE_BUILD_CHECK_FAILED');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('FREE_BUILD_NO_LICENSE_GATE_OK=true');
