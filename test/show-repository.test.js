const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { ShowRepository, validateShowDocument } = require('../src/show-storage/repository.js');
const { writeShowDocumentFile, readShowDocumentFile } = require('../src/show-storage/document-file.js');

const fsp = fs.promises;
let passed = 0;

function check(name, condition, detail = '') {
  assert.ok(condition, name + (detail ? ': ' + detail : ''));
  passed++;
  console.log(name + '=true' + (detail ? ' ' + detail : ''));
}

function documentFor(name, speaker = 'Speaker') {
  return {
    schemaVersion: 1,
    app: { version: 'test' },
    show: {
      id: 'show-test',
      name,
      details: { venue: 'Hall A' },
      rundown: [{ id: 'cue-1', name: 'Keynote', durationMs: 60000, speakerName: speaker }],
      selectedCue: 0,
      liveCue: 0,
      timer: { mode: 'countdown', durationMs: 60000, remainingMs: 42000, elapsedMs: 0, wasRunning: true, capturedAt: 100 },
      actualTimes: [],
      message: { text: 'Wrap up', flash: true },
      lowerThird: { activeTemplateId: 'lt-a', library: { schemaVersion: 1, templates: [] } },
      screenContent: { scenes: [{ id: 'scene-1', name: 'Timer', layers: [] }] },
      branding: { logo: '', bgColor: '#000000' },
      outputs: { configs: [] },
      preferences: { lang: 'en' }
    }
  };
}

async function makeRoot() {
  return fsp.mkdtemp(path.join(os.tmpdir(), 'showslate-show-repository-'));
}

async function prepareCrash(root, nowRef) {
  const clean = new ShowRepository({ userDataDir: root, now: () => ++nowRef.value });
  await clean.initializeSession({ track: true });
  await clean.save(documentFor('Last saved', 'Ada'));
  await clean.markClean();
  const crashed = new ShowRepository({ userDataDir: root, now: () => ++nowRef.value });
  await crashed.initializeSession({ track: true });
  await crashed.save(documentFor('Crash autosave', 'Grace'));
}

(async () => {
  const validation = validateShowDocument(documentFor('Validated'));
  check('SHOW_REPOSITORY_SCHEMA_VALIDATION_OK', validation.ok && validation.value.show.timer.wasRunning === true);

  const malicious = JSON.parse('{"schemaVersion":1,"show":{"rundown":[],"__proto__":{"polluted":true}}}');
  const safe = validateShowDocument(malicious);
  check('SHOW_REPOSITORY_DANGEROUS_KEYS_STRIPPED_OK', safe.ok && !Object.prototype.hasOwnProperty.call(safe.value.show, '__proto__') && !({}).polluted);

  const root = await makeRoot();
  let clock = Date.now();
  const repo = new ShowRepository({ userDataDir: root, now: () => ++clock, maxBackups: 10, appMetadata: { commit: 'unit-test' } });
  await repo.initializeSession({ track: true });
  const firstSave = await repo.save(documentFor('Atomic show'));
  const current = await repo.readCurrent();
  check('SHOW_REPOSITORY_ATOMIC_CURRENT_OK', firstSave.ok && current.ok && current.document.show.name === 'Atomic show' && current.document.app.commit === 'unit-test');

  for (let index = 0; index < 13; index++) await repo.save(documentFor('Version ' + index));
  const backups = await repo.listBackups();
  check('SHOW_REPOSITORY_BACKUP_ROTATION_OK', backups.length === 10, 'count=' + backups.length);

  const dangling = path.join(root, 'shows', 'current-show.json.tmp-dangling');
  await fsp.writeFile(dangling, 'partial');
  const cleanupRepo = new ShowRepository({ userDataDir: root, now: () => ++clock });
  await cleanupRepo.initializeSession({ track: false });
  check('SHOW_REPOSITORY_TEMP_CLEANUP_OK', !fs.existsSync(dangling));

  const backupCountBeforeCorrupt = (await repo.listBackups()).length;
  await fsp.writeFile(path.join(root, 'shows', 'current-show.json'), '{broken');
  const corrupt = await repo.readCurrent();
  check('SHOW_REPOSITORY_CORRUPTION_REJECTED_OK', !corrupt.ok && (await repo.listBackups()).length === backupCountBeforeCorrupt);
  await fsp.rm(root, { recursive: true, force: true });

  const documentRoot = await makeRoot();
  const documentPath = path.join(documentRoot, 'Conference opening');
  const documentSave = await writeShowDocumentFile({ file: documentPath, document: documentFor('Conference opening'), appMetadata: { commit: 'project-file-test' } });
  const documentOpen = await readShowDocumentFile(documentSave.path);
  check('SHOW_DOCUMENT_FILE_SAVE_OPEN_ROUNDTRIP_OK', documentSave.ok && documentSave.path.endsWith('.showslate') && documentOpen.ok && documentOpen.document.show.name === 'Conference opening' && documentOpen.document.app.commit === 'project-file-test');
  const invalidPath = path.join(documentRoot, 'invalid.showslate');
  await fsp.writeFile(invalidPath, '{"schemaVersion":99,"show":{"rundown":[]}}');
  const invalidOpen = await readShowDocumentFile(invalidPath);
  check('SHOW_DOCUMENT_FILE_INVALID_PROJECT_REJECTED_OK', !invalidOpen.ok && /schemaVersion/.test(invalidOpen.error));
  await fsp.rm(documentRoot, { recursive: true, force: true });

  const crashRoot = await makeRoot();
  const crashClock = { value: Date.now() };
  await prepareCrash(crashRoot, crashClock);
  const restart = new ShowRepository({ userDataDir: crashRoot, now: () => ++crashClock.value });
  const crashStatus = await restart.initializeSession({ track: true });
  check('SHOW_REPOSITORY_CRASH_DETECTED_OK', crashStatus.recoveryAvailable && crashStatus.hasLastSaved);
  const recovered = await restart.resolveRecovery('recover');
  check('SHOW_REPOSITORY_RECOVER_AUTOSAVE_OK', recovered.ok && recovered.source === 'autosave' && recovered.document.show.name === 'Crash autosave');
  await fsp.rm(crashRoot, { recursive: true, force: true });

  const baselineRoot = await makeRoot();
  const baselineClock = { value: Date.now() };
  await prepareCrash(baselineRoot, baselineClock);
  const baselineRestart = new ShowRepository({ userDataDir: baselineRoot, now: () => ++baselineClock.value });
  await baselineRestart.initializeSession({ track: true });
  const baseline = await baselineRestart.resolveRecovery('last-saved');
  check('SHOW_REPOSITORY_OPEN_LAST_SAVED_OK', baseline.ok && baseline.source === 'last-saved' && baseline.document.show.name === 'Last saved');
  await baselineRestart.markClean();
  const cleanRestart = new ShowRepository({ userDataDir: baselineRoot, now: () => ++baselineClock.value });
  const cleanStatus = await cleanRestart.initializeSession({ track: false });
  check('SHOW_REPOSITORY_CLEAN_EXIT_NO_RECOVERY_OK', !cleanStatus.recoveryAvailable);
  await fsp.rm(baselineRoot, { recursive: true, force: true });

  console.log('SHOW_REPOSITORY_TESTS_OK ' + passed + '/12');
})().catch((error) => {
  console.error(error && error.stack || error);
  process.exit(1);
});
