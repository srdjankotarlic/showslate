const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const fsp = fs.promises;
const SHOW_SCHEMA_VERSION = 1;
const SESSION_SCHEMA_VERSION = 1;
const MAX_SHOW_BYTES = 25 * 1024 * 1024;
const FORBIDDEN_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function finiteNumber(value, fallback, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function safeClone(value, depth = 0) {
  if (depth > 40) throw new Error('show document exceeds maximum depth');
  if (value == null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (Array.isArray(value)) {
    if (value.length > 10000) throw new Error('show document array is too large');
    return value.map((item) => safeClone(item, depth + 1));
  }
  if (!isRecord(value)) return null;
  const out = {};
  const entries = Object.entries(value);
  if (entries.length > 20000) throw new Error('show document object is too large');
  for (const [key, item] of entries) {
    if (FORBIDDEN_KEYS.has(key)) continue;
    out[key] = safeClone(item, depth + 1);
  }
  return out;
}

function normalizeTimer(timer) {
  const source = isRecord(timer) ? timer : {};
  const mode = ['countdown', 'countup', 'clock'].includes(source.mode) ? source.mode : 'countdown';
  return {
    mode,
    durationMs: finiteNumber(source.durationMs, 600000, 1000, 24 * 60 * 60 * 1000),
    remainingMs: finiteNumber(source.remainingMs, 600000, -24 * 60 * 60 * 1000, 24 * 60 * 60 * 1000),
    elapsedMs: finiteNumber(source.elapsedMs, 0, 0, 24 * 60 * 60 * 1000),
    wasRunning: source.wasRunning === true,
    capturedAt: finiteNumber(source.capturedAt, Date.now(), 0),
    yellowSec: finiteNumber(source.yellowSec, 120, 0, 24 * 60 * 60),
    redSec: finiteNumber(source.redSec, 60, 0, 24 * 60 * 60),
    overtime: source.overtime !== false
  };
}

function validateShowDocument(input) {
  const errors = [];
  let source;
  try { source = safeClone(input); }
  catch (error) { return { ok: false, value: null, errors: [String(error.message || error)] }; }
  if (!isRecord(source)) return { ok: false, value: null, errors: ['show document must be an object'] };
  if (source.schemaVersion !== SHOW_SCHEMA_VERSION) errors.push('unsupported show schemaVersion');
  if (!isRecord(source.show)) errors.push('show payload is required');
  const show = isRecord(source.show) ? source.show : {};
  const rundown = Array.isArray(show.rundown) ? show.rundown : [];
  if (!Array.isArray(show.rundown)) errors.push('show.rundown must be an array');
  if (rundown.length > 5000) errors.push('show.rundown exceeds 5000 cues');
  const selectedCue = Math.trunc(finiteNumber(show.selectedCue, -1, -1, rundown.length - 1));
  const liveCue = Math.trunc(finiteNumber(show.liveCue, -1, -1, rundown.length - 1));
  const value = {
    ...source,
    schemaVersion: SHOW_SCHEMA_VERSION,
    savedAt: typeof source.savedAt === 'string' ? source.savedAt : '',
    app: isRecord(source.app) ? source.app : {},
    show: {
      ...show,
      id: String(show.id || 'show-current').slice(0, 160),
      name: String(show.name || 'Untitled show').slice(0, 160),
      details: isRecord(show.details) ? show.details : {},
      rundown,
      selectedCue,
      liveCue,
      timer: normalizeTimer(show.timer),
      actualTimes: Array.isArray(show.actualTimes) ? show.actualTimes : [],
      message: isRecord(show.message) ? show.message : { text: '', flash: false },
      lowerThird: isRecord(show.lowerThird) ? show.lowerThird : {},
      screenContent: isRecord(show.screenContent) ? show.screenContent : {},
      branding: isRecord(show.branding) ? show.branding : {},
      outputs: isRecord(show.outputs) ? show.outputs : {},
      preferences: isRecord(show.preferences) ? show.preferences : {}
    }
  };
  return { ok: errors.length === 0, value, errors };
}

async function exists(file) {
  try { await fsp.access(file); return true; }
  catch (_) { return false; }
}

async function readJsonFile(file, maxBytes = MAX_SHOW_BYTES) {
  const stat = await fsp.stat(file);
  if (!stat.isFile()) throw new Error('not a file');
  if (stat.size > maxBytes) throw new Error('file exceeds maximum size');
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fsp.open(directory, 'r');
    await handle.sync();
  } catch (_) {
    // Directory fsync is not available on every platform/filesystem.
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
}

async function atomicWrite(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const temp = file + '.tmp-' + process.pid + '-' + crypto.randomBytes(6).toString('hex');
  let handle;
  try {
    handle = await fsp.open(temp, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await fsp.rename(temp, file);
    await syncDirectory(path.dirname(file));
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsp.unlink(temp).catch(() => {});
    throw error;
  }
}

function safeTimestamp(now) {
  return new Date(now).toISOString().replace(/[:.]/g, '-');
}

class ShowRepository {
  constructor(options = {}) {
    if (!options.userDataDir) throw new Error('userDataDir is required');
    this.userDataDir = path.resolve(options.userDataDir);
    this.directory = path.join(this.userDataDir, 'shows');
    this.backupDirectory = path.join(this.directory, 'backups');
    this.currentFile = path.join(this.directory, 'current-show.json');
    this.sessionFile = path.join(this.directory, 'session.json');
    this.maxBackups = Math.max(1, Math.min(50, Number(options.maxBackups) || 10));
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.appMetadata = isRecord(options.appMetadata) ? safeClone(options.appMetadata) : {};
    this.session = null;
    this.currentDocument = null;
    this.priorRecovery = { available: false };
    this.trackSession = false;
  }

  async cleanupTemps() {
    await fsp.mkdir(this.directory, { recursive: true });
    const names = await fsp.readdir(this.directory).catch(() => []);
    await Promise.all(names.filter((name) => name.includes('.tmp-')).map((name) => fsp.unlink(path.join(this.directory, name)).catch(() => {})));
  }

  async readValidated(file) {
    try {
      const parsed = await readJsonFile(file);
      const result = validateShowDocument(parsed);
      if (!result.ok) return { ok: false, document: null, errors: result.errors };
      return { ok: true, document: result.value, errors: [] };
    } catch (error) {
      return { ok: false, document: null, errors: [String(error.message || error)] };
    }
  }

  async readCurrent() {
    return this.readValidated(this.currentFile);
  }

  async initializeSession({ track = true } = {}) {
    await this.cleanupTemps();
    await fsp.mkdir(this.backupDirectory, { recursive: true });
    let priorMarker = null;
    try { priorMarker = await readJsonFile(this.sessionFile, 1024 * 1024); }
    catch (_) {}
    const crashed = isRecord(priorMarker) && priorMarker.clean === false;
    const current = await this.readCurrent();
    this.currentDocument = current.ok ? current.document : null;
    let baseline = { ok: false, document: null, errors: [] };
    let priorBaselineFile = '';
    if (crashed && typeof priorMarker.baselineFile === 'string' && path.basename(priorMarker.baselineFile) === priorMarker.baselineFile) {
      priorBaselineFile = path.join(this.directory, priorMarker.baselineFile);
      baseline = await this.readValidated(priorBaselineFile);
    }
    this.priorRecovery = {
      available: crashed && (current.ok || baseline.ok),
      crashed,
      sessionId: crashed ? String(priorMarker.sessionId || '') : '',
      startedAt: crashed ? String(priorMarker.startedAt || '') : '',
      autosaveDocument: crashed && current.ok ? current.document : null,
      baselineDocument: crashed && baseline.ok ? baseline.document : null,
      priorBaselineFile
    };
    this.trackSession = !!track;
    if (this.trackSession) {
      const startedAt = new Date(this.now()).toISOString();
      const sessionId = crypto.randomBytes(10).toString('hex');
      let baselineFile = '';
      // Until recovery is resolved, another restart must retain the original
      // last-saved version instead of promoting the crash autosave to baseline.
      const sessionBaseline = crashed ? (baseline.ok ? baseline.document : null) : (current.ok ? current.document : null);
      if (sessionBaseline) {
        baselineFile = 'session-baseline-' + sessionId + '.json';
        await atomicWrite(path.join(this.directory, baselineFile), JSON.stringify(sessionBaseline, null, 2) + '\n');
      }
      this.session = { schemaVersion: SESSION_SCHEMA_VERSION, sessionId, pid: process.pid, startedAt, clean: false, baselineFile };
      await atomicWrite(this.sessionFile, JSON.stringify(this.session, null, 2) + '\n');
    }
    return this.getStatus();
  }

  getStatus() {
    const recover = this.priorRecovery || { available: false };
    return {
      ok: true,
      recoveryAvailable: !!recover.available,
      crashedSessionStartedAt: recover.startedAt || '',
      hasLastSaved: !!recover.baselineDocument,
      currentAvailable: !!(this.currentDocument || recover.autosaveDocument),
      sessionTracked: this.trackSession
    };
  }

  async save(input, { reason = 'change' } = {}) {
    const result = validateShowDocument(input);
    if (!result.ok) return { ok: false, error: result.errors.join('; '), errors: result.errors };
    const now = this.now();
    const document = {
      ...result.value,
      savedAt: new Date(now).toISOString(),
      app: { ...result.value.app, ...this.appMetadata }
    };
    const serialized = JSON.stringify(document, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > MAX_SHOW_BYTES) return { ok: false, error: 'show document exceeds 25 MB' };
    if (await exists(this.currentFile)) {
      const previous = await this.readValidated(this.currentFile);
      if (previous.ok) {
        const backupName = 'show-' + safeTimestamp(now) + '-' + crypto.randomBytes(3).toString('hex') + '.json';
        await atomicWrite(path.join(this.backupDirectory, backupName), JSON.stringify(previous.document, null, 2) + '\n');
      }
    }
    await atomicWrite(this.currentFile, serialized);
    this.currentDocument = document;
    await this.pruneBackups();
    return { ok: true, savedAt: document.savedAt, bytes: Buffer.byteLength(serialized), reason: String(reason || 'change') };
  }

  async listBackups() {
    const names = (await fsp.readdir(this.backupDirectory).catch(() => [])).filter((name) => /^show-[A-Za-z0-9-]+\.json$/.test(name));
    const rows = await Promise.all(names.map(async (name) => {
      const file = path.join(this.backupDirectory, name);
      const stat = await fsp.stat(file).catch(() => null);
      return stat ? { name, file, mtimeMs: stat.mtimeMs } : null;
    }));
    return rows.filter(Boolean).sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name));
  }

  async pruneBackups() {
    const backups = await this.listBackups();
    await Promise.all(backups.slice(this.maxBackups).map((backup) => fsp.unlink(backup.file).catch(() => {})));
  }

  async loadCurrent() {
    const current = await this.readCurrent();
    return current.ok ? { ok: true, document: current.document, source: 'current' } : { ok: false, error: current.errors.join('; ') || 'No saved show' };
  }

  async resolveRecovery(choice) {
    const recover = this.priorRecovery || { available: false };
    let document = null;
    let source = 'discard';
    if (choice === 'recover' && (recover.autosaveDocument || recover.baselineDocument)) {
      document = recover.autosaveDocument || recover.baselineDocument;
      source = recover.autosaveDocument ? 'autosave' : 'last-saved';
    } else if (choice === 'last-saved' && (recover.baselineDocument || recover.autosaveDocument)) {
      document = recover.baselineDocument || recover.autosaveDocument;
      source = recover.baselineDocument ? 'last-saved' : 'autosave';
    } else if (choice !== 'discard') {
      return { ok: false, error: 'Unknown recovery choice' };
    }
    if (this.trackSession && this.session) {
      try {
        const previousBaselineFile = this.session.baselineFile;
        const baselineFile = document ? (previousBaselineFile || 'session-baseline-' + this.session.sessionId + '.json') : '';
        if (document) await atomicWrite(path.join(this.directory, baselineFile), JSON.stringify(document, null, 2) + '\n');
        if (baselineFile !== previousBaselineFile) {
          const session = { ...this.session, baselineFile };
          await atomicWrite(this.sessionFile, JSON.stringify(session, null, 2) + '\n');
          this.session = session;
        }
        if (!baselineFile && previousBaselineFile) await fsp.unlink(path.join(this.directory, previousBaselineFile)).catch(() => {});
      } catch (error) {
        return { ok: false, error: String(error && error.message || error) };
      }
    }
    if (recover.priorBaselineFile) await fsp.unlink(recover.priorBaselineFile).catch(() => {});
    this.priorRecovery = { available: false };
    return { ok: true, document: document ? safeClone(document) : null, source };
  }

  async markClean() {
    if (!this.trackSession || !this.session) return { ok: true, skipped: true };
    this.session = { ...this.session, clean: true, endedAt: new Date(this.now()).toISOString() };
    await atomicWrite(this.sessionFile, JSON.stringify(this.session, null, 2) + '\n');
    if (this.session.baselineFile) await fsp.unlink(path.join(this.directory, this.session.baselineFile)).catch(() => {});
    return { ok: true };
  }
}

module.exports = {
  SHOW_SCHEMA_VERSION,
  MAX_SHOW_BYTES,
  ShowRepository,
  validateShowDocument,
  atomicWrite
};
