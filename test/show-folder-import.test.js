'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const importer = require('../src/conference-desk/import.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-conference-folder-'));
const showFolder = path.join(root, 'Demo Conference');
const mediaDirectory = path.join(root, 'profile-media');
fs.mkdirSync(path.join(showFolder, 'media'), { recursive: true });
fs.writeFileSync(path.join(showFolder, 'rundown.csv'), 'session,duration,speaker,media\nOpening,10:00,Ana,opening.png\nKeynote,30:00,Maya,keynote.pdf\n');
fs.writeFileSync(path.join(showFolder, 'media', 'opening.png'), Buffer.from('deterministic-png-fixture'));
fs.writeFileSync(path.join(showFolder, 'media', 'keynote.pdf'), Buffer.from('%PDF-1.4 deterministic fixture'));
fs.writeFileSync(path.join(showFolder, '.hidden.txt'), 'ignored');

let passed = 0;
function check(name, condition) {
  assert.ok(condition, name);
  passed++;
  console.log(`${name}=true`);
}

(async () => {
  const result = await importer.importShowFolder({ rootDirectory: showFolder, mediaDirectory });
  check('SHOW_FOLDER_IMPORT_SUCCEEDS_OK', result.ok === true && result.rootName === 'Demo Conference');
  check('SHOW_FOLDER_IMPORT_SELECTS_RUNDOWN_OK', result.schedule && result.schedule.name === 'rundown.csv' && result.schedule.text.includes('Keynote'));
  check('SHOW_FOLDER_IMPORT_COPIES_SUPPORTED_MEDIA_OK', result.assets.length === 2 && result.assets.every(asset => asset.src.startsWith('media://')));
  check('SHOW_FOLDER_IMPORT_PERSISTS_HASHED_ASSETS_OK', result.assets.every(asset => fs.existsSync(path.join(mediaDirectory, asset.src.slice(8)))));
  check('SHOW_FOLDER_IMPORT_IGNORES_HIDDEN_FILES_OK', result.fileCount === 3);

  let limitBlocked = false;
  try { await importer.scanDirectory(showFolder, { maxFiles: 2 }); }
  catch (error) { limitBlocked = /more than 2 files/.test(String(error.message)); }
  check('SHOW_FOLDER_IMPORT_FILE_LIMIT_FAILS_CLOSED_OK', limitBlocked);

  console.log(`SHOW_FOLDER_IMPORT_TESTS_OK count=${passed}`);
  fs.rmSync(root, { recursive: true, force: true });
})().catch(error => {
  console.error(error && error.stack || error);
  fs.rmSync(root, { recursive: true, force: true });
  process.exit(1);
});
