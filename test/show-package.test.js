const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/show-storage/package.js');
const M = require('../src/lower-third/model.js');
const { ShowRepository } = require('../src/show-storage/repository.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-show-package-'));
const sourceMedia = path.join(root, 'source-media');
const importedMedia = path.join(root, 'clean-profile', 'media');
const packagePath = path.join(root, 'Demo Conference.showslate-show');
fs.mkdirSync(sourceMedia, { recursive: true });
fs.writeFileSync(path.join(sourceMedia, 'plate.png'), Buffer.from('portable-png-data'));
fs.writeFileSync(path.join(sourceMedia, 'intro.webm'), Buffer.from('portable-webm-data'));
fs.writeFileSync(path.join(sourceMedia, 'deck.pdf'), Buffer.from('portable-pdf-data'));
fs.writeFileSync(path.join(sourceMedia, 'unused.jpg'), Buffer.from('must-not-be-exported'));

const template = M.makeTemplate({
  id: 'lt-demo-custom',
  name: 'Demo Custom',
  kind: 'custom',
  layers: [
    M.makeMediaLayer({ id: 'lt-plate', assetId: 'media://plate.png', mediaKind: 'image' }),
    M.makeMediaLayer({ id: 'lt-intro', assetId: 'media://intro.webm', mediaKind: 'video' }),
    M.makeDynamicTextLayer({ id: 'lt-name', field: 'speakerName', fontFamily: 'Avenir Next' })
  ],
  phases: {
    intro: M.defaultPhase({ enabled: true, mode: 'media', mediaLayerId: 'lt-intro', durationMs: 800 }),
    hold: M.defaultPhase({ enabled: true, mode: 'static' }),
    outro: null
  }
});

function makeShow() {
  return {
    schemaVersion: 1,
    app: { productName: 'ShowSlate' },
    show: {
      id: 'show-demo-conference',
      name: 'Demo Conference',
      details: { venue: 'Main Hall' },
      rundown: [{ id: 'cue-1', name: 'Opening', durationMs: 60000, speakerName: 'Maya Chen', lowerThirdTemplateId: template.id }],
      selectedCue: 0,
      liveCue: -1,
      timer: { mode: 'countdown', durationMs: 60000, remainingMs: 60000, elapsedMs: 0, wasRunning: false },
      actualTimes: [],
      message: { text: '', flash: false },
      lowerThird: {
        library: { schemaVersion: 1, activeTemplateId: template.id, templates: [template], updatedAt: new Date().toISOString() },
        activeTemplateId: template.id,
        state: { visible: false },
        autoCue: true
      },
      screenContent: {
        scenes: [{ id: 'scene-1', name: 'Holding', layers: [{ id: 'scene-pdf', type: 'media', src: 'media://deck.pdf', x: 0, y: 0, width: 100, height: 100 }] }],
        activeSceneId: 'scene-1',
        text: '',
        textOnly: false,
        transparent: false
      },
      branding: { logo: 'media://plate.png', bgColor: '#000000', fgColor: '#ffffff' },
      outputs: { configs: [{ id: 'output-main', name: 'Main', mode: 'window' }], canvasAspect: '16:9' },
      preferences: { lang: 'en' }
    }
  };
}

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(name + '=true');
}

