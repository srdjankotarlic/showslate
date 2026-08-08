'use strict';

const fs = require('fs');
const path = require('path');

const LEGACY_USER_DATA_NAMES = ['ProTimer Studio', 'protimer-studio'];
const OWNED_ENTRIES = [
  'shows',
  'media',
  'Local Storage',
  'Preferences'
];

function copyMissing(source, destination) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) return 0;
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: true });
    return fs.readdirSync(source).reduce(
      (count, name) => count + copyMissing(path.join(source, name), path.join(destination, name)),
      0
    );
  }
  if (!stat.isFile() || fs.existsSync(destination)) return 0;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination, fs.constants.COPYFILE_EXCL);
  return 1;
}

function migrateLegacyUserData({ appDataDir, currentUserDataDir, legacyNames = LEGACY_USER_DATA_NAMES } = {}) {
  if (!appDataDir || !currentUserDataDir) throw new Error('appDataDir and currentUserDataDir are required');
  const current = path.resolve(currentUserDataDir);
  fs.mkdirSync(current, { recursive: true });
  const sources = [];
  let copiedFiles = 0;

  for (const legacyName of legacyNames) {
    const source = path.resolve(appDataDir, legacyName);
    if (source === current || !fs.existsSync(source) || !fs.lstatSync(source).isDirectory()) continue;
    let copiedFromSource = 0;
    for (const entry of OWNED_ENTRIES) {
      const sourceEntry = path.join(source, entry);
      if (!fs.existsSync(sourceEntry)) continue;
      copiedFromSource += copyMissing(sourceEntry, path.join(current, entry));
    }
    if (copiedFromSource) {
      copiedFiles += copiedFromSource;
      sources.push(source);
    }
  }

  if (copiedFiles) {
    fs.writeFileSync(path.join(current, 'showslate-migration-v1.json'), JSON.stringify({
      schemaVersion: 1,
      migratedAt: new Date().toISOString(),
      sources,
      copiedFiles
    }, null, 2) + '\n');
  }
  return { migrated: copiedFiles > 0, copiedFiles, sources };
}

module.exports = { LEGACY_USER_DATA_NAMES, OWNED_ENTRIES, migrateLegacyUserData };
