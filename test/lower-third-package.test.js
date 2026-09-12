const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../src/lower-third/package.js');
const M = require('../src/lower-third/model.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-lt-package-'));
const sourceMedia = path.join(root, 'source-media');
const importedMedia = path.join(root, 'imported-media');
const packagePath = path.join(root, 'Conference Lower Third.showslate-lt');
fs.mkdirSync(sourceMedia, { recursive: true });
fs.writeFileSync(path.join(sourceMedia, 'aaaaaaaaaaaaaaaa.png'), Buffer.from('png-fixture-data'));
fs.writeFileSync(path.join(sourceMedia, 'bbbbbbbbbbbbbbbb.webm'), Buffer.from('webm-fixture-data'));
fs.writeFileSync(path.join(sourceMedia, 'unused-unused.png'), Buffer.from('unused'));

const template = M.makeTemplate({
  id: 'lt-package-roundtrip',
  name: 'Conference Lower Third',
  kind: 'custom',
  layers: [
    M.makeMediaLayer({ id: 'plate', assetId: 'media://aaaaaaaaaaaaaaaa.png', mediaKind: 'image' }),
    M.makeMediaLayer({ id: 'intro', assetId: 'media://bbbbbbbbbbbbbbbb.webm', mediaKind: 'video' }),
    M.makeDynamicTextLayer({ id: 'speaker', field: 'speakerName', fontFamily: 'Avenir Next' })
  ],
  phases: {
    intro: M.defaultPhase({ enabled: true, mode: 'media', mediaLayerId: 'intro', durationMs: 900 }),
    hold: M.defaultPhase({ enabled: true, mode: 'static' }),
    outro: null
  }
});

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(name + '=true');
}

