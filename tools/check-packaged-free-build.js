#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const archivePath = path.resolve(process.argv[2] || '');
const forbiddenPaths = [
  '/license.js',
  '/tools/keygen.js',
  '/tools/private.key'
];
const uiFiles = [
  'controller.html',
  'preload.js',
  'output.html',
  'signal.html',
  'i18n.js'
];
const gatePattern = /license-status|license-activate|PTP-[A-Za-z0-9_-]+|(?:ShowSlate|ProTimer Studio)\s*[—-]\s*TRIAL/i;

function fail(message) {
  console.error(`PACKAGED_FREE_BUILD_FAILED: ${message}`);
  process.exit(1);
}

if (!archivePath || !fs.existsSync(archivePath) || !fs.statSync(archivePath).isFile()) {
  fail('expected an existing app.asar path');
}

async function main() {
  const asar = await import('@electron/asar');
  let entries;
  try {
    entries = asar.listPackage(archivePath);
  } catch (error) {
    fail(`cannot read app.asar: ${error.message}`);
  }

  // @electron/asar builds listed paths with the host platform separator.
  // Normalize them so the same release check works on macOS and Windows.
  const entrySet = new Set(entries.map(entry => entry.replace(/\\/g, '/')));
  for (const forbidden of forbiddenPaths) {
    if (entrySet.has(forbidden)) fail(`forbidden packaged path: ${forbidden}`);
  }

  for (const file of uiFiles) {
    if (!entrySet.has(`/${file}`)) fail(`missing packaged UI file: ${file}`);
    const source = asar.extractFile(archivePath, file).toString('utf8');
    if (gatePattern.test(source)) fail(`activation/trial gate remains in packaged ${file}`);
  }

  if (!entrySet.has('/package.json')) fail('missing packaged package.json');
  const pkg = JSON.parse(asar.extractFile(archivePath, 'package.json').toString('utf8'));
  if (pkg.license !== 'MIT') fail('packaged package.json license is not MIT');

  console.log(`PACKAGED_FREE_BUILD_OK=true entries=${entries.length}`);
}

main().catch(error => fail(error.message || String(error)));
