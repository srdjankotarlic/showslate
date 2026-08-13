const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const yauzl = require('yauzl');
const { validateShowDocument, MAX_SHOW_BYTES } = require('./repository.js');
const LT = require('../lower-third/validate.js');

const FORMAT = 'showslate-show';
const LEGACY_FORMATS = new Set(['protimer-show']);
const PACKAGE_SCHEMA_VERSION = 1;
const MAX_PACKAGE_BYTES = 1024 * 1024 * 1024;
const MAX_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_COUNT = 2048;
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.m4v': 'video/mp4',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf'
};
const FORBIDDEN_SECRET_KEYS = new Set([
  'license', 'licensekey', 'privatekey', 'apitoken', 'cmdtoken', 'token',
  'accesstoken', 'refreshtoken', 'authorization', 'secret'
]);

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function safePackagePath(value) {
  const name = String(value || '');
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  return name.split('/').every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f]/.test(part));
}

function safeMediaFilename(assetId) {
  const match = /^media:\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,159})$/.exec(String(assetId || ''));
  if (!match) return null;
  const filename = match[1];
  const ext = path.extname(filename).toLowerCase();
  if (!MIME_BY_EXT[ext] || path.basename(filename) !== filename) return null;
  return filename;
}

function visit(value, visitor, keyPath = [], depth = 0) {
  if (depth > 50) throw fail('DOCUMENT_TOO_DEEP', 'Show document exceeds the package depth limit.');
  if (typeof value === 'string') {
    visitor(value, keyPath);
    return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => visit(item, visitor, keyPath.concat(String(index)), depth + 1));
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (FORBIDDEN_SECRET_KEYS.has(String(key).toLowerCase())) {
      throw fail('SECRET_FIELD', 'Show document contains a private field that cannot be exported: ' + keyPath.concat(key).join('.'));
    }
    visit(item, visitor, keyPath.concat(key), depth + 1);
  }
}

function collectMediaReferences(document) {
  const references = new Map();
  visit(document, (value, keyPath) => {
    if (!value.startsWith('media://')) return;
    const filename = safeMediaFilename(value);
    if (!filename) throw fail('UNSAFE_ASSET_REFERENCE', 'Show contains an unsafe media reference at ' + keyPath.join('.') + '.');
    const row = references.get(value) || { source: value, filename, references: [] };
    row.references.push(keyPath.join('.'));
    references.set(value, row);
  });
  return [...references.values()];
}

