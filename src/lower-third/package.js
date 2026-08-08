const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const yauzl = require('yauzl');
const V = require('./validate.js');

const FORMAT = 'showslate-lt';
const LEGACY_FORMATS = new Set(['protimer-lt']);
const PACKAGE_SCHEMA_VERSION = 1;
const MAX_PACKAGE_BYTES = 512 * 1024 * 1024;
const MAX_ASSET_BYTES = 200 * 1024 * 1024;
const MAX_ENTRY_COUNT = 128;
const MAX_JSON_BYTES = 5 * 1024 * 1024;
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm'
};

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

function safePackagePath(value) {
  const name = String(value || '');
  if (!name || name.includes('\0') || name.includes('\\') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) return false;
  const parts = name.split('/');
  return parts.every(part => part && part !== '.' && part !== '..' && !/[\x00-\x1f]/.test(part));
}

function safeMediaFilename(assetId) {
  const match = /^media:\/\/([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/.exec(String(assetId || ''));
  if (!match) return null;
  const filename = match[1];
  const ext = path.extname(filename).toLowerCase();
  if (!MIME_BY_EXT[ext] || path.basename(filename) !== filename) return null;
  return filename;
}

function jsonBuffer(value) {
  return Buffer.from(JSON.stringify(value, null, 2) + '\n', 'utf8');
}

function validateTemplate(template) {
  const result = V.validateLowerThirdTemplate(template);
  if (!result.ok) throw fail('INVALID_TEMPLATE', 'Invalid lower-third template: ' + result.errors.slice(0, 3).join('; '));
  if (result.value.kind !== 'custom') throw fail('INVALID_TEMPLATE_KIND', 'Only custom lower-third templates can be packaged.');
  return result.value;
}

function templateAssets(template, mediaDirectory) {
  const bySource = new Map();
  for (const layer of template.layers || []) {
    if (!layer || (layer.type !== 'media' && layer.type !== 'logo')) continue;
    const source = layer.assetId || layer.src || '';
    const filename = safeMediaFilename(source);
    if (!filename) throw fail('UNSAFE_ASSET_REFERENCE', 'Template contains an unsupported or unsafe asset reference.');
    const full = path.resolve(mediaDirectory, filename);
    const mediaRoot = path.resolve(mediaDirectory) + path.sep;
    if (!full.startsWith(mediaRoot) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
      throw fail('MISSING_ASSET', 'Missing lower-third asset: ' + filename);
    }
    const bytes = fs.statSync(full).size;
    if (bytes > MAX_ASSET_BYTES) throw fail('ASSET_TOO_LARGE', 'Lower-third asset exceeds 200 MB: ' + filename);
    const existing = bySource.get(source) || { source, filename, full, layerIds: [] };
    existing.layerIds.push(layer.id);
    bySource.set(source, existing);
  }
  return [...bySource.values()];
}

function fontFallbacks(template) {
  const fonts = new Set((template.layers || [])
    .filter(layer => layer && (layer.type === 'dynamicText' || layer.type === 'staticText'))
    .map(layer => String(layer.fontFamily || '').trim())
    .filter(Boolean));
  return [...fonts].map(requested => ({ requested, fallback: '-apple-system, system-ui, sans-serif' }));
}

async function writeZip(destination, entries) {
  const parent = path.dirname(destination);
  fs.mkdirSync(parent, { recursive: true });
  const temp = path.join(parent, '.' + path.basename(destination) + '.' + process.pid + '.' + crypto.randomBytes(5).toString('hex') + '.tmp');
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
      for (const entry of entries) archive.append(entry.data, { name: entry.name });
      archive.finalize().catch(done);
    });
    fs.renameSync(temp, destination);
  } catch (error) {
    try { fs.rmSync(temp, { force: true }); } catch (e) {}
    throw error;
  }
}

async function exportLowerThirdPackage({ destination, template, mediaDirectory, appMetadata = {} }) {
  if (!destination || !String(destination).toLowerCase().endsWith('.showslate-lt')) {
    throw fail('INVALID_DESTINATION', 'Template package must use the .showslate-lt extension.');
  }
  const cleanTemplate = validateTemplate(template);
  const templateData = jsonBuffer(cleanTemplate);
  const assets = templateAssets(cleanTemplate, mediaDirectory).map(asset => {
    const data = fs.readFileSync(asset.full);
    const ext = path.extname(asset.filename).toLowerCase();
    const checksum = sha256(data);
    return {
      ...asset,
      data,
      packagePath: 'assets/' + checksum.slice(0, 24) + ext,
      sha256: checksum,
      bytes: data.length,
      mime: MIME_BY_EXT[ext]
    };
  });
  const manifest = {
    format: FORMAT,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    app: {
      name: 'ShowSlate',
      version: String(appMetadata.version || ''),
      commit: String(appMetadata.commit || '')
    },
    template: {
      id: cleanTemplate.id,
      name: cleanTemplate.name,
      path: 'template.json',
      sha256: sha256(templateData)
    },
    assets: assets.map(asset => ({
      source: asset.source,
      path: asset.packagePath,
      sha256: asset.sha256,
      bytes: asset.bytes,
      mime: asset.mime,
      layerIds: asset.layerIds
    })),
    fontFallbacks: fontFallbacks(cleanTemplate)
  };
  const entries = [
    { name: 'manifest.json', data: jsonBuffer(manifest) },
    { name: 'template.json', data: templateData },
    ...assets.map(asset => ({ name: asset.packagePath, data: asset.data }))
  ];
  await writeZip(destination, entries);
  return { ok: true, path: destination, templateId: cleanTemplate.id, assets: assets.length, bytes: fs.statSync(destination).size };
}