(async () => {
  try {
    const exported = await P.exportLowerThirdPackage({
      destination: packagePath,
      template,
      mediaDirectory: sourceMedia,
      appMetadata: { version: '1.0.0', commit: 'test-commit' }
    });
    const entries = await P.readZipEntries(packagePath);
    const prepared = P.validateLowerThirdPackageEntries(entries);
    check('LT_PACKAGE_EXPORT_CONTENT_OK', () => {
      assert.strictEqual(exported.assets, 2);
      assert(entries.has('manifest.json'));
      assert(entries.has('template.json'));
      assert.strictEqual([...entries.keys()].filter(name => name.startsWith('assets/')).length, 2);
      assert(![...entries.keys()].some(name => name.includes('unused')));
      assert.strictEqual(prepared.manifest.fontFallbacks[0].requested, 'Avenir Next');
    });

    const imported = await P.importLowerThirdPackage({ packagePath, mediaDirectory: importedMedia, existingTemplateIds: [] });
    check('LT_PACKAGE_EXPORT_DELETE_IMPORT_OK', () => {
      assert.strictEqual(imported.template.id, template.id);
      assert.strictEqual(imported.assets, 2);
      const importedAssets = imported.template.layers.filter(layer => layer.type === 'media').map(layer => layer.assetId);
      assert(importedAssets.every(assetId => /^media:\/\/[a-f0-9]{16}\.(png|webm)$/.test(assetId)));
      assert(importedAssets.every(assetId => fs.existsSync(path.join(importedMedia, assetId.slice(8)))));
      assert.strictEqual(imported.template.phases.intro.mediaLayerId, 'intro');
    });

    const duplicateFilename = 'cccccccccccccccc.png';
    fs.copyFileSync(path.join(sourceMedia, 'aaaaaaaaaaaaaaaa.png'), path.join(sourceMedia, duplicateFilename));
    const duplicateTemplate = JSON.parse(JSON.stringify(template));
    duplicateTemplate.layers.push(M.makeLogoLayer({ id: 'second-plate', assetId: 'media://' + duplicateFilename }));
    const duplicatePackagePath = path.join(root, 'Duplicate media bytes.showslate-lt');
    await P.exportLowerThirdPackage({ destination: duplicatePackagePath, template: duplicateTemplate, mediaDirectory: sourceMedia });
    const duplicateEntries = await P.readZipEntries(duplicatePackagePath);
    const duplicateImported = await P.importLowerThirdPackage({ packagePath: duplicatePackagePath, mediaDirectory: path.join(root, 'duplicate-import') });
    check('LT_PACKAGE_IDENTICAL_BYTES_DIFFERENT_REFERENCES_ROUNDTRIP_OK', () => {
      assert.strictEqual([...duplicateEntries.keys()].filter(name => name.startsWith('assets/')).length, 3);
      assert.strictEqual(duplicateImported.template.layers.find(layer => layer.id === 'plate').assetId,
        duplicateImported.template.layers.find(layer => layer.id === 'second-plate').assetId);
      assert.strictEqual(fs.readdirSync(path.join(root, 'duplicate-import')).length, 2);
    });

    const collisionMedia = path.join(root, 'collision-media');
    fs.mkdirSync(collisionMedia);
    const collisionFilename = imported.template.layers.find(layer => layer.id === 'plate').assetId.slice(8);
    const collisionPath = path.join(collisionMedia, collisionFilename);
    fs.writeFileSync(collisionPath, 'damaged local media');
    await assert.rejects(P.importLowerThirdPackage({ packagePath, mediaDirectory: collisionMedia }), error => error.code === 'MEDIA_COLLISION');
    check('LT_PACKAGE_CORRUPT_EXISTING_MEDIA_REJECTED_OK', () => {
      assert.strictEqual(fs.readFileSync(collisionPath, 'utf8'), 'damaged local media');
      assert.deepStrictEqual(fs.readdirSync(collisionMedia), [collisionFilename]);
    });
    const reimported = await P.importLowerThirdPackage({ packagePath, mediaDirectory: importedMedia });
    check('LT_PACKAGE_REUSES_VERIFIED_EXISTING_MEDIA_OK', () => {
      assert.strictEqual(reimported.template.layers.find(layer => layer.id === 'plate').assetId, imported.template.layers.find(layer => layer.id === 'plate').assetId);
      assert.strictEqual(fs.readdirSync(importedMedia).length, 2);
    });

    const protectedDestination = path.join(root, 'Existing export.showslate-lt');
    fs.writeFileSync(protectedDestination, 'previous export');
    const oversizedTemplate = M.makeTemplate({ layers: [M.makeStaticTextLayer({ text: 'x'.repeat(5 * 1024 * 1024) })] });
    await assert.rejects(P.exportLowerThirdPackage({ destination: protectedDestination, template: oversizedTemplate, mediaDirectory: sourceMedia }), error => error.code === 'JSON_TOO_LARGE');
    check('LT_PACKAGE_OVERSIZED_JSON_PRESERVES_DESTINATION_OK', () => {
      assert.strictEqual(fs.readFileSync(protectedDestination, 'utf8'), 'previous export');
    });
    const manyAssetsTemplate = M.makeTemplate({ layers: [] });
    for (let index = 0; index < 127; index++) {
      const filename = 'plate-' + index + '.png';
      fs.writeFileSync(path.join(sourceMedia, filename), String(index));
      manyAssetsTemplate.layers.push(M.makeMediaLayer({ assetId: 'media://' + filename }));
    }
    await assert.rejects(P.exportLowerThirdPackage({ destination: protectedDestination, template: manyAssetsTemplate, mediaDirectory: sourceMedia }), error => error.code === 'TOO_MANY_ENTRIES');
    check('LT_PACKAGE_ENTRY_LIMIT_PRESERVES_DESTINATION_OK', () => {
      assert.strictEqual(fs.readFileSync(protectedDestination, 'utf8'), 'previous export');
    });

    const aggregateTemplate = M.makeTemplate({ layers: manyAssetsTemplate.layers.slice(0, 3) });
    const aggregateFiles = new Set(aggregateTemplate.layers.map(layer => path.join(sourceMedia, layer.assetId.slice(8))));
    const originalStat = fs.statSync, originalRead = fs.readFileSync;
    let aggregateReadAttempted = false;
    try {
      fs.statSync = function (file, ...args) {
        const stat = originalStat.call(fs, file, ...args);
        return aggregateFiles.has(String(file)) ? Object.assign(Object.create(stat), { size: P.MAX_ASSET_BYTES }) : stat;
      };
      fs.readFileSync = function (file, ...args) {
        if (aggregateFiles.has(String(file))) {
          aggregateReadAttempted = true;
          throw new Error('Oversized export must be rejected before loading its media.');
        }
        return originalRead.call(fs, file, ...args);
      };
      await assert.rejects(P.exportLowerThirdPackage({ destination: protectedDestination, template: aggregateTemplate, mediaDirectory: sourceMedia }), error => error.code === 'PACKAGE_TOO_LARGE');
    } finally {
      fs.statSync = originalStat;
      fs.readFileSync = originalRead;
    }
    check('LT_PACKAGE_TOTAL_SIZE_REJECTED_BEFORE_READ_OK', () => {
      assert.strictEqual(aggregateReadAttempted, false);
      assert.strictEqual(fs.readFileSync(protectedDestination, 'utf8'), 'previous export');
    });

    const bareTemplate = JSON.parse(JSON.stringify(template));
    bareTemplate.layers[0].assetId = 'aaaaaaaaaaaaaaaa.png';
    const barePackagePath = path.join(root, 'Bare asset reference.showslate-lt');
    await P.exportLowerThirdPackage({ destination: barePackagePath, template: bareTemplate, mediaDirectory: sourceMedia });
    const bareImported = await P.importLowerThirdPackage({ packagePath: barePackagePath, mediaDirectory: importedMedia });
    check('LT_PACKAGE_BARE_ASSET_REFERENCE_ROUNDTRIP_OK', () => {
      assert.strictEqual(bareImported.template.layers[0].assetId, imported.template.layers[0].assetId);
      assert.strictEqual(bareTemplate.layers[0].assetId, 'aaaaaaaaaaaaaaaa.png');
    });

    const embeddedTemplate = M.makeTemplate({ layers: [M.makeMediaLayer({ sourceType: 'legacyDataUrl', dataUrl: 'data:image/png;base64,cG5nLWZpeHR1cmUtZGF0YQ==' })] });
    const embeddedPackagePath = path.join(root, 'Embedded legacy image.showslate-lt');
    const embeddedExported = await P.exportLowerThirdPackage({ destination: embeddedPackagePath, template: embeddedTemplate, mediaDirectory: sourceMedia });
    const embeddedImported = await P.importLowerThirdPackage({ packagePath: embeddedPackagePath, mediaDirectory: importedMedia });
    check('LT_PACKAGE_EMBEDDED_LEGACY_IMAGE_ROUNDTRIP_OK', () => {
      assert.strictEqual(embeddedExported.assets, 0);
      assert.strictEqual(embeddedImported.template.layers[0].sourceType, 'legacyDataUrl');
      assert.strictEqual(embeddedImported.template.layers[0].dataUrl, embeddedTemplate.layers[0].dataUrl);
    });

    check('LT_PACKAGE_PATH_TRAVERSAL_BLOCKED_OK', () => {
      assert.strictEqual(P.safePackagePath('../private.key'), false);
      assert.strictEqual(P.safePackagePath('assets/../../private.key'), false);
      assert.strictEqual(P.safePackagePath('/absolute/file'), false);
      assert.strictEqual(P.safePackagePath('C:/windows/file'), false);
    });

    check('LT_PACKAGE_CORRUPT_JSON_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.set('manifest.json', Buffer.from('{bad json'));
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'INVALID_JSON');
    });

    check('LT_PACKAGE_LEGACY_FORMAT_ACCEPTED_OK', () => {
      const legacy = new Map(entries);
      const manifest = JSON.parse(legacy.get('manifest.json').toString('utf8'));
      manifest.format = 'protimer-lt';
      legacy.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.strictEqual(P.validateLowerThirdPackageEntries(legacy).template.id, template.id);
    });

    check('LT_PACKAGE_CHECKSUM_REJECTED_OK', () => {
      const bad = new Map(entries);
      bad.set('template.json', Buffer.from('{}'));
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'CHECKSUM_MISMATCH');
    });

    check('LT_PACKAGE_SCHEMA_REJECTED_OK', () => {
      const bad = new Map(entries);
      const manifest = JSON.parse(bad.get('manifest.json').toString('utf8'));
      manifest.schemaVersion = 999;
      bad.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'UNSUPPORTED_SCHEMA');
    });

    check('LT_PACKAGE_MANIFEST_ID_REJECTED_OK', () => {
      const bad = new Map(entries);
      const manifest = JSON.parse(bad.get('manifest.json').toString('utf8'));
      manifest.template.id = 'different-template-id';
      bad.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'INVALID_MANIFEST');
    });

    check('LT_PACKAGE_DUPLICATE_ID_REJECTED_OK', () => {
      assert.throws(() => P.validateLowerThirdPackageEntries(entries, { existingTemplateIds: [template.id] }), error => error.code === 'DUPLICATE_TEMPLATE_ID');
    });

    check('LT_PACKAGE_MISSING_ASSET_REJECTED_OK', () => {
      const bad = new Map(entries);
      const assetName = [...bad.keys()].find(name => name.startsWith('assets/'));
      bad.delete(assetName);
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'MISSING_ASSET');
    });

    check('LT_PACKAGE_UNUSED_ASSET_REJECTED_OK', () => {
      const bad = new Map(entries);
      const manifest = JSON.parse(bad.get('manifest.json').toString('utf8'));
      const data = Buffer.from('unused-package-asset');
      const assetPath = 'assets/unused.png';
      bad.set(assetPath, data);
      manifest.assets.push({
        source: 'media://cccccccccccccccc.png', path: assetPath, sha256: P.sha256(data),
        bytes: data.length, mime: 'image/png', layerIds: []
      });
      bad.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      assert.throws(() => P.validateLowerThirdPackageEntries(bad), error => error.code === 'UNUSED_ASSET');
    });

    console.log('LT_PACKAGE_TESTS_OK count=' + passed);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('LT_PACKAGE_TESTS_FAIL', error);
  process.exit(1);
});