function collectWarnings(document) {
  const warnings = new Set();
  visit(document, (value) => {
    if (/^https?:\/\//i.test(value)) warnings.add('The show contains remote media or links that may not be available offline.');
  });
  const templates = document.show && document.show.lowerThird && document.show.lowerThird.library
    && Array.isArray(document.show.lowerThird.library.templates)
    ? document.show.lowerThird.library.templates : [];
  templates.forEach(template => (template.layers || []).forEach(layer => {
    if ((layer.type === 'dynamicText' || layer.type === 'staticText') && layer.fontFamily) {
      warnings.add('Fonts are referenced by name and must be installed on the destination computer.');
    }
  }));
  const liveInputs = document.show && document.show.screenContent && Array.isArray(document.show.screenContent.liveInputs)
    ? document.show.screenContent.liveInputs : [];
  if (liveInputs.length) warnings.add('Live windows and capture devices are linked to this computer and may need to be selected again after import.');
  return [...warnings];
}

function assertUniqueIds(items, label, { required = false } = {}) {
  if (!Array.isArray(items)) return;
  const seen = new Set();
  items.forEach((item, index) => {
    const id = String(item && item.id || '');
    if (!id) {
      if (required) throw fail('MISSING_ID', label + ' at index ' + index + ' has no ID.');
      return;
    }
    if (seen.has(id)) throw fail('DUPLICATE_ID', label + ' contains duplicate ID: ' + id);
    seen.add(id);
  });
}

function validateEmbeddedCollections(document, { existingTemplateIds = [] } = {}) {
  const show = document.show || {};
  assertUniqueIds(show.rundown, 'Rundown', { required: true });
  const library = show.lowerThird && show.lowerThird.library;
  if (library) {
    const result = LT.validateLowerThirdLibrary(library);
    if (!result.ok) throw fail('INVALID_LOWER_THIRD_LIBRARY', 'Invalid lower-third library: ' + result.errors.slice(0, 3).join('; '));
    assertUniqueIds(library.templates, 'Lower-third library', { required: true });
    const existing = new Set(existingTemplateIds.map(String));
    for (const template of library.templates || []) {
      if (existing.has(String(template.id))) throw fail('DUPLICATE_TEMPLATE_ID', 'A lower-third template with this ID already exists: ' + template.id);
      assertUniqueIds(template.layers, 'Lower-third template ' + template.id + ' layers', { required: true });
    }
  }
  const content = show.screenContent || {};
  assertUniqueIds(content.scenes, 'Screen scenes', { required: true });
  (content.scenes || []).forEach(scene => assertUniqueIds(scene.layers, 'Scene ' + scene.id + ' layers', { required: true }));
  assertUniqueIds(content.items, 'Screen content', { required: true });
  assertUniqueIds(show.outputs && show.outputs.configs, 'Output configurations', { required: true });
  return document;
}

function validateExportDocument(input) {
  const validated = validateShowDocument(input);
  if (!validated.ok) throw fail('INVALID_SHOW', 'Invalid show document: ' + validated.errors.slice(0, 3).join('; '));
  visit(validated.value, () => {});
  validateEmbeddedCollections(validated.value);
  return validated.value;
}

async function writeZip(destination, entries) {
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  const temp = path.join(path.dirname(destination), '.' + path.basename(destination) + '.' + process.pid + '.' + crypto.randomBytes(5).toString('hex') + '.tmp');
  try {
    await new Promise((resolve, reject) => {
      const output = fs.createWriteStream(temp, { flags: 'wx' });
      const archive = new ZipArchive({ zlib: { level: 9 } });
      let settled = false;
      const done = error => {
        if (settled) return;
        settled = true;
        if (error) reject(error); else resolve();
      };
      output.on('close', () => done());
      output.on('error', done);
      archive.on('warning', error => { if (error.code !== 'ENOENT') done(error); });
      archive.on('error', done);
      archive.pipe(output);
      entries.forEach(entry => archive.append(entry.data, { name: entry.name }));
      archive.finalize().catch(done);
    });
    fs.renameSync(temp, destination);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (_) {}
    throw error;
  }
}

function componentEntries(document) {
  const show = document.show;
  return {
    show: { path: 'show.json', data: jsonBuffer(document) },
    rundown: { path: 'rundown.json', data: jsonBuffer(show.rundown || []) },
    lowerThirds: { path: 'lower-thirds.json', data: jsonBuffer(show.lowerThird || {}) },
    screenContent: { path: 'screen-content.json', data: jsonBuffer(show.screenContent || {}) }
  };
}

async function exportShowPackage({ destination, document: input, mediaDirectory, appMetadata = {} }) {
  if (!destination || !String(destination).toLowerCase().endsWith('.showslate-show')) {
    throw fail('INVALID_DESTINATION', 'Show package must use the .showslate-show extension.');
  }
  const document = validateExportDocument(input);
  const components = componentEntries(document);
  Object.values(components).forEach(component => {
    if (component.data.length > MAX_SHOW_BYTES) throw fail('JSON_TOO_LARGE', component.path + ' exceeds 25 MB.');
  });
  const mediaRoot = path.resolve(mediaDirectory) + path.sep;
  const assets = collectMediaReferences(document).map((reference, index) => {
    const full = path.resolve(mediaDirectory, reference.filename);
    if (!full.startsWith(mediaRoot) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw fail('MISSING_ASSET', 'Missing show asset: ' + reference.filename);
    }
    const data = fs.readFileSync(full);
    if (data.length > MAX_ASSET_BYTES) throw fail('ASSET_TOO_LARGE', 'Show asset exceeds 200 MB: ' + reference.filename);
    const ext = path.extname(reference.filename).toLowerCase();
    const checksum = sha256(data);
    const sourceTag = sha256(reference.source).slice(0, 8);
    return {
      ...reference,
      data,
      path: 'assets/' + checksum.slice(0, 24) + '-' + sourceTag + '-' + index + ext,
      sha256: checksum,
      bytes: data.length,
      mime: MIME_BY_EXT[ext]
    };
  });
  const manifest = {
    format: FORMAT,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    documentSchemaVersion: document.schemaVersion,
    createdAt: new Date().toISOString(),
    app: {
      name: 'ShowSlate',
      version: String(appMetadata.version || ''),
      commit: String(appMetadata.commit || ''),
      buildTimestamp: String(appMetadata.buildTimestamp || '')
    },
    show: { id: document.show.id, name: document.show.name, path: components.show.path, sha256: sha256(components.show.data) },
    components: Object.fromEntries(Object.entries(components).map(([name, component]) => [name, {
      path: component.path,
      sha256: sha256(component.data),
      bytes: component.data.length
    }])),
    assets: assets.map(asset => ({
      source: asset.source,
      path: asset.path,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      references: asset.references
    })),
    warnings: collectWarnings(document)
  };
  const entries = [
    { name: 'manifest.json', data: jsonBuffer(manifest) },
    ...Object.values(components).map(component => ({ name: component.path, data: component.data })),
    ...assets.map(asset => ({ name: asset.path, data: asset.data }))
  ];
  await writeZip(destination, entries);
  return {
    ok: true,
    path: destination,
    showId: document.show.id,
    assets: assets.length,
    warnings: manifest.warnings,
    bytes: fs.statSync(destination).size
  };
}

function readZipEntries(packagePath) {
  const stat = fs.statSync(packagePath);
  if (!stat.isFile()) return Promise.reject(fail('INVALID_PACKAGE', 'Show package is not a file.'));
  if (stat.size > MAX_PACKAGE_BYTES) return Promise.reject(fail('PACKAGE_TOO_LARGE', 'Show package exceeds 1 GB.'));
  return new Promise((resolve, reject) => {
    yauzl.open(packagePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: true }, (openError, zip) => {
      if (openError) { reject(fail('INVALID_ZIP', 'Cannot open show package.')); return; }
      const entries = new Map();
      let count = 0;
      let total = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch (_) {}
        if (error) reject(error); else resolve(value);
      };
      zip.on('error', error => finish(fail('INVALID_ZIP', String(error.message || error))));
      zip.on('end', () => finish(null, entries));
      zip.on('entry', entry => {
        const name = String(entry.fileName || '');
        if (++count > MAX_ENTRY_COUNT) { finish(fail('TOO_MANY_ENTRIES', 'Show package contains too many files.')); return; }
        if (!safePackagePath(name)) { finish(fail('UNSAFE_PATH', 'Unsafe path in show package: ' + name)); return; }
        if (entries.has(name)) { finish(fail('DUPLICATE_ENTRY', 'Duplicate file in show package: ' + name)); return; }
        if (entry.generalPurposeBitFlag & 0x1) { finish(fail('ENCRYPTED_ENTRY', 'Encrypted show packages are not supported.')); return; }
        if (entry.uncompressedSize > MAX_ASSET_BYTES || total + entry.uncompressedSize > MAX_PACKAGE_BYTES) {
          finish(fail('PACKAGE_TOO_LARGE', 'Show package expands beyond the allowed size.'));
          return;
        }
        total += entry.uncompressedSize;
        zip.openReadStream(entry, (streamError, stream) => {
          if (streamError) { finish(fail('INVALID_ZIP', String(streamError.message || streamError))); return; }
          const chunks = [];
          let bytes = 0;
          stream.on('data', chunk => {
            bytes += chunk.length;
            if (bytes > MAX_ASSET_BYTES) stream.destroy(fail('ENTRY_TOO_LARGE', 'Package file exceeds 200 MB.'));
            else chunks.push(chunk);
          });
          stream.on('error', error => finish(error.code ? error : fail('INVALID_ZIP', String(error.message || error))));
          stream.on('end', () => {
            entries.set(name, Buffer.concat(chunks));
            zip.readEntry();
          });
        });
      });
      zip.readEntry();
    });
  });
}