function readZipEntries(packagePath) {
  const stat = fs.statSync(packagePath);
  if (!stat.isFile()) return Promise.reject(fail('INVALID_PACKAGE', 'Template package is not a file.'));
  if (stat.size > MAX_PACKAGE_BYTES) return Promise.reject(fail('PACKAGE_TOO_LARGE', 'Template package exceeds 512 MB.'));
  return new Promise((resolve, reject) => {
    yauzl.open(packagePath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true, autoClose: true }, (openError, zip) => {
      if (openError) { reject(fail('INVALID_ZIP', 'Cannot open template package.')); return; }
      const entries = new Map();
      let count = 0;
      let total = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        try { zip.close(); } catch (e) {}
        if (error) reject(error); else resolve(value);
      };
      zip.on('error', error => finish(fail('INVALID_ZIP', String(error.message || error))));
      zip.on('end', () => finish(null, entries));
      zip.on('entry', entry => {
        const name = String(entry.fileName || '');
        if (++count > MAX_ENTRY_COUNT) { finish(fail('TOO_MANY_ENTRIES', 'Template package contains too many files.')); return; }
        if (!safePackagePath(name)) { finish(fail('UNSAFE_PATH', 'Unsafe path in template package: ' + name)); return; }
        if (entries.has(name)) { finish(fail('DUPLICATE_ENTRY', 'Duplicate file in template package: ' + name)); return; }
        if (entry.generalPurposeBitFlag & 0x1) { finish(fail('ENCRYPTED_ENTRY', 'Encrypted template packages are not supported.')); return; }
        if (entry.uncompressedSize > MAX_ASSET_BYTES || total + entry.uncompressedSize > MAX_PACKAGE_BYTES) {
          finish(fail('PACKAGE_TOO_LARGE', 'Template package expands beyond the allowed size.'));
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
  if (!data) throw fail('MISSING_ENTRY', 'Template package is missing ' + name + '.');
  if (data.length > MAX_JSON_BYTES) throw fail('JSON_TOO_LARGE', name + ' exceeds 5 MB.');
  try { return JSON.parse(data.toString('utf8')); }
  catch (e) { throw fail('INVALID_JSON', 'Invalid JSON in ' + name + '.'); }
}

function validateLowerThirdPackageEntries(entries, { existingTemplateIds = [] } = {}) {
  if (!(entries instanceof Map)) throw fail('INVALID_PACKAGE', 'Package entries are invalid.');
  const manifest = parseJsonEntry(entries, 'manifest.json');
  if (manifest.format !== FORMAT && !LEGACY_FORMATS.has(manifest.format)) throw fail('INVALID_FORMAT', 'Not a ShowSlate lower-third package.');
  if (manifest.schemaVersion !== PACKAGE_SCHEMA_VERSION) throw fail('UNSUPPORTED_SCHEMA', 'Unsupported lower-third package schema version.');
  if (!manifest.template || manifest.template.path !== 'template.json' || !/^[a-f0-9]{64}$/.test(String(manifest.template.sha256 || ''))) {
    throw fail('INVALID_MANIFEST', 'Template manifest entry is invalid.');
  }
  const templateData = entries.get('template.json');
  if (!templateData || sha256(templateData) !== manifest.template.sha256) throw fail('CHECKSUM_MISMATCH', 'Template checksum does not match.');
  const template = validateTemplate(parseJsonEntry(entries, 'template.json'));
  if (String(manifest.template.id || '') !== String(template.id)) throw fail('INVALID_MANIFEST', 'Manifest template ID does not match template.json.');
  if (existingTemplateIds.map(String).includes(String(template.id))) throw fail('DUPLICATE_TEMPLATE_ID', 'A template with this ID already exists.');

  const declared = new Set(['manifest.json', 'template.json']);
  const sourceMap = new Map();
  const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
  for (const asset of assets) {
    const packagePath = String(asset && asset.path || '');
    const source = String(asset && asset.source || '');
    if (!safePackagePath(packagePath) || !packagePath.startsWith('assets/')) throw fail('UNSAFE_PATH', 'Unsafe asset path in manifest.');
    if (!safeMediaFilename(source)) throw fail('UNSAFE_ASSET_REFERENCE', 'Unsafe source asset reference in manifest.');
    if (declared.has(packagePath) || sourceMap.has(source)) throw fail('DUPLICATE_ASSET', 'Duplicate asset declaration in manifest.');
    const data = entries.get(packagePath);
    if (!data) throw fail('MISSING_ASSET', 'Template package is missing a declared asset.');
    if (!/^[a-f0-9]{64}$/.test(String(asset.sha256 || '')) || sha256(data) !== asset.sha256) throw fail('CHECKSUM_MISMATCH', 'Asset checksum does not match.');
    if (Number(asset.bytes) !== data.length || data.length > MAX_ASSET_BYTES) throw fail('ASSET_SIZE_MISMATCH', 'Asset size does not match the manifest.');
    const ext = path.extname(packagePath).toLowerCase();
    if (!MIME_BY_EXT[ext] || MIME_BY_EXT[ext] !== asset.mime) throw fail('UNSUPPORTED_ASSET', 'Unsupported asset type in template package.');
    declared.add(packagePath);
    sourceMap.set(source, { source, packagePath, data, ext, mime: asset.mime, sha256: asset.sha256 });
  }
  for (const name of entries.keys()) if (!declared.has(name)) throw fail('UNDECLARED_ENTRY', 'Template package contains an undeclared file: ' + name);

  const usedSources = new Set();
  for (const layer of template.layers || []) {
    if (!layer || (layer.type !== 'media' && layer.type !== 'logo')) continue;
    const source = layer.assetId || layer.src || '';
    if (!sourceMap.has(source)) throw fail('MISSING_ASSET', 'Template references an asset not declared in the package.');
    usedSources.add(source);
  }
  for (const source of sourceMap.keys()) if (!usedSources.has(source)) throw fail('UNUSED_ASSET', 'Template package contains an unused asset.');
  return { manifest, template, assets: [...sourceMap.values()] };
}

function installPackageAssets(prepared, mediaDirectory) {
  fs.mkdirSync(mediaDirectory, { recursive: true });
  const replacements = new Map();
  const plans = prepared.assets.map(asset => {
    const filename = crypto.createHash('sha1').update(asset.data).digest('hex').slice(0, 16) + asset.ext;
    replacements.set(asset.source, 'media://' + filename);
    return { asset, filename, destination: path.join(mediaDirectory, filename), temp: null, created: false };
  });
  const imported = JSON.parse(JSON.stringify(prepared.template));
  for (const layer of imported.layers || []) {
    if (!layer || (layer.type !== 'media' && layer.type !== 'logo')) continue;
    const source = layer.assetId || layer.src || '';
    const replacement = replacements.get(source);
    if (replacement) {
      layer.assetId = replacement;
      if (Object.prototype.hasOwnProperty.call(layer, 'src')) delete layer.src;
    }
  }
  const cleanImported = validateTemplate(imported);
  try {
    for (const plan of plans) {
      if (!fs.existsSync(plan.destination)) {
        plan.temp = path.join(mediaDirectory, '.lt-import-' + crypto.randomBytes(8).toString('hex') + '.tmp');
        fs.writeFileSync(plan.temp, plan.asset.data, { flag: 'wx' });
      }
    }
    for (const plan of plans) {
      if (plan.temp) {
        fs.renameSync(plan.temp, plan.destination);
        plan.temp = null;
        plan.created = true;
      }
    }
  } catch (error) {
    plans.forEach(plan => {
      if (plan.temp) { try { fs.rmSync(plan.temp, { force: true }); } catch (e) {} }
      if (plan.created) { try { fs.rmSync(plan.destination, { force: true }); } catch (e) {} }
    });
    throw error;
  }
  return cleanImported;
}

async function importLowerThirdPackage({ packagePath, mediaDirectory, existingTemplateIds = [] }) {
  const entries = await readZipEntries(packagePath);
  const prepared = validateLowerThirdPackageEntries(entries, { existingTemplateIds });
  const template = installPackageAssets(prepared, mediaDirectory);
  return { ok: true, template, manifest: prepared.manifest, assets: prepared.assets.length };
}

module.exports = {
  FORMAT,
  LEGACY_FORMATS,
  PACKAGE_SCHEMA_VERSION,
  MAX_PACKAGE_BYTES,
  MAX_ASSET_BYTES,
  sha256,
  safePackagePath,
  exportLowerThirdPackage,
  readZipEntries,
  validateLowerThirdPackageEntries,
  importLowerThirdPackage
};
