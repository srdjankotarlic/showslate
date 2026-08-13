'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const fsp = fs.promises;
const DEFAULT_MANAGED_COPY_MAX_BYTES = 512 * 1024 * 1024;
const SUPPORTED_MEDIA_MIME = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.pdf': 'application/pdf'
});

function safeExtension(filename) {
  const extension = path.extname(String(filename || '')).toLowerCase();
  return Object.prototype.hasOwnProperty.call(SUPPORTED_MEDIA_MIME, extension) ? extension : '';
}

function safeMediaId(value) {
  const name = path.basename(String(value || ''));
  if (!name || name !== String(value || '') || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name)) return '';
  return safeExtension(name) ? name : '';
}

function mediaFingerprint(realPath, stat) {
  return crypto.createHash('sha256')
    .update(realPath)
    .update('\0')
    .update(String(stat.size))
    .update('\0')
    .update(String(stat.mtimeMs))
    .digest('hex')
    .slice(0, 24);
}

async function availableBytes(directory) {
  if (typeof fsp.statfs !== 'function') return Number.POSITIVE_INFINITY;
  try {
    const stat = await fsp.statfs(directory, { bigint: true });
    const available = stat.bavail * stat.bsize;
    return available > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(available);
  } catch (_) {
    return Number.POSITIVE_INFINITY;
  }
}

class MediaLibrary {
  constructor(options = {}) {
    if (!options.mediaDirectory) throw new Error('mediaDirectory is required');
    this.mediaDirectory = path.resolve(options.mediaDirectory);
    this.registryPath = path.resolve(options.registryPath || path.join(this.mediaDirectory, '.library.json'));
    this.managedCopyMaxBytes = Number.isFinite(Number(options.managedCopyMaxBytes))
      ? Math.max(0, Number(options.managedCopyMaxBytes))
      : DEFAULT_MANAGED_COPY_MAX_BYTES;
    this.reserveBytes = Number.isFinite(Number(options.reserveBytes))
      ? Math.max(0, Number(options.reserveBytes))
      : 256 * 1024 * 1024;
    this.entries = new Map();
    fs.mkdirSync(this.mediaDirectory, { recursive: true });
    this.loadRegistry();
  }