function parseJsonEntry(entries, name) {
  const data = entries.get(name);
  if (!data) throw fail('MISSING_ENTRY', 'Show package is missing ' + name + '.');
  if (data.length > MAX_SHOW_BYTES) throw fail('JSON_TOO_LARGE', name + ' exceeds 25 MB.');
  try { return JSON.parse(data.toString('utf8')); }
  catch (_) { throw fail('INVALID_JSON', 'Invalid JSON in ' + name + '.'); }
}

function verifyComponent(entries, component, expectedPath) {
  if (!component || component.path !== expectedPath || !/^[a-f0-9]{64}$/.test(String(component.sha256 || ''))) {
    throw fail('INVALID_MANIFEST', 'Invalid package component: ' + expectedPath);
  }
  const data = entries.get(expectedPath);
  if (!data) throw fail('MISSING_ENTRY', 'Show package is missing ' + expectedPath + '.');
  if (sha256(data) !== component.sha256) throw fail('CHECKSUM_MISMATCH', expectedPath + ' checksum does not match.');
  if (Number(component.bytes) !== data.length) throw fail('ASSET_SIZE_MISMATCH', expectedPath + ' size does not match.');
  return parseJsonEntry(entries, expectedPath);
}

function validateShowPackageEntries(entries, { existingShowIds = [], existingTemplateIds = [] } = {}) {
  if (!(entries instanceof Map)) throw fail('INVALID_PACKAGE', 'Package entries are invalid.');
  const manifest = parseJsonEntry(entries, 'manifest.json');
  if (manifest.format !== FORMAT && !LEGACY_FORMATS.has(manifest.format)) throw fail('INVALID_FORMAT', 'Not a ShowSlate show package.');
  if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION) throw fail('UNSUPPORTED_SCHEMA', 'Unsupported show package schema version.');
  if (!manifest.show || manifest.show.path !== 'show.json' || !/^[a-f0-9]{64}$/.test(String(manifest.show.sha256 || ''))) {
    throw fail('INVALID_MANIFEST', 'Show manifest entry is invalid.');
  }
  const components = manifest.components || {};
  const document = verifyComponent(entries, components.show, 'show.json');
  const rundown = verifyComponent(entries, components.rundown, 'rundown.json');
  const lowerThirds = verifyComponent(entries, components.lowerThirds, 'lower-thirds.json');
  const screenContent = verifyComponent(entries, components.screenContent, 'screen-content.json');
  if (sha256(entries.get('show.json')) !== manifest.show.sha256) throw fail('CHECKSUM_MISMATCH', 'Show checksum does not match.');
  const validated = validateShowDocument(document);
  if (!validated.ok) throw fail('INVALID_SHOW', 'Invalid show document: ' + validated.errors.slice(0, 3).join('; '));
  if (manifest.documentSchemaVersion !== validated.value.schemaVersion) {
    throw fail('UNSUPPORTED_SCHEMA', 'Show document schema does not match the package manifest.');
  }
  visit(validated.value, () => {});
  validateEmbeddedCollections(validated.value, { existingTemplateIds });
  if (String(manifest.show.id || '') !== String(validated.value.show.id) || String(manifest.show.name || '') !== String(validated.value.show.name)) {
    throw fail('INVALID_MANIFEST', 'Manifest show identity does not match show.json.');
  }
  if (existingShowIds.map(String).includes(String(validated.value.show.id))) {
    throw fail('DUPLICATE_SHOW_ID', 'A show with this ID already exists.');
  }
  if (JSON.stringify(rundown) !== JSON.stringify(validated.value.show.rundown)
      || JSON.stringify(lowerThirds) !== JSON.stringify(validated.value.show.lowerThird)
      || JSON.stringify(screenContent) !== JSON.stringify(validated.value.show.screenContent)) {
    throw fail('COMPONENT_MISMATCH', 'Package component files do not match show.json.');
  }

  const declared = new Set(['manifest.json', 'show.json', 'rundown.json', 'lower-thirds.json', 'screen-content.json']);
  const sourceMap = new Map();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const asset of assets) {
    const packagePath = String(asset && asset.path || '');
    const source = String(asset && asset.source || '');
    if (!safePackagePath(packagePath) || !packagePath.startsWith('assets/')) throw fail('UNSAFE_PATH', 'Unsafe asset path in manifest.');
    if (!safeMediaFilename(source)) throw fail('UNSAFE_ASSET_REFERENCE', 'Unsafe source asset reference in manifest.');
    if (declared.has(packagePath) || sourceMap.has(source)) throw fail('DUPLICATE_ASSET', 'Duplicate asset declaration in manifest.');
    const data = entries.get(packagePath);
    if (!data) throw fail('MISSING_ASSET', 'Show package is missing a declared asset.');
    if (!/^[a-f0-9]{64}$/.test(String(asset.sha256 || '')) || sha256(data) !== asset.sha256) throw fail('CHECKSUM_MISMATCH', 'Asset checksum does not match.');
    if (Number(asset.bytes) !== data.length || data.length > MAX_ASSET_BYTES) throw fail('ASSET_SIZE_MISMATCH', 'Asset size does not match the manifest.');
    const ext = path.extname(packagePath).toLowerCase();
    if (!MIME_BY_EXT[ext] || MIME_BY_EXT[ext] !== asset.mime) throw fail('UNSUPPORTED_ASSET', 'Unsupported asset type in show package.');
    declared.add(packagePath);
    sourceMap.set(source, { source, packagePath, data, ext, mime: asset.mime, sha256: asset.sha256 });
  }
  for (const name of entries.keys()) if (!declared.has(name)) throw fail('UNDECLARED_ENTRY', 'Show package contains an undeclared file: ' + name);
  const used = new Set(collectMediaReferences(validated.value).map(reference => reference.source));
  for (const source of used) if (!sourceMap.has(source)) throw fail('MISSING_ASSET', 'Show references an asset not declared in the package: ' + source);
  for (const source of sourceMap.keys()) if (!used.has(source)) throw fail('UNUSED_ASSET', 'Show package contains an unused asset: ' + source);
  return { manifest, document: validated.value, assets: [...sourceMap.values()], warnings: Array.isArray(manifest.warnings) ? manifest.warnings.map(String) : [] };
}