(async () => {
  try {
    const document = makeShow();
    const exported = await P.exportShowPackage({
      destination: packagePath,
      document,
      mediaDirectory: sourceMedia,
      appMetadata: { version: '1.0.0', commit: 'show-package-test' }
    });
    const entries = await P.readZipEntries(packagePath);
    const prepared = P.validateShowPackageEntries(entries);

    check('SHOW_PACKAGE_REFERENCED_CONTENT_ONLY_OK', () => {
      assert.strictEqual(exported.assets, 3);
      assert(entries.has('show.json'));
      assert(entries.has('rundown.json'));
      assert(entries.has('lower-thirds.json'));
      assert(entries.has('screen-content.json'));
      assert.strictEqual([...entries.keys()].filter(name => name.startsWith('assets/')).length, 3);
      assert(!Buffer.concat([...entries.values()]).includes(Buffer.from('must-not-be-exported')));
      assert.deepStrictEqual(prepared.document.show.rundown, document.show.rundown);
      assert(prepared.warnings.some(message => message.includes('Fonts')));
    });

    const oversizedAsset = path.join(sourceMedia, 'oversized.mp4');
    fs.writeFileSync(oversizedAsset, 'mock large video');
    const oversizedDocument = makeShow();
    oversizedDocument.show.branding.logo = 'media://oversized.mp4';
    const packageBeforeOversized = fs.readFileSync(packagePath);
    const statSync = fs.statSync;
    const readFileSync = fs.readFileSync;
    let oversizedReadAttempted = false;
    try {
      fs.statSync = function (file, ...args) {
        const stat = statSync.call(fs, file, ...args);
        return String(file) === oversizedAsset ? Object.assign(Object.create(stat), { size: P.MAX_ASSET_BYTES + 1 }) : stat;
      };
      fs.readFileSync = function (file, ...args) {
        if (String(file) === oversizedAsset) {
          oversizedReadAttempted = true;
          throw new Error('Oversized media must be rejected before loading it into memory.');
        }
        return readFileSync.call(fs, file, ...args);
      };
      await assert.rejects(P.exportShowPackage({ destination: packagePath, document: oversizedDocument, mediaDirectory: sourceMedia }), error => error.code === 'ASSET_TOO_LARGE');
    } finally {
      fs.statSync = statSync;
      fs.readFileSync = readFileSync;
    }
    check('SHOW_PACKAGE_OVERSIZED_MEDIA_REJECTED_BEFORE_READ_OK', () => {
      assert.strictEqual(oversizedReadAttempted, false);
      assert.deepStrictEqual(fs.readFileSync(packagePath), packageBeforeOversized);
    });

    const manyAssetsDocument = makeShow();
    manyAssetsDocument.show.screenContent.scenes = [{ id: 'bulk-assets', layers: Array.from({ length: 2044 }, (_, index) => ({ id: 'bulk-' + index, type: 'media', src: 'media://bulk-' + index + '.png' })) }];
    await assert.rejects(P.exportShowPackage({ destination: packagePath, document: manyAssetsDocument, mediaDirectory: sourceMedia }), error => error.code === 'TOO_MANY_ENTRIES');
    check('SHOW_PACKAGE_ENTRY_LIMIT_PRESERVES_DESTINATION_OK', () => {
      assert.deepStrictEqual(fs.readFileSync(packagePath), packageBeforeOversized);
    });

    const aggregateDocument = makeShow();
    const aggregateFiles = new Set();
    aggregateDocument.show.screenContent.scenes = [{ id: 'aggregate', layers: Array.from({ length: 6 }, (_, index) => {
      const filename = 'aggregate-' + index + '.mp4';
      const file = path.join(sourceMedia, filename);
      aggregateFiles.add(file);
      fs.writeFileSync(file, 'mock video');
      return { id: 'aggregate-' + index, type: 'media', src: 'media://' + filename };
    }) }];
    let aggregateReadAttempted = false;
    try {
      fs.statSync = function (file, ...args) {
        const stat = statSync.call(fs, file, ...args);
        return aggregateFiles.has(String(file)) ? Object.assign(Object.create(stat), { size: P.MAX_ASSET_BYTES }) : stat;
      };
      fs.readFileSync = function (file, ...args) {
        if (aggregateFiles.has(String(file))) {
          aggregateReadAttempted = true;
          throw new Error('Oversized export must be rejected before loading its media.');
        }
        return readFileSync.call(fs, file, ...args);
      };
      await assert.rejects(P.exportShowPackage({ destination: packagePath, document: aggregateDocument, mediaDirectory: sourceMedia }), error => error.code === 'PACKAGE_TOO_LARGE');
    } finally {
      fs.statSync = statSync;
      fs.readFileSync = readFileSync;
    }
    check('SHOW_PACKAGE_TOTAL_SIZE_REJECTED_BEFORE_READ_OK', () => {
      assert.strictEqual(aggregateReadAttempted, false);
      assert.deepStrictEqual(fs.readFileSync(packagePath), packageBeforeOversized);
    });

    const bareDocument = makeShow();
    bareDocument.show.lowerThird.library.templates[0].layers[0].assetId = 'plate.png';
    bareDocument.show.rundown[0].name = 'plate.png';
    bareDocument.show.branding.logo = '';
    bareDocument.show.screenContent.items = [{ id: 'inline-logo', type: 'logo', assetId: 'data:image/png;base64,cG5n' }];
    const barePackagePath = path.join(root, 'Bare lower-third asset.showslate-show');
    const bareExported = await P.exportShowPackage({ destination: barePackagePath, document: bareDocument, mediaDirectory: sourceMedia });
    const bareImported = await P.importShowPackage({ packagePath: barePackagePath, mediaDirectory: importedMedia });
    check('SHOW_PACKAGE_BARE_LT_ASSET_ROUNDTRIP_PRESERVES_TEXT_OK', () => {
      assert.strictEqual(bareExported.assets, 3);
      const importedAsset = bareImported.document.show.lowerThird.library.templates[0].layers[0].assetId;
      assert(/^media:\/\/[a-f0-9]{16}\.png$/.test(importedAsset));
      assert.strictEqual(fs.readFileSync(path.join(importedMedia, importedAsset.slice(8)), 'utf8'), 'portable-png-data');
      assert.strictEqual(bareImported.document.show.rundown[0].name, 'plate.png');
      assert.strictEqual(bareImported.document.show.screenContent.items[0].assetId, 'data:image/png;base64,cG5n');
      assert.strictEqual(bareDocument.show.lowerThird.library.templates[0].layers[0].assetId, 'plate.png');
    });

    fs.rmSync(sourceMedia, { recursive: true, force: true });
    const imported = await P.importShowPackage({ packagePath, mediaDirectory: importedMedia });
    const cleanProfile = path.join(root, 'clean-profile');
    const repository = new ShowRepository({ userDataDir: cleanProfile, maxBackups: 10 });
    await repository.initializeSession({ track: false });
    const savedImport = await repository.save(imported.document, { reason: 'package-import' });
    const reopenedImport = await repository.loadCurrent();
    check('SHOW_PACKAGE_CLEAN_PROFILE_ROUNDTRIP_OK', () => {
      assert.strictEqual(savedImport.ok, true);
      assert.strictEqual(reopenedImport.ok, true);
      assert.strictEqual(imported.document.show.id, document.show.id);
      assert.strictEqual(imported.document.show.name, document.show.name);
      assert.strictEqual(imported.document.show.rundown[0].speakerName, 'Maya Chen');
      assert.strictEqual(reopenedImport.document.show.rundown[0].speakerName, 'Maya Chen');
      const refs = P.collectMediaReferences(imported.document).map(row => row.source);
      assert.strictEqual(refs.length, 3);
      assert(refs.every(ref => /^media:\/\/[a-f0-9]{16}\.(png|webm|pdf)$/.test(ref)));
      assert(refs.every(ref => fs.existsSync(path.join(importedMedia, ref.slice(8)))));
    });

    check('SHOW_PACKAGE_PATH_TRAVERSAL_BLOCKED_OK', () => {
      assert.strictEqual(P.safePackagePath('../tools/private.key'), false);
      assert.strictEqual(P.safePackagePath('assets/../../private.key'), false);
      assert.strictEqual(P.safePackagePath('/absolute/file'), false);
      assert.strictEqual(P.safePackagePath('C:/windows/file'), false);
    });

    check('SHOW_PACKAGE_CORRUPT_JSON_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.set('manifest.json', Buffer.from('{bad json'));
      assert.throws(() => P.validateShowPackageEntries(bad), error => error.code === 'INVALID_JSON');
    });

    check('SHOW_PACKAGE_LEGACY_FORMAT_ACCEPTED_OK', () => {
      const legacy = new Map(entries);
      const manifest = JSON.parse(legacy.get('manifest.json').toString('utf8'));
      manifest.format = 'protimer-show';
      legacy.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.strictEqual(P.validateShowPackageEntries(legacy).document.show.id, document.show.id);
    });

    check('SHOW_PACKAGE_CHECKSUM_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.set('show.json', Buffer.from('{}'));
      assert.throws(() => P.validateShowPackageEntries(bad), error => error.code === 'CHECKSUM_MISMATCH');
    });

    check('SHOW_PACKAGE_SCHEMA_REJECTED_OK', () => {
      const bad = new Map(entries);
      const manifest = JSON.parse(bad.get('manifest.json').toString('utf8'));
      manifest.schemaVersion = 999;
      bad.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.throws(() => P.validateShowPackageEntries(bad), error => error.code === 'UNSUPPORTED_SCHEMA');
    });

    check('SHOW_PACKAGE_DUPLICATE_IDS_REJECTED_OK', () => {
      assert.throws(() => P.validateShowPackageEntries(entries, { existingShowIds: [document.show.id] }), error => error.code === 'DUPLICATE_SHOW_ID');
      const duplicateCue = makeShow();
      duplicateCue.show.rundown.push({ ...duplicateCue.show.rundown[0] });
      assert.throws(() => P.validateEmbeddedCollections(duplicateCue), error => error.code === 'DUPLICATE_ID');
      assert.throws(() => P.validateShowPackageEntries(entries, { existingTemplateIds: [template.id] }), error => error.code === 'DUPLICATE_TEMPLATE_ID');
    });

    check('SHOW_PACKAGE_MISSING_ASSET_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.delete([...bad.keys()].find(name => name.startsWith('assets/')));
      assert.throws(() => P.validateShowPackageEntries(bad), error => error.code === 'MISSING_ASSET');
    });

    check('SHOW_PACKAGE_UNDECLARED_CONTENT_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.set('userData/cache.bin', Buffer.from('cache'));
      assert.throws(() => P.validateShowPackageEntries(bad), error => error.code === 'UNDECLARED_ENTRY');
    });

    check('SHOW_PACKAGE_PRIVATE_DATA_EXCLUDED_OK', () => {
      const all = Buffer.concat([...entries.values()]).toString('utf8');
      assert(!all.includes('private.key'));
      assert(!all.includes('licenseKey'));
      const secret = makeShow();
      secret.show.preferences.apiToken = 'do-not-export';
      assert.throws(() => P.collectMediaReferences(secret), error => error.code === 'SECRET_FIELD');
    });

    console.log('SHOW_PACKAGE_TESTS_OK count=' + passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('SHOW_PACKAGE_TESTS_FAIL', error);
  process.exit(1);
});
