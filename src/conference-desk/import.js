'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const conference = require('./model.js');

const fsp = fs.promises;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
const DEFAULT_MAX_ASSET_BYTES = 200 * 1024 * 1024;
const DEFAULT_MAX_SCHEDULE_BYTES = 5 * 1024 * 1024;
const SCHEDULE_EXTENSIONS = new Set(['.csv', '.tsv', '.txt']);
const SCHEDULE_NAMES = ['rundown', 'schedule', 'run-of-show', 'run_of_show', 'show', 'agenda', 'program'];

function safeExtension(filename) {
  const extension = path.extname(String(filename || '')).toLocaleLowerCase();
  return /^\.[a-z0-9]{1,6}$/.test(extension) ? extension : '';
}

function scheduleRank(file) {
  const extension = safeExtension(file.name);
  const basename = path.basename(file.name, extension).toLocaleLowerCase();
  const named = SCHEDULE_NAMES.indexOf(basename);
  return (named >= 0 ? named : 100) * 10 + (extension === '.csv' ? 0 : extension === '.tsv' ? 1 : 2);
}

async function scanDirectory(rootDirectory, options = {}) {
  const root = await fsp.realpath(path.resolve(rootDirectory));
  const rootStat = await fsp.stat(root);
  if (!rootStat.isDirectory()) throw new Error('The selected show folder is not a directory.');
  const maxFiles = Math.max(1, Number(options.maxFiles) || DEFAULT_MAX_FILES);
  const configuredTotal = Number(options.maxTotalBytes);
  const maxTotalBytes = Number.isFinite(configuredTotal) && configuredTotal > 0
    ? configuredTotal
    : (configuredTotal === Number.POSITIVE_INFINITY ? configuredTotal : DEFAULT_MAX_TOTAL_BYTES);
  const files = [];
  const warnings = [];
  let totalBytes = 0;

  async function visit(directory) {
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === '__MACOSX') continue;
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        warnings.push(`Skipped symbolic link: ${path.relative(root, absolute)}`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      if (files.length >= maxFiles) throw new Error(`The show folder contains more than ${maxFiles} files.`);
      const stat = await fsp.stat(absolute);
      totalBytes += stat.size;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`The show folder is larger than the ${Math.round(maxTotalBytes / (1024 * 1024))} MB import limit.`);
      }
      files.push({
        absolute,
        name: entry.name,
        relativePath: path.relative(root, absolute).split(path.sep).join('/'),
        bytes: stat.size,
        extension: safeExtension(entry.name)
      });
    }
  }

  await visit(root);
  return { root, rootName: path.basename(root), files, warnings, totalBytes };
}

function hashFile(filename) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filename);
    stream.on('error', reject);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex').slice(0, 24)));
  });
}

async function importAsset(file, mediaDirectory, options = {}) {
  const kind = conference.mediaKind(file.name);
  if (!kind) return { ok: false, warning: '' };
  if (typeof options.importMediaFile === 'function') {
    const saved = await options.importMediaFile(file.absolute, { name: file.name });
    if (!saved || !saved.ok) {
      return { ok: false, warning: `Skipped ${file.relativePath}: ${(saved && saved.error) || 'media import failed'}.` };
    }
    return {
      ok: true,
      asset: {
        id: `asset-${String(saved.src || '').replace(/^media:\/\//, '').replace(/\.[^.]+$/, '')}`,
        name: file.name,
        relativePath: file.relativePath,
        bytes: Number(saved.bytes) || file.bytes,
        mime: String(saved.mime || ''),
        storage: String(saved.storage || 'managed'),
        portable: saved.portable !== false,
        kind,
        src: saved.src
      }
    };
  }
  const configuredMax = Number(options.maxAssetBytes);
  const maxBytes = Number.isFinite(configuredMax) && configuredMax > 0 ? configuredMax : DEFAULT_MAX_ASSET_BYTES;
  if (file.bytes > maxBytes) return { ok: false, warning: `Skipped ${file.relativePath}: file exceeds ${Math.round(maxBytes / (1024 * 1024))} MB.` };
  const hash = await hashFile(file.absolute);
  const extension = file.extension || '.bin';
  const filename = hash + extension;
  const destination = path.join(mediaDirectory, filename);
  await fsp.mkdir(mediaDirectory, { recursive: true });
  try {
    await fsp.copyFile(file.absolute, destination, fs.constants.COPYFILE_EXCL);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  return {
    ok: true,
    asset: {
      id: `asset-${hash}`,
      name: file.name,
      relativePath: file.relativePath,
      bytes: file.bytes,
      kind,
      src: `media://${filename}`
    }
  };
}

async function importShowFolder(options = {}) {
  if (!options.rootDirectory) throw new Error('rootDirectory is required');
  if (!options.mediaDirectory) throw new Error('mediaDirectory is required');
  const scanned = await scanDirectory(options.rootDirectory, options);
  const warnings = scanned.warnings.slice();
  const scheduleFiles = scanned.files.filter(file => SCHEDULE_EXTENSIONS.has(file.extension)).sort((a, b) => scheduleRank(a) - scheduleRank(b));
  const workbookFiles = scanned.files.filter(file => ['.xlsx', '.xls'].includes(file.extension));
  let schedule = null;
  if (scheduleFiles.length) {
    const selected = scheduleFiles[0];
    if (selected.bytes > (Number(options.maxScheduleBytes) || DEFAULT_MAX_SCHEDULE_BYTES)) {
      throw new Error('The schedule file is larger than the 5 MB import limit.');
    }
    schedule = {
      name: selected.name,
      relativePath: selected.relativePath,
      text: await fsp.readFile(selected.absolute, 'utf8')
    };
    if (scheduleFiles.length > 1) warnings.push(`Using ${selected.relativePath}; ${scheduleFiles.length - 1} other schedule file(s) were left untouched.`);
  } else if (workbookFiles.length) {
    warnings.push('Excel workbook found. Export its rundown sheet as CSV/TSV or paste the rows into ShowSlate.');
  } else {
    warnings.push('No CSV/TSV rundown was found. Paste the schedule after the folder import.');
  }

  const assets = [];
  for (const file of scanned.files) {
    const result = await importAsset(file, options.mediaDirectory, options);
    if (result.ok) assets.push(result.asset);
    else if (result.warning) warnings.push(result.warning);
  }

  return {
    ok: true,
    rootName: scanned.rootName,
    rootPath: scanned.root,
    schedule,
    assets,
    warnings,
    fileCount: scanned.files.length,
    totalBytes: scanned.totalBytes
  };
}

module.exports = {
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_TOTAL_BYTES,
  DEFAULT_MAX_ASSET_BYTES,
  DEFAULT_MAX_SCHEDULE_BYTES,
  scanDirectory,
  importShowFolder
};