  loadRegistry() {
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(this.registryPath, 'utf8')); } catch (_) {}
    const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
    this.entries.clear();
    entries.forEach(entry => {
      const id = safeMediaId(entry && entry.id);
      const sourcePath = String(entry && entry.sourcePath || '');
      if (!id || !path.isAbsolute(sourcePath)) return;
      this.entries.set(id, {
        id,
        sourcePath,
        originalName: String(entry.originalName || path.basename(sourcePath)).slice(0, 512),
        bytes: Math.max(0, Number(entry.bytes) || 0),
        mtimeMs: Math.max(0, Number(entry.mtimeMs) || 0),
        mime: SUPPORTED_MEDIA_MIME[safeExtension(id)],
        linkedAt: String(entry.linkedAt || '')
      });
    });
  }

  saveRegistry() {
    fs.mkdirSync(path.dirname(this.registryPath), { recursive: true });
    const temp = this.registryPath + '.' + process.pid + '.' + crypto.randomBytes(5).toString('hex') + '.tmp';
    const payload = JSON.stringify({ schemaVersion: 1, entries: [...this.entries.values()] }, null, 2) + '\n';
    try {
      fs.writeFileSync(temp, payload, { flag: 'wx', mode: 0o600 });
      fs.renameSync(temp, this.registryPath);
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch (_) {}
      throw error;
    }
  }

  async importFile(sourcePath, options = {}) {
    const requested = String(sourcePath || '');
    if (!requested || !path.isAbsolute(requested)) {
      return { ok: false, code: 'MEDIA_PATH_REQUIRED', error: 'Select a local file from disk.' };
    }
    let realPath;
    let stat;
    try {
      realPath = await fsp.realpath(requested);
      stat = await fsp.stat(realPath);
    } catch (error) {
      return { ok: false, code: 'MEDIA_NOT_FOUND', error: 'The selected media file is no longer available.' };
    }
    if (!stat.isFile()) return { ok: false, code: 'MEDIA_NOT_FILE', error: 'The selected media source is not a file.' };
    const originalName = String(options.name || path.basename(realPath));
    const extension = safeExtension(originalName) || safeExtension(realPath);
    if (!extension) {
      return { ok: false, code: 'MEDIA_UNSUPPORTED', error: 'This media format is not supported by ShowSlate.' };
    }

    const id = mediaFingerprint(realPath, stat) + extension;
    const destination = path.join(this.mediaDirectory, id);
    const insideLibrary = realPath === destination || realPath.startsWith(this.mediaDirectory + path.sep);
    const free = await availableBytes(this.mediaDirectory);
    const forceLinked = options.storage === 'linked';
    const forceManaged = options.storage === 'managed';
    const shouldLink = !insideLibrary && !forceManaged && (
      forceLinked || stat.size > this.managedCopyMaxBytes || free < stat.size + this.reserveBytes
    );

    const existingManagedId = insideLibrary ? safeMediaId(path.basename(realPath)) : '';
    if (existingManagedId) {
      return {
        ok: true,
        src: 'media://' + existingManagedId,
        bytes: stat.size,
        mime: SUPPORTED_MEDIA_MIME[extension],
        storage: 'managed',
        portable: true,
        originalName
      };
    }

    if (shouldLink) {
      this.entries.set(id, {
        id,
        sourcePath: realPath,
        originalName: originalName.slice(0, 512),
        bytes: stat.size,
        mtimeMs: stat.mtimeMs,
        mime: SUPPORTED_MEDIA_MIME[extension],
        linkedAt: new Date().toISOString()
      });
      this.saveRegistry();
      return {
        ok: true,
        src: 'media://' + id,
        bytes: stat.size,
        mime: SUPPORTED_MEDIA_MIME[extension],
        storage: 'linked',
        portable: false,
        originalName
      };
    }

    if (!fs.existsSync(destination)) {
      const temp = path.join(this.mediaDirectory, '.import-' + crypto.randomBytes(10).toString('hex') + '.tmp');
      try {
        try {
          await fsp.copyFile(realPath, temp, fs.constants.COPYFILE_FICLONE || 0);
        } catch (error) {
          if (error.code !== 'ENOTSUP' && error.code !== 'EINVAL' && error.code !== 'EXDEV') throw error;
          await fsp.copyFile(realPath, temp);
        }
        const copied = await fsp.stat(temp);
        if (copied.size !== stat.size) throw new Error('Media copy size does not match the source file.');
        await fsp.rename(temp, destination);
      } catch (error) {
        try { await fsp.rm(temp, { force: true }); } catch (_) {}
        return { ok: false, code: 'MEDIA_COPY_FAILED', error: String(error.message || error) };
      }
    }

    this.entries.delete(id);
    this.saveRegistry();
    return {
      ok: true,
      src: 'media://' + id,
      bytes: stat.size,
      mime: SUPPORTED_MEDIA_MIME[extension],
      storage: 'managed',
      portable: true,
      originalName
    };
  }

  inspect(idOrSource) {
    const raw = String(idOrSource || '').replace(/^media:\/\//, '');
    const id = safeMediaId(raw);
    if (!id) return { ok: false, found: false, code: 'MEDIA_ID_INVALID' };
    const managedPath = path.join(this.mediaDirectory, id);
    try {
      const stat = fs.statSync(managedPath);
      if (stat.isFile()) return { ok: true, found: true, id, path: managedPath, bytes: stat.size, mime: SUPPORTED_MEDIA_MIME[safeExtension(id)], storage: 'managed', portable: true };
    } catch (_) {}
    const entry = this.entries.get(id);
    if (!entry) return { ok: false, found: false, id, code: 'MEDIA_NOT_FOUND' };
    try {
      const stat = fs.statSync(entry.sourcePath);
      if (!stat.isFile()) throw new Error('not a file');
      return {
        ok: true,
        found: true,
        id,
        path: entry.sourcePath,
        bytes: stat.size,
        mime: entry.mime || SUPPORTED_MEDIA_MIME[safeExtension(id)],
        storage: 'linked',
        portable: false,
        changed: stat.size !== entry.bytes || Math.abs(stat.mtimeMs - entry.mtimeMs) > 1
      };
    } catch (_) {
      return { ok: false, found: false, id, code: 'MEDIA_LINK_OFFLINE', storage: 'linked', portable: false, path: entry.sourcePath };
    }
  }

  resolve(idOrSource) {
    const inspected = this.inspect(idOrSource);
    return inspected.ok ? inspected.path : '';
  }
}

module.exports = {
  DEFAULT_MANAGED_COPY_MAX_BYTES,
  SUPPORTED_MEDIA_MIME,
  MediaLibrary,
  safeExtension,
  safeMediaId
};