function rewriteMediaReferences(value, replacements) {
  if (typeof value === 'string') return replacements.get(value) || value;
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(item => rewriteMediaReferences(item, replacements));
  const out = {};
  for (const [key, item] of Object.entries(value)) out[key] = rewriteMediaReferences(item, replacements);
  return out;
}

function installPackageAssets(prepared, mediaDirectory) {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const replacements = new Map();
  const plans = prepared.assets.map(asset => {
    const filename = crypto.createHash('sha1').update(asset.data).digest('hex').slice(0, 16) + asset.ext;
    replacements.set(asset.source, 'media://' + filename);
    return { asset, filename, destination: path.join(mediaDirectory, filename), temp: null, created: false };
  });
  const imported = rewriteMediaReferences(prepared.document, replacements);
  const validated = validateShowDocument(imported);
  if (!validated.ok) throw fail('INVALID_SHOW', 'Imported show is invalid after media installation.');
  validateEmbeddedCollections(validated.value);
  try {
    for (const plan of plans) {
      if (fs.existsSync(plan.destination)) {
        if (sha256(fs.readFileSync(plan.destination)) !== plan.asset.sha256) throw fail('MEDIA_COLLISION', 'Existing media file does not match imported content.');
        continue;
      }
      plan.temp = path.join(mediaDirectory, '.show-import-' + crypto.randomBytes(8).toString('hex') + '.tmp');
      fs.writeFileSync(plan.temp, plan.asset.data, { flag: 'wx' });
    }
    for (const plan of plans) {
      if (!plan.temp) continue;
      fs.renameSync(plan.temp, plan.destination);
      plan.temp = null;
      plan.created = true;
    }
  } catch (error) {
    plans.forEach(plan => {
      if (plan.temp) { try { fs.rmSync(plan.temp, { force: true }); } catch (_) {} }
      if (plan.created) { try { fs.rmSync(plan.destination, { force: true }); } catch (_) {} }
    });
    throw error;
  }
  return validated.value;
}

async function importShowPackage({ packagePath, mediaDirectory, existingShowIds = [], existingTemplateIds = [] }) {
  const entries = await readZipEntries(packagePath);
  const prepared = validateShowPackageEntries(entries, { existingShowIds, existingTemplateIds });
  const document = installPackageAssets(prepared, mediaDirectory);
  return { ok: true, document, manifest: prepared.manifest, assets: prepared.assets.length, warnings: prepared.warnings };
}

module.exports = {
  FORMAT,
  LEGACY_FORMATS,
  PACKAGE_SCHEMA_VERSION,
  MAX_PACKAGE_BYTES,
  MAX_ASSET_BYTES,
  MIME_BY_EXT,
  sha256,
  safePackagePath,
  safeMediaFilename,
  collectMediaReferences,
  validateEmbeddedCollections,
  exportShowPackage,
  readZipEntries,
  validateShowPackageEntries,
  importShowPackage
};
