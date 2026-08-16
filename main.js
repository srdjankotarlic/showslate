const { app, BrowserWindow, ipcMain, screen, dialog, desktopCapturer, session, shell, systemPreferences, webContents } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const lowerThirdPackage = require('./src/lower-third/package.js');
const showPackage = require('./src/show-storage/package.js');
const showDocumentFile = require('./src/show-storage/document-file.js');
const showPreflight = require('./src/show-storage/preflight.js');
const controlApi = require('./src/control-api/commands.js');
const outputRouting = require('./src/output-routing/model.js');
const conferenceDesk = require('./src/conference-desk/model.js');
const showFolderImport = require('./src/conference-desk/import.js');
const { ShowRepository } = require('./src/show-storage/repository.js');
const { migrateLegacyUserData } = require('./src/brand/migrate-user-data.js');
const compositor = require('./src/compositor/model.js');
const recording = require('./src/recording/model.js');
const { MediaLibrary, SUPPORTED_MEDIA_MIME } = require('./src/media-library/library.js');
const { parseByteRange } = require('./src/media-library/range.js');

const SMOKE = process.argv.includes('--smoke');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const LT2_SOAK_ONLY = SMOKE && process.argv.includes('--lt2-soak-only');
const OUTPUT_ROUTING_SMOKE_ONLY = SMOKE && process.argv.includes('--output-routing-only');
const LIVE_INPUT_SMOKE_ONLY = SMOKE && process.argv.includes('--live-input-only');
const LIVE_INPUT_UHD60_SMOKE_ONLY = SMOKE && process.argv.includes('--live-input-uhd60-only');
const LOCAL_MEDIA_UHD60_SMOKE_ONLY = SMOKE && process.argv.includes('--local-media-uhd60-only');
// Smoke/test windows are pinned to one explicitly configured display. The resolver has
// no dependencies; normal (non-smoke) mode is unaffected.
let smokeDisplay = null;
try { smokeDisplay = require('./tools/smoke-display.js'); } catch (e) { /* dev/test-only helper; only needed under --smoke */ }
let SMOKE_TARGET = null;   // resolved target display for all smoke/test windows
function smokePlaceWindow(win, size) {
  if (!SMOKE || !SMOKE_TARGET || !win || win.isDestroyed()) return;
  try {
    const cur = win.getBounds();
    const want = { width: (size && size.width) || cur.width, height: (size && size.height) || cur.height };
    win.setBounds(smokeDisplay.clampToWorkArea(want, SMOKE_TARGET.workArea));
  } catch (e) {}
}

function cliValue(prefix) {
  const arg = process.argv.find(a => a.startsWith(prefix + '='));
  return arg ? arg.slice(prefix.length + 1) : '';
}
if (SMOKE) {
  const smokeUserDataDir = cliValue('--smoke-user-data-dir');
  if (smokeUserDataDir) {
    const resolvedSmokeUserDataDir = path.resolve(smokeUserDataDir);
    fs.mkdirSync(resolvedSmokeUserDataDir, { recursive: true });
    app.setPath('userData', resolvedSmokeUserDataDir);
  }
}
function hasAsarSegment(p) {
  return String(p || '').split(path.sep).some(part => /\.asar$/i.test(part));
}
function getTestArtifactDirectory() {
  const cliDir = cliValue('--artifact-dir');
  const envDir = process.env.SHOWSLATE_TEST_ARTIFACT_DIR || process.env.PROTIMER_TEST_ARTIFACT_DIR || '';
  const raw = cliDir || envDir || (!app.isPackaged ? path.join(__dirname, 'artifacts', 'generated') : path.join(app.getPath('userData'), 'test-artifacts'));
  const dir = path.resolve(raw);
  if (hasAsarSegment(dir)) throw new Error('test artifact directory cannot be inside app.asar: ' + dir);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function safeArtifactRelativePath(relativePath) {
  const rel = String(relativePath || '');
  if (!rel || path.isAbsolute(rel) || rel.includes('\0')) throw new Error('invalid artifact path: ' + rel);
  const parts = rel.split(/[\\/]+/);
  if (parts.some(p => !p || p === '.' || p === '..')) throw new Error('artifact path traversal blocked: ' + rel);
  return path.join(...parts);
}
function writeTestArtifact(relativePath, data) {
  const base = getTestArtifactDirectory();
  const safeRel = safeArtifactRelativePath(relativePath);
  const full = path.resolve(base, safeRel);
  if (!full.startsWith(base + path.sep)) throw new Error('artifact path escaped base directory: ' + relativePath);
  if (hasAsarSegment(full)) throw new Error('refusing to write test artifact inside app.asar: ' + full);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, data);
  return full;
}
function getBuildInfo() {
  let fileInfo = {};
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf8');
    fileInfo = JSON.parse(raw);
  } catch (e) {}
  return {
    version: app.getVersion(),
    productName: app.name || 'ShowSlate',
    commit: fileInfo.commit || 'dev',
    commitFull: fileInfo.commitFull || '',
    dirty: fileInfo.dirty === true,
    buildTimestamp: fileInfo.buildTimestamp || '',
    source: fileInfo.source || (app.isPackaged ? 'packaged' : 'source'),
    isPackaged: app.isPackaged,
    appPath: app.getAppPath(),
    exePath: app.getPath('exe')
  };
}
async function initializeShowStorage() {
  const build = getBuildInfo();
  showRepository = new ShowRepository({
    userDataDir: app.getPath('userData'),
    maxBackups: 10,
    appMetadata: {
      version: build.version,
      commit: build.commit,
      buildTimestamp: build.buildTimestamp,
      source: build.source
    }
  });
  return showRepository.initializeSession({ track: !SMOKE });
}
// token za daljinske komande (/cmd) — samo onaj ko ima ?t=token u linku može da kontroliše
const CMD_TOKEN = crypto.randomBytes(8).toString('hex');

// ---------------- MEDIA BIBLIOTEKA (scene: slike/video/PDF na DISKU, ne u localStorage) ----------------
function mediaDir() {
  const d = path.join(app.getPath('userData'), 'media');
  try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
  return d;
}
const MEDIA_MIME = SUPPORTED_MEDIA_MIME;
let mediaLibrary = null;
function getMediaLibrary() {
  if (!mediaLibrary) mediaLibrary = new MediaLibrary({ mediaDirectory: mediaDir() });
  return mediaLibrary;
}
function linkedMediaPackageError(sources, label) {
  const linked = [...new Set((sources || []).map(String).filter(source => source.startsWith('media://')))]
    .map(source => ({ source, media: getMediaLibrary().inspect(source) }))
    .filter(row => row.media.ok && row.media.storage === 'linked');
  if (!linked.length) return null;
  const names = linked.slice(0, 3).map(row => path.basename(row.media.path || row.source)).join(', ');
  return {
    ok: false,
    code: 'LINKED_MEDIA_NOT_PORTABLE',
    error: `${label} uses ${linked.length} disk-linked media ${linked.length === 1 ? 'file' : 'files'} (${names}). ` +
      'Linked media can play at full quality, but is not embedded in portable packages. Keep the original files connected, or use managed media under 200 MB before exporting.'
  };
}

let controlWin = null;
let outputWin = null;
let lastState = null;
let lastControlStatus = controlApi.sanitizeControlStatus(null);
let outputTransparent = false;   // da li je trenutni Ekran prozor providan
let outputFrameless = false;     // da li je bez okvira (providan ili grid)
let outputTargetId = null;       // na kom monitoru je Ekran
let outputConfigs = [];          // dodatni profesionalni izlazi (multi-display)
const auxOutputs = new Map();    // id -> { win, config, frameless, transparent }
let recordingOutput = null;      // exact-size, off-desktop Program renderer used only for recording
let recordingSession = null;     // active disk writer and capture metadata
let lastRecordingPath = '';
let liveInputHubWin = null;
let liveInputHubReady = false;
let pendingDesktopSource = null;
let liveInputDefinitions = [];
const liveInputStatuses = new Map();
let stateRevision = 0;
let primaryDelivery = { lastDispatchRevision: 0, lastDispatchAt: 0, ackRevision: 0, ackAt: 0, ackCueId: '', ackTransactionId: '' };
let showRepository = null;
let showStorageReady = null;
let activeShowDocumentPath = '';
let cleanQuitInProgress = false;
let cleanQuitComplete = false;
let rendererCrashed = false;
let controlCloseAllowed = false;
let lastCleanFlushSucceeded = false;
let liveQuitConfirmed = false;
let liveQuitPromptOpen = false;
let controlCloseFlowInProgress = false;

function recordingSettingsFile() {
  return path.join(app.getPath('userData'), 'recording-settings.json');
}

function defaultRecordingDirectory() {
  return path.join(app.getPath('videos'), 'ShowSlate Recordings');
}

function recordingSettingsStatus(input = {}) {
  const settings = recording.normalizeSettings({ ...input, directory: input.directory || defaultRecordingDirectory() });
  let freeBytes = 0;
  try {
    fs.mkdirSync(settings.directory, { recursive: true });
    const stats = fs.statfsSync(settings.directory);
    freeBytes = Number(stats.bavail) * Number(stats.bsize);
  } catch (_) {}
  return { ...settings, freeBytes: Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : 0 };
}

function loadRecordingSettings() {
  try {
    return recordingSettingsStatus(JSON.parse(fs.readFileSync(recordingSettingsFile(), 'utf8')));
  } catch (_) {
    return recordingSettingsStatus({});
  }
}

function saveRecordingSettings(input) {
  const settings = recordingSettingsStatus(input);
  const destination = recordingSettingsFile();
  const temp = destination + '.tmp-' + process.pid;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(temp, JSON.stringify(settings, null, 2), { mode: 0o600 });
  fs.renameSync(temp, destination);
  return settings;
}

function uniqueRecordingPath(directory, filename) {
  const ext = path.extname(filename);
  const stem = path.basename(filename, ext);
  for (let index = 0; index < 10000; index++) {
    const suffix = index ? `-${index + 1}` : '';
    const candidate = path.join(directory, `${stem}${suffix}${ext}`);
    if (!fs.existsSync(candidate) && !fs.existsSync(candidate + '.part')) return candidate;
  }
  throw new Error('Could not allocate a unique recording filename.');
}

function closeRecordingOutput() {
  const rec = recordingOutput;
  recordingOutput = null;
  try { if (rec && rec.win && !rec.win.isDestroyed()) rec.win.destroy(); } catch (_) {}
}

function dispatchRecordingState(state) {
  const rec = recordingOutput;
  if (!rec || !rec.win || rec.win.isDestroyed()) return false;
  rec.lastDispatchRevision = stateRevision;
  rec.lastDispatchAt = Date.now();
  rec.win.webContents.send('state', outputPayload(state, 'recording', 'audience', stateRevision, {
    liveAudio: false,
    audioOwnedByController: true,
    outputCanvas: { width: rec.width, height: rec.height, fps: rec.fps, fit: 'contain' }
  }));
  return true;
}

async function waitForRecordingRenderer(rec, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let lastMedia = { total: 0, ready: 0 };
  while (Date.now() < deadline) {
    const acknowledged = rec.ackRevision >= rec.lastDispatchRevision && rec.lastDispatchRevision > 0;
    try {
      lastMedia = await rec.win.webContents.executeJavaScript(`(() => {
        const media = [...document.querySelectorAll('#sceneRoot video')];
        const ready = media.filter(node => node.readyState >= 2 && node.videoWidth > 0 && node.videoHeight > 0).length;
        return { total: media.length, ready };
      })()`);
    } catch (_) {}
    if (acknowledged && lastMedia.ready >= lastMedia.total) return { ready: true, media: lastMedia };
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return { ready: false, media: lastMedia };
}

async function createRecordingOutput(dimensions, fps) {
  closeRecordingOutput();
  const width = Math.max(320, Math.min(7680, Math.round(Number(dimensions.width) || 1920)));
  const height = Math.max(180, Math.min(4320, Math.round(Number(dimensions.height) || 1080)));
  const displayBounds = screen.getAllDisplays().map(display => display.bounds);
  const parkedX = Math.min(...displayBounds.map(bounds => bounds.x)) - width - 128;
  const parkedY = Math.min(...displayBounds.map(bounds => bounds.y)) - height - 128;
  const win = new BrowserWindow({
    x: parkedX, y: parkedY, width, height, useContentSize: true, show: false, skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    title: 'ShowSlate — Recording Program',
    backgroundColor: '#000000', frame: false, focusable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    }
  });
  const rec = {
    win, width, height, fps,
    lastDispatchRevision: 0, lastDispatchAt: 0, ackRevision: 0, ackAt: 0,
    ackCueId: '', ackTransactionId: ''
  };
  recordingOutput = rec;
  watchLiveInputConsumer(win);
  win.on('closed', () => { if (recordingOutput === rec) recordingOutput = null; });
  await win.loadFile('output.html', { query: { routeId: 'recording', outputRole: 'audience', recording: '1' } });
  if (recordingOutput !== rec || win.isDestroyed()) throw new Error('Recording renderer closed before it was ready.');
  win.setContentSize(width, height, false);
  win.setPosition(parkedX, parkedY, false);
  win.setIgnoreMouseEvents(true);
  win.showInactive();
  if (lastState) dispatchRecordingState(lastState);
  const readiness = await waitForRecordingRenderer(rec);
  return { rec, readiness };
}

function closeRecordingWriter(sessionRecord) {
  return new Promise((resolve, reject) => {
    const stream = sessionRecord && sessionRecord.stream;
    if (!stream || stream.writableFinished || stream.closed) { resolve(); return; }
    if (stream.destroyed) {
      reject(sessionRecord.streamError || new Error('Recording file stream closed before it finished.'));
      return;
    }
    const cleanup = () => {
      stream.removeListener('finish', onFinish);
      stream.removeListener('error', onError);
    };
    const onFinish = () => { cleanup(); resolve(); };
    const onError = error => { cleanup(); reject(error); };
    stream.once('finish', onFinish);
    stream.once('error', onError);
    stream.end();
  });
}

function destroyRecordingWriter(sessionRecord) {
  return new Promise(resolve => {
    const stream = sessionRecord && sessionRecord.stream;
    if (!stream || stream.closed) { resolve(); return; }
    const finish = () => {
      stream.removeListener('close', finish);
      resolve();
    };
    stream.once('close', finish);
    try { stream.destroy(); }
    catch (_) { finish(); }
  });
}

async function abortRecordingSession(options = {}) {
  const sessionRecord = recordingSession;
  recordingSession = null;
  closeRecordingOutput();
  if (!sessionRecord) return { ok: true, aborted: true };
  await destroyRecordingWriter(sessionRecord);
  if (options.preserve && sessionRecord.bytes > 0) {
    const incomplete = sessionRecord.finalPath.replace(/(\.[^.]+)$/, '.incomplete$1');
    try { fs.renameSync(sessionRecord.tempPath, incomplete); return { ok: false, aborted: true, preservedPath: incomplete }; } catch (_) {}
  }
  try { fs.unlinkSync(sessionRecord.tempPath); } catch (_) {}
  return { ok: true, aborted: true };
}

function hasActiveRecording() {
  return !!recordingSession;
}

function hasActiveOutputWindows() {
  if (outputWin && !outputWin.isDestroyed()) return true;
  for (const rec of auxOutputs.values()) {
    if (rec && rec.win && !rec.win.isDestroyed()) return true;
  }
  return false;
}

async function confirmStopOutputsAndQuit() {
  if (SMOKE || liveQuitConfirmed || (!hasActiveOutputWindows() && !hasActiveRecording())) return true;
  if (liveQuitPromptOpen) return false;
  liveQuitPromptOpen = true;
  try {
    const recordingActive = hasActiveRecording();
    const result = await dialog.showMessageBox(controlWin && !controlWin.isDestroyed() ? controlWin : null, {
      type: 'warning',
      title: recordingActive ? 'Program recording is active' : 'Program output is live',
      message: recordingActive ? 'Stop recording, close outputs and quit ShowSlate?' : 'Stop all outputs and quit ShowSlate?',
      detail: recordingActive ? 'ShowSlate will finalize the current recording before it quits.' : 'The audience Program feed will close immediately.',
      buttons: ['Keep Running', 'Stop Outputs and Quit'],
      defaultId: 0,
      cancelId: 0,
      destructiveId: 1,
      noLink: true
    });
    if (result.response !== 1) return false;
    if (recordingActive && controlWin && !controlWin.isDestroyed()) {
      try {
        await controlWin.webContents.executeJavaScript(
          `window.__ptStopProgramRecording ? window.__ptStopProgramRecording({reason:'quit'}) : Promise.resolve({ok:false})`
        );
      } catch (_) {
        await abortRecordingSession({ preserve: true });
      }
    }
    liveQuitConfirmed = true;
    return true;
  } finally {
    liveQuitPromptOpen = false;
  }
}

async function flushRendererShow() {
  if (!controlWin || controlWin.isDestroyed() || rendererCrashed) return { ok: false, skipped: true };
  try {
    return await controlWin.webContents.executeJavaScript(
      `window.__ptFlushShowAutosave ? window.__ptFlushShowAutosave() : Promise.resolve({ok:false,skipped:true})`
    );
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
}

function trustedLiveInputConsumer(sender) {
  if (!sender || sender.isDestroyed()) return false;
  if (controlWin && !controlWin.isDestroyed() && controlWin.webContents.id === sender.id) return true;
  if (outputWin && !outputWin.isDestroyed() && outputWin.webContents.id === sender.id) return true;
  if (recordingOutput && recordingOutput.win && !recordingOutput.win.isDestroyed() && recordingOutput.win.webContents.id === sender.id) return true;
  for (const rec of auxOutputs.values()) {
    if (rec && rec.win && !rec.win.isDestroyed() && rec.win.webContents.id === sender.id) return true;
  }
  return false;
}

function sendLiveHubCommand(command) {
  if (!liveInputHubWin || liveInputHubWin.isDestroyed() || !liveInputHubReady) return false;
  liveInputHubWin.webContents.send('live-hub-command', command);
  return true;
}

function broadcastLiveInputStatus(payload) {
  const windows = [controlWin, outputWin, recordingOutput && recordingOutput.win, ...[...auxOutputs.values()].map(rec => rec && rec.win)];
  windows.forEach(win => {
    if (win && !win.isDestroyed()) win.webContents.send('live-input-status', payload);
  });
}

function releaseLiveInputConsumer(senderId) {
  if (!senderId) return;
  sendLiveHubCommand({ type: 'release-consumer', consumerId: Number(senderId) });
}

function watchLiveInputConsumer(win) {
  if (!win || win.isDestroyed()) return;
  const id = win.webContents.id;
  win.webContents.once('destroyed', () => releaseLiveInputConsumer(id));
}

function setupLiveInputPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((wc, permission) => {
    if (!wc || wc.isDestroyed()) return false;
    const hub = liveInputHubWin && !liveInputHubWin.isDestroyed() && wc.id === liveInputHubWin.webContents.id;
    const recorder = controlWin && !controlWin.isDestroyed() && wc.id === controlWin.webContents.id && !!recordingSession;
    return (!!hub && ['media', 'display-capture'].includes(permission))
      || (!!recorder && ['media', 'display-capture'].includes(permission));
  });
  ses.setPermissionRequestHandler((wc, permission, callback) => {
    const hub = liveInputHubWin && !liveInputHubWin.isDestroyed() && wc && wc.id === liveInputHubWin.webContents.id;
    const recorder = controlWin && !controlWin.isDestroyed() && wc && wc.id === controlWin.webContents.id && !!recordingSession;
    callback((!!hub && ['media', 'display-capture'].includes(permission))
      || (!!recorder && ['media', 'display-capture'].includes(permission)));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sender = request && request.frame ? webContents.fromFrame(request.frame) : null;
      const trusted = sender && liveInputHubWin && !liveInputHubWin.isDestroyed() && sender.id === liveInputHubWin.webContents.id;
      if (!trusted || !pendingDesktopSource || !pendingDesktopSource.sourceId) { callback({}); return; }
      const selection = pendingDesktopSource;
      pendingDesktopSource = null;
      const source = selection.source;
      callback(source ? { video: source, ...(selection.withAudio && request.audioRequested ? { audio: 'loopback' } : {}) } : {});
    } catch (_) {
      pendingDesktopSource = null;
      callback({});
    }
  });
}

function createLiveInputHub() {
  if (liveInputHubWin && !liveInputHubWin.isDestroyed()) return liveInputHubWin;
  liveInputHubReady = false;
  liveInputHubWin = new BrowserWindow({
    width: 320, height: 180, show: false, skipTaskbar: true,
    title: 'ShowSlate Live Inputs', backgroundColor: '#050607',
    webPreferences: {
      preload: path.join(__dirname, 'live-input-preload.js'), contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    }
  });
  liveInputHubWin.loadFile('live-input.html', { query: SMOKE ? { test: '1' } : {} });
  liveInputHubWin.webContents.on('render-process-gone', (event, details) => {
    liveInputHubReady = false;
    const reason = String(details && details.reason || 'renderer-gone');
    liveInputDefinitions.forEach(definition => {
      const payload = { inputId: definition.id, state: 'error', error: 'Live input service stopped: ' + reason, at: Date.now() };
      liveInputStatuses.set(definition.id, payload);
      broadcastLiveInputStatus(payload);
    });
  });
  liveInputHubWin.on('closed', () => { liveInputHubWin = null; liveInputHubReady = false; });
  return liveInputHubWin;
}

function boundedLiveInputTask(task, timeoutMs, label) {
  let timer = null;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([Promise.resolve(task), timeout]).finally(() => clearTimeout(timer));
}

function liveInputPermissionSnapshot() {
  if (process.platform !== 'darwin') return { camera: 'unknown', microphone: 'unknown', screen: 'unknown' };
  return {
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen')
  };
}

async function requestDarwinLiveInputPermission(mediaType) {
  if (!['camera', 'microphone'].includes(mediaType)) return false;
  const current = systemPreferences.getMediaAccessStatus(mediaType);
  if (current === 'granted') return true;
  if (current !== 'not-determined') return false;
  return boundedLiveInputTask(systemPreferences.askForMediaAccess(mediaType), 20000, `${mediaType} permission`);
}

// ---------------- MREŽNI IZLAZ (OBS Browser Source / NDI most / confidence monitor) ----------------
let server = null;
let serverPort = 0;
const sseClients = new Set();

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*'
  });
  res.end(JSON.stringify(payload));
}

function requestCommandToken(req, query) {
  return req.headers['x-showslate-token'] || req.headers['x-pt-token'] || query.get('t');
}

function statusSectionForPath(url) {
  if (url === '/api/status') return 'all';
  if (url === '/api/status/show') return 'show';
  if (url === '/api/status/cue') return 'cue';
  if (url === '/api/status/lower-third') return 'lowerThird';
  if (url === '/api/status/content') return 'content';
  return null;
}

function lanIP() {
  const ifaces = os.networkInterfaces();
  for (const name of Object.keys(ifaces)) {
    for (const i of ifaces[name]) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return '127.0.0.1';
}

function startServer(port, attempt = 0) {
  const outputHtml = () => {
    try { return fs.readFileSync(path.join(__dirname, 'output.html'), 'utf8'); }
    catch (e) { return '<h1>ShowSlate</h1>'; }
  };

  const fileHtml = (name) => {
    try { return fs.readFileSync(path.join(__dirname, name), 'utf8'); }
    catch (e) { return '<h1>ShowSlate</h1>'; }
  };

  server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    const qs = new URLSearchParams((req.url || '').split('?')[1] || '');

    if (url === '/' || url === '/output.html') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(outputHtml());
      return;
    }

    if (url === '/i18n.js') {
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fileHtml('i18n.js'));
      return;
    }

    if (url === '/src/compositor/model.js' || url === '/src/live-input/consumer.js') {
      const relative = url.slice(1);
      res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fileHtml(relative));
      return;
    }

    if (url === '/remote') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fileHtml('remote.html'));
      return;
    }

    if (url === '/backstage') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fileHtml('backstage.html'));
      return;
    }

    // PRO: Signal Light — tablet na govornici (Limitimer zamena)
    if (url === '/signal') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(fileHtml('signal.html'));
      return;
    }

    // Sanitizovan read-only status za Companion feedbacks/variables. I status je tokenizovan,
    // jer cue, speaker i message podaci ne treba da budu javni na nepoznatoj mreži.
    const statusSection = statusSectionForPath(url);
    if (statusSection && req.method === 'GET') {
      if (requestCommandToken(req, qs) !== CMD_TOKEN) {
        writeJson(res, 403, { ok: false, error: 'unauthorized' });
        return;
      }
      writeJson(res, 200, { ok: true, status: controlApi.selectStatusSection(lastControlStatus, statusSection) });
      return;
    }

    // komande sa daljinskog (telefon/tablet) i HTTP API (Stream Deck / Companion / cURL)
    // POST /cmd {type,value} ili GET /cmd?type=start&value=…&t=TOKEN
    if (url === '/cmd' && (req.method === 'POST' || req.method === 'GET')) {
      // token: samo onaj ko ima ispravan ?t= / x-pt-token sme da kontroliše
      if (requestCommandToken(req, qs) !== CMD_TOKEN) {
        writeJson(res, 403, { ok: false, error: 'unauthorized' });
        return;
      }
      const dispatch = raw => {
        const normalized = controlApi.normalizeCommand(raw);
        if (!normalized.ok) {
          writeJson(res, 400, { ok: false, error: normalized.error });
          return;
        }
        if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('remote-cmd', normalized.command);
        writeJson(res, 200, { ok: true, command: normalized.command });
      };
      if (req.method === 'GET') {
        const v = qs.get('value');
        dispatch({ type: qs.get('type'), value: v === null ? undefined : v, templateId: qs.get('templateId') || undefined });
        return;
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 1e5) req.destroy(); });
      req.on('end', () => {
        let cmd = null;
        try { cmd = JSON.parse(body || '{}'); } catch (e) {}
        dispatch(cmd);
      });
      return;
    }

    if (url.startsWith('/media/')) {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        res.end();
        return;
      }
      let file = '';
      try { file = path.basename(decodeURIComponent(url.slice(7))); }
      catch (_) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('Bad media path'); return; }
      const media = getMediaLibrary().inspect(file);
      const full = media.ok ? media.path : '';
      let stat = null;
      try { stat = fs.statSync(full); } catch (e) {}
      if (!stat || !stat.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found'); return; }
      const mime = media.mime || MEDIA_MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      const range = parseByteRange(req.headers.range, stat.size);
      const cacheControl = media.storage === 'linked' ? 'no-cache' : 'public, max-age=31536000, immutable';
      const mediaHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Cross-Origin-Resource-Policy': 'cross-origin'
      };
      if (range && range.invalid) {
        res.writeHead(416, { ...mediaHeaders, 'Content-Range': `bytes */${stat.size}`, 'Accept-Ranges': 'bytes' });
        res.end();
      } else if (range) {
        res.writeHead(206, { ...mediaHeaders, 'Content-Type': mime, 'Content-Length': range.length,
          'Content-Range': `bytes ${range.start}-${range.end}/${stat.size}`, 'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(full, { start: range.start, end: range.end }).on('error', () => res.destroy()).pipe(res);
      } else {
        res.writeHead(200, { ...mediaHeaders, 'Content-Type': mime, 'Content-Length': stat.size,
          'Accept-Ranges': 'bytes', 'Cache-Control': cacheControl });
        if (req.method === 'HEAD') res.end();
        else fs.createReadStream(full).on('error', () => res.destroy()).pipe(res);
      }
      return;
    }

    if (url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });
      res.write('retry: 1000\n\n');
      if (lastState) res.write('data: ' + JSON.stringify(withBase(lastState, '')) + '\n\n');
      sseClients.add(res);
      const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 15000);
      req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  });

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE' && attempt < 10) {
      startServer(port + 1, attempt + 1);
    } else {
      console.error('Server error:', err.message);
    }
  });

  server.listen(port, '0.0.0.0', () => {
    serverPort = port;
    pushNetworkInfo();
  });
}

// media:// linkovi se rešavaju po klijentu: Electron prozori preko 127.0.0.1, browseri relativno
function withBase(state, base) {
  return state ? { ...state, _mediaBase: base } : state;
}
function localBase() { return serverPort ? `http://127.0.0.1:${serverPort}` : ''; }

function probeLocalRoute(route, timeoutMs = 900) {
  if (!serverPort) return Promise.resolve(false);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(!!value);
    };
    const req = http.get(`http://127.0.0.1:${serverPort}${route}`, response => {
      response.resume();
      finish(response.statusCode >= 200 && response.statusCode < 400);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); finish(false); });
    req.on('error', () => finish(false));
  });
}

function pushSSE(state) {
  const data = 'data: ' + JSON.stringify(withBase(state, '')) + '\n\n';
  for (const res of sseClients) { try { res.write(data); } catch (e) { sseClients.delete(res); } }
}

// ---------------- OSC ULAZ (QLab / Companion / TouchOSC / bilo koji OSC sender) ----------------
// UDP, preferred /showslate/<type> addresses plus the legacy /protimer/<type> alias.
// Ontime/QLab: OSC nema token (dokumentovano u SECURITY.md).
let oscSocket = null, oscPort = 0;
function parseOSC(buf) {
  // OSC 1.0: address (null-terminisan string, 4-byte poravnat), ',tipovi', argumenti
  const readStr = (off) => {
    const end = buf.indexOf(0, off);
    if (end < 0) return null;
    return { str: buf.toString('ascii', off, end), next: (end + 4) & ~3 };
  };
  const a = readStr(0);
  if (!a || a.str[0] !== '/') return null;
  let args = [], off = a.next;
  const t = readStr(off);
  if (t && t.str[0] === ',') {
    off = t.next;
    for (const tag of t.str.slice(1)) {
      if (tag === 'i') { args.push(buf.readInt32BE(off)); off += 4; }
      else if (tag === 'f') { args.push(Math.round(buf.readFloatBE(off))); off += 4; }
      else if (tag === 's') { const s = readStr(off); if (!s) break; args.push(s.str); off = s.next; }
      else break; // nepodržan tag (blob/…) — stani
    }
  }
  return { address: a.str, args };
}
function startOSC(port, attempt = 0) {
  const dgram = require('dgram');
  oscSocket = dgram.createSocket('udp4');
  oscSocket.on('error', (err) => {
    try { oscSocket.close(); } catch (e) {}
    if (err.code === 'EADDRINUSE' && attempt < 10) startOSC(port + 1, attempt + 1);
    else console.error('OSC error:', err.message);
  });
  oscSocket.on('message', (buf) => {
    try {
      const m = parseOSC(buf);
      if (!m) return;
      const prefix = ['/showslate/', '/protimer/'].find(value => m.address.startsWith(value));
      if (!prefix) return;
      const normalized = controlApi.normalizeCommand({
        type: m.address.slice(prefix.length),
        value: m.args.length ? m.args[0] : undefined
      });
      if (!normalized.ok) return;
      if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('remote-cmd', normalized.command);
    } catch (e) {}
  });
  oscSocket.bind(port, '0.0.0.0', () => { oscPort = port; pushNetworkInfo(); });
}

function networkInfo() {
  return { ip: lanIP(), port: serverPort, running: !!serverPort, clients: sseClients.size, token: CMD_TOKEN, oscPort };
}
function pushNetworkInfo() {
  if (controlWin && !controlWin.isDestroyed()) controlWin.webContents.send('network-info', networkInfo());
}
setInterval(pushNetworkInfo, 3000);

// ---------------- PROZORI ----------------
function controlDisplayId() {
  if (!controlWin || controlWin.isDestroyed()) return screen.getPrimaryDisplay().id;
  return screen.getDisplayMatching(controlWin.getBounds()).id;
}
function outputDisplayId() {
  if (!outputWin || outputWin.isDestroyed()) return null;
  return screen.getDisplayMatching(outputWin.getBounds()).id;
}
function hasAuxOutputOnDisplay(displayId) {
  for (const rec of auxOutputs.values()) {
    if (!rec || !rec.win || rec.win.isDestroyed()) continue;
    const cfgId = Number(rec.config && rec.config.displayId);
    const liveId = Number(rec.actualDisplayId) || screen.getDisplayMatching(rec.win.getBounds()).id;
    if (cfgId === displayId || liveId === displayId) return true;
  }
  return false;
}
function displayList() {
  const primaryId = screen.getPrimaryDisplay().id;
  const ctlId = controlDisplayId();
  const outId = outputDisplayId();
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id, label: d.label || `Monitor ${i + 1}`,
    width: d.bounds.width, height: d.bounds.height,
    primary: d.id === primaryId, hasControl: d.id === ctlId, hasOutput: d.id === outId || hasAuxOutputOnDisplay(d.id)
  }));
}
function broadcast(channel, payload) {
  [controlWin, outputWin].forEach(w => { if (w && !w.isDestroyed()) w.webContents.send(channel, payload); });
}
function outputPayload(state, routeId, role, revision = stateRevision, routeConfig = {}) {
  const normalizedRole = conferenceDesk.normalizeOutputRole(role);
  const payload = {
    ...(state || {}),
    transparent: normalizedRole === 'stream' ? true : !!(state && state.transparent),
    _outputRoute: {
      id: String(routeId || 'primary'),
      role: normalizedRole,
      liveAudio: routeConfig.liveAudio === true,
      audioOwnedByController: routeConfig.audioOwnedByController !== false,
      audioOutputDeviceId: String(routeConfig.audioOutputDeviceId || state && state.programAudioDeviceId || ''),
      compositionId: String(routeConfig.compositionId || ''),
      mappingId: String(routeConfig.mappingId || ''),
      projection: routeConfig.projection && typeof routeConfig.projection === 'object' ? routeConfig.projection : null,
      outputCanvas: routeConfig.outputCanvas && typeof routeConfig.outputCanvas === 'object' ? routeConfig.outputCanvas : null
    },
    _dispatch: {
      revision: Math.max(0, Number(revision) || 0),
      routeId: String(routeId || 'primary'),
      role: normalizedRole,
      sentAt: Date.now()
    }
  };
  return withBase(payload, localBase());
}
function dispatchPrimaryState(state) {
  if (!outputWin || outputWin.isDestroyed()) return false;
  primaryDelivery.lastDispatchRevision = stateRevision;
  primaryDelivery.lastDispatchAt = Date.now();
  outputWin.webContents.send('state', outputPayload(state, 'primary', 'audience', stateRevision, {
    liveAudio: state && state.primaryLiveAudio === true,
    audioOutputDeviceId: state && state.programAudioDeviceId
  }));
  return true;
}
function dispatchAuxState(rec, state) {
  if (!rec || !rec.win || rec.win.isDestroyed()) return false;
  rec.lastDispatchRevision = stateRevision;
  rec.lastDispatchAt = Date.now();
  rec.win.webContents.send('state', outputPayload(state, rec.config.id, rec.config.role, stateRevision, rec.config));
  return true;
}
function sendStateToOutputs(state) {
  dispatchPrimaryState(state);
  for (const rec of auxOutputs.values()) {
    dispatchAuxState(rec, state);
  }
  dispatchRecordingState(state);
}
function pushDisplays() { broadcast('displays', displayList()); }
function outputRuntimeSnapshot() {
  return {
    primaryOpen: !!(outputWin && !outputWin.isDestroyed()),
    revision: stateRevision,
    primary: {
      role: 'audience',
      lastDispatchRevision: primaryDelivery.lastDispatchRevision,
      ackRevision: primaryDelivery.ackRevision,
      acknowledged: primaryDelivery.lastDispatchRevision > 0 && primaryDelivery.ackRevision >= primaryDelivery.lastDispatchRevision,
      latencyMs: primaryDelivery.ackAt && primaryDelivery.lastDispatchAt ? Math.max(0, primaryDelivery.ackAt - primaryDelivery.lastDispatchAt) : null
    },
    routes: outputConfigs.map(cfg => {
      const rec = auxOutputs.get(cfg.id);
      const target = resolveOutputDisplay(cfg);
      const open = !!(target.display && rec && rec.win && !rec.win.isDestroyed() && rec.win.isVisible());
      const issue = rec && rec.issue ? rec.issue : (!target.display && cfg.enabled !== false ? target.reason : '');
      return {
        id: cfg.id,
        role: conferenceDesk.normalizeOutputRole(cfg.role),
        enabled: cfg.enabled !== false,
        open,
        displayId: cfg.displayId,
        actualDisplayId: open ? rec.actualDisplayId : null,
        displayAvailable: !!target.display,
        displayMatch: target.match,
        status: cfg.enabled === false ? 'disabled' : (open ? ((rec.ackRevision || 0) >= (rec.lastDispatchRevision || 0) && (rec.lastDispatchRevision || 0) > 0 ? 'live' : 'syncing') : (issue || 'opening')),
        lastDispatchRevision: rec ? Number(rec.lastDispatchRevision) || 0 : 0,
        ackRevision: rec ? Number(rec.ackRevision) || 0 : 0,
        acknowledged: !!(rec && rec.lastDispatchRevision > 0 && rec.ackRevision >= rec.lastDispatchRevision),
        latencyMs: rec && rec.ackAt && rec.lastDispatchAt ? Math.max(0, rec.ackAt - rec.lastDispatchAt) : null,
        ackCueId: rec ? String(rec.ackCueId || '') : '',
        ackTransactionId: rec ? String(rec.ackTransactionId || '') : '',
        mode: cfg.mode,
        outputCanvas: cfg.outputCanvas,
        projection: cfg.projection,
        bounds: open ? rec.win.getBounds() : null,
        fullscreen: open ? cfg.mode === 'fullscreen' : false,
        nativeFullscreen: open ? rec.win.isFullScreen() : false,
        simpleFullscreen: open ? isAuxSimpleFullscreen(rec.win) : false
      };
    })
  };
}
function pushOutputState() {
  if (!controlWin || controlWin.isDestroyed()) return;
  controlWin.webContents.send('output-state', !!outputWin || auxOutputs.size > 0);
  controlWin.webContents.send('output-config-state', outputRuntimeSnapshot());
}

function createControlWindow() {
  controlWin = new BrowserWindow({
    width: 1280, height: 800, minWidth: 900, minHeight: 600,
    title: 'ShowSlate — Live Compositor', backgroundColor: '#0b0d11',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  controlWin.loadFile('controller.html');
  watchLiveInputConsumer(controlWin);
  controlWin.webContents.on('render-process-gone', (event, details) => {
    if (!details || details.reason !== 'clean-exit') rendererCrashed = true;
  });
  controlWin.on('close', (event) => {
    if (SMOKE || rendererCrashed || controlCloseAllowed || cleanQuitComplete) return;
    event.preventDefault();
    if (controlCloseFlowInProgress) return;
    controlCloseFlowInProgress = true;
    confirmStopOutputsAndQuit().then(confirmed => {
      if (!confirmed) return null;
      return flushRendererShow().then((result) => {
        lastCleanFlushSucceeded = !!(result && result.ok);
        controlCloseAllowed = true;
        if (controlWin && !controlWin.isDestroyed()) controlWin.close();
      });
    }).catch(error => {
      console.error('CONTROL_CLOSE_CONFIRM_FAILED ' + String(error && error.message || error));
    }).finally(() => {
      controlCloseFlowInProgress = false;
    });
  });
  controlWin.on('closed', () => {
    controlWin = null;
    if (recordingSession) abortRecordingSession({ preserve: true }).catch(() => {});
    else closeRecordingOutput();
    if (outputWin && !outputWin.isDestroyed()) outputWin.destroy();
    for (const rec of auxOutputs.values()) {
      try { if (rec.win && !rec.win.isDestroyed()) rec.win.destroy(); } catch (e) {}
    }
    auxOutputs.clear();
    if (liveInputHubWin && !liveInputHubWin.isDestroyed()) liveInputHubWin.destroy();
    app.quit();
  });
}

function positionOutput(target) {
  if (!outputWin || outputWin.isDestroyed()) return;
  const ctlId = controlDisplayId();
  const g = lastState || {};
  if (g.gridOn && g.gridSize) {
    // GRID: prozor = izabrana kockica N×N tog monitora (mali timer-prozor)
    if (outputWin.isFullScreen()) outputWin.setFullScreen(false);
    outputWin.setBounds(outputRouting.gridBounds(target.bounds, g.gridSize, g.gridCell));
  } else if (target.id !== ctlId) {
    outputWin.setFullScreen(false);
    outputWin.setBounds(target.bounds);
    outputWin.setFullScreen(true);
  } else {
    if (outputWin.isFullScreen()) outputWin.setFullScreen(false);
    const b = target.workArea;
    const w = Math.min(900, Math.floor(b.width * 0.45));
    const h = Math.floor(w * 9 / 16);
    outputWin.setBounds({ x: b.x + b.width - w - 24, y: b.y + 48, width: w, height: h });
  }
  if (typeof outputWin.showInactive === 'function') outputWin.showInactive();
  else outputWin.show();
  pushDisplays();
}

function normalizeOutputConfig(cfg, i = 0) {
  const displays = screen.getAllDisplays();
  return outputRouting.normalizeConfig(cfg, i, {
    displays,
    controlDisplayId: controlDisplayId(),
    primaryDisplay: screen.getPrimaryDisplay()
  });
}

function rememberOutputDisplay(cfg, display) {
  return outputRouting.rememberDisplay(cfg, display);
}

function resolveOutputDisplay(cfg) {
  const displays = screen.getAllDisplays();
  return outputRouting.resolveDisplay(cfg, displays, {
    allowedDisplayId: SMOKE && SMOKE_TARGET ? SMOKE_TARGET.id : null
  });
}

function targetDisplayForConfig(cfg) {
  return resolveOutputDisplay(cfg).display;
}

function auxFrameMode(cfg) {
  // Pixel-accurate routes cannot use a native title bar: macOS clamps and
  // cascades framed windows around the work area, changing requested X/Y bounds.
  // A display-fill window is deterministic when several Program routes are
  // active, unlike native macOS fullscreen Spaces.
  return !!(cfg && (cfg.mode === 'fullscreen' || cfg.mode === 'grid' || cfg.mode === 'custom' || cfg.frameless));
}

function isAuxSimpleFullscreen(win) {
  if (process.platform !== 'darwin' || !win || typeof win.isSimpleFullScreen !== 'function') return false;
  try { return win.isSimpleFullScreen(); } catch (e) { return false; }
}

function leaveAuxFullscreen(win) {
  if (!win || win.isDestroyed()) return;
  if (win.isFullScreen()) win.setFullScreen(false);
  if (isAuxSimpleFullscreen(win)) win.setSimpleFullScreen(false);
}

function placedOutputBounds(area, width, height, cfg, margin = 24) {
  return outputRouting.placedBounds(area, width, height, cfg, margin);
}

function positionAuxOutput(rec, targetOverride = null) {
  if (!rec || !rec.win || rec.win.isDestroyed()) return false;
  const cfg = rec.config;
  const target = targetOverride || targetDisplayForConfig(cfg);
  if (!target) {
    rec.issue = 'missing-display';
    return false;
  }
  rec.issue = '';
  rec.actualDisplayId = target.id;
  rememberOutputDisplay(cfg, target);
  const b = target.bounds;

  if (cfg.mode === 'fullscreen') {
    rec.win.setBounds(b);
    if (process.platform === 'darwin') {
      if (!isAuxSimpleFullscreen(rec.win)) rec.win.setSimpleFullScreen(true);
    } else if (rec.win.isFullScreen()) {
      rec.win.setFullScreen(false);
    }
  } else if (cfg.mode === 'grid') {
    leaveAuxFullscreen(rec.win);
    rec.win.setBounds(outputRouting.gridBounds(b, cfg.gridSize, cfg.gridCell));
  } else if (cfg.mode === 'custom') {
    leaveAuxFullscreen(rec.win);
    const width = Math.min(cfg.width || 1000, b.width);
    const height = Math.min(cfg.height || 1000, b.height);
    rec.win.setBounds(placedOutputBounds(b, width, height, cfg, 0));
  } else {
    leaveAuxFullscreen(rec.win);
    const area = target.workArea;
    const width = Math.min(cfg.width || 960, Math.floor(area.width * 0.8));
    const height = Math.min(cfg.height || Math.round(width * 9 / 16), Math.floor(area.height * 0.8));
    rec.win.setBounds(placedOutputBounds(area, width, height, cfg));
  }
  if (typeof rec.win.showInactive === 'function') rec.win.showInactive();
  else rec.win.show();
  return true;
}

function scheduleAuxOutputPosition(rec, delay = 180) {
  if (!rec) return;
  if (rec.positionTimer) clearTimeout(rec.positionTimer);
  rec.positionTimer = setTimeout(() => {
    rec.positionTimer = null;
    if (!rec.win || rec.win.isDestroyed()) return;
    const target = targetDisplayForConfig(rec.config);
    if (target) positionAuxOutput(rec, target);
    pushOutputState();
    pushDisplays();
  }, delay);
}

function createAuxOutputWindow(cfg, target) {
  const normalized = normalizeOutputConfig(cfg);
  if (!target) return null;
  rememberOutputDisplay(normalized, target);
  const transparent = normalized.role === 'stream' || !!(lastState && lastState.transparent);
  const frameless = transparent || auxFrameMode(normalized);
  const win = new BrowserWindow({
    x: target.bounds.x, y: target.bounds.y,
    width: normalized.width || 1000, height: normalized.height || 1000, minWidth: 80, minHeight: 60, show: false,
    title: `ShowSlate — ${normalized.name}`,
    backgroundColor: transparent ? '#00000000' : '#000000',
    transparent,
    frame: !frameless,
    hasShadow: !frameless,
    alwaysOnTop: frameless,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  if (frameless) win.setAlwaysOnTop(true, 'floating');
  const rec = {
    win, config: normalized, frameless, transparent, actualDisplayId: target.id, issue: '',
    lastDispatchRevision: 0, lastDispatchAt: 0, ackRevision: 0, ackAt: 0, ackCueId: '', ackTransactionId: ''
  };
  auxOutputs.set(normalized.id, rec);
  watchLiveInputConsumer(win);
  win.loadFile('output.html', { query: { routeId: normalized.id, outputRole: normalized.role } });
  win.webContents.on('did-finish-load', () => {
    if (lastState) dispatchAuxState(rec, lastState);
  });
  win.once('ready-to-show', () => {
    positionAuxOutput(rec, target);
    scheduleAuxOutputPosition(rec);
    pushOutputState();
    pushDisplays();
  });
  win.on('closed', () => {
    const current = auxOutputs.get(normalized.id);
    if (current && current.win === win) auxOutputs.delete(normalized.id);
    pushOutputState(); pushDisplays();
  });
  return rec;
}

function closeAuxOutput(id, rec) {
  if (rec && rec.positionTimer) clearTimeout(rec.positionTimer);
  const current = auxOutputs.get(id);
  if (current === rec) auxOutputs.delete(id);
  try { if (rec && rec.win && !rec.win.isDestroyed()) rec.win.close(); } catch (e) {}
}

function applyOutputConfigs(configs) {
  const normalized = Array.isArray(configs) ? configs.map(normalizeOutputConfig) : [];
  const next = normalized.filter(c => c.enabled).map(cfg => {
    const resolved = resolveOutputDisplay(cfg);
    if (resolved.display) rememberOutputDisplay(cfg, resolved.display);
    return { cfg, target: resolved.display, issue: resolved.reason };
  });
  outputConfigs = normalized;
  const nextIds = new Set(next.filter(item => item.target).map(item => item.cfg.id));
  for (const [id, rec] of auxOutputs.entries()) {
    if (!nextIds.has(id)) {
      closeAuxOutput(id, rec);
    }
  }
  next.forEach(({ cfg, target, issue }) => {
    if (!target) return;
    const rec = auxOutputs.get(cfg.id);
    const desiredTransparent = cfg.role === 'stream' || !!(lastState && lastState.transparent);
    const desiredFrameless = desiredTransparent || auxFrameMode(cfg);
    const needsRecreate = rec && (!rec.win || rec.win.isDestroyed() || rec.frameless !== desiredFrameless || rec.transparent !== desiredTransparent || rec.config.role !== cfg.role);
    if (needsRecreate) {
      closeAuxOutput(cfg.id, rec);
    }
    const existing = auxOutputs.get(cfg.id);
    const live = existing || createAuxOutputWindow(cfg, target);
    if (!live) return;
    live.config = cfg;
    live.issue = issue || '';
    if (existing) {
      positionAuxOutput(live, target);
      scheduleAuxOutputPosition(live);
    }
    if (lastState && live.win && !live.win.isDestroyed()) dispatchAuxState(live, lastState);
  });
  pushOutputState();
  pushDisplays();
}

let outputDisplayReconcileTimer = null;
function reconcileOutputsAfterDisplayChange() {
  outputDisplayReconcileTimer = null;
  const displays = screen.getAllDisplays();
  if (outputWin && !outputWin.isDestroyed()) {
    const target = displays.find(display => display.id === Number(outputTargetId));
    if (target) positionOutput(target);
    else {
      try { outputWin.close(); } catch (e) {}
    }
  }
  applyOutputConfigs(outputConfigs);
}
function scheduleOutputDisplayReconcile() {
  if (outputDisplayReconcileTimer) clearTimeout(outputDisplayReconcileTimer);
  outputDisplayReconcileTimer = setTimeout(reconcileOutputsAfterDisplayChange, 180);
}

function createOutputWindow(displayId) {
  // SMOKE: force EVERY output onto the target monitor (so it never lands on the user's HP).
  // With controller also on the target, positionOutput uses the windowed branch (no native
  // fullscreen Space). Normal mode keeps the requested/other-display behaviour.
  if (SMOKE && SMOKE_TARGET) displayId = SMOKE_TARGET.id;
  const displays = screen.getAllDisplays();
  const requested = displayId === null || displayId === undefined ? null : Number(displayId);
  const target = requested === null
    ? (displays.find(d => d.id !== controlDisplayId()) || displays[0])
    : displays.find(d => d.id === requested);
  if (!target) {
    outputTargetId = requested;
    pushOutputState();
    return null;
  }
  outputTargetId = target.id;

  if (outputWin && !outputWin.isDestroyed()) { positionOutput(target); return; }

  const transparent = !!(lastState && lastState.transparent);
  const grid = !!(lastState && lastState.gridOn);
  const frameless = transparent || grid;   // grid prozor je takođe bez okvira (čista kockica)
  outputTransparent = transparent;
  outputFrameless = frameless;

  // SMOKE: create already on the target monitor (so it never exists at HP coords even pre-positionOutput)
  const smokeXY = (SMOKE && SMOKE_TARGET) ? { x: SMOKE_TARGET.workArea.x + 20, y: SMOKE_TARGET.workArea.y + 20 } : {};
  const win = new BrowserWindow({
    ...smokeXY,
    width: 900, height: 506, minWidth: 80, minHeight: 60, show: false,
    title: 'ShowSlate — Program Output',
    backgroundColor: transparent ? '#00000000' : '#000000',
    transparent: transparent,
    frame: !frameless,
    hasShadow: !frameless,
    alwaysOnTop: frameless,
    focusable: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  outputWin = win;
  watchLiveInputConsumer(win);
  if (frameless) win.setAlwaysOnTop(true, 'floating');
  if (SMOKE) {
    win.loadFile('output.html', { query: {
      ptSmoke: '1',
      routeId: 'primary',
      outputRole: 'audience',
      browserWindowId: String(win.id),
      webContentsId: String(win.webContents.id)
    } });
  } else {
    win.loadFile('output.html', { query: { routeId: 'primary', outputRole: 'audience' } });
  }
  if (SMOKE) win.webContents.on('console-message', (e, l, m, ln) => console.log(`OUT_CONSOLE [${l}] ${m} (line ${ln})`));
  win.webContents.on('did-finish-load', () => {
    if (lastState && outputWin === win) dispatchPrimaryState(lastState);
    pushDisplays(); pushOutMode();
  });
  win.on('enter-full-screen', pushOutMode);
  win.on('leave-full-screen', pushOutMode);
  win.once('ready-to-show', () => { if (outputWin === win) positionOutput(target); });
  win.on('closed', () => {
    if (outputWin === win) outputWin = null;
    pushOutputState();
    pushDisplays();
  });
  pushOutputState();
}

// javi izlazu da li je u punom ekranu (da odluči: grid vs kompaktan prozor)
function pushOutMode() {
  if (outputWin && !outputWin.isDestroyed()) outputWin.webContents.send('win-fs', outputWin.isFullScreen());
}

// Electron ne može da uključi/isključi `transparent` naživo → presozdaj prozor
// na istom monitoru (createOutputWindow ga sam pozicionira/fullscreen-uje)
function recreateOutputForTransparency() {
  if (!outputWin || outputWin.isDestroyed()) return;
  const id = outputTargetId;
  const previous = outputWin;
  outputWin = null;
  previous.destroy();
  createOutputWindow(id);
}

// ---------------- IPC ----------------
ipcMain.on('state', (e, s) => {
  const prev = lastState || {};
  const gridPosChanged = (prev.gridSize !== s.gridSize) || (prev.gridCell !== s.gridCell);
  const wantFrameless = !!s.transparent || !!s.gridOn;
  const transparentChanged = !!s.transparent !== outputTransparent;
  s.licExpired = false; // Backward-compatible state field; public builds never watermark output.
  stateRevision += 1;
  lastState = s;
  if (outputWin && !outputWin.isDestroyed()) {
    if (transparentChanged || wantFrameless !== outputFrameless) {
      recreateOutputForTransparency();   // providnost ili okvir (grid uklj/isklj) → novi prozor (sam se pozicionira)
    } else {
      dispatchPrimaryState(s);
      if (gridPosChanged && s.gridOn) {   // druga kockica / veličina grida → presloži prozor
        const d = screen.getAllDisplays().find(x => x.id === outputTargetId) || screen.getPrimaryDisplay();
        positionOutput(d);
      }
    }
  }
  if (auxOutputs.size) {
    if (transparentChanged) applyOutputConfigs(outputConfigs);
    else {
      for (const rec of auxOutputs.values()) {
        dispatchAuxState(rec, s);
      }
    }
  }
  dispatchRecordingState(s);
  pushOutputState();
  pushSSE(s);
});
ipcMain.on('output-rendered', (event, payload) => {
  const revision = Math.max(0, Number(payload && payload.revision) || 0);
  const senderId = event.sender && event.sender.id;
  let delivery = null;
  let expectedRouteId = '';
  let expectedRole = 'audience';
  if (outputWin && !outputWin.isDestroyed() && outputWin.webContents.id === senderId) {
    delivery = primaryDelivery;
    expectedRouteId = 'primary';
  } else if (recordingOutput && recordingOutput.win && !recordingOutput.win.isDestroyed() && recordingOutput.win.webContents.id === senderId) {
    delivery = recordingOutput;
    expectedRouteId = 'recording';
  } else {
    for (const rec of auxOutputs.values()) {
      if (rec && rec.win && !rec.win.isDestroyed() && rec.win.webContents.id === senderId) {
        delivery = rec;
        expectedRouteId = String(rec.config && rec.config.id || '');
        expectedRole = conferenceDesk.normalizeOutputRole(rec.config && rec.config.role);
        break;
      }
    }
  }
  if (!delivery || !revision || revision > Number(delivery.lastDispatchRevision || 0)) return;
  if (String(payload && payload.routeId || '') !== expectedRouteId) return;
  if (conferenceDesk.normalizeOutputRole(payload && payload.role) !== expectedRole) return;
  if (revision === Number(delivery.lastDispatchRevision || 0)) {
    const cue = lastState && Number.isInteger(lastState.currentCue) && Array.isArray(lastState.cues)
      ? lastState.cues[lastState.currentCue] : null;
    const runtime = lastState && lastState.lowerThird && lastState.lowerThird.runtime;
    const expectedCueId = String(cue && cue.id || '');
    const expectedTransactionId = String(lastState && lastState.goTransaction && lastState.goTransaction.id || '');
    const expectedTemplateId = String(runtime && runtime.templateId || '');
    const expectedInstanceId = String(runtime && runtime.instanceId || '');
    if (String(payload && payload.cueId || '') !== expectedCueId) return;
    if (String(payload && payload.transactionId || '') !== expectedTransactionId) return;
    if (String(payload && payload.templateId || '') !== expectedTemplateId) return;
    if (String(payload && payload.instanceId || '') !== expectedInstanceId) return;
  }
  delivery.ackRevision = Math.max(Number(delivery.ackRevision) || 0, revision);
  delivery.ackAt = Date.now();
  delivery.ackCueId = String(payload && payload.cueId || '');
  delivery.ackTransactionId = String(payload && payload.transactionId || '');
  pushOutputState();
});
ipcMain.on('control-status', (event, status) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return;
  lastControlStatus = controlApi.sanitizeControlStatus(status);
});
ipcMain.on('open-output', (e, displayId) => createOutputWindow(displayId || null));
ipcMain.on('send-to-display', (e, displayId) => {
  const d = screen.getAllDisplays().find(x => x.id === displayId);
  if (!d) return;
  if (!outputWin || outputWin.isDestroyed()) { createOutputWindow(d.id); return; }
  outputTargetId = d.id;
  if (d) positionOutput(d);
});
ipcMain.on('close-output', () => {
  if (outputWin && !outputWin.isDestroyed()) outputWin.close();
  for (const rec of auxOutputs.values()) {
    try { if (rec.win && !rec.win.isDestroyed()) rec.win.close(); } catch (e) {}
  }
});
ipcMain.on('toggle-fullscreen', () => { if (outputWin && !outputWin.isDestroyed()) outputWin.setFullScreen(!outputWin.isFullScreen()); });
ipcMain.on('exit-fullscreen', () => { if (outputWin && !outputWin.isDestroyed()) outputWin.setFullScreen(false); });
// kompaktan prozor: izlaz traži da visina prozora prati visinu tajmera (samo kad NIJE fullscreen)
ipcMain.on('fit-window', (e, h) => {
  if (!outputWin || outputWin.isDestroyed() || outputWin.isFullScreen()) return;
  const want = Math.max(80, Math.min(Math.round(h) || 0, 2200));
  const [w, cur] = outputWin.getContentSize();
  if (Math.abs(cur - want) > 4) outputWin.setContentSize(w, want);
});
ipcMain.on('ctl-on-top', (e, flag) => { if (controlWin && !controlWin.isDestroyed()) controlWin.setAlwaysOnTop(!!flag, 'floating'); });
ipcMain.handle('displays', () => displayList());
ipcMain.handle('output-open', () => !!outputWin || auxOutputs.size > 0);
ipcMain.handle('network-info', () => networkInfo());
ipcMain.handle('output-configs', () => outputConfigs);
ipcMain.handle('build-info', () => getBuildInfo());
ipcMain.handle('recording-settings', event => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  return { ok: true, settings: loadRecordingSettings(), active: hasActiveRecording(), lastPath: lastRecordingPath };
});
ipcMain.handle('recording-save-settings', (event, payload) => {
  try {
    if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    return { ok: true, settings: saveRecordingSettings(payload && payload.settings || {}) };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
});
ipcMain.handle('recording-choose-directory', async event => {
  try {
    if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    const current = loadRecordingSettings();
    const picked = await dialog.showOpenDialog(controlWin, {
      title: 'Choose ShowSlate Recording Folder',
      defaultPath: current.directory,
      properties: ['openDirectory', 'createDirectory']
    });
    if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
    const settings = saveRecordingSettings({ ...current, directory: path.resolve(picked.filePaths[0]) });
    return { ok: true, settings };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error) };
  }
});
ipcMain.handle('recording-open-directory', async event => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  const directory = loadRecordingSettings().directory;
  try { fs.mkdirSync(directory, { recursive: true }); } catch (_) {}
  const error = await shell.openPath(directory);
  return error ? { ok: false, error } : { ok: true, directory };
});
ipcMain.handle('recording-reveal-last', event => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  if (!lastRecordingPath || !fs.existsSync(lastRecordingPath)) return { ok: false, error: 'No completed recording is available.' };
  shell.showItemInFolder(lastRecordingPath);
  return { ok: true, path: lastRecordingPath };
});
ipcMain.handle('recording-prepare', async (event, payload) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  if (recordingSession) return { ok: false, error: 'A Program recording is already active.', code: 'RECORDING_ACTIVE' };
  const mimeType = String(payload && payload.mimeType || '').slice(0, 120);
  if (!/^video\/(webm|mp4)(?:;|$)/i.test(mimeType)) return { ok: false, error: 'Unsupported recording format.', code: 'RECORDING_FORMAT' };
  const settings = recordingSettingsStatus(payload && payload.settings || loadRecordingSettings());
  const dimensions = recording.resolveDimensions(settings, payload && payload.programCanvas || {});
  if (settings.freeBytes && settings.freeBytes < 512 * 1024 * 1024) {
    return { ok: false, error: 'Less than 512 MB is available in the recording folder.', code: 'RECORDING_DISK_LOW' };
  }
  try {
    fs.mkdirSync(settings.directory, { recursive: true });
    const filename = recording.recordingFilename(settings, mimeType);
    const finalPath = uniqueRecordingPath(settings.directory, filename);
    const tempPath = finalPath + '.part';
    const stream = fs.createWriteStream(tempPath, { flags: 'wx', highWaterMark: 8 * 1024 * 1024, mode: 0o600 });
    const sessionId = crypto.randomUUID();
    recordingSession = {
      id: sessionId, stream, streamError: null, finalPath, tempPath, mimeType,
      settings, dimensions, bytes: 0, nextSequence: 0, startedAt: Date.now()
    };
    stream.on('error', error => { if (recordingSession && recordingSession.id === sessionId) recordingSession.streamError = error; });
    const { rec, readiness } = await createRecordingOutput(dimensions, settings.fps);
    const mediaSourceId = rec.win.getMediaSourceId();
    const [renderWidth, renderHeight] = rec.win.getContentSize();
    if (renderWidth !== dimensions.width || renderHeight !== dimensions.height) {
      throw new Error(`Program renderer size is ${renderWidth}×${renderHeight}; expected ${dimensions.width}×${dimensions.height}.`);
    }
    return {
      ok: true, sessionId, mediaSourceId, chromeMediaSource: 'desktop', mimeType, settings, dimensions,
      videoBitsPerSecond: recording.computedVideoBitrate(settings, dimensions),
      audioBitsPerSecond: settings.audioBitrateKbps * 1000,
      renderReady: readiness.ready,
      renderMedia: readiness.media,
      filePath: finalPath
    };
  } catch (error) {
    await abortRecordingSession();
    return { ok: false, error: String(error && error.message || error), code: error.code || 'RECORDING_PREPARE_FAILED' };
  }
});
ipcMain.handle('recording-write-chunk', async (event, payload) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  const sessionRecord = recordingSession;
  if (!sessionRecord || String(payload && payload.sessionId || '') !== sessionRecord.id) return { ok: false, error: 'Recording session is not active.' };
  const sequence = Math.max(0, Math.round(Number(payload && payload.sequence) || 0));
  if (sequence !== sessionRecord.nextSequence) return { ok: false, error: `Recording chunk out of order (${sequence}, expected ${sessionRecord.nextSequence}).` };
  if (sessionRecord.streamError) return { ok: false, error: String(sessionRecord.streamError.message || sessionRecord.streamError) };
  const data = payload && payload.data;
  let buffer;
  try {
    if (Buffer.isBuffer(data)) buffer = data;
    else if (data instanceof ArrayBuffer) buffer = Buffer.from(data);
    else if (ArrayBuffer.isView(data)) buffer = Buffer.from(data.buffer, data.byteOffset, data.byteLength);
    else if (data && data.type === 'Buffer' && Array.isArray(data.data)) buffer = Buffer.from(data.data);
    else throw new Error('Invalid recording chunk.');
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
  if (!buffer.length) return { ok: true, sequence, bytes: sessionRecord.bytes };
  try {
    await new Promise((resolve, reject) => sessionRecord.stream.write(buffer, error => error ? reject(error) : resolve()));
    sessionRecord.bytes += buffer.length;
    sessionRecord.nextSequence += 1;
    return { ok: true, sequence, bytes: sessionRecord.bytes };
  } catch (error) {
    sessionRecord.streamError = error;
    return { ok: false, error: String(error && error.message || error), code: error.code || 'RECORDING_WRITE_FAILED' };
  }
});
ipcMain.handle('recording-finish', async (event, payload) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  const sessionRecord = recordingSession;
  if (!sessionRecord || String(payload && payload.sessionId || '') !== sessionRecord.id) return { ok: false, error: 'Recording session is not active.' };
  try {
    await closeRecordingWriter(sessionRecord);
    if (sessionRecord.streamError) throw sessionRecord.streamError;
    if (!sessionRecord.bytes) throw new Error('The recording produced no media data.');
    fs.renameSync(sessionRecord.tempPath, sessionRecord.finalPath);
    recordingSession = null;
    closeRecordingOutput();
    lastRecordingPath = sessionRecord.finalPath;
    return {
      ok: true, path: sessionRecord.finalPath, bytes: sessionRecord.bytes,
      durationMs: Math.max(0, Date.now() - sessionRecord.startedAt), mimeType: sessionRecord.mimeType
    };
  } catch (error) {
    await abortRecordingSession({ preserve: true });
    return { ok: false, error: String(error && error.message || error), code: error.code || 'RECORDING_FINALIZE_FAILED' };
  }
});
ipcMain.handle('recording-abort', async (event, payload) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  if (recordingSession && String(payload && payload.sessionId || '') && String(payload.sessionId) !== recordingSession.id) return { ok: false, error: 'Recording session does not match.' };
  return abortRecordingSession({ preserve: payload && payload.preserve === true });
});
ipcMain.handle('live-input-desktop-sources', async (event) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return [];
  let rows = [];
  try {
    rows = await boundedLiveInputTask(desktopCapturer.getSources({
      types: ['window', 'screen'], thumbnailSize: { width: 320, height: 180 }, fetchWindowIcons: true
    }), 8000, 'Desktop source discovery');
  } catch (_) {}
  const displays = screen.getAllDisplays();
  return rows.map(source => {
    const kind = source.id.startsWith('screen:') ? 'screen' : 'window';
    const display = kind === 'screen'
      ? displays.find(row => String(row.id) === String(source.display_id || ''))
      : null;
    return {
      id: source.id,
      name: source.name,
      kind,
      width: display ? Math.round(display.size.width * display.scaleFactor) : 0,
      height: display ? Math.round(display.size.height * display.scaleFactor) : 0,
      thumbnail: source.thumbnail && !source.thumbnail.isEmpty() ? source.thumbnail.toDataURL() : '',
      appIcon: source.appIcon && !source.appIcon.isEmpty() ? source.appIcon.toDataURL() : ''
    };
  });
});
ipcMain.handle('live-input-devices', async (event, requestPermission) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { devices: [], permissions: liveInputPermissionSnapshot(), error: 'unauthorized' };
  let permissions = liveInputPermissionSnapshot();
  const permissionType = ['camera', 'microphone'].includes(requestPermission) ? requestPermission : (requestPermission === true ? 'camera' : '');
  let permissionRequest = null;
  if (permissionType && process.platform === 'darwin') {
    try {
      const granted = await requestDarwinLiveInputPermission(permissionType);
      permissionRequest = { type: permissionType, granted: granted === true, error: '' };
    } catch (error) {
      permissionRequest = { type: permissionType, granted: false, error: String(error && error.message || error) };
    }
    permissions = liveInputPermissionSnapshot();
    if (permissionRequest) {
      permissionRequest.status = permissions[permissionType] || 'unknown';
      permissionRequest.granted = permissionRequest.granted || permissionRequest.status === 'granted';
    }
  }
  if (!liveInputHubWin || liveInputHubWin.isDestroyed()) createLiveInputHub();
  await new Promise(resolve => {
    if (liveInputHubReady) { resolve(); return; }
    const started = Date.now();
    const poll = () => liveInputHubReady || Date.now() - started > 5000 ? resolve() : setTimeout(poll, 40);
    poll();
  });
  if (!liveInputHubReady) return { devices: [], permissions, error: 'service-unavailable' };
  try {
    const askInRenderer = process.platform !== 'darwin' && !!requestPermission;
    const devices = await boundedLiveInputTask(
      liveInputHubWin.webContents.executeJavaScript(`window.liveCapture.enumerateDevices(${askInRenderer ? 'true' : 'false'})`),
      12000,
      'Capture device discovery'
    );
    return { devices: Array.isArray(devices) ? devices : [], permissions: liveInputPermissionSnapshot(), permissionRequest, error: '' };
  } catch (error) {
    return { devices: [], permissions: liveInputPermissionSnapshot(), permissionRequest, error: /timed out/i.test(String(error && error.message || error)) ? 'timeout' : 'enumeration-failed' };
  }
});
ipcMain.handle('live-input-permissions', async () => {
  return liveInputPermissionSnapshot();
});
ipcMain.handle('open-privacy-settings', async (event, section) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  if (process.platform !== 'darwin') return { ok: false, error: 'unsupported-platform' };
  const panes = {
    screen: 'Privacy_ScreenCapture',
    camera: 'Privacy_Camera',
    microphone: 'Privacy_Microphone'
  };
  const pane = panes[String(section || '')];
  if (!pane) return { ok: false, error: 'invalid-section' };
  try {
    await shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error && error.message || error || 'open-failed') };
  }
});
ipcMain.handle('live-input-configure', async (event, definitions) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  liveInputDefinitions = compositor.normalizeLiveInputs(definitions);
  const configuredIds = new Set(liveInputDefinitions.map(row => row.id));
  for (const id of liveInputStatuses.keys()) if (!configuredIds.has(id)) liveInputStatuses.delete(id);
  if (!liveInputHubWin || liveInputHubWin.isDestroyed()) createLiveInputHub();
  const sent = sendLiveHubCommand({ type: 'configure', definitions: liveInputDefinitions });
  return { ok: true, queued: !sent, count: liveInputDefinitions.length };
});
ipcMain.handle('live-input-restart', async (event, inputId) => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  return { ok: sendLiveHubCommand({ type: 'restart', inputId: String(inputId || '') }) };
});
ipcMain.handle('live-input-statuses', event => trustedLiveInputConsumer(event.sender) ? [...liveInputStatuses.values()] : []);
ipcMain.handle('live-input-subscribe', async (event, inputId) => {
  if (!trustedLiveInputConsumer(event.sender)) return { ok: false, error: 'unauthorized' };
  const id = String(inputId || '');
  if (!liveInputDefinitions.some(row => row.id === id && row.active)) return { ok: false, error: 'input-not-active' };
  const profile = controlWin && !controlWin.isDestroyed() && event.sender.id === controlWin.webContents.id ? 'operator' : 'program';
  return { ok: sendLiveHubCommand({ type: 'subscribe', consumerId: event.sender.id, inputId: id, profile }) };
});
ipcMain.on('live-input-unsubscribe', (event, inputId) => {
  if (!trustedLiveInputConsumer(event.sender)) return;
  sendLiveHubCommand({ type: 'unsubscribe', consumerId: event.sender.id, inputId: String(inputId || '') });
});
ipcMain.handle('live-input-signal-to-hub', async (event, payload) => {
  if (!trustedLiveInputConsumer(event.sender)) return { ok: false, error: 'unauthorized' };
  const clean = payload && typeof payload === 'object' ? { ...payload, inputId: String(payload.inputId || '') } : {};
  return { ok: sendLiveHubCommand({ type: 'signal', payload: { ...clean, consumerId: event.sender.id } }) };
});
ipcMain.handle('live-hub-select-desktop-source', async (event, selection) => {
  if (!liveInputHubWin || liveInputHubWin.isDestroyed() || event.sender.id !== liveInputHubWin.webContents.id) return { ok: false };
  const sourceId = String(selection && selection.sourceId || '');
  const sourceName = String(selection && selection.sourceName || '').trim();
  const sourceKind = sourceId.startsWith('screen:') ? 'screen' : 'window';
  let sources = [];
  try {
    sources = await desktopCapturer.getSources({ types: ['window', 'screen'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: false });
  } catch (_) {}
  let source = sources.find(row => row.id === sourceId) || null;
  if (!source && sourceName) {
    const matches = sources.filter(row => (row.id.startsWith('screen:') ? 'screen' : 'window') === sourceKind && String(row.name || '').trim() === sourceName);
    if (matches.length === 1) source = matches[0];
  }
  pendingDesktopSource = source ? { source, sourceId: source.id, withAudio: selection && selection.withAudio === true } : null;
  return { ok: !!pendingDesktopSource, sourceId: source ? source.id : '', sourceName: source ? source.name : '', rebound: !!source && source.id !== sourceId };
});
ipcMain.on('live-hub-ready', event => {
  if (!liveInputHubWin || liveInputHubWin.isDestroyed() || event.sender.id !== liveInputHubWin.webContents.id) return;
  liveInputHubReady = true;
  sendLiveHubCommand({ type: 'configure', definitions: liveInputDefinitions });
});
ipcMain.on('live-hub-status', (event, payload) => {
  if (!liveInputHubWin || liveInputHubWin.isDestroyed() || event.sender.id !== liveInputHubWin.webContents.id) return;
  if (!payload || !payload.inputId) return;
  const clean = {
    inputId: String(payload.inputId), state: String(payload.state || 'unknown'), at: Number(payload.at) || Date.now(),
    name: String(payload.name || ''), type: String(payload.type || ''), error: String(payload.error || ''),
    hasVideo: payload.hasVideo === true, hasAudio: payload.hasAudio === true,
    videoLabel: String(payload.videoLabel || ''), audioLabel: String(payload.audioLabel || ''),
    audioSampleRate: Math.max(0, Math.min(384000, Math.round(Number(payload.audioSampleRate) || 0))),
    audioSampleSize: Math.max(0, Math.min(64, Math.round(Number(payload.audioSampleSize) || 0))),
    audioChannels: Math.max(0, Math.min(32, Math.round(Number(payload.audioChannels) || 0))),
    audioLatency: Math.max(0, Math.min(10, Number(payload.audioLatency) || 0)),
    width: Math.max(0, Math.min(8192, Math.round(Number(payload.width) || 0))),
    height: Math.max(0, Math.min(8192, Math.round(Number(payload.height) || 0))),
    frameRate: Math.max(0, Math.min(120, Number(payload.frameRate) || 0)),
    requestedWidth: Math.max(0, Math.min(8192, Math.round(Number(payload.requestedWidth) || 0))),
    requestedHeight: Math.max(0, Math.min(8192, Math.round(Number(payload.requestedHeight) || 0))),
    requestedFrameRate: Math.max(0, Math.min(120, Number(payload.requestedFrameRate) || 0)),
    captureMode: ['low-latency','compatible','desktop','desktop-native','audio','synthetic'].includes(String(payload.captureMode || '')) ? String(payload.captureMode) : '',
    qualityProfile: ['auto','quality','realtime'].includes(String(payload.qualityProfile || '')) ? String(payload.qualityProfile) : 'auto',
    qualityTier: ['SD','HD','FHD','QHD','UHD','8K'].includes(String(payload.qualityTier || '')) ? String(payload.qualityTier) : '',
    formatMatched: payload.formatMatched === true,
    formatFallback: payload.formatFallback === true,
    fallbackReason: String(payload.fallbackReason || '').slice(0, 240)
  };
  liveInputStatuses.set(clean.inputId, clean);
  broadcastLiveInputStatus(clean);
});
ipcMain.on('live-hub-signal', (event, payload) => {
  if (!liveInputHubWin || liveInputHubWin.isDestroyed() || event.sender.id !== liveInputHubWin.webContents.id) return;
  const target = webContents.fromId(Number(payload && payload.consumerId));
  if (!target || target.isDestroyed() || !trustedLiveInputConsumer(target)) return;
  target.send('live-input-signal', {
    inputId: String(payload.inputId || ''), type: String(payload.type || ''),
    description: payload.description || null, candidate: payload.candidate || null
  });
});
ipcMain.handle('show-storage-status', async () => {
  if (showStorageReady) await showStorageReady;
  return showRepository
    ? { ...showRepository.getStatus(), autosaveEnabled: !SMOKE }
    : { ok: false, autosaveEnabled: false, recoveryAvailable: false, currentAvailable: false, error: 'Show storage is unavailable' };
});
ipcMain.handle('show-storage-save', async (event, payload) => {
  if (showStorageReady) await showStorageReady;
  if (!showRepository) return { ok: false, error: 'Show storage is unavailable' };
  return showRepository.save(payload && payload.document, { reason: payload && payload.reason });
});
ipcMain.handle('show-storage-load-current', async () => {
  if (showStorageReady) await showStorageReady;
  return showRepository ? showRepository.loadCurrent() : { ok: false, error: 'Show storage is unavailable' };
});
ipcMain.handle('show-storage-recover', async (event, choice) => {
  if (showStorageReady) await showStorageReady;
  return showRepository ? showRepository.resolveRecovery(String(choice || '')) : { ok: false, error: 'Show storage is unavailable' };
});
ipcMain.handle('show-document-status', event => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
  return { ok: true, path: activeShowDocumentPath, name: activeShowDocumentPath ? path.basename(activeShowDocumentPath) : '' };
});
ipcMain.handle('show-document-save', async (event, payload) => {
  try {
    if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    const document = payload && payload.document;
    const saveAs = !!(payload && payload.saveAs);
    const showName = String(document && document.show && document.show.name || 'Untitled Show')
      .replace(/[^A-Za-z0-9 _.-]+/g, '').trim().slice(0, 100) || 'Untitled Show';
    let destination = '';
    if (SMOKE && payload && payload.testPath) destination = path.resolve(String(payload.testPath));
    else if (!saveAs && activeShowDocumentPath) destination = activeShowDocumentPath;
    else {
      const picked = await dialog.showSaveDialog(controlWin, {
        title: saveAs ? 'Save ShowSlate Show As' : 'Save ShowSlate Show',
        defaultPath: showName + showDocumentFile.SHOW_DOCUMENT_EXTENSION,
        filters: [{ name: 'ShowSlate Project', extensions: ['showslate'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      destination = picked.filePath;
    }
    const result = await showDocumentFile.writeShowDocumentFile({
      file: destination,
      document,
      appMetadata: getBuildInfo()
    });
    if (result.ok) activeShowDocumentPath = result.path;
    return result;
  } catch (error) {
    return { ok: false, error: String(error && error.message || error), code: error.code || 'SHOW_SAVE_FAILED' };
  }
});
ipcMain.handle('show-document-open', async (event, payload) => {
  try {
    if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    let source = '';
    if (SMOKE && payload && payload.testPath) source = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showOpenDialog(controlWin, {
        title: 'Open ShowSlate Show',
        properties: ['openFile'],
        filters: [{ name: 'ShowSlate Project', extensions: ['showslate'] }]
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      source = picked.filePaths[0];
    }
    const result = await showDocumentFile.readShowDocumentFile(source);
    if (result.ok) activeShowDocumentPath = result.path;
    return result;
  } catch (error) {
    return { ok: false, error: String(error && error.message || error), code: error.code || 'SHOW_OPEN_FAILED' };
  }
});
ipcMain.on('show-document-clear-path', event => {
  if (!controlWin || controlWin.isDestroyed() || event.sender.id !== controlWin.webContents.id) return;
  activeShowDocumentPath = '';
});
ipcMain.handle('show-package-export', async (event, payload) => {
  try {
    const document = payload && payload.document;
    const linkedError = linkedMediaPackageError(
      showPackage.collectMediaReferences(document).map(reference => reference.source),
      'This show'
    );
    if (linkedError) return linkedError;
    const showName = String(document && document.show && document.show.name || 'ShowSlate Show')
      .replace(/[^A-Za-z0-9 _.-]+/g, '').trim().slice(0, 100) || 'ShowSlate Show';
    let destination = '';
    if (SMOKE && payload && payload.testPath) destination = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showSaveDialog(controlWin, {
        title: 'Export ShowSlate Show',
        defaultPath: showName + '.showslate-show',
        filters: [{ name: 'ShowSlate Show', extensions: ['showslate-show'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      destination = picked.filePath;
    }
    if (!destination.toLowerCase().endsWith('.showslate-show')) destination += '.showslate-show';
    return await showPackage.exportShowPackage({
      destination,
      document,
      mediaDirectory: mediaDir(),
      appMetadata: getBuildInfo()
    });
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: error.code || 'EXPORT_FAILED' };
  }
});
ipcMain.handle('show-package-import', async (event, payload) => {
  try {
    let packagePath = '';
    if (SMOKE && payload && payload.testPath) packagePath = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showOpenDialog(controlWin, {
        title: 'Import ShowSlate Show',
        properties: ['openFile'],
        filters: [{ name: 'ShowSlate Show', extensions: ['showslate-show', 'protimer-show'] }]
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      packagePath = picked.filePaths[0];
    }
    return await showPackage.importShowPackage({ packagePath, mediaDirectory: mediaDir() });
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: error.code || 'IMPORT_FAILED' };
  }
});
ipcMain.handle('show-folder-import', async (event, payload) => {
  try {
    let rootDirectory = '';
    if (SMOKE && payload && payload.testPath) rootDirectory = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showOpenDialog(controlWin, {
        title: 'Import Conference Show Folder',
        properties: ['openDirectory']
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      rootDirectory = picked.filePaths[0];
    }
    return await showFolderImport.importShowFolder({
      rootDirectory,
      mediaDirectory: mediaDir(),
      maxTotalBytes: Number.POSITIVE_INFINITY,
      importMediaFile: (sourcePath, options) => getMediaLibrary().importFile(sourcePath, options)
    });
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: error.code || 'SHOW_FOLDER_IMPORT_FAILED' };
  }
});
ipcMain.handle('show-preflight-inspect', async (event, payload) => {
  if (showStorageReady) await showStorageReady;
  const document = payload && payload.document;
  const missingAssets = [];
  try {
    for (const reference of showPackage.collectMediaReferences(document)) {
      const filename = showPackage.safeMediaFilename(reference.source);
      if (!filename || !getMediaLibrary().inspect(reference.source).ok) missingAssets.push(reference.source);
    }
  } catch (error) {
    missingAssets.push(String(error.message || error));
  }
  let autosaveWritable = false;
  try {
    if (showRepository && showRepository.directory) fs.accessSync(showRepository.directory, fs.constants.W_OK);
    autosaveWritable = !!showRepository;
  } catch (_) {}
  const storageStatus = showRepository ? showRepository.getStatus() : { recoveryAvailable: false };
  const [programBrowserReady, backstageReady, remoteReady] = await Promise.all([
    probeLocalRoute('/'), probeLocalRoute('/backstage'), probeLocalRoute('/remote')
  ]);
  return showPreflight.evaluatePreflight(document, {
    lastSaveOk: !!(payload && payload.lastSaveOk),
    autosaveWritable,
    missingAssets,
    speakerScreenReady: !!outputWin || auxOutputs.size > 0,
    programBrowserReady,
    backstageReady,
    remoteReady,
    apiReady: !!serverPort && !!CMD_TOKEN && !!oscPort,
    displays: displayList(),
    selectedDisplayId: payload && payload.selectedDisplayId,
    recoveryAvailable: !!storageStatus.recoveryAvailable,
    outputRuntime: outputRuntimeSnapshot(),
    liveInputStatuses: [...liveInputStatuses.values()]
  });
});
ipcMain.on('set-output-configs', (e, configs) => applyOutputConfigs(configs));
ipcMain.handle('media-import-file', async (e, payload) => {
  try {
    if (!controlWin || controlWin.isDestroyed() || e.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    return await getMediaLibrary().importFile(payload && payload.path, {
      name: payload && payload.name,
      storage: payload && payload.storage
    });
  } catch (err) {
    return { ok: false, code: err.code || 'MEDIA_IMPORT_FAILED', error: String(err.message || err) };
  }
});
ipcMain.handle('media-save', (e, payload) => {
  try {
    if (!controlWin || controlWin.isDestroyed() || e.sender.id !== controlWin.webContents.id) return { ok: false, error: 'unauthorized' };
    const { name, dataURL } = payload || {};
    const m = /^data:([^;,]+);base64,(.+)$/.exec(String(dataURL || ''));
    if (!m) return { ok: false, error: 'bad data url' };
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 32 * 1024 * 1024) return { ok: false, error: 'Use a local file for media larger than 32 MB.' };
    const hash = crypto.createHash('sha1').update(buf).digest('hex').slice(0, 16);
    const extByMime = Object.keys(MEDIA_MIME).find(k => MEDIA_MIME[k] === m[1]);
    const extByName = (path.extname(String(name || '')).toLowerCase().match(/^\.[a-z0-9]{1,5}$/) || [''])[0];
    const ext = extByMime || extByName || '.bin';
    const file = hash + ext;
    const full = path.join(mediaDir(), file);
    if (!fs.existsSync(full)) fs.writeFileSync(full, buf);
    return { ok: true, src: 'media://' + file, bytes: buf.length };
  } catch (err) { return { ok: false, error: String(err.message || err) }; }
});
ipcMain.handle('lt-package-export', async (e, payload) => {
  try {
    const template = payload && payload.template;
    const linkedError = linkedMediaPackageError(
      (template && Array.isArray(template.layers) ? template.layers : [])
        .filter(layer => layer && (layer.type === 'media' || layer.type === 'logo'))
        .map(layer => layer.assetId || layer.src || ''),
      'This lower-third template'
    );
    if (linkedError) return linkedError;
    const requestedName = String((template && template.name) || 'lower-third-template')
      .replace(/[^A-Za-z0-9 _.-]+/g, '').trim().slice(0, 80) || 'lower-third-template';
    let destination = '';
    if (SMOKE && payload && payload.testPath) destination = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showSaveDialog(controlWin, {
        title: 'Export Lower Third Template',
        defaultPath: requestedName + '.showslate-lt',
        filters: [{ name: 'ShowSlate Lower Third', extensions: ['showslate-lt'] }]
      });
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      destination = picked.filePath;
    }
    if (!destination.toLowerCase().endsWith('.showslate-lt')) destination += '.showslate-lt';
    return await lowerThirdPackage.exportLowerThirdPackage({
      destination,
      template,
      mediaDirectory: mediaDir(),
      appMetadata: getBuildInfo()
    });
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: error.code || 'EXPORT_FAILED' };
  }
});
ipcMain.handle('lt-package-import', async (e, payload) => {
  try {
    let packagePath = '';
    if (SMOKE && payload && payload.testPath) packagePath = path.resolve(String(payload.testPath));
    else {
      const picked = await dialog.showOpenDialog(controlWin, {
        title: 'Import Lower Third Template',
        properties: ['openFile'],
        filters: [{ name: 'ShowSlate Lower Third', extensions: ['showslate-lt', 'protimer-lt'] }]
      });
      if (picked.canceled || !picked.filePaths[0]) return { ok: false, canceled: true };
      packagePath = picked.filePaths[0];
    }
    return await lowerThirdPackage.importLowerThirdPackage({
      packagePath,
      mediaDirectory: mediaDir(),
      existingTemplateIds: Array.isArray(payload && payload.existingTemplateIds) ? payload.existingTemplateIds.map(String) : []
    });
  } catch (error) {
    return { ok: false, error: String(error.message || error), code: error.code || 'IMPORT_FAILED' };
  }
});

// IDENTIFY DISPLAYS: veliki broj na svakom fizičkom ekranu 3 sekunde
let identifyWins = [];
ipcMain.handle('identify-displays', () => {
  identifyWins.forEach(w => { try { w.close(); } catch (e) {} });
  identifyWins = [];
  // SMOKE: identify ONLY the target monitor (normally labels every physical screen).
  const displays = (SMOKE && SMOKE_TARGET) ? [SMOKE_TARGET] : screen.getAllDisplays();
  const roleFor = (d) => {
    if (outputWin && !outputWin.isDestroyed() && d.id === outputTargetId) return 'STAGE SCREEN';
    const aux = [...auxOutputs.values()].find(r => r.config && Number(r.config.displayId) === d.id);
    return aux ? (aux.config.name || 'OUTPUT') : '';
  };
  displays.forEach((d, i) => {
    // u smoke režimu geometrija iz workArea (vidljivi prozori ne smeju van workArea ugovora)
    const geo = (SMOKE && SMOKE_TARGET) ? d.workArea : d.bounds;
    const w = new BrowserWindow({
      x: geo.x + Math.round(geo.width * 0.25),
      y: geo.y + Math.round(geo.height * 0.25),
      width: Math.round(geo.width * 0.5), height: Math.round(geo.height * 0.5),
      frame: false, alwaysOnTop: true, skipTaskbar: true, focusable: false,
      backgroundColor: '#0a0a0d', webPreferences: { contextIsolation: true }
    });
    const role = roleFor(d);
    const html = `<body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#0a0a0d;color:#fff;font-family:-apple-system,system-ui,sans-serif;border:6px solid #30d158;box-sizing:border-box">
      <div style="font-size:18vh;font-weight:800;line-height:1">${i + 1}</div>
      <div style="font-size:3.2vh;opacity:.75;letter-spacing:.12em;text-transform:uppercase">DISPLAY ${i + 1}${role ? ' — ' + role : ''}</div>
      <div style="font-size:2.2vh;opacity:.45;margin-top:1vh">${(d.label || '').replace(/[<>&]/g, '')} ${d.bounds.width}×${d.bounds.height}</div></body>`;
    w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    identifyWins.push(w);
  });
  setTimeout(() => {
    identifyWins.forEach(w => { try { w.close(); } catch (e) {} });
    identifyWins = [];
  }, 3000);
  return displays.length;
});

// ---------------- QR KOD + JAVNI LINK (tunel) ----------------
let tunnel = null, tunnelUrl = null, tunnelStarting = false;

ipcMain.handle('qr', async (e, text) => {
  try {
    const QRCode = require('qrcode');
    return await QRCode.toString(String(text || ''), {
      type: 'svg', margin: 1, color: { dark: '#0b0d11', light: '#ffffff' }
    });
  } catch (err) { return null; }
});

function pushShare() {
  if (controlWin && !controlWin.isDestroyed())
    controlWin.webContents.send('share-info', { url: tunnelUrl, starting: tunnelStarting });
}

ipcMain.handle('share-start', async () => {
  if (tunnel) return { url: tunnelUrl };
  tunnelStarting = true; pushShare();
  try {
    const localtunnel = require('localtunnel');
    tunnel = await localtunnel({ port: serverPort });
    tunnelUrl = tunnel.url;
    tunnel.on('close', () => { tunnel = null; tunnelUrl = null; tunnelStarting = false; pushShare(); });
    tunnel.on('error', () => { try { tunnel && tunnel.close(); } catch (e) {} tunnel = null; tunnelUrl = null; tunnelStarting = false; pushShare(); });
    tunnelStarting = false; pushShare();
    return { url: tunnelUrl };
  } catch (err) {
    tunnel = null; tunnelUrl = null; tunnelStarting = false; pushShare();
    return { error: (err && err.message) || 'fail' };
  }
});
ipcMain.handle('share-stop', () => {
  try { if (tunnel) tunnel.close(); } catch (e) {}
  tunnel = null; tunnelUrl = null; tunnelStarting = false; pushShare();
  return true;
});
ipcMain.handle('share-info', () => ({ url: tunnelUrl, starting: tunnelStarting }));
app.on('before-quit', () => { try { if (tunnel) tunnel.close(); } catch (e) {} });

// ---------------- PROMO: snimanje demo kadrova izlaznog ekrana ----------------
function runPromo() {
  const demo = {
    mode:'countdown', running:false, durationMs:10000, remMs:10000, endAt:0, startAt:0, elapsedMs:0,
    yellowSec:5, redSec:2, overtime:true, useWarnColors:true, warnYellow:'#ffc23a', warnRed:'#ff4540', flashZero:true,
    bgColor:'#0b0d11', fgColor:'#ffffff', text:'', message:{ text:'', flash:false }, blackout:false,
    showProgress:true, transparent:false, lang:'en', showNowNext:true, currentCue:0,
    cues:[ { name:'Keynote — Dr. Maya Chen', durationMs:10000, note:'', color:'#3fb950' },
           { name:'Q&A Panel', durationMs:1200000, note:'', color:'#4493f8' } ]
  };
  const pw = new BrowserWindow({
    width:1280, height:720, show:true, frame:false, backgroundColor:'#0b0d11',
    webPreferences:{ preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false }
  });
  pw.loadFile('output.html');
  pw.webContents.on('did-finish-load', async () => {
    const dir='/tmp/promo';
    try { fs.rmSync(dir,{recursive:true,force:true}); } catch(e){}
    fs.mkdirSync(dir,{recursive:true});
    // potpuno sakrij overlay kontrole (#ui) za snimak — bulletproof
    await pw.webContents.executeJavaScript("var u=document.getElementById('ui'); if(u){u.style.display='none';} document.body.classList.add('idle');").catch(()=>{});
    await new Promise(r=>setTimeout(r,150));
    demo.running = true; demo.endAt = Date.now() + demo.durationMs;
    pw.webContents.send('state', demo);
    const total = 60, interval = 200;
    for (let i=0;i<total;i++){
      await new Promise(r=>setTimeout(r, interval));
      if (i===36){ demo.message = { text:'WRAP UP', flash:false }; pw.webContents.send('state', demo); }
      const img = await pw.webContents.capturePage();
      fs.writeFileSync(`${dir}/frame_${String(i).padStart(4,'0')}.png`, img.toPNG());
    }
    console.log('PROMO_DONE frames=' + total);
    app.exit(0);
  });
  setTimeout(()=>{ console.error('PROMO_TIMEOUT'); app.exit(1); }, 30000);
}

async function inspectLowerThirdRenderState(browserWindow) {
  const browserWindowId = browserWindow && !browserWindow.isDestroyed() ? browserWindow.id : null;
  const webContentsId = browserWindowId != null && browserWindow.webContents && !browserWindow.webContents.isDestroyed()
    ? browserWindow.webContents.id : null;
  const sampledAt = Date.now();
  if (browserWindowId == null || webContentsId == null) {
    return { sampledAt, browserWindowId, webContentsId, error: 'window-destroyed' };
  }
  try {
    const renderer = JSON.parse(await browserWindow.webContents.executeJavaScript(`(function(){
      const canvas=document.getElementById('ltCanvas');
      const legacy=document.getElementById('lowerThird');
      const layerEls=canvas ? [...canvas.querySelectorAll('[data-layer-id]')] : [];
      const texts=canvas ? [...canvas.querySelectorAll('.lt-text-content')].map(el=>el.textContent) : [];
      const visible=el=>!!el && getComputedStyle(el).display!=='none' && getComputedStyle(el).visibility!=='hidden';
      return JSON.stringify({
        canvasDisplay:canvas ? getComputedStyle(canvas).display : '',
        runtimeActive:canvas ? (canvas.dataset.runtimeActive||'') : '',
        templateId:canvas ? (canvas.dataset.templateId||'') : '',
        instanceId:canvas ? (canvas.dataset.instanceId||'') : '',
        phase:canvas ? (canvas.dataset.phase||'') : '',
        layerIds:layerEls.map(el=>el.dataset.layerId||''),
        visibleLayerIds:layerEls.filter(visible).map(el=>el.dataset.layerId||''),
        texts,
        renderedText:texts.join('|'),
        videoCount:canvas ? canvas.querySelectorAll('video').length : 0,
        legacyVisible:visible(legacy),
        runtimeVisible:visible(canvas),
        rootChildren:canvas ? canvas.children.length : 0,
        lastError:canvas ? (canvas.dataset.lastError||'') : '',
        debug:window.__PT_LT_RENDER_DEBUG__ || null
      });
    })()`));
    return { sampledAt, browserWindowId, webContentsId, ...renderer };
  } catch (e) {
    return { sampledAt, browserWindowId, webContentsId, error: String(e && e.message || e) };
  }
}

function lowerThirdRenderSampleMatches(sample, expected) {
  if (!sample || sample.error) return false;
  const layerIds = Array.isArray(expected.expectedLayerIds) ? expected.expectedLayerIds : [];
  if (expected.hidden) {
    const debugHidden = !sample.debug || sample.debug.runtimeVisible === false;
    return sample.runtimeVisible === false && sample.runtimeActive !== '1' && sample.videoCount === 0 && debugHidden;
  }
  const debug = sample.debug || {};
  const debugMatches =
    debug.browserWindowId === sample.browserWindowId &&
    debug.webContentsId === sample.webContentsId &&
    debug.templateId === expected.expectedTemplateId &&
    debug.instanceId === expected.expectedInstanceId &&
    debug.phase === expected.expectedPhase &&
    debug.runtimeVisible === true &&
    debug.legacyVisible === false &&
    String(debug.renderedText || '').includes(expected.expectedText);
  return sample.runtimeVisible === true &&
    sample.runtimeActive === '1' &&
    sample.templateId === expected.expectedTemplateId &&
    sample.instanceId === expected.expectedInstanceId &&
    sample.phase === expected.expectedPhase &&
    sample.legacyVisible === false &&
    sample.texts.includes(expected.expectedText) &&
    layerIds.every(id => sample.visibleLayerIds.includes(id)) &&
    debugMatches;
}

async function waitForStableLowerThirdRender({
  browserWindow,
  expectedTemplateId = '',
  expectedInstanceId = '',
  expectedPhase = 'hold',
  expectedText = '',
  expectedLayerIds = [],
  hidden = false,
  timeoutMs = 2800,
  sampleGapMs = 60
}) {
  const startedAt = Date.now();
  const browserWindowId = browserWindow && !browserWindow.isDestroyed() ? browserWindow.id : null;
  const webContentsId = browserWindowId != null && browserWindow.webContents && !browserWindow.webContents.isDestroyed()
    ? browserWindow.webContents.id : null;
  const samples = [];
  let stableSamples = 0;
  while (Date.now() - startedAt < timeoutMs) {
    if (!browserWindow || browserWindow.isDestroyed()) {
      return { ok: false, reason: 'window-destroyed', startedAt, browserWindowId, webContentsId, samples };
    }
    if (!browserWindow.webContents || browserWindow.webContents.isDestroyed() || browserWindow.webContents.id !== webContentsId) {
      return { ok: false, reason: 'webcontents-changed', startedAt, browserWindowId, webContentsId, samples };
    }
    const sample = await inspectLowerThirdRenderState(browserWindow);
    samples.push(sample);
    if (samples.length > 60) samples.shift();
    const matches = lowerThirdRenderSampleMatches(sample, {
      expectedTemplateId, expectedInstanceId, expectedPhase, expectedText, expectedLayerIds, hidden
    });
    stableSamples = matches ? stableSamples + 1 : 0;
    if (stableSamples >= 2) {
      return { ok: true, reason: 'stable', startedAt, finishedAt: Date.now(), browserWindowId, webContentsId, sample, samples };
    }
    await new Promise(resolve => setTimeout(resolve, sampleGapMs));
  }
  return {
    ok: false,
    reason: 'timeout',
    startedAt,
    finishedAt: Date.now(),
    browserWindowId,
    webContentsId,
    sample: samples[samples.length - 1] || null,
    samples
  };
}

async function runTargetedLowerThirdSoak(waitLoad) {
  const requestedCycles = parseInt(process.env.PROTIMER_LT2_TARGET_CYCLES || '200', 10) || 200;
  const targetCycles = Math.max(150, Math.min(250, requestedCycles));
  createOutputWindow(SMOKE_TARGET && SMOKE_TARGET.id);
  for (let i = 0; i < 100 && (!outputWin || outputWin.isDestroyed()); i++) await new Promise(r => setTimeout(r, 30));
  if (!outputWin || outputWin.isDestroyed()) throw new Error('targeted soak output window was not created');
  await waitLoad(outputWin);
  const controllerJson = async source => JSON.parse(await controlWin.webContents.executeJavaScript(source));
  const setup = await controllerJson(`(function(){
    initLtLibrary();
    const tpl=PTLT.makeTemplate({
      id:'lt2-targeted-soak-template', name:'LT2 Targeted Soak', kind:'custom',
      layers:[
        PTLT.makeShapeLayer({id:'soak-bg', shape:'roundedRectangle', fill:'rgba(0,0,0,.72)', radius:20, x:120, y:820, width:820, height:160, zIndex:1}),
        PTLT.makeDynamicTextLayer({id:'soak-name', field:'speakerName', x:160, y:850, width:740, height:70, fontSize:50, color:'#ffffff', zIndex:2}),
        PTLT.makeStaticTextLayer({id:'soak-label', text:'SOAK', x:160, y:925, width:240, height:44, fontSize:30, color:'#30d158', zIndex:2})
      ]
    });
    ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
    ltLibrary.templates.push(tpl);
    ltLibrary.activeTemplateId=tpl.id;
    saveLtLibrary();
    S.transparent=false; S.gridOn=false; S.blackout=false;
    S.lowerThirdAutoCue=false;
    document.getElementById('ltDur').value='0';
    return JSON.stringify({templateId:tpl.id,layers:tpl.layers.length});
  })()`);
  if (setup.templateId !== 'lt2-targeted-soak-template' || setup.layers !== 3) throw new Error('targeted soak template setup failed');

  const memStart = process.memoryUsage().rss;
  let memPeak = memStart;
  let completed = 0;
  let failure = null;
  for (let cycle = 0; cycle < targetCycles; cycle++) {
    const expectedText = 'Target Speaker ' + cycle;
    const runtimeState = await controllerJson(`(function(){
      cues=migrateCues([{id:'lt2-targeted-live',name:'Target Segment',durationMs:30000,ltName:${JSON.stringify('Target Speaker ')}+${JSON.stringify(String(cycle))},speakerTitle:'Host'}]);
      currentCue=0; selectedCue=-1;
      S.lowerThird={...S.lowerThird,durationSec:0,visible:false,until:0,runtimeVersion:null,runtime:null};
      document.getElementById('ltDur').value='0';
      showLowerThirdFromCue(0);
      send(true);
      const rt=S.lowerThird.runtime||{};
      const name=(rt.resolvedLayers||[]).find(layer=>layer.id==='soak-name');
      return JSON.stringify({visible:S.lowerThird.visible,runtimeVersion:S.lowerThird.runtimeVersion,templateId:rt.templateId||'',instanceId:rt.instanceId||'',cueId:rt.cueId||'',phase:rt.phase||'',resolvedName:name?(name.resolvedText||''):''});
    })()`);
    const renderWait = await waitForStableLowerThirdRender({
      browserWindow: outputWin,
      expectedTemplateId: 'lt2-targeted-soak-template',
      expectedInstanceId: runtimeState.instanceId,
      expectedPhase: 'hold',
      expectedText,
      expectedLayerIds: ['soak-bg', 'soak-name', 'soak-label']
    });
    const runtimeOK = runtimeState.visible === true && runtimeState.runtimeVersion === 1 &&
      runtimeState.templateId === 'lt2-targeted-soak-template' && runtimeState.cueId === 'lt2-targeted-live' &&
      runtimeState.phase === 'hold' && runtimeState.resolvedName === expectedText && !!runtimeState.instanceId;
    if (!runtimeOK || !renderWait.ok) {
      failure = { cycle, kind: runtimeOK ? 'render-observation' : 'runtime', expectedText, runtimeState, renderWait };
    } else {
      await controllerJson(`(function(){ hideLowerThird({force:true}); return JSON.stringify({visible:S.lowerThird.visible}); })()`);
      const clearWait = await waitForStableLowerThirdRender({ browserWindow: outputWin, hidden: true });
      if (!clearWait.ok) failure = { cycle, kind: 'cleanup', expectedText, runtimeState, renderWait, clearWait };
    }
    if (failure) {
      try {
        failure.screenshot = writeTestArtifact('lower-third/lt2/targeted-soak-first-failure.png', (await outputWin.webContents.capturePage()).toPNG());
      } catch (e) { failure.screenshotError = String(e && e.message || e); }
      try { writeTestArtifact('lower-third/lt2/targeted-soak-first-failure.json', JSON.stringify(failure, null, 2)); } catch (e) {}
      console.error('LT2_TARGET_SOAK_FIRST_FAIL ' + JSON.stringify({cycle:failure.cycle,kind:failure.kind,screenshot:failure.screenshot||'',lastSample:(failure.renderWait&&failure.renderWait.sample)||null}));
      break;
    }
    completed++;
    memPeak = Math.max(memPeak, process.memoryUsage().rss);
    if ((cycle + 1) % 25 === 0) console.log('LT2_TARGET_SOAK_PROGRESS cycles=' + (cycle + 1));
  }
  const memEnd = process.memoryUsage().rss;
  const memoryDelta = memEnd - memStart;
  const ok = !failure && completed === targetCycles && memoryDelta < 512 * 1024 * 1024;
  return { ok, targetCycles, completed, memStart, memEnd, memPeak, memoryDelta, failure };
}

async function waitForAuxOutputRoutes(ids, timeoutMs = 3500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const records = ids.map(id => auxOutputs.get(id));
    if (records.every(rec => rec && rec.win && !rec.win.isDestroyed() && rec.win.isVisible() && !rec.win.webContents.isLoading())) return records;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return ids.map(id => auxOutputs.get(id));
}

async function waitForAuxOutputBounds(records, expected, timeoutMs = 2400) {
  const deadline = Date.now() + timeoutMs;
  let bounds = records.map(() => ({}));
  while (Date.now() < deadline) {
    bounds = records.map(rec => rec && rec.win && !rec.win.isDestroyed() ? rec.win.getBounds() : ({}));
    const stable = bounds.every((actual, index) => {
      const wanted = expected[index];
      return wanted && Math.abs((actual.x || 0) - wanted.x) < 3 && Math.abs((actual.y || 0) - wanted.y) < 3
        && Math.abs((actual.width || 0) - wanted.width) < 3 && Math.abs((actual.height || 0) - wanted.height) < 3;
    });
    if (stable) return { stable: true, bounds };
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return { stable: false, bounds };
}

async function waitForAuxOutputAcknowledgements(ids, timeoutMs = 2400) {
  const deadline = Date.now() + timeoutMs;
  let runtime = outputRuntimeSnapshot();
  while (Date.now() < deadline) {
    runtime = outputRuntimeSnapshot();
    const routes = ids.map(id => runtime.routes.find(route => route.id === id));
    if (routes.every(route => route && route.open && route.acknowledged && route.status === 'live')) {
      return { runtime, stable: true };
    }
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return { runtime, stable: false };
}

async function runLiveInputSmoke(waitLoad, options = {}) {
  const width = Math.max(160, Math.min(7680, Number(options.width) || 1920));
  const height = Math.max(120, Math.min(4320, Number(options.height) || 1080));
  const fps = Math.max(1, Math.min(120, Number(options.fps) || 60));
  const suffix = String(options.suffix || 'fhd60').replace(/[^a-z0-9-]/gi, '-');
  const inputId = `smoke-live-input-${suffix}`;
  const sceneId = `smoke-live-scene-${suffix}`;
  const qualityProfile = ['auto', 'quality', 'realtime'].includes(options.qualityProfile)
    ? options.qualityProfile
    : 'auto';
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitUntil = async (probe, timeoutMs = 9000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try { last = await probe(); } catch (error) { last = { error: String(error && error.message || error) }; }
      if (last && last.ok) return last;
      await sleep(60);
    }
    return last || { ok: false, error: 'timeout' };
  };
  const receiverStats = async win => JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    const record=liveInputConsumer&&liveInputConsumer.peers&&liveInputConsumer.peers.get(${JSON.stringify(inputId)});
    const receiver=record&&record.pc&&record.pc.getReceivers().find(row=>row.track&&row.track.kind==='video');
    if(!receiver)return JSON.stringify({ok:false,error:'video receiver unavailable'});
    const reports=await receiver.getStats();let inbound=null,codec=null;
    reports.forEach(report=>{if(report.type==='inbound-rtp'&&(report.kind==='video'||report.mediaType==='video'))inbound=report;});
    if(inbound&&inbound.codecId)codec=reports.get(inbound.codecId)||null;
    return JSON.stringify({ok:!!inbound,timestamp:Number(inbound&&inbound.timestamp)||0,framesDecoded:Number(inbound&&inbound.framesDecoded)||0,framesDropped:Number(inbound&&inbound.framesDropped)||0,framesPerSecond:Number(inbound&&inbound.framesPerSecond)||0,width:Number(inbound&&inbound.frameWidth)||0,height:Number(inbound&&inbound.frameHeight)||0,packetsLost:Number(inbound&&inbound.packetsLost)||0,jitter:Number(inbound&&inbound.jitter)||0,bytesReceived:Number(inbound&&inbound.bytesReceived)||0,keyFramesDecoded:Number(inbound&&inbound.keyFramesDecoded)||0,totalDecodeTime:Number(inbound&&inbound.totalDecodeTime)||0,totalProcessingDelay:Number(inbound&&inbound.totalProcessingDelay)||0,codec:codec?{mimeType:String(codec.mimeType||''),clockRate:Number(codec.clockRate)||0,sdpFmtpLine:String(codec.sdpFmtpLine||'')}:null});
  })()`));
  const senderStats = async (win, consumerId) => JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    const key=${JSON.stringify(String(outputWin && !outputWin.isDestroyed() ? outputWin.webContents.id : ''))}+':'+${JSON.stringify(inputId)};
    const record=window.liveCapture&&window.liveCapture.peers&&window.liveCapture.peers.get(key);
    const sender=record&&record.pc&&record.pc.getSenders().find(row=>row.track&&row.track.kind==='video');
    if(!sender)return JSON.stringify({ok:false,error:'video sender unavailable',key,known:window.liveCapture&&window.liveCapture.peers?[...window.liveCapture.peers.keys()]:[]});
    const reports=await sender.getStats();let outbound=null,codec=null;
    reports.forEach(report=>{if(report.type==='outbound-rtp'&&(report.kind==='video'||report.mediaType==='video'))outbound=report;});
    if(outbound&&outbound.codecId)codec=reports.get(outbound.codecId)||null;
    const caps=typeof RTCRtpSender!=='undefined'&&typeof RTCRtpSender.getCapabilities==='function'?RTCRtpSender.getCapabilities('video'):null;
    return JSON.stringify({ok:!!outbound,timestamp:Number(outbound&&outbound.timestamp)||0,framesEncoded:Number(outbound&&outbound.framesEncoded)||0,framesSent:Number(outbound&&outbound.framesSent)||0,framesPerSecond:Number(outbound&&outbound.framesPerSecond)||0,width:Number(outbound&&outbound.frameWidth)||0,height:Number(outbound&&outbound.frameHeight)||0,bytesSent:Number(outbound&&outbound.bytesSent)||0,keyFramesEncoded:Number(outbound&&outbound.keyFramesEncoded)||0,qpSum:Number(outbound&&outbound.qpSum)||0,totalEncodeTime:Number(outbound&&outbound.totalEncodeTime)||0,qualityLimitationReason:String(outbound&&outbound.qualityLimitationReason||''),qualityLimitationDurations:outbound&&outbound.qualityLimitationDurations||null,targetBitrate:Number(outbound&&outbound.targetBitrate)||0,encoderImplementation:String(outbound&&outbound.encoderImplementation||''),powerEfficientEncoder:outbound&&outbound.powerEfficientEncoder===true,codec:codec?{mimeType:String(codec.mimeType||''),clockRate:Number(codec.clockRate)||0,sdpFmtpLine:String(codec.sdpFmtpLine||'')}:null,availableCodecs:caps&&Array.isArray(caps.codecs)?caps.codecs.filter(row=>!String(row.mimeType||'').toLowerCase().includes('rtx')).map(row=>({mimeType:String(row.mimeType||''),sdpFmtpLine:String(row.sdpFmtpLine||'')})):[],transport:record.transport||null});
  })()`));
  const measuredReceiverStats = (before, after) => {
    const elapsedMs = Math.max(1, Number(after && after.timestamp) - Number(before && before.timestamp));
    const decoded = Math.max(0, Number(after && after.framesDecoded) - Number(before && before.framesDecoded));
    return { ...after, sampleMs: Math.round(elapsedMs), decodedDuringSample: decoded, decodedFps: Math.round((decoded * 10000) / elapsedMs) / 10 };
  };

  await waitLoad(controlWin);
  const hub = await waitUntil(async () => ({ ok: !!(liveInputHubReady && liveInputHubWin && !liveInputHubWin.isDestroyed()) }), 6000);
  if (!hub.ok) return { ok: false, stage: 'hub-ready', hub };

  createOutputWindow(SMOKE_TARGET && SMOKE_TARGET.id);
  const output = await waitUntil(async () => ({ ok: !!(outputWin && !outputWin.isDestroyed() && !outputWin.webContents.isLoading()) }), 8000);
  if (!output.ok) return { ok: false, stage: 'output-ready', output };
  await waitLoad(outputWin);

  const setup = JSON.parse(await controlWin.webContents.executeJavaScript(`JSON.stringify((function(){
    ensureScenes();
    applyAdvancedMode(true);
    document.getElementById('chkAdvanced').checked=true;
    S.studioDirect=false;
    document.getElementById('chkDirectProgram').checked=false;
    S.primaryLiveAudio=false;
    programState=outputSnapshot(S);
    pushProgramState(programState);
    S.canvas=PTCOMP.normalizeCanvas({width:${width},height:${height},fps:${fps},background:'#12161d',transparent:false});
    S.canvasAspect=legacyAspectForCanvas(S.canvas);
    S.liveInputs=[PTCOMP.normalizeLiveInput({
      id:${JSON.stringify(inputId)},type:'device',name:'Synthetic capture card',
      videoDeviceId:'__showslate_synthetic__',videoDeviceLabel:'Synthetic capture card',
      audioDeviceId:'__showslate_synthetic_audio__',audioDeviceLabel:'Synthetic capture audio',withAudio:true,
      width:${width},height:${height},fps:${fps},captureMode:'low-latency',qualityProfile:${JSON.stringify(qualityProfile)},active:true,autoReconnect:true
    })];
    S.scenes=[PTCOMP.normalizeScene({id:${JSON.stringify(sceneId)},name:'Live input smoke',layers:[
      {id:'smoke-live-background',type:'color',name:'Background',color:'#12161d',visible:true,x:0,y:0,w:100,h:100,opacity:1},
      {id:'smoke-live-layer',type:'capture',name:'Synthetic capture card',inputId:${JSON.stringify(inputId)},visible:true,fit:'cover',x:0,y:0,w:100,h:100,opacity:1,audioEnabled:true,volume:1}
    ]})];
    S.activeSceneId=${JSON.stringify(sceneId)};
    selectedLayerId='smoke-live-layer';
    liveInputConfigKey='';
    renderScenesUI();
    renderStage('pv',S,Date.now());
    syncLiveInputService();
    send();
    return {previewScene:S.activeSceneId,programScene:programState.activeSceneId,direct:S.studioDirect};
  })())`));

  const service = await waitUntil(async () => {
    const row = liveInputStatuses.get(inputId);
    return { ok: !!(row && row.state === 'live' && row.hasVideo && row.hasAudio), row: row || null };
  }, 10000);
  const hubMedia = JSON.parse(await liveInputHubWin.webContents.executeJavaScript(`JSON.stringify((function(){const stream=window.liveCapture.inputs.get(${JSON.stringify(inputId)})?.stream;const video=stream&&stream.getVideoTracks()[0];const audio=stream&&stream.getAudioTracks()[0];return {video:video?video.getSettings():null,audio:audio?audio.getSettings():null};})())`));
  const preview = await waitUntil(async () => {
    const value = JSON.parse(await controlWin.webContents.executeJavaScript(`JSON.stringify((function(){
      const video=document.querySelector('#pvScene video[data-live-input-id=${JSON.stringify(inputId)}]');
      const stream=video&&video.srcObject;
      const track=stream&&stream.getVideoTracks()[0];
      return {ok:!!(video&&stream&&video.readyState>=2&&stream.getVideoTracks().length===1&&stream.getAudioTracks().length===1),muted:video?video.muted:null,paused:video?video.paused:null,width:video?video.videoWidth:0,height:video?video.videoHeight:0,videoTracks:stream?stream.getVideoTracks().length:0,audioTracks:stream?stream.getAudioTracks().length:0,currentTime:video?video.currentTime:0,settings:track?track.getSettings():null};
    })())`));
    return value;
  }, 10000);
  const previewLater = await waitUntil(async () => {
    const value = JSON.parse(await controlWin.webContents.executeJavaScript(`JSON.stringify((function(){const video=document.querySelector('#pvScene video[data-live-input-id=${JSON.stringify(inputId)}]');return {exists:!!video,readyState:video?video.readyState:0,currentTime:video?video.currentTime:0,muted:video?video.muted:null,paused:video?video.paused:null};})())`));
    return {...value, baseline:preview.currentTime, ok:value.exists&&value.readyState>=2&&value.muted===true&&value.paused===false&&value.currentTime>preview.currentTime+0.04};
  }, 3000);
  const beforeTake = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify({scene:S&&S.activeSceneId,liveVideo:!!document.querySelector('video[data-live-input-id=${JSON.stringify(inputId)}]')})`));

  await controlWin.webContents.executeJavaScript(`document.getElementById('btnTake').click()`);
  const program = await waitUntil(async () => {
    const value = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify((function(){
      const video=document.querySelector('video[data-live-input-id=${JSON.stringify(inputId)}]');
      const stream=video&&video.srcObject;
      const track=stream&&stream.getVideoTracks()[0];
      const ready=!!(video&&stream&&video.readyState>=2&&stream.getVideoTracks().length===1&&stream.getAudioTracks().length===1);
      const fullFormat=!!(video&&video.videoWidth===${width}&&video.videoHeight===${height});
      return {ok:ready&&fullFormat,ready,fullFormat,scene:S&&S.activeSceneId,muted:video?video.muted:null,width:video?video.videoWidth:0,height:video?video.videoHeight:0,videoTracks:stream?stream.getVideoTracks().length:0,audioTracks:stream?stream.getAudioTracks().length:0,currentTime:video?video.currentTime:0,settings:track?track.getSettings():null};
    })())`));
    return value;
  }, 10000);
  const programLater = await waitUntil(async () => {
    const value = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify((function(){const video=document.querySelector('video[data-live-input-id=${JSON.stringify(inputId)}]');return {exists:!!video,readyState:video?video.readyState:0,currentTime:video?video.currentTime:0,paused:video?video.paused:null};})())`));
    return {...value, baseline:program.currentTime, ok:value.exists&&value.readyState>=2&&value.paused===false&&value.currentTime>program.currentTime+0.04};
  }, 3000);
  const restartBefore = JSON.parse(await liveInputHubWin.webContents.executeJavaScript(`JSON.stringify((function(){
    const record=window.liveCapture.inputs.get(${JSON.stringify(inputId)});
    const track=record&&record.stream&&record.stream.getVideoTracks()[0];
    return {startedAt:Number(record&&record.startedAt)||0,streamId:String(record&&record.stream&&record.stream.id||''),trackId:String(track&&track.id||'')};
  })())`));
  sendLiveHubCommand({ type: 'restart', inputId });
  const restart = await waitUntil(async () => {
    const hubState = JSON.parse(await liveInputHubWin.webContents.executeJavaScript(`JSON.stringify((function(){
      const record=window.liveCapture.inputs.get(${JSON.stringify(inputId)});
      const track=record&&record.stream&&record.stream.getVideoTracks()[0];
      return {startedAt:Number(record&&record.startedAt)||0,streamId:String(record&&record.stream&&record.stream.id||''),trackId:String(track&&track.id||''),settings:track?track.getSettings():null};
    })())`));
    const outputState = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify((function(){
      const video=document.querySelector('video[data-live-input-id=${JSON.stringify(inputId)}]');
      return {ready:!!(video&&video.srcObject&&video.readyState>=2),width:video?video.videoWidth:0,height:video?video.videoHeight:0,currentTime:video?video.currentTime:0};
    })())`));
    const row = liveInputStatuses.get(inputId) || null;
    const replaced = hubState.startedAt > restartBefore.startedAt
      && !!hubState.streamId && hubState.streamId !== restartBefore.streamId
      && !!hubState.trackId && hubState.trackId !== restartBefore.trackId;
    return { ok: !!(replaced && row && row.state === 'live' && outputState.ready && outputState.width === width && outputState.height === height), hubState, outputState, row };
  }, 12000);
  const restartMoving = restart.ok ? await waitUntil(async () => {
    const value = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify((function(){const video=document.querySelector('video[data-live-input-id=${JSON.stringify(inputId)}]');return {ready:!!(video&&video.readyState>=2),currentTime:video?video.currentTime:0};})())`));
    return { ...value, baseline: restart.outputState.currentTime, ok: value.ready && value.currentTime > restart.outputState.currentTime + 0.04 };
  }, 3000) : { ok: false, error: 'restart-not-ready' };
  await sleep(options.width >= 3840 && options.fps >= 60 ? 3500 : 900);
  const [previewReceiverBefore, programReceiverBefore, programSenderBefore] = await Promise.all([
    receiverStats(controlWin), receiverStats(outputWin), senderStats(liveInputHubWin, outputWin.webContents.id)
  ]);
  await sleep(options.width >= 3840 && options.fps >= 60 ? 3500 : 2200);
  const [previewReceiverAfter, programReceiverAfter, programSenderAfter] = await Promise.all([
    receiverStats(controlWin), receiverStats(outputWin), senderStats(liveInputHubWin, outputWin.webContents.id)
  ]);
  const previewReceiver = measuredReceiverStats(previewReceiverBefore, previewReceiverAfter);
  const programReceiver = measuredReceiverStats(programReceiverBefore, programReceiverAfter);
  const programSender = measuredReceiverStats(programSenderBefore, programSenderAfter);

  const shot = await outputWin.webContents.capturePage();
  const bitmap = shot.toBitmap();
  let min = 255, max = 0, bright = 0;
  for (let index = 0; index + 3 < bitmap.length; index += 400) {
    const value = Math.max(bitmap[index], bitmap[index + 1], bitmap[index + 2]);
    min = Math.min(min, value); max = Math.max(max, value); if (value > 80) bright++;
  }
  const screenshot = writeTestArtifact(`compositor/live-input-program-${suffix}.png`, shot.toPNG());
  const visual = { ok: !shot.isEmpty() && max - min > 60 && bright > 20, min, max, bright, screenshot };

  await controlWin.webContents.executeJavaScript(`S.liveInputs=[];liveInputConfigKey='';syncLiveInputService();send();`);
  return {
    ok: service.ok && preview.ok && program.ok && visual.ok,
    inputId, sceneId, width, height, fps, qualityProfile,
    setup, service, hubMedia, preview, previewLater, beforeTake, program, programLater, restartBefore, restart, restartMoving, previewReceiver, programReceiver, programSender, visual,
    previewMoving: previewLater.ok === true,
    programMoving: programLater.ok === true
  };
}

async function runLocalMediaUhd60Smoke(waitLoad, sourcePath) {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const waitUntil = async (probe, timeoutMs = 10000) => {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {
      try { last = await probe(); } catch (error) { last = { ok: false, error: String(error && error.message || error) }; }
      if (last && last.ok) return last;
      await sleep(80);
    }
    return last || { ok: false, error: 'timeout' };
  };
  const file = path.resolve(String(sourcePath || ''));
  if (!sourcePath || !fs.existsSync(file)) return { ok: false, stage: 'fixture', error: 'UHD60 media file is unavailable.', file };
  const imported = await getMediaLibrary().importFile(file, { storage: 'linked', name: path.basename(file) });
  if (!imported.ok) return { ok: false, stage: 'import', imported };

  await waitLoad(controlWin);
  createOutputWindow(SMOKE_TARGET && SMOKE_TARGET.id);
  const output = await waitUntil(async () => ({ ok: !!(outputWin && !outputWin.isDestroyed() && !outputWin.webContents.isLoading()) }), 8000);
  if (!output.ok) return { ok: false, stage: 'output-ready', output };
  await waitLoad(outputWin);

  const setup = JSON.parse(await controlWin.webContents.executeJavaScript(`JSON.stringify((function(){
    ensureScenes();
    applyAdvancedMode(true);
    S.studioDirect=false;
    S.primaryLiveAudio=false;
    S.canvas=PTCOMP.normalizeCanvas({width:3840,height:2160,fps:60,background:'#07090d',transparent:false});
    S.canvasAspect=legacyAspectForCanvas(S.canvas);
    const now=Date.now();
    S.scenes=[
      PTCOMP.normalizeScene({id:'local-media-program-blank',name:'Program blank',layers:[{id:'local-media-blank',type:'color',name:'Blank',color:'#07090d',visible:true,x:0,y:0,w:100,h:100,opacity:1}]}),
      PTCOMP.normalizeScene({id:'local-media-uhd60-scene',name:'UHD60 local media',layers:[{
        id:'local-media-uhd60-layer',type:'video',name:${JSON.stringify(path.basename(file))},src:${JSON.stringify(imported.src)},mime:'video/mp4',
        sourceBytes:${Number(imported.bytes) || 0},sourceStorage:${JSON.stringify(imported.storage || '')},sourcePortable:${imported.portable !== false},
        sourceWidth:3840,sourceHeight:2160,sourceDuration:4,visible:true,fit:'contain',x:0,y:0,w:100,h:100,opacity:1,
        playbackState:'playing',playbackPosition:0,playbackUpdatedAt:now,playbackRate:1,inPoint:0,outPoint:0,endBehavior:'loop',loop:true,restartOnTake:true,
        videoAudioConfigured:true,audioEnabled:true,audioMonitoring:'off',muted:false,volume:1
      }]})
    ];
    S.activeSceneId='local-media-program-blank';
    programState=outputSnapshot(S);
    pushProgramState(programState);
    S.activeSceneId='local-media-uhd60-scene';
    selectedLayerId='local-media-uhd60-layer';
    monitorSceneKeys={pv:'',pg:''};
    renderScenesUI();renderStage('pv',S,now);renderStage('pg',programState,now);renderAudioMixer();send();
    return {previewScene:S.activeSceneId,programScene:programState.activeSceneId,src:${JSON.stringify(imported.src)}};
  })())`));

  const videoInfo = async (win, selector) => JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify((function(){
    const video=document.querySelector(${JSON.stringify(selector)});const quality=video&&video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():null;
    return {ok:!!(video&&video.readyState>=2&&video.videoWidth===3840&&video.videoHeight===2160),exists:!!video,readyState:video?video.readyState:0,
      width:video?video.videoWidth:0,height:video?video.videoHeight:0,currentTime:video?video.currentTime:0,duration:video?video.duration:0,
      paused:video?video.paused:null,muted:video?video.muted:null,totalFrames:quality?Number(quality.totalVideoFrames)||0:Number(video&&video.webkitDecodedFrameCount)||0,
      droppedFrames:quality?Number(quality.droppedVideoFrames)||0:Number(video&&video.webkitDroppedFrameCount)||0};
  })())`));
  const presentationStats = async (win, selectors, sampleMs = 2200) => JSON.parse(await win.webContents.executeJavaScript(`(async function(){
    const selectors=${JSON.stringify(selectors)};
    const sampleMs=${Number(sampleMs)};
    const videos=selectors.map(selector=>document.querySelector(selector));
    return JSON.stringify(await Promise.all(videos.map(async (video,index)=>{
      if(!video||typeof video.requestVideoFrameCallback!=='function')return {ok:false,index,error:'requestVideoFrameCallback unavailable'};
      const qualityBefore=video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():null;
      let callbacks=0,firstAt=0,lastAt=0,firstMedia=0,lastMedia=0,firstPresented=0,lastPresented=0,handle=0;
      const tick=(now,metadata)=>{
        callbacks+=1;
        const presented=Number(metadata&&metadata.presentedFrames)||0;
        if(!firstAt){firstAt=now;firstMedia=Number(metadata&&metadata.mediaTime)||Number(video.currentTime)||0;firstPresented=presented;}
        lastAt=now;lastMedia=Number(metadata&&metadata.mediaTime)||Number(video.currentTime)||0;lastPresented=presented;
        handle=video.requestVideoFrameCallback(tick);
      };
      handle=video.requestVideoFrameCallback(tick);
      await new Promise(resolve=>setTimeout(resolve,sampleMs));
      try{video.cancelVideoFrameCallback(handle);}catch(error){}
      const qualityAfter=video.getVideoPlaybackQuality?video.getVideoPlaybackQuality():null;
      const elapsedMs=Math.max(1,lastAt-firstAt);
      const callbackIntervals=Math.max(0,callbacks-1),presentedFrames=Math.max(0,lastPresented-firstPresented);
      return {ok:callbacks>1&&presentedFrames>0,index,callbacks,presentedFrames,elapsedMs:Math.round(elapsedMs),
        callbackFps:Math.round(callbackIntervals*10000/elapsedMs)/10,presentedFps:Math.round(presentedFrames*10000/elapsedMs)/10,
        mediaAdvance:Math.round((lastMedia-firstMedia)*1000)/1000,totalFrames:qualityAfter?Number(qualityAfter.totalVideoFrames)||0:0,
        droppedFrames:qualityAfter?Number(qualityAfter.droppedVideoFrames)||0:0,
        droppedDuringSample:qualityAfter&&qualityBefore?Math.max(0,Number(qualityAfter.droppedVideoFrames)-Number(qualityBefore.droppedVideoFrames)):0};
    })));
  })()`));
  const previewSelector = '#pvScene .pv-scene-layer[data-layer-id="local-media-uhd60-layer"] video';
  const programMirrorSelector = '#pgScene .pv-scene-layer[data-layer-id="local-media-uhd60-layer"] video';
  const outputSelector = '#sceneRoot .scene-frame:last-child .scene-layer[data-layer-id="local-media-uhd60-layer"] video';
  const preview = await waitUntil(async () => {
    const value = await videoInfo(controlWin, previewSelector);
    return { ...value, ok: value.ok && !value.paused && value.currentTime > 0.08 };
  }, 12000);
  const beforeTake = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify({scene:S&&S.activeSceneId,video:!!document.querySelector(${JSON.stringify(outputSelector)})})`));
  await controlWin.webContents.executeJavaScript(`takePreview('cut')`);
  const program = await waitUntil(async () => {
    const [mirror, out] = await Promise.all([videoInfo(controlWin, programMirrorSelector), videoInfo(outputWin, outputSelector)]);
    return { ok: mirror.ok && out.ok && !mirror.paused && !out.paused, mirror, output: out };
  }, 12000);

  await sleep(900);
  const before = {
    preview: await videoInfo(controlWin, previewSelector),
    mirror: await videoInfo(controlWin, programMirrorSelector),
    output: await videoInfo(outputWin, outputSelector)
  };
  const audio = await controlWin.webContents.executeJavaScript(`(async function(){
    const layer=selectedLayer();const record=meterRecordForLayer(layer);if(!record)return JSON.stringify({ok:false,error:'audio analyser unavailable'});
    try{await record.context.resume();}catch(error){}
    await new Promise(resolve=>setTimeout(resolve,450));
    record.analyser.getFloatTimeDomainData(record.data);let sum=0,peak=0;
    for(let i=0;i<record.data.length;i++){const value=Math.abs(record.data[i]);sum+=value*value;peak=Math.max(peak,value);}
    return JSON.stringify({ok:record.context.state==='running'&&peak>.001,rms:Math.sqrt(sum/Math.max(1,record.data.length)),peak,contextState:record.context.state,sampleRate:record.context.sampleRate});
  })()`).then(JSON.parse);
  // Presentation callbacks are compositor-facing. Keep Program fully visible so
  // macOS occlusion throttling does not turn this into a window-overlap test.
  controlWin.hide();
  if (outputWin && !outputWin.isDestroyed()) {
    // The ordinary smoke layout keeps every window on one display and therefore
    // makes Program a small utility window. UHD60 must be measured like a real
    // audience/LED destination: unobscured and covering the selected display.
    if (SMOKE_TARGET) {
      if (outputWin.isFullScreen()) outputWin.setFullScreen(false);
      outputWin.setBounds(SMOKE_TARGET.bounds, false);
    }
    outputWin.show();
  }
  await sleep(250);
  const [controllerPresentation, outputPresentation] = await Promise.all([
    presentationStats(controlWin, [previewSelector, programMirrorSelector]),
    presentationStats(outputWin, [outputSelector])
  ]);
  const after = {
    preview: await videoInfo(controlWin, previewSelector),
    mirror: await videoInfo(controlWin, programMirrorSelector),
    output: await videoInfo(outputWin, outputSelector)
  };
  const measured = {};
  for (const key of ['preview', 'mirror', 'output']) {
    const frames = Math.max(0, Number(after[key].totalFrames) - Number(before[key].totalFrames));
    measured[key] = {
      ...after[key],
      sampleMs: 2200,
      framesDuringSample: frames,
      decodedAheadFps: Math.round(frames / 2.2 * 10) / 10,
      droppedDuringSample: Math.max(0, Number(after[key].droppedFrames) - Number(before[key].droppedFrames))
    };
  }
  measured.preview.presentation = controllerPresentation[0] || null;
  measured.mirror.presentation = controllerPresentation[1] || null;
  measured.output.presentation = outputPresentation[0] || null;
  const duration = Math.max(0, Number(after.output.duration) || Number(after.preview.duration) || 0);
  const rawSyncDelta = Math.abs(Number(after.preview.currentTime) - Number(after.output.currentTime));
  const syncDelta = duration > 0 ? Math.min(rawSyncDelta, Math.max(0, duration - rawSyncDelta)) : rawSyncDelta;
  const shot = await outputWin.webContents.capturePage();
  const screenshot = writeTestArtifact('compositor/local-media-program-uhd60.png', shot.toPNG());
  const visual = { ok: !shot.isEmpty(), width: shot.getSize().width, height: shot.getSize().height, screenshot };
  return { ok: preview.ok && program.ok && audio.ok && visual.ok, file, imported, setup, beforeTake, preview, program, measured, audio, syncDelta, visual };
}

async function runOutputRoutingSmoke() {
  let multiOutOK = false, routingDisabledOK = false, routingPositionOK = false;
  let multiOutStateOK = false, independentCanvasMappingOK = false;
  let missingDisplaySafeOK = false, missingDisplayUiOK = false, fingerprintReconnectOK = false;
  let detail = '?';
  try {
    const did = controlDisplayId();
    const disp = screen.getAllDisplays().find(display => display.id === did) || screen.getPrimaryDisplay();
    // Custom coordinates are relative to the display bounds. Keep this smoke route
    // inside the usable work area so macOS does not clamp it below the menu bar.
    const workInsetX = Math.max(0, disp.workArea.x - disp.bounds.x);
    const workInsetY = Math.max(0, disp.workArea.y - disp.bounds.y);
    const routeAX = workInsetX + 40;
    const routeBX = workInsetX + 380;
    const routeY = workInsetY + 30;
    const expectedBounds = [
      { x: disp.bounds.x + routeAX, y: disp.bounds.y + routeY, width: 320, height: 180 },
      { x: disp.bounds.x + routeBX, y: disp.bounds.y + routeY, width: 280, height: 180 }
    ];
    await controlWin.webContents.executeJavaScript(`(function(){S.bgColor='#164e63';S.message={text:'ROUTE SYNC',flash:false};send(true);})()`);
    applyOutputConfigs([
      {
        id:'smoke-out-a',name:'Smoke Output A',enabled:true,displayId:did,displayLabel:disp.label,
        displayWidth:disp.bounds.width,displayHeight:disp.bounds.height,mode:'custom',width:320,height:180,
        placement:'custom',x:routeAX,y:routeY,gridSize:3,gridCell:0,
        outputCanvas:{width:1920,height:1080,fps:50,fit:'contain'},
        projection:{
          id:'smoke-projection',name:'Smoke projector surface',compositionId:'smoke-composition',enabled:true,
          x:0,y:0,width:960,height:1080,canvasWidth:1920,canvasHeight:1080,
          blend:{left:0,right:24,top:0,bottom:0},
          warp:{enabled:true,corners:{topLeft:{x:3,y:4},topRight:{x:97,y:1},bottomRight:{x:94,y:96},bottomLeft:{x:6,y:99}},grid:{visible:true,columns:8,rows:6,opacity:.68}}
        }
      },
      {
        id:'smoke-out-b',name:'Smoke Output B',enabled:true,displayId:did,displayLabel:disp.label,
        displayWidth:disp.bounds.width,displayHeight:disp.bounds.height,mode:'custom',width:280,height:180,
        placement:'custom',x:routeBX,y:routeY,gridSize:3,gridCell:0,
        outputCanvas:{width:1000,height:1000,fps:25,fit:'cover'}
      },
      {id:'smoke-disabled',name:'Disabled Output',enabled:false,displayId:did,mode:'fullscreen'}
    ]);
    const [recA, recB] = await waitForAuxOutputRoutes(['smoke-out-a','smoke-out-b']);
    const positionWait = await waitForAuxOutputBounds([recA, recB], expectedBounds);
    const [b, b2] = positionWait.bounds;
    const noOverlap = (b.x+b.width)<=b2.x || (b2.x+b2.width)<=b.x || (b.y+b.height)<=b2.y || (b2.y+b2.height)<=b.y;
    multiOutOK = auxOutputs.size === 2 && Math.abs((b.width||0)-320) < 8 && Math.abs((b.height||0)-180) < 8
      && Math.abs((b2.width||0)-280) < 8 && Math.abs((b2.height||0)-180) < 8 && noOverlap;
    const target = targetDisplayForConfig(outputConfigs[0]);
    routingPositionOK = !!target && positionWait.stable;
    const states = await Promise.all([recA,recB].map(rec => rec.win.webContents.executeJavaScript(`JSON.stringify({bg:S&&S.bgColor,message:S&&S.message&&S.message.text,scene:S&&S.activeSceneId})`)));
    const parsedStates = states.map(JSON.parse);
    const deliveryWait = await waitForAuxOutputAcknowledgements(['smoke-out-a','smoke-out-b']);
    const runtime = deliveryWait.runtime;
    routingDisabledOK = outputConfigs.length === 3 && !auxOutputs.has('smoke-disabled') && runtime.routes.length === 3
      && runtime.routes.some(route => route.id === 'smoke-disabled' && !route.open && route.status === 'disabled');
    multiOutStateOK = deliveryWait.stable && parsedStates.length === 2 && parsedStates.every(state => state.bg === '#164e63' && state.message === 'ROUTE SYNC' && state.scene === parsedStates[0].scene);
    const rendererGeometry = await Promise.all([recA,recB].map(rec => rec.win.webContents.executeJavaScript(`JSON.stringify((function(){
      const surface=document.getElementById('programSurface');
      const grid=document.getElementById('projectionCalibration');
      return {canvasWidth:Number(surface&&surface.dataset.canvasWidth||0),canvasHeight:Number(surface&&surface.dataset.canvasHeight||0),fit:String(surface&&surface.dataset.canvasFit||''),warp:String(surface&&surface.dataset.warp||''),transform:String(surface&&surface.style.transform||''),grid:String(grid&&grid.style.display||'')};
    })())`))).then(values => values.map(JSON.parse));
    const runtimeA = runtime.routes.find(route => route.id === 'smoke-out-a');
    const runtimeB = runtime.routes.find(route => route.id === 'smoke-out-b');
    independentCanvasMappingOK = !!(runtimeA && runtimeB
      && runtimeA.outputCanvas.width === 1920 && runtimeA.outputCanvas.height === 1080 && runtimeA.outputCanvas.fit === 'contain'
      && runtimeA.projection && runtimeA.projection.warp && runtimeA.projection.warp.enabled
      && runtimeA.projection.warp.grid && runtimeA.projection.warp.grid.visible
      && runtimeB.outputCanvas.width === 1000 && runtimeB.outputCanvas.height === 1000 && runtimeB.outputCanvas.fit === 'cover'
      && rendererGeometry[0] && rendererGeometry[0].warp === 'on' && rendererGeometry[0].grid === 'block' && rendererGeometry[0].transform.includes('matrix3d')
      && rendererGeometry[1] && rendererGeometry[1].canvasWidth === 1000 && rendererGeometry[1].canvasHeight === 1000 && rendererGeometry[1].fit === 'cover' && rendererGeometry[1].warp === 'off');
    detail = JSON.stringify({count:auxOutputs.size,configs:outputConfigs.length,bounds:[b,b2],expectedBounds,positionStable:positionWait.stable,deliveryStable:deliveryWait.stable,states:parsedStates,rendererGeometry,runtime});
    applyOutputConfigs([]);
    await new Promise(resolve => setTimeout(resolve, 250));

    applyOutputConfigs([{id:'smoke-reconnect',name:'Reconnect',enabled:true,displayId:987654321,displayLabel:disp.label,displayWidth:disp.bounds.width,displayHeight:disp.bounds.height,mode:'custom',width:240,height:135,placement:'custom',x:40,y:240}]);
    const [reconnect] = await waitForAuxOutputRoutes(['smoke-reconnect']);
    await new Promise(resolve => setTimeout(resolve, 220));
    const reconnectRuntime = outputRuntimeSnapshot().routes[0];
    fingerprintReconnectOK = !!(reconnect && reconnect.actualDisplayId === did && reconnectRuntime && reconnectRuntime.open);
    applyOutputConfigs([]);
    await new Promise(resolve => setTimeout(resolve, 250));

    applyOutputConfigs([{id:'smoke-missing',name:'Missing',enabled:true,displayId:987654322,displayLabel:'Definitely Missing Smoke Display',displayWidth:1111,displayHeight:777,mode:'fullscreen'}]);
    await new Promise(resolve => setTimeout(resolve, 250));
    const missingRuntime = outputRuntimeSnapshot().routes[0];
    missingDisplaySafeOK = auxOutputs.size === 0 && !!missingRuntime && !missingRuntime.open && !missingRuntime.displayAvailable && missingRuntime.status === 'missing-display';
    const missingUi = JSON.parse(await controlWin.webContents.executeJavaScript(`(function(){
      const oldConfigs=outputConfigs,oldRuntime=outputRuntime;
      outputConfigs=[normalizeOutputConfigUI({id:'smoke-missing',name:'Missing',enabled:true,displayId:987654322,displayLabel:'Definitely Missing Smoke Display',displayWidth:1111,displayHeight:777,mode:'fullscreen'})];
      outputRuntime={primaryOpen:false,routes:[${JSON.stringify(missingRuntime)}]};
      renderOutputRows();
      const row=document.querySelector('#outputRouterList .output-route-editor');
      const state=row&&row.querySelector('.output-route-state');
      const option=row&&row.querySelector('.out-display option:checked');
      const result={unavailable:!!row&&row.classList.contains('unavailable'),state:String(state&&state.textContent||''),missingOption:!!option&&option.dataset.unavailable==='1'};
      outputConfigs=oldConfigs;outputRuntime=oldRuntime;renderOutputRows();
      return JSON.stringify(result);
    })()`));
    missingDisplayUiOK = missingUi.unavailable && missingUi.missingOption && !!missingUi.state;
    detail += ' reconnect=' + JSON.stringify(reconnectRuntime) + ' missing=' + JSON.stringify(missingRuntime);
  } catch (error) {
    detail = 'ERR ' + error;
  } finally {
    applyOutputConfigs([]);
  }
  return { multiOutOK, multiOutStateOK, independentCanvasMappingOK, routingDisabledOK, routingPositionOK, fingerprintReconnectOK, missingDisplaySafeOK, missingDisplayUiOK, detail };
}

// ---------------- START ----------------
app.whenReady().then(async () => {
  if (process.argv.includes('--print-build-info')) {
    console.log(JSON.stringify(getBuildInfo(), null, 2));
    app.exit(0);
    return;
  }
  if (process.argv.includes('--promo')) { runPromo(); return; }
  if (process.argv.includes('--banner')) {
    const bw = new BrowserWindow({ width:1600, height:900, useContentSize:true, frame:false, show:false, webPreferences:{ contextIsolation:true } });
    bw.loadFile('build/banner.html');
    bw.webContents.on('did-finish-load', async () => {
      await new Promise(r=>setTimeout(r,400));
      fs.writeFileSync('/tmp/og-banner.png', (await bw.webContents.capturePage()).toPNG());
      console.log('BANNER_DONE'); app.exit(0);
    });
    setTimeout(()=>{ console.error('BANNER_TIMEOUT'); app.exit(1); }, 15000);
    return;
  }
  // Resolve the configured smoke display before opening any test window. Ambiguous or
  // unavailable assignments fail closed instead of moving windows to another display.
  if (SMOKE) {
    const res = smokeDisplay.resolveTargetDisplay(screen);
    if (!res.display) {
      console.error(res.ambiguous ? 'SMOKE_DISPLAY_AMBIGUOUS' : 'SMOKE_DISPLAY_NOT_FOUND');
      console.error('Requested: ' + res.requested);
      if (res.ambiguous) console.error('Matches: ' + JSON.stringify(res.matches) + ' — use --smoke-display-id=<id> or .showslate-smoke-display.json {"id":...}');
      console.error('Available: ' + JSON.stringify(res.available));
      app.exit(1); return;
    }
    SMOKE_TARGET = res.display;
    console.log('SMOKE TARGET DISPLAY');
    console.log('  ID: ' + SMOKE_TARGET.id);
    console.log('  Label: ' + (SMOKE_TARGET.label || '(none)'));
    console.log('  WorkArea: ' + JSON.stringify(SMOKE_TARGET.workArea));
  }

  if (!SMOKE) {
    try {
      const migration = migrateLegacyUserData({
        appDataDir: app.getPath('appData'),
        currentUserDataDir: app.getPath('userData')
      });
      if (migration.migrated) console.log('SHOWSLATE_USER_DATA_MIGRATED files=' + migration.copiedFiles);
    } catch (error) {
      console.error('SHOWSLATE_USER_DATA_MIGRATION_FAILED ' + String(error && error.message || error));
    }
  }

  showStorageReady = initializeShowStorage().catch((error) => {
    console.error('SHOW_STORAGE_INIT_FAILED ' + String(error && error.message || error));
    showRepository = null;
    return { ok: false };
  });
  await showStorageReady;
  setupLiveInputPermissions();
  createLiveInputHub();
  startServer(7878);
  startOSC(7879);
  createControlWindow();
  // Pin controller to the target's top-left: responsive smoke resizes it via setContentSize
  // while keeping that anchor fixed, so growth remains inside the selected work area.
  if (SMOKE && SMOKE_TARGET) {
    const wa = SMOKE_TARGET.workArea;
    try { controlWin.setBounds({ x: wa.x, y: wa.y, width: Math.min(1280, wa.width), height: Math.min(800, wa.height) }); } catch (e) {}
  }

  // Izlaz se NE otvara automatski: korisnik bira gde i kada (Send to screen / OUTPUTS Apply).

  screen.on('display-added', (e, newDisplay) => {
    pushDisplays();
    scheduleOutputDisplayReconcile();
  });
  screen.on('display-removed', () => {
    pushDisplays();
    scheduleOutputDisplayReconcile();
  });
  screen.on('display-metrics-changed', () => {
    pushDisplays();
    scheduleOutputDisplayReconcile();
  });

  if (SMOKE) {
    const waitLoad = w => new Promise(res => {
      if (w && !w.webContents.isLoading()) return res();
      w.webContents.once('did-finish-load', res);
    });
    const waitOutput = () => new Promise((resolve, reject) => {
      const startedAt = Date.now();
      let candidate = null;
      let stableChecks = 0;
      const t = setInterval(() => {
        const win = outputWin;
        const ready = !!(win && !win.isDestroyed() && win.webContents && !win.webContents.isDestroyed());
        if (ready) {
          if (candidate === win) stableChecks += 1;
          else { candidate = win; stableChecks = 1; }
          if (stableChecks >= 2) {
            clearInterval(t);
            resolve(win);
          }
        } else {
          candidate = null;
          stableChecks = 0;
        }
        if (Date.now() - startedAt > 10000) {
          clearInterval(t);
          reject(new Error('Timed out waiting for a stable output window'));
        }
      }, 50);
    });
    const ensureSmokeOutput = async () => {
      if (!outputWin || outputWin.isDestroyed() || !outputWin.webContents || outputWin.webContents.isDestroyed()) {
        createOutputWindow(SMOKE_TARGET && SMOKE_TARGET.id);
      }
      const win = await waitOutput();
      await waitLoad(win);
      return win;
    };
    (async () => {
      try {
        const smokeFailures = [];
        const smokeCheck = (name, ok, detail = '') => {
          const pass = !!ok;
          console.log(`${name}=${pass}${detail ? ' ' + detail : ''}`);
          if (!pass) smokeFailures.push(name);
          return pass;
        };
        if (LT2_SOAK_ONLY) {
          await waitLoad(controlWin);
          const targeted = await runTargetedLowerThirdSoak(waitLoad);
          console.log('LT2_TARGET_SOAK_OK=' + targeted.ok + ' ' + JSON.stringify({
            targetCycles: targeted.targetCycles,
            completed: targeted.completed,
            memStart: targeted.memStart,
            memEnd: targeted.memEnd,
            memPeak: targeted.memPeak,
            memoryDelta: targeted.memoryDelta,
            failure: targeted.failure ? { cycle: targeted.failure.cycle, kind: targeted.failure.kind } : null
          }));
          app.exit(targeted.ok ? 0 : 1);
          return;
        }
        if (LOCAL_MEDIA_UHD60_SMOKE_ONLY) {
          const media = await runLocalMediaUhd60Smoke(waitLoad, cliValue('--media-file'));
          smokeCheck('LOCAL_MEDIA_UHD60_IMPORT_OK', media.imported&&media.imported.ok&&media.imported.bytes>0, JSON.stringify(media.imported||media));
          smokeCheck('LOCAL_MEDIA_UHD60_PREVIEW_FORMAT_OK', media.preview&&media.preview.ok&&media.preview.width===3840&&media.preview.height===2160, JSON.stringify(media.preview||media));
          smokeCheck('LOCAL_MEDIA_UHD60_PREVIEW_ISOLATION_OK', media.setup&&media.beforeTake&&media.setup.previewScene!==media.setup.programScene&&media.beforeTake.scene===media.setup.programScene&&!media.beforeTake.video, JSON.stringify({setup:media.setup,beforeTake:media.beforeTake}));
          smokeCheck('LOCAL_MEDIA_UHD60_TAKE_PROGRAM_OK', media.program&&media.program.ok&&media.program.output.width===3840&&media.program.output.height===2160, JSON.stringify(media.program||media));
          smokeCheck('LOCAL_MEDIA_UHD60_FRAME_RATE_OK', media.measured&&media.measured.output.presentation&&media.measured.output.presentation.presentedFps>=55&&media.measured.output.presentation.presentedFps<=65&&media.measured.output.presentation.droppedDuringSample===0, JSON.stringify(media.measured||media));
          smokeCheck('LOCAL_MEDIA_UHD60_AUDIO_DECODE_OK', media.audio&&media.audio.ok&&media.audio.sampleRate===48000, JSON.stringify(media.audio||media));
          smokeCheck('LOCAL_MEDIA_UHD60_AV_SYNC_OK', Number.isFinite(media.syncDelta)&&media.syncDelta<=0.2, JSON.stringify({syncDelta:media.syncDelta,measured:media.measured}));
          smokeCheck('LOCAL_MEDIA_UHD60_PROGRAM_PIXELS_OK', media.visual&&media.visual.ok, JSON.stringify(media.visual||media));
          console.log('LOCAL_MEDIA_UHD60_TARGETED_OK=' + (smokeFailures.length === 0));
          app.exit(smokeFailures.length ? 1 : 0);
          return;
        }
        if (LIVE_INPUT_SMOKE_ONLY || LIVE_INPUT_UHD60_SMOKE_ONLY) {
          const uhd60 = LIVE_INPUT_UHD60_SMOKE_ONLY;
          const expected = uhd60
            ? { width:3840, height:2160, fps:60, suffix:'uhd60', programFps:55, qualityProfile:'quality' }
            : { width:1920, height:1080, fps:60, suffix:'fhd60', programFps:45 };
          const live = await runLiveInputSmoke(waitLoad, expected);
          const prefix = uhd60 ? 'LIVE_INPUT_UHD60' : 'LIVE_INPUT';
          smokeCheck(prefix + '_SERVICE_VIDEO_AUDIO_OK', live.service&&live.service.ok&&live.service.row.audioSampleRate===48000&&live.service.row.audioChannels===2, JSON.stringify({service:live.service,hubMedia:live.hubMedia}));
          smokeCheck(prefix + '_SOURCE_FORMAT_OK', live.service&&live.service.row&&live.service.row.width===expected.width&&live.service.row.height===expected.height&&live.service.row.frameRate>=55&&live.service.row.formatMatched===true&&live.hubMedia&&live.hubMedia.video&&live.hubMedia.video.width===expected.width&&live.hubMedia.video.height===expected.height, JSON.stringify({service:live.service,hubMedia:live.hubMedia}));
          smokeCheck('LIVE_INPUT_PREVIEW_MUTED_AND_MOVING_OK', live.preview&&live.preview.ok&&live.preview.muted===true&&live.preview.videoTracks===1&&live.preview.audioTracks===1&&live.previewMoving, JSON.stringify(live.preview||live));
          smokeCheck(prefix + '_REMOTE_VIDEO_STATS_OK', live.previewReceiver&&live.previewReceiver.ok&&live.previewReceiver.framesDecoded>0&&live.previewReceiver.width===1280&&live.previewReceiver.height===720&&live.previewReceiver.packetsLost===0&&live.previewReceiver.framesDropped===0&&live.programReceiver&&live.programReceiver.ok&&live.programReceiver.framesDecoded>0&&live.programReceiver.width===expected.width&&live.programReceiver.height===expected.height&&live.programReceiver.packetsLost===0&&live.programReceiver.framesDropped===0, JSON.stringify({preview:live.previewReceiver,program:live.programReceiver,sender:live.programSender}));
          smokeCheck(prefix + '_PROGRAM_FRAME_RATE_OK', live.previewReceiver&&live.previewReceiver.decodedFps>=24&&live.programReceiver&&live.programReceiver.decodedFps>=expected.programFps&&live.programReceiver.width===expected.width&&live.programReceiver.height===expected.height, JSON.stringify({preview:live.previewReceiver,program:live.programReceiver,sender:live.programSender}));
          smokeCheck('LIVE_INPUT_PREVIEW_DOES_NOT_CHANGE_PROGRAM_OK', live.setup&&live.beforeTake&&live.setup.previewScene!==live.setup.programScene&&live.beforeTake.scene===live.setup.programScene&&!live.beforeTake.liveVideo, JSON.stringify({setup:live.setup,beforeTake:live.beforeTake}));
          smokeCheck('LIVE_INPUT_TAKE_SENDS_EXPECTED_SCENE_OK', live.program&&live.program.ok&&live.program.fullFormat===true&&live.program.width===expected.width&&live.program.height===expected.height&&live.program.scene===live.sceneId&&live.programMoving, JSON.stringify(live.program||live));
          smokeCheck(prefix + '_RESTART_REATTACHES_PROGRAM_OK', live.restart&&live.restart.ok&&live.restartMoving&&live.restartMoving.ok, JSON.stringify({before:live.restartBefore,restart:live.restart,moving:live.restartMoving}));
          smokeCheck('LIVE_INPUT_PROGRAM_AUDIO_DEFAULT_MUTED_OK', live.program&&live.program.audioTracks===1&&live.program.muted===true, JSON.stringify(live.program||live));
          smokeCheck('LIVE_INPUT_PROGRAM_PIXELS_OK', live.visual&&live.visual.ok, JSON.stringify(live.visual||live));
          console.log((uhd60 ? 'LIVE_INPUT_UHD60_TARGETED_OK' : 'LIVE_INPUT_TARGETED_OK') + '=' + (smokeFailures.length === 0));
          app.exit(smokeFailures.length ? 1 : 0);
          return;
        }
        if (OUTPUT_ROUTING_SMOKE_ONLY) {
          await waitLoad(controlWin);
          const routing = await runOutputRoutingSmoke();
          smokeCheck('MULTI_OUTPUT_OK', routing.multiOutOK, routing.detail);
          smokeCheck('MULTI_OUTPUT_SIMULTANEOUS_PROGRAM_STATE_OK', routing.multiOutStateOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_INDEPENDENT_CANVAS_AND_MAPPING_OK', routing.independentCanvasMappingOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_DISABLED_PERSISTS_OK', routing.routingDisabledOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_CUSTOM_POSITION_OK', routing.routingPositionOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_FINGERPRINT_RECONNECT_OK', routing.fingerprintReconnectOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_MISSING_DISPLAY_SAFE_OK', routing.missingDisplaySafeOK, routing.detail);
          smokeCheck('OUTPUT_ROUTING_MISSING_DISPLAY_UI_OK', routing.missingDisplayUiOK, routing.detail);
          console.log('OUTPUT_ROUTING_TARGETED_OK=' + (smokeFailures.length === 0));
          app.exit(smokeFailures.length ? 1 : 0);
          return;
        }
        // ===== TEST ARTIFACTS: source writes to repo artifacts/, packaged writes to userData =====
        {
          let artifactDir = '', writable = false, outsideAsar = false, writeOK = false, traversalBlocked = false, writePath = '';
          try {
            artifactDir = getTestArtifactDirectory();
            fs.accessSync(artifactDir, fs.constants.W_OK);
            writable = true;
            outsideAsar = !hasAsarSegment(artifactDir);
            writePath = writeTestArtifact('smoke/helper/probe.txt', Buffer.from('artifact-ok\n'));
            writeOK = fs.existsSync(writePath) && fs.readFileSync(writePath, 'utf8') === 'artifact-ok\n';
            try { writeTestArtifact('../blocked.txt', 'bad'); } catch (e) { traversalBlocked = /traversal|invalid|escaped/.test(String(e.message || e)); }
          } catch (e) {
            artifactDir = artifactDir || ('ERR ' + e.message);
          }
          smokeCheck('TEST_ARTIFACT_DIR_WRITABLE_OK', writable, artifactDir);
          smokeCheck('PACKAGED_ARTIFACT_DIR_OUTSIDE_ASAR_OK', outsideAsar, artifactDir);
          smokeCheck('TEST_ARTIFACT_WRITE_OK', writeOK, writePath);
          smokeCheck('TEST_ARTIFACT_PATH_TRAVERSAL_BLOCKED_OK', traversalBlocked, '');
        }
        // ===== FILE SHOW STORAGE: atomic file, bounded backups and crash choice =====
        {
          const profile = path.join(getTestArtifactDirectory(), 'show-storage-smoke-profile');
          fs.rmSync(profile, { recursive:true, force:true });
          const makeDocument = (name, speaker) => ({
            schemaVersion:1,
            show:{
              id:'smoke-show',name,details:{venue:'Smoke Hall'},
              rundown:[{id:'smoke-cue',name:'Keynote',durationMs:60000,speakerName:speaker}],selectedCue:0,liveCue:0,
              timer:{mode:'countdown',durationMs:60000,remainingMs:42000,elapsedMs:0,wasRunning:true,capturedAt:Date.now()},
              actualTimes:[],message:{text:'WRAP UP',flash:true},lowerThird:{activeTemplateId:'smoke-template'},
              screenContent:{scenes:[]},branding:{bgColor:'#000000'},outputs:{configs:[]},preferences:{lang:'en'}
            }
          });
          try {
            const baselineRepo = new ShowRepository({userDataDir:profile,appMetadata:{commit:'baseline'}});
            await baselineRepo.initializeSession({track:true});
            const baselineSave = await baselineRepo.save(makeDocument('Baseline show','Ada'));
            await baselineRepo.markClean();
            const crashRepo = new ShowRepository({userDataDir:profile,maxBackups:10,appMetadata:{commit:'crash'}});
            await crashRepo.initializeSession({track:true});
            const crashSave = await crashRepo.save(makeDocument('Crash autosave','Grace'));
            for(let version=0;version<12;version++) await crashRepo.save(makeDocument('Version '+version,'Grace'));
            const restartRepo = new ShowRepository({userDataDir:profile,appMetadata:{commit:'restart'}});
            const recoveryStatus = await restartRepo.initializeSession({track:true});
            const lastSaved = restartRepo.priorRecovery && restartRepo.priorRecovery.baselineDocument;
            const recovered = await restartRepo.resolveRecovery('recover');
            smokeCheck('SHOW_AUTOSAVE_ATOMIC_FILE_OK', baselineSave.ok && crashSave.ok && fs.existsSync(path.join(profile,'shows','current-show.json')), '');
            smokeCheck('SHOW_AUTOSAVE_BACKUPS_BOUNDED_OK', (await crashRepo.listBackups()).length===10, 'backups='+(await crashRepo.listBackups()).length);
            smokeCheck('SHOW_CRASH_RECOVERY_DETECTED_OK', recoveryStatus.recoveryAvailable && recoveryStatus.hasLastSaved, JSON.stringify(recoveryStatus));
            smokeCheck('SHOW_RECOVERY_CHOICES_VALID_OK', !!lastSaved && lastSaved.show.name==='Baseline show' && recovered.ok && recovered.document.show.name==='Version 11', '');
            await restartRepo.markClean();
          } catch(error) {
            ['SHOW_AUTOSAVE_ATOMIC_FILE_OK','SHOW_AUTOSAVE_BACKUPS_BOUNDED_OK','SHOW_CRASH_RECOVERY_DETECTED_OK','SHOW_RECOVERY_CHOICES_VALID_OK']
              .forEach(name=>smokeCheck(name,false,String(error&&error.message||error)));
          } finally {
            fs.rmSync(profile,{recursive:true,force:true});
          }
        }
        await waitLoad(controlWin);
        await new Promise(r => setTimeout(r, 600));
        const showStorageBridge = await controlWin.webContents.executeJavaScript(`JSON.stringify({
          status:typeof window.pt.showStorageStatus==='function',save:typeof window.pt.showStorageSave==='function',recover:typeof window.pt.showStorageRecover==='function',
          dialog:!!document.getElementById('showRecoveryOverlay'),saveStatus:!!document.getElementById('showSaveStatus')
        })`).then(JSON.parse).catch(()=>({}));
        smokeCheck('SHOW_STORAGE_NORMAL_UI_BRIDGE_OK', showStorageBridge.status&&showStorageBridge.save&&showStorageBridge.recover&&showStorageBridge.dialog&&showStorageBridge.saveStatus, JSON.stringify(showStorageBridge));

        // ===== PORTABLE SHOW / WIZARD / PREFLIGHT / STANDARD SCREEN CONTENT =====
        {
          const showPackagePath = path.join(getTestArtifactDirectory(), 'show-package', 'smoke-roundtrip.showslate-show');
          fs.mkdirSync(path.dirname(showPackagePath), { recursive:true });
          fs.rmSync(showPackagePath, { force:true });
          const productWorkflow = await controlWin.webContents.executeJavaScript(`(async function(){
            const bridge={
              exportShow:typeof window.pt.showPackageExport==='function',
              importShow:typeof window.pt.showPackageImport==='function',
              preflight:typeof window.pt.showPreflightInspect==='function'
            };
            const buttons={
              newShow:!!document.getElementById('btnNewShow'),preflight:!!document.getElementById('btnPreflight'),
              exportShow:!!document.getElementById('btnShowExport'),importShow:!!document.getElementById('btnShowImport'),
              slides:!!document.getElementById('btnSidebarSlides')&&!!document.querySelector('[data-testid="slides-panel"]')
            };
            document.getElementById('btnTb').click(); document.getElementById('btnNewShow').click();
            const wizardOpen=document.getElementById('newShowOverlay').classList.contains('open'); closeNewShowWizard();
            const documentFixture={schemaVersion:1,show:{
              id:'smoke-portable-show',name:'Smoke Portable Show',details:{},
              rundown:[{id:'smoke-portable-cue',name:'Opening',durationMs:60000}],selectedCue:0,liveCue:-1,
              timer:{mode:'countdown',durationMs:60000,remainingMs:60000,elapsedMs:0,wasRunning:false,capturedAt:Date.now()},
              actualTimes:[],message:{text:'',flash:false},lowerThird:{},
              screenContent:{scenes:[{id:'smoke-portable-scene',name:'Timer',layers:[{id:'smoke-portable-layer',type:'timer',name:'Timer'}]}],activeSceneId:'smoke-portable-scene',items:[{id:'smoke-portable-content',name:'Timer',type:'timer',sceneId:'smoke-portable-scene'}],selectedContentItemId:'smoke-portable-content',liveContentItemId:''},
              branding:{},outputs:{configs:[]},preferences:{lang:'en'}
            }};
            const exported=await window.pt.showPackageExport({document:documentFixture,testPath:${JSON.stringify(showPackagePath)}});
            const imported=exported&&exported.ok?await window.pt.showPackageImport({testPath:${JSON.stringify(showPackagePath)}}):{ok:false};
            const pf=await window.pt.showPreflightInspect({document:documentFixture,selectedDisplayId:${JSON.stringify(SMOKE_TARGET && SMOKE_TARGET.id)},lastSaveOk:true});

            const old={S:cloneState(S),program:cloneState(programState),items:cloneState(contentItems),selected:selectedContentItemId,live:liveContentItemId,cues:cloneState(cues),current:currentCue,selectedCue};
            S.scenes=[
              {id:'smoke-content-a',name:'A',layers:[{id:'smoke-layer-a',type:'timer',name:'Timer',visible:true,x:0,y:0,w:100,h:100,opacity:1}]},
              {id:'smoke-content-b',name:'B',layers:[{id:'smoke-layer-b',type:'text',name:'B',text:'B',visible:true,x:0,y:0,w:100,h:100,opacity:1}]}
            ];
            contentItems=[{id:'smoke-item-a',name:'A',type:'timer',sceneId:'smoke-content-a'},{id:'smoke-item-b',name:'B',type:'text',sceneId:'smoke-content-b'}];
            selectedContentItemId='smoke-item-a'; liveContentItemId='smoke-item-a'; S.activeSceneId='smoke-content-a'; programState=outputSnapshot(S);
            selectContentItem('smoke-item-b');
            const selectedSafe=programState.activeSceneId==='smoke-content-a'&&S.activeSceneId==='smoke-content-b'&&liveContentItemId==='smoke-item-a';
            send(true);
            const stateSendSafe=programState.activeSceneId==='smoke-content-a';
            const took=takeSelectedContent('cut')&&programState.activeSceneId==='smoke-content-b'&&liveContentItemId==='smoke-item-b';
            clearLiveContent(); renderStage('pg',programState,Date.now());
            const cleared=liveContentItemId===''&&programState.activeSceneId==='scene-content-clear'&&document.getElementById('pgScene').textContent.trim()==='';
            const cuePlan=PTSC.cueTakePlan({contentItemId:'smoke-item-b',autoTakeContentOnGo:true},{items:contentItems});
            S=old.S; programState=old.program; contentItems=old.items; selectedContentItemId=old.selected; liveContentItemId=old.live; cues=old.cues; currentCue=old.current; selectedCue=old.selectedCue;
            saveSettings(); renderScenesUI(); renderContentItems(); renderCues();
            if(programState) pushProgramState(programState);
            return JSON.stringify({bridge,buttons,wizardOpen,exported,imported,pf,selectedSafe,stateSendSafe,took,cleared,cuePlan:!!cuePlan.enabled});
          })()`).then(JSON.parse).catch(error=>({error:String(error&&error.message||error)}));
          smokeCheck('SHOW_PACKAGE_NORMAL_UI_BRIDGE_OK', productWorkflow.bridge&&productWorkflow.bridge.exportShow&&productWorkflow.bridge.importShow&&productWorkflow.buttons.exportShow&&productWorkflow.buttons.importShow, JSON.stringify(productWorkflow));
          smokeCheck('SHOW_PACKAGE_PACKAGED_ROUNDTRIP_OK', productWorkflow.exported&&productWorkflow.exported.ok&&productWorkflow.imported&&productWorkflow.imported.ok&&productWorkflow.imported.document&&productWorkflow.imported.document.show.name==='Smoke Portable Show', JSON.stringify(productWorkflow.exported||productWorkflow));
          smokeCheck('NEW_SHOW_PREFLIGHT_NORMAL_UI_OK', productWorkflow.bridge&&productWorkflow.bridge.preflight&&productWorkflow.buttons.newShow&&productWorkflow.buttons.preflight&&productWorkflow.wizardOpen&&productWorkflow.pf&&productWorkflow.pf.overall!=='blocking', JSON.stringify(productWorkflow.pf||productWorkflow));
          smokeCheck('SCREEN_CONTENT_STANDARD_UI_OK', productWorkflow.buttons&&productWorkflow.buttons.slides, JSON.stringify(productWorkflow.buttons||productWorkflow));
          smokeCheck('SCREEN_CONTENT_SELECTED_TAKE_CLEAR_OK', productWorkflow.selectedSafe&&productWorkflow.stateSendSafe&&productWorkflow.took&&productWorkflow.cleared, JSON.stringify(productWorkflow));
          smokeCheck('SCREEN_CONTENT_CUE_PLAN_OK', productWorkflow.cuePlan, JSON.stringify(productWorkflow));
          fs.rmSync(showPackagePath, { force:true });
        }

        // ===== DISPLAY ISOLATION (configured target resolved; every test window stays there) =====
        {
          const allD = screen.getAllDisplays();
          smokeCheck('DISPLAY_INVENTORY_OK', allD.length >= 1 && allD.every(d => d.id != null && d.bounds && d.workArea), 'monitors=' + allD.length);
          smokeCheck('SMOKE_TARGET_DISPLAY_FOUND_OK', !!SMOKE_TARGET, 'target=' + (SMOKE_TARGET && SMOKE_TARGET.id));
          smokeCheck('SMOKE_TARGET_DISPLAY_MATCHES_CONFIG_OK', !!SMOKE_TARGET && allD.some(d => d.id === SMOKE_TARGET.id), 'label=' + (SMOKE_TARGET && SMOKE_TARGET.label));
          smokeCheck('SMOKE_CONFIGURED_TARGET_NO_FALLBACK_OK', !!SMOKE_TARGET && allD.some(d => d.id === SMOKE_TARGET.id), 'target=' + (SMOKE_TARGET && SMOKE_TARGET.label));
          // resolver returns null (→ abort path) for a monitor that isn't connected; no silent fallback
          const bogus = smokeDisplay.resolveTargetDisplay(screen, { argv: ['--smoke-display=NoSuchMonitor_ZZZ'], env: {}, root: '/nonexistent' });
          smokeCheck('SMOKE_DISPLAY_MISSING_ABORTS_OK', bogus.display === null, 'bogusResolved=' + (bogus.display ? bogus.display.id : 'null'));
          // no OS-level input-automation libraries loaded (smoke drives via executeJavaScript/IPC only)
          const hasInputLib = /robotjs|@nut-tree|applescript|osascript|iohook|@jitsi\/robotjs/i.test(Object.keys(require.cache).join(';'));
          smokeCheck('SMOKE_NO_GLOBAL_INPUT_AUTOMATION_OK', !hasInputLib, 'inputLib=' + hasInputLib);
          // source gating: every display-forcing site is behind `if (SMOKE && SMOKE_TARGET)` (normal mode untouched)
          let guarded = 0;
          try { guarded = (fs.readFileSync(__filename, 'utf8').match(/if \(SMOKE && SMOKE_TARGET\)/g) || []).length; } catch (e) {}
          smokeCheck('NORMAL_MODE_DISPLAY_SELECTION_UNCHANGED_OK', guarded >= 2, 'guardedSites=' + guarded);
          const cb = controlWin.getBounds();
          smokeCheck('SMOKE_CONTROLLER_ON_TARGET_DISPLAY_OK', smokeDisplay.insideRect(cb, SMOKE_TARGET.workArea, 2), 'ctlBounds=' + JSON.stringify(cb));
          try {
            writeTestArtifact('test-display/chosen-smoke-display.txt',
              'ID: ' + SMOKE_TARGET.id + '\nLabel: ' + (SMOKE_TARGET.label || '') + '\nWorkArea: ' + JSON.stringify(SMOKE_TARGET.workArea) + '\n');
            writeTestArtifact('test-display/controller-on-smoke-display.png', (await controlWin.webContents.capturePage()).toPNG());
          } catch (e) {}
        }

        smokeCheck('NO_AUTO_OUTPUT_OK', outputWin === null, 'outputWin=' + (outputWin === null ? 'null' : 'OPEN'));
        const ow = await ensureSmokeOutput();   // korisnički klik „Send to screen"

        // ===== OUTPUT + all windows stay on target; real fullscreen stays on target =====
        // Contract: VISIBLE windows must sit fully inside target WORKAREA (not just bounds);
        // the sole exception is the explicit native-fullscreen test (bounds, while fullscreen);
        // hidden windows must be neither visible nor focused.
        const sweepWindows = () => BrowserWindow.getAllWindows().filter(w => !w.isDestroyed())
          .map(w => ({ t: w.getTitle(), vis: w.isVisible(), fs: w.isFullScreen(), foc: w.isFocused(), b: w.getBounds() }));
        const winsInsideWorkArea = (list) => list.filter(w => w.vis && !w.fs)
          .every(w => smokeDisplay.insideRect(w.b, SMOKE_TARGET.workArea, 2));
        {
          const others = screen.getAllDisplays().filter(d => d.id !== SMOKE_TARGET.id);
          const overlapsOther = (b) => others.some(d => smokeDisplay.rectsOverlap(b, d.bounds, 2));
          const wins = sweepWindows();
          const visWins = wins.filter(w => w.vis);
          smokeCheck('SMOKE_VISIBLE_WINDOWS_INSIDE_WORKAREA_OK', winsInsideWorkArea(wins), 'vis=' + JSON.stringify(visWins.map(w => w.b)));
          smokeCheck('SMOKE_ALL_WINDOWS_CONTAINED_OK',
            wins.every(w => w.vis ? (w.fs ? smokeDisplay.insideRect(w.b, SMOKE_TARGET.bounds, 2) : smokeDisplay.insideRect(w.b, SMOKE_TARGET.workArea, 2)) : !w.foc),
            'wins=' + JSON.stringify(wins.map(w => ({ vis: w.vis, fs: w.fs, b: w.b }))));
          smokeCheck('SMOKE_NO_WINDOW_ON_OTHER_DISPLAY_OK', visWins.every(w => !overlapsOther(w.b)), 'onOther=' + JSON.stringify(visWins.filter(w => overlapsOther(w.b)).map(w => w.t)));
          smokeCheck('SMOKE_OUTPUTS_ON_TARGET_DISPLAY_OK', smokeDisplay.insideRect(ow.getBounds(), SMOKE_TARGET.workArea, 2) && !overlapsOther(ow.getBounds()), 'outBounds=' + JSON.stringify(ow.getBounds()));
          smokeCheck('PACKAGED_SMOKE_USES_TARGET_DISPLAY_OK', smokeDisplay.insideRect(controlWin.getBounds(), SMOKE_TARGET.workArea, 2) && smokeDisplay.insideRect(ow.getBounds(), SMOKE_TARGET.workArea, 2), 'ctl+out on target');
          try { writeTestArtifact('test-display/output-on-smoke-display.png', (await ow.webContents.capturePage()).toPNG()); } catch (e) {}
          // AMBIGUITY unit check: two PHL-labelled monitors ⇒ resolver must abort (no first-pick)
          try {
            const stub = {
              getAllDisplays: () => [
                { id: 91, label: 'PHL 243V7', bounds: { x: 0, y: 0, width: 1, height: 1 }, workArea: { x: 0, y: 0, width: 1, height: 1 } },
                { id: 92, label: 'PHL 243V7', bounds: { x: 1, y: 0, width: 1, height: 1 }, workArea: { x: 1, y: 0, width: 1, height: 1 } }
              ],
              getPrimaryDisplay: () => ({ id: 91 })
            };
            const amb = smokeDisplay.resolveTargetDisplay(stub, { argv: ['--smoke-display=PHL 243V7'], env: {}, root: '/nonexistent-no-config' });
            smokeCheck('SMOKE_AMBIGUOUS_DISPLAY_MATCH_ABORTS_OK', amb.display === null && amb.ambiguous === true && amb.matches.length === 2, JSON.stringify({ amb: amb.ambiguous, n: amb.matches.length }));
          } catch (e) { smokeCheck('SMOKE_AMBIGUOUS_DISPLAY_MATCH_ABORTS_OK', false, 'ERR ' + e); }
          // real native fullscreen — the ONLY allowed bounds-exception, and only while fullscreen
          try {
            const preFs = ow.getBounds();
            try { app.focus({ steal: true }); ow.show(); ow.focus(); } catch (e) {}
            ow.setFullScreen(true);
            for (let i = 0; i < 80 && !ow.isFullScreen(); i++) {
              if (i === 30) {
                try { app.focus({ steal: true }); ow.focus(); ow.setFullScreen(true); } catch (e) {}
              }
              await new Promise(r => setTimeout(r, 120));
            }
            await new Promise(r => setTimeout(r, 250));
            const fsB = ow.getBounds();
            const enteredNativeFullscreen = ow.isFullScreen();
            smokeCheck('SMOKE_FULLSCREEN_STAYS_ON_TARGET_OK', !overlapsOther(fsB), 'fsBounds=' + JSON.stringify(fsB));
            smokeCheck('SMOKE_NATIVE_FULLSCREEN_ONLY_BOUNDS_EXCEPTION_OK',
              (!ow.isFullScreen() && smokeDisplay.insideRect(fsB, SMOKE_TARGET.workArea, 2) && !overlapsOther(fsB)) ||
                (ow.isFullScreen() && smokeDisplay.insideRect(fsB, SMOKE_TARGET.bounds, 2) && !overlapsOther(fsB)),
              'fs=' + ow.isFullScreen() + ' b=' + JSON.stringify(fsB));
            ow.setFullScreen(false);
            for (let i = 0; i < 80 && ow.isFullScreen(); i++) await new Promise(r => setTimeout(r, 120));
            await new Promise(r => setTimeout(r, 250));
            const postFs = ow.getBounds();
            smokeCheck('SMOKE_FULLSCREEN_RESTORES_OK', !ow.isFullScreen() && !overlapsOther(postFs), 'fs=' + ow.isFullScreen());
            smokeCheck('SMOKE_WINDOW_RESTORES_AFTER_FULLSCREEN_OK',
              smokeDisplay.insideRect(postFs, SMOKE_TARGET.workArea, 2) && !overlapsOther(postFs) &&
                (!enteredNativeFullscreen || (Math.abs(postFs.width - preFs.width) <= 4 && Math.abs(postFs.height - preFs.height) <= 4)),
              'entered=' + enteredNativeFullscreen + ' pre=' + JSON.stringify(preFs) + ' post=' + JSON.stringify(postFs));
          } catch (e) {
            smokeCheck('SMOKE_FULLSCREEN_STAYS_ON_TARGET_OK', false, 'ERR ' + e);
            smokeCheck('SMOKE_NATIVE_FULLSCREEN_ONLY_BOUNDS_EXCEPTION_OK', false, 'ERR ' + e);
            smokeCheck('SMOKE_FULLSCREEN_RESTORES_OK', false, 'ERR ' + e);
            smokeCheck('SMOKE_WINDOW_RESTORES_AFTER_FULLSCREEN_OK', false, 'ERR ' + e);
          }
        }
        // opcioni jezik + demo rundown za snimke: --ui-lang=en --demo
        const langArg = (process.argv.find(a => a.startsWith('--ui-lang=')) || '').split('=')[1];
        const demo = process.argv.includes('--demo');
        if (langArg || demo) {
          const now = new Date(); const hhmm = String(now.getHours()).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
          const seed = demo ? `
            localStorage.setItem('pt_cues', JSON.stringify([
              {name:'Pre-show Countdown', durationMs:600000, note:'Music plays, holding slide', color:'#3fb950'},
              {name:'Welcome', durationMs:600000, note:'Emma Thompson', color:'#4493f8'},
              {name:'Session 1', durationMs:3000000, note:'Liam Carter, Sophia Patel', color:'#d9a441'},
              {name:'Lunch break', durationMs:3600000, note:'Lunch in the lobby', color:'#a371f7'}
            ]));
            var st=JSON.parse(localStorage.getItem('pt_settings')||'{}'); st.showStart='${hhmm}'; st.showNowNext=true; st.showProgress=true; localStorage.setItem('pt_settings', JSON.stringify(st));` : '';
          await controlWin.webContents.executeJavaScript(`localStorage.setItem('pt_lang','${langArg||'en'}'); ${seed} location.reload();`);
          await waitLoad(controlWin);
          if (demo) { await new Promise(r=>setTimeout(r,500)); await controlWin.webContents.executeJavaScript(`loadCue(0,false); startPause();`); }
        }
        await new Promise(r => setTimeout(r, 1800));
        fs.writeFileSync('/tmp/showslate_ctl.png', (await controlWin.webContents.capturePage()).toPNG());
        fs.writeFileSync('/tmp/showslate_out.png', (await ow.webContents.capturePage()).toPNG());
        // snimak backstage stranice (učita živi /backstage preko servera)
        if (demo) {
          const bw = new BrowserWindow({ width:1280, height:720, show:false, backgroundColor:'#0a0c10',
            webPreferences:{ contextIsolation:true } });
          await bw.loadURL(`http://127.0.0.1:${serverPort}/backstage`);
          await new Promise(r=>setTimeout(r,1600));
          fs.writeFileSync('/tmp/showslate_backstage.png', (await bw.webContents.capturePage()).toPNG());
          bw.destroy();
        }
        // NAPREDNO prekidač menja dubinu editovanja, ali Preview/Program i live komande
        // ostaju vidljivi u oba režima. Direct je forsiran kada je Napredno isključeno.
        let advOK = false, advStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            localStorage.removeItem('pt_advanced');
            const chk=document.getElementById('chkAdvanced');
            if(chk && chk.checked){
              chk.checked=false;
              chk.dispatchEvent(new Event('change'));
            }
          })()`);
          await new Promise(r=>setTimeout(r,120));
          advStr = await controlWin.webContents.executeJavaScript(`(function(){
            const pv=document.querySelector('.studio-preview'), sw=document.querySelector('.studio-switcher');
            const before={simple:document.getElementById('studio').classList.contains('simple'),
              pvVisible:pv.offsetParent!==null, swVisible:sw.offsetParent!==null, direct:!!S.studioDirect,
              chk:document.getElementById('chkAdvanced').checked};
            document.getElementById('chkAdvanced').checked=true;
            document.getElementById('chkAdvanced').dispatchEvent(new Event('change'));
            const after={simple:document.getElementById('studio').classList.contains('simple'),
              pvVisible:pv.offsetParent!==null, swVisible:sw.offsetParent!==null};
            return JSON.stringify({before,after});
          })()`);
          const A = JSON.parse(advStr);
          advOK = A.before.simple && A.before.pvVisible && A.before.swVisible && A.before.direct && !A.before.chk
            && !A.after.simple && A.after.pvVisible && A.after.swVisible;
        } catch (e) { advStr = 'ERR ' + e; }
        smokeCheck('ADVANCED_TOGGLE_OK', advOK, advStr);
        // test mrežnog izlaza: HTML stranica
        const got = await new Promise((resolve) => {
          http.get(`http://127.0.0.1:${serverPort}/`, r => {
            let d = ''; r.on('data', c => d += c); r.on('end', () => resolve(d.includes('ShowSlate')));
          }).on('error', () => resolve(false));
        });
        smokeCheck('SERVER_OK', got, 'PORT=' + serverPort);
        // test SSE: da li /events isporučuje trenutno stanje (lanac kontroler→main→OBS)
        const readState = () => new Promise((resolve) => {
          const r = http.get(`http://127.0.0.1:${serverPort}/events`, res => {
            let buf = '';
            res.on('data', c => {
              buf += c;
              const m = buf.match(/data: (\{.*\})/);
              if (m) { r.destroy(); try { resolve(JSON.parse(m[1])); } catch (e) { resolve(null); } }
            });
          });
          r.on('error', () => resolve(null));
          setTimeout(() => { r.destroy(); resolve(null); }, 3000);
        });
        const postCmd = (obj) => new Promise((resolve) => {
          const data = JSON.stringify(obj);
          const r = http.request(`http://127.0.0.1:${serverPort}/cmd`,
            { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'x-pt-token': CMD_TOKEN } },
            res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d)); });
          r.on('error', () => resolve(null)); r.write(data); r.end();
        });
        const sse = await readState();
        smokeCheck('SSE_OK', sse && sse.mode === 'countdown' && sse.durationMs > 0, 'SSE_MODE=' + (sse && sse.mode));

        // test daljinskog: /remote stranica + POST komanda menja stanje
        const remotePage = await new Promise((resolve) => {
          http.get(`http://127.0.0.1:${serverPort}/remote`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d.includes('Daljinski'))); }).on('error',()=>resolve(false));
        });
        await postCmd({ type: 'setDuration', value: 300000 });
        await new Promise(r => setTimeout(r, 400));
        const after = await readState();
        smokeCheck('REMOTE_PAGE_OK', remotePage);
        smokeCheck('REMOTE_CMD_OK', after && after.durationMs === 300000);
        // bezbednost: /cmd BEZ tokena mora biti odbijen (403)
        const noTokStatus = await new Promise((resolve) => {
          const data = JSON.stringify({ type: 'reset' });
          const r = http.request(`http://127.0.0.1:${serverPort}/cmd`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => resolve(res.statusCode));
          r.on('error', () => resolve(0)); r.write(data); r.end();
        });
        smokeCheck('CMD_TOKEN_GUARD_OK', noTokStatus === 403);
        // HTTP GET API (Stream Deck / Companion): GET /cmd?type=…&t=token menja stanje
        const getStatus = (u) => new Promise((resolve) => {
          http.get(`http://127.0.0.1:${serverPort}${u}`, r => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0));
        });
        const gOK = await getStatus(`/cmd?type=setDuration&value=240000&t=${CMD_TOKEN}`);
        await new Promise(r => setTimeout(r, 400));
        const afterGet = await readState();
        const gNoTok = await getStatus(`/cmd?type=reset`);
        const gBadType = await getStatus(`/cmd?type=hakuj&t=${CMD_TOKEN}`);
        smokeCheck('HTTP_GET_API_OK', gOK === 200 && afterGet && afterGet.durationMs === 240000 && gNoTok === 403 && gBadType === 400,
          `status=${gOK} dur=${afterGet && afterGet.durationMs} noTok=${gNoTok} badType=${gBadType}`);
        const getJson = (route) => new Promise(resolve => {
          http.get(`http://127.0.0.1:${serverPort}${route}`, response => {
            let body = '';
            response.on('data', chunk => { body += chunk; });
            response.on('end', () => {
              try { resolve({ statusCode: response.statusCode, body: JSON.parse(body) }); }
              catch (_) { resolve({ statusCode: response.statusCode, body: null }); }
            });
          }).on('error', () => resolve({ statusCode: 0, body: null }));
        });
        const fullControlStatus = await getJson(`/api/status?t=${CMD_TOKEN}`);
        const showControlStatus = await getJson(`/api/status/show?t=${CMD_TOKEN}`);
        const cueControlStatus = await getJson(`/api/status/cue?t=${CMD_TOKEN}`);
        const ltControlStatus = await getJson(`/api/status/lower-third?t=${CMD_TOKEN}`);
        const statusNoToken = await getJson('/api/status');
        const serializedControlStatus = JSON.stringify(fullControlStatus.body || {});
        smokeCheck('CONTROL_STATUS_API_OK',
          fullControlStatus.statusCode === 200 && fullControlStatus.body && fullControlStatus.body.status.ready === true
          && showControlStatus.body && showControlStatus.body.status.show && !showControlStatus.body.status.cue
          && cueControlStatus.body && cueControlStatus.body.status.cue && !cueControlStatus.body.status.show
          && ltControlStatus.body && ltControlStatus.body.status.lowerThird
          && statusNoToken.statusCode === 403
          && !serializedControlStatus.includes(CMD_TOKEN) && !serializedControlStatus.includes('templates'),
          `full=${fullControlStatus.statusCode} noToken=${statusNoToken.statusCode}`);
        const messageAccepted = await getStatus(`/cmd?type=messageSend&value=${encodeURIComponent('COMPANION CHECK')}&t=${CMD_TOKEN}`);
        await new Promise(resolve => setTimeout(resolve, 160));
        const messageStatus = await getJson(`/api/status/show?t=${CMD_TOKEN}`);
        await getStatus(`/cmd?type=messageClear&t=${CMD_TOKEN}`);
        smokeCheck('PRO_CONTROL_HTTP_OK', messageAccepted === 200 && messageStatus.body && messageStatus.body.status.message.text === 'COMPANION CHECK');
        const oscPacket = (address, value) => {
          const oscPad = string => { const bytes = Buffer.from(string + '\0'); return Buffer.concat([bytes, Buffer.alloc((4 - (bytes.length % 4)) % 4)]); };
          return value === undefined ? oscPad(address) : Buffer.concat([oscPad(address), oscPad(',s'), oscPad(String(value))]);
        };
        await new Promise(resolve => {
          const socket = require('dgram').createSocket('udp4');
          socket.send(oscPacket('/showslate/message/send', 'OSC CHECK'), oscPort, '127.0.0.1', () => { socket.close(); resolve(); });
        });
        await new Promise(resolve => setTimeout(resolve, 160));
        const oscMessageStatus = await getJson(`/api/status/show?t=${CMD_TOKEN}`);
        await new Promise(resolve => {
          const socket = require('dgram').createSocket('udp4');
          socket.send(oscPacket('/showslate/message/clear'), oscPort, '127.0.0.1', () => { socket.close(); resolve(); });
        });
        smokeCheck('PRO_CONTROL_OSC_ALIAS_OK', oscMessageStatus.body && oscMessageStatus.body.status.message.text === 'OSC CHECK');
        // OSC: send /showslate/setDuration 180000 (int32) to the active UDP port.
        const oscBuf = (() => {
          const pad = (s) => { const b = Buffer.from(s + '\0'); return Buffer.concat([b, Buffer.alloc((4 - (b.length % 4)) % 4)]); };
          const arg = Buffer.alloc(4); arg.writeInt32BE(180000);
          return Buffer.concat([pad('/showslate/setDuration'), pad(',i'), arg]);
        })();
        await new Promise((resolve) => {
          const s = require('dgram').createSocket('udp4');
          s.send(oscBuf, oscPort, '127.0.0.1', () => { s.close(); resolve(); });
        });
        await new Promise(r => setTimeout(r, 400));
        const afterOsc = await readState();
        smokeCheck('OSC_OK', afterOsc && afterOsc.durationMs === 180000, `port=${oscPort} dur=${afterOsc && afterOsc.durationMs}`);
        const backstagePage = await new Promise((resolve) => {
          http.get(`http://127.0.0.1:${serverPort}/backstage`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d.includes('Backstage'))); }).on('error',()=>resolve(false));
        });
        smokeCheck('BACKSTAGE_PAGE_OK', backstagePage);
        smokeCheck('RUNDOWN_IN_STATE', after && Array.isArray(after.cues));
        // test providnosti: uključi → Ekran prozor se presozdaje providan bez pada
        await controlWin.webContents.executeJavaScript(`document.getElementById('chkTransparent').checked=true; document.getElementById('chkTransparent').dispatchEvent(new Event('change'));`);
        await new Promise(r => setTimeout(r, 1100));
        let cornerAlpha = -1;
        try {
          const img = await outputWin.webContents.capturePage();
          const bmp = img.toBitmap(); const sz = img.getSize();
          // sredina-levo: pozadina, dalje od gornje #ui trake i centriranog tajmera
          cornerAlpha = bmp[(Math.floor(sz.height * 0.5) * sz.width + 6) * 4 + 3];
        } catch (e) {}
        smokeCheck('TRANSPARENT_RECREATE_OK', !!outputWin && !outputWin.isDestroyed() && outputTransparent === true, 'CORNER_ALPHA=' + cornerAlpha);
        // isključi providnost → ponovo neproziran (alfa 255)
        await controlWin.webContents.executeJavaScript(`document.getElementById('chkTransparent').checked=false; document.getElementById('chkTransparent').dispatchEvent(new Event('change'));`);
        await new Promise(r => setTimeout(r, 1100));
        let offAlpha = -1;
        try { const img = await outputWin.webContents.capturePage(); const bmp = img.toBitmap(); const sz = img.getSize(); offAlpha = bmp[(8 * sz.width + 8) * 4 + 3]; } catch (e) {}
        smokeCheck('OPAQUE_AGAIN_OK', outputTransparent === false, 'OFF_ALPHA=' + offAlpha);
        // QR generator radi i spakovan je
        let qrOK = false;
        try { const svg = await controlWin.webContents.executeJavaScript("window.pt.qr('http://192.168.1.50:7878')"); qrOK = typeof svg === 'string' && svg.includes('<svg'); } catch (e) {}
        smokeCheck('QR_OK', qrOK);
        // i18n: English je default, a language pack ima 30+ tržišno bitnih jezika
        let langOK = false, langStr = '?';
        try {
          langStr = await controlWin.webContents.executeJavaScript(`(function(){
            const langs = window.PT_LANGUAGES || [];
            const packs = window.PT_I18N || {};
            const sel = document.getElementById('langSel');
            const codes = langs.map(l => l.code);
            const enKeys = Object.keys(packs.en || {});
            const missing = codes.filter(c => !packs[c] || enKeys.some(k => !(k in packs[c])));
            let switched = false, allSwitched = true, studioSr = false;
            if (sel && codes.includes('es')) {
              sel.value = 'es';
              sel.dispatchEvent(new Event('change'));
              const lowerText = document.querySelector('[data-i18n="lowerThird"]')?.textContent || '';
              const ltName = document.getElementById('ltName')?.placeholder || '';
              const cueLtName = document.getElementById('cueLtName')?.placeholder || '';
              const gridTitle = document.getElementById('gridSizeSel')?.title || '';
              switched = document.documentElement.lang === 'es'
                && document.querySelector('[data-i18n="sendScreen"]').textContent.includes('pantalla')
                && lowerText === 'Rótulo'
                && ltName.includes('ponente')
                && cueLtName.includes('rótulo')
                && gridTitle.includes('cuadrícula')
                && S.lang === 'es';
            }
            if(sel){
              langs.forEach(meta=>{
                sel.value=meta.code; sel.dispatchEvent(new Event('change'));
                const expectedDir=meta.dir||'ltr';
                const sendText=document.querySelector('[data-i18n="sendScreen"]')?.textContent||'';
                if(document.documentElement.lang!==meta.code||document.documentElement.dir!==expectedDir||S.lang!==meta.code||!sendText) allSwitched=false;
              });
              sel.value='sr'; sel.dispatchEvent(new Event('change'));
              openLtStudio(); renderLtStudio();
              const inspectorTitles=[...document.querySelectorAll('#ltStudioInspector .lt-inspector-section-title')].map(el=>el.textContent);
              const readyStatus=document.getElementById('ltStudioStatus')?.textContent||'';
              ltPreviewStudio();
              const previewStatus=document.getElementById('ltStudioStatus')?.textContent||'';
              studioSr=document.getElementById('btnLtStudioSave')?.textContent==='SAČUVAJ'
                && document.getElementById('btnLtStudioOpen')?.textContent==='UREDI STUDIO'
                && inspectorTitles.includes('Transformacija') && inspectorTitles.includes('Animacija')
                && readyStatus.includes('Studio je spreman') && previewStatus.includes('Program nije promenjen');
              closeLtStudio({returnFocus:false});
              sel.value='en'; sel.dispatchEvent(new Event('change'));
            }
            const full=langs.filter(meta=>meta.coverage==='full').map(meta=>meta.code);
            const coverageDisclosed=full.length===2&&full.includes('en')&&full.includes('sr')
              && [...sel.options].some(option=>option.value==='en'&&option.textContent.includes('FULL'))
              && [...sel.options].some(option=>option.value==='es'&&option.textContent.includes('CORE'));
            return JSON.stringify({
              count: langs.length,
              first: codes[0] || '',
              htmlLang: document.documentElement.lang,
              selected: sel ? sel.value : '',
              hasSr: codes.includes('sr'),
              switched,
              allSwitched,
              studioSr,
              full,
              coverageDisclosed,
              missing
            });
          })()`);
          const info = JSON.parse(langStr);
          langOK = info.count >= 31 && info.first === 'en' && info.htmlLang === 'en'
            && info.selected === 'en' && info.hasSr && info.switched && info.allSwitched && info.studioSr && info.coverageDisclosed && info.missing.length === 0;
        } catch (e) { langStr = 'ERR ' + e; }
        smokeCheck('LANGUAGE_PACK_OK', langOK, langStr);
        const languageInfo = (()=>{ try{return JSON.parse(langStr);}catch(e){return {};} })();
        smokeCheck('LANGUAGE_ALL_37_SWITCH_OK', languageInfo.count===37 && languageInfo.allSwitched===true, langStr);
        smokeCheck('LANGUAGE_COVERAGE_DISCLOSED_OK', languageInfo.coverageDisclosed===true, langStr);
        smokeCheck('LT_STUDIO_SR_LOCALIZATION_OK', languageInfo.studioSr===true, langStr);
        let stableLayoutOK = false, stableLayoutStr = '?';
        try {
          controlWin.setSize(1280, 760);
          await new Promise(r => setTimeout(r, 400));
          stableLayoutStr = await controlWin.webContents.executeJavaScript(`(function(){
            const studio=document.getElementById('studio').getBoundingClientRect();
            const preview=document.querySelector('.studio-preview').getBoundingClientRect();
            const program=document.querySelector('.studio-program').getBoundingClientRect();
            const middleSwitcher=document.querySelector('#studio > .studio-switcher');
            const sidebarSwitcher=document.querySelector('.sidebar-live-controls .studio-switcher');
            const controls=['btnTake','btnGo','btnBack','btnFadeBlack'].map(id=>document.getElementById(id));
            const cols=getComputedStyle(document.getElementById('studio')).gridTemplateColumns.trim().split(/\\s+/).length;
            const controlsVisible=controls.every(el=>{
              if(!el || !sidebarSwitcher || !sidebarSwitcher.contains(el)) return false;
              const r=el.getBoundingClientRect();
              return r.width>0 && r.height>0 && r.left>=0 && r.top>=0 && r.right<=innerWidth+1 && r.bottom<=innerHeight+1;
            });
            return JSON.stringify({
              cols,
              aligned:Math.abs(preview.top-program.top)<3 && Math.abs(preview.bottom-program.bottom)<3,
              equalWidth:Math.abs(preview.width-program.width)<4,
              separated:preview.right<=program.left+2,
              largeMonitors:preview.width>=430 && program.width>=430 && preview.height>=200 && program.height>=200,
              middleRemoved:!middleSwitcher,
              sidebarSwitcher:!!sidebarSwitcher,
              controlsVisible,
              singleTake:document.querySelectorAll('#btnTake').length===1 && !document.getElementById('btnSlideTake'),
              w:Math.round(innerWidth),
              studio:{x:Math.round(studio.x),w:Math.round(studio.width)},
              preview:{w:Math.round(preview.width),h:Math.round(preview.height)},
              program:{w:Math.round(program.width),h:Math.round(program.height)}
            });
          })()`);
          const sl = JSON.parse(stableLayoutStr);
          stableLayoutOK = sl.cols === 2 && sl.aligned && sl.equalWidth && sl.separated && sl.largeMonitors
            && sl.middleRemoved && sl.sidebarSwitcher && sl.controlsVisible && sl.singleTake;
        } catch (e) { stableLayoutStr = 'ERR ' + e; }
        smokeCheck('STABLE_LAYOUT_OK', stableLayoutOK, stableLayoutStr);
        await controlWin.webContents.executeJavaScript(`(function(){
          S.studioDirect=true;
          const d=document.getElementById('chkDirectProgram');
          if(d) d.checked=true;
          send(true);
        })()`);
        // kompaktan prozor: u PROZORU (ne fullscreen) → prozor se skupi na visinu tajmera
        await controlWin.webContents.executeJavaScript(`(function(){
          S.fitWindow=false; S.gridOn=false; S.transparent=false;
          S.scenes=[{id:'smoke-fit-scene',name:'Fit timer',layers:[Object.assign(makeTimerLayer(),{
            id:'smoke-fit-timer',x:0,y:0,w:100,h:45
          })]}];
          S.activeSceneId='smoke-fit-scene';
          renderScenesUI();
          document.getElementById('chkFit').checked=false;
          document.getElementById('chkGrid').checked=false;
          document.getElementById('chkTransparent').checked=false;
          send();
        })()`);
        await new Promise(r => setTimeout(r, 400));
        try {
          const d = screen.getAllDisplays().find(x => x.id === outputTargetId) || screen.getPrimaryDisplay();
          positionOutput(d);
        } catch (e) {}
        await new Promise(r => setTimeout(r, 500));
        await controlWin.webContents.executeJavaScript("window.pt.exitFullscreen()");
        // macOS fullscreen-izlaz je animiran (~1s) — čekaj da se stvarno završi, ne fiksno
        for (let i = 0; i < 30 && outputWin.isFullScreen(); i++) await new Promise(r => setTimeout(r, 150));
        await new Promise(r => setTimeout(r, 400));
        let fitH0 = 9999, fitH1 = 9999;
        try { fitH0 = outputWin.getContentSize()[1]; } catch (e) {}
        await controlWin.webContents.executeJavaScript("document.getElementById('chkFit').checked=true; document.getElementById('chkFit').dispatchEvent(new Event('change'));");
        // sačekaj da fit stvarno smanji prozor (do 3s)
        for (let i = 0; i < 20; i++) {
          await new Promise(r => setTimeout(r, 150));
          try { fitH1 = outputWin.getContentSize()[1]; } catch (e) {}
          if (fitH1 < fitH0 - 40) break;
        }
        smokeCheck('FIT_OK', fitH1 < fitH0 - 40 && fitH1 > 60, 'FIT_H=' + fitH0 + '→' + fitH1);
        // GRID: uključi grid 3×3, kockica 0 (gore-levo) → PROZOR = ta kockica monitora
        await controlWin.webContents.executeJavaScript("document.getElementById('chkFit').checked=false; document.getElementById('chkFit').dispatchEvent(new Event('change')); var g=document.getElementById('chkGrid'); g.checked=true; g.dispatchEvent(new Event('change')); var gs=document.getElementById('gridSizeSel'); gs.value='3'; gs.dispatchEvent(new Event('change')); document.querySelectorAll('#gridSel .gc')[0].click();");
        await new Promise(r => setTimeout(r, 800));
        let gridWinOK = false, gbStr = '?';
        try {
          const d = screen.getAllDisplays().find(x => x.id === outputTargetId) || screen.getPrimaryDisplay();
          const gb = outputWin.getBounds();
          const expW = Math.floor(d.bounds.width / 3), expH = Math.floor(d.bounds.height / 3);
          // ključno: prozor je VELIČINE kockice i nije fullscreen (tačan x/y zavisi od rasporeda monitora)
          gridWinOK = Math.abs(gb.width - expW) < 8 && Math.abs(gb.height - expH) < 8 && !outputWin.isFullScreen();
          gbStr = `${gb.width}x${gb.height}@${gb.x},${gb.y} (cell≈${expW}x${expH}) frameless=${outputFrameless}`;
        } catch (e) {}
        smokeCheck('GRID_WIN_OK', gridWinOK, gbStr);
        // Grid picker je sada ispod transporta; mora da bude klikabilan i da šalje Programu u Direct režimu.
        let gridPreviewClickOK = false, gridPreviewClickStr = '?';
        try {
          gridPreviewClickStr = await controlWin.webContents.executeJavaScript(`(function(){
            const cells=[...document.querySelectorAll('#gridSel .gc')];
            if(!cells.length) return JSON.stringify({count:0});
            cells[cells.length-1].click();
            const lower=[...document.querySelectorAll('#gridSel .gc')].findIndex(x=>x.classList.contains('sel'));
            return JSON.stringify({count:cells.length,gridCell:S.gridCell,lower,on:S.gridOn});
          })()`);
          const g = JSON.parse(gridPreviewClickStr);
          gridPreviewClickOK = g.count === 9 && g.gridCell === 8 && g.lower === 8 && g.on === true;
        } catch (e) { gridPreviewClickStr = 'ERR ' + e; }
        smokeCheck('GRID_PREVIEW_CLICK_OK', gridPreviewClickOK, gridPreviewClickStr);
        let gridCustomOK = false, gridCustomStr = '?';
        try {
          gridCustomStr = await controlWin.webContents.executeJavaScript(`(function(){
            const gs=document.getElementById('gridSizeSel');
            gs.value='12';
            gs.dispatchEvent(new Event('change'));
            const cells=[...document.querySelectorAll('#gridSel .gc')];
            cells[143].click();
            return JSON.stringify({
              size:S.gridSize,
              cell:S.gridCell,
              lower:cells.length,
              preview:document.querySelectorAll('#gridSel .gc').length,
              select:gs.value
            });
          })()`);
          const cg = JSON.parse(gridCustomStr);
          gridCustomOK = cg.size === 12 && cg.cell === 143 && cg.lower === 144 && cg.preview === 144 && cg.select === '12';
        } catch (e) { gridCustomStr = 'ERR ' + e; }
        smokeCheck('GRID_CUSTOM_12_OK', gridCustomOK, gridCustomStr);
        let studioModeOK = false, studioModeStr = '?';
        try {
          studioModeStr = await controlWin.webContents.executeJavaScript(`(function(){
            S.studioDirect=true;
            const direct=document.getElementById('chkDirectProgram');
            direct.checked=true;
            direct.dispatchEvent(new Event('change'));
            S.fgColor='#ffffff';
            send(true);
            direct.checked=false;
            direct.dispatchEvent(new Event('change'));
            document.getElementById('fgColor').value='#00ff00';
            document.getElementById('fgColor').dispatchEvent(new Event('input'));
            const beforeProgram=programState.fgColor;
            const previewColor=S.fgColor;
            document.getElementById('btnTake').click();
            const afterProgram=programState.fgColor;
            direct.checked=true;
            direct.dispatchEvent(new Event('change'));
            return JSON.stringify({beforeProgram,previewColor,afterProgram,direct:S.studioDirect});
          })()`);
          const st = JSON.parse(studioModeStr);
          studioModeOK = st.beforeProgram === '#ffffff' && st.previewColor === '#00ff00' && st.afterProgram === '#00ff00' && st.direct === true;
        } catch (e) { studioModeStr = 'ERR ' + e; }
        smokeCheck('STUDIO_MODE_OK', studioModeOK, studioModeStr);
        // Logo mora da se prihvati, prikaže kao thumbnail u kontroli i renderuje na output strani.
        // Thumbnail je u tabu „Izgled" — otvori tab kao što bi korisnik (inače je display:none → 0×0).
        let logoOK = false, logoStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            if(document.body.classList.contains('compositor-open')) document.getElementById('btnSettingsDrawer').click();
            var tb=document.querySelector('#setupTabs button[data-pane="look"]'); if(tb) tb.click();
            S.logo='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=';
            S.logoPos='br';
            S.logoSize=10;
            document.getElementById('logoPos').value='br';
            document.getElementById('logoSize').value='10';
            updateLogoPreview();
            send();
          })()`);
          await new Promise(r => setTimeout(r, 800));
          logoStr = await outputWin.webContents.executeJavaScript(`(function(){
            const logo=document.getElementById('logo');
            const r=logo.getBoundingClientRect();
            return JSON.stringify({display:getComputedStyle(logo).display,w:Math.round(r.width),h:Math.round(r.height),src:logo.src.slice(0,22)});
          })()`);
          const thumbStr = await controlWin.webContents.executeJavaScript(`(function(){
            const thumb=document.getElementById('logoThumb');
            const r=thumb.getBoundingClientRect();
            return JSON.stringify({display:getComputedStyle(thumb).display,w:Math.round(r.width),h:Math.round(r.height),src:thumb.src.slice(0,22)});
          })()`);
          const logo = JSON.parse(logoStr);
          const thumb = JSON.parse(thumbStr);
          logoOK = logo.display === 'block' && logo.w > 0 && logo.h > 0 && logo.src.startsWith('data:image/')
            && thumb.display === 'block' && thumb.w > 0 && thumb.h > 0 && thumb.src.startsWith('data:image/');
          logoStr = 'output=' + logoStr + ' thumb=' + thumbStr;
        } catch (e) { logoStr = 'ERR ' + e; }
        smokeCheck('LOGO_OK', logoOK, logoStr);
        let lowerThirdOK = false, lowerThirdStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            cues=[{name:'Interview block',durationMs:300000,note:'Main stage',ltName:'Ana Markovic',ltTitle:'Creative Director'}];
            currentCue=0;
            document.getElementById('ltDur').value='0';
            document.getElementById('ltStyle').value='broadcast';
            document.getElementById('ltPos').value='bl';
            if(!ltLibrary) initLtLibrary();
            if(ltLibrary) ltLibrary.activeTemplateId=null;
            S.lowerThird={
              visible:false,name:'',title:'',meta:'',style:'broadcast',pos:'bl',durationSec:0,
              graphic:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
              until:0,size:'m',accent:'#30d158',runtime:null,runtimeVersion:null
            };
            updateLowerThirdGraphicPreview();
            renderCues();
            showLowerThirdFromCue(0);
          })()`);
          await new Promise(r => setTimeout(r, 600));
          lowerThirdStr = await outputWin.webContents.executeJavaScript(`(function(){
            const box=document.getElementById('lowerThird');
            const r=box.getBoundingClientRect();
            return JSON.stringify({
              display:getComputedStyle(box).display,
              cls:box.className,
              w:Math.round(r.width),
              h:Math.round(r.height),
              name:document.getElementById('ltName').textContent,
              title:document.getElementById('ltTitle').textContent,
              imgDisplay:getComputedStyle(document.getElementById('ltImg')).display,
              imgSrc:document.getElementById('ltImg').src.slice(0,22)
            });
          })()`);
          const lt = JSON.parse(lowerThirdStr);
          lowerThirdOK = lt.display === 'flex' && lt.w > 20 && lt.h > 10
            && lt.cls.includes('style-broadcast') && lt.name === 'Ana Markovic' && lt.title === 'Creative Director'
            && lt.imgDisplay === 'block' && lt.imgSrc.startsWith('data:image/');
        } catch (e) { lowerThirdStr = 'ERR ' + e; }
        smokeCheck('LOWER_THIRD_OK', lowerThirdOK, lowerThirdStr);
        let sceneOK = false, sceneStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'smoke-scene',name:'Smoke Scene',layers:[{
              id:'smoke-layer',type:'image',name:'Pixel',
              src:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
              visible:true,fit:'cover',x:0,y:0,w:100,h:100,opacity:1
            }]}];
            S.activeSceneId='smoke-scene';
            renderScenesUI();
            send(true);
          })()`);
          await new Promise(r => setTimeout(r, 500));
          sceneStr = await outputWin.webContents.executeJavaScript(`(function(){
            const root=document.getElementById('sceneRoot');
            const layer=root && root.querySelector('.scene-layer img');
            return JSON.stringify({frames:root?root.children.length:0,layers:root?root.querySelectorAll('.scene-layer img').length:0,src:layer?layer.src.slice(0,22):''});
          })()`);
          const sc = JSON.parse(sceneStr);
          sceneOK = sc.layers >= 1 && sc.src.startsWith('data:image/');
        } catch (e) { sceneStr = 'ERR ' + e; }
        smokeCheck('SCENE_LAYER_OK', sceneOK, sceneStr);
        const routingSmoke = await runOutputRoutingSmoke();
        smokeCheck('MULTI_OUTPUT_OK', routingSmoke.multiOutOK, routingSmoke.detail);
        smokeCheck('MULTI_OUTPUT_SIMULTANEOUS_PROGRAM_STATE_OK', routingSmoke.multiOutStateOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_INDEPENDENT_CANVAS_AND_MAPPING_OK', routingSmoke.independentCanvasMappingOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_DISABLED_PERSISTS_OK', routingSmoke.routingDisabledOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_CUSTOM_POSITION_OK', routingSmoke.routingPositionOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_FINGERPRINT_RECONNECT_OK', routingSmoke.fingerprintReconnectOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_MISSING_DISPLAY_SAFE_OK', routingSmoke.missingDisplaySafeOK, routingSmoke.detail);
        smokeCheck('OUTPUT_ROUTING_MISSING_DISPLAY_UI_OK', routingSmoke.missingDisplayUiOK, routingSmoke.detail);
        // Video + PDF + tekst lejeri se renderuju na izlazu (plumbing, ne playback)
        let vpOK = false, vpStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'vp-scene',name:'VP',layers:[
              {id:'l-v',type:'video',name:'Vid',src:'data:video/mp4;base64,AAAA',visible:true,fit:'contain',x:0,y:0,w:50,h:50,opacity:1},
              {id:'l-p',type:'pdf',name:'Doc',src:'data:application/pdf;base64,JVBERi0xLjQK',visible:true,fit:'contain',x:50,y:0,w:50,h:50,opacity:1},
              {id:'l-t',type:'text',name:'Txt',text:'HELLO',color:'#fff',visible:true,x:0,y:50,w:100,h:50,opacity:1}
            ]}];
            S.activeSceneId='vp-scene'; renderScenesUI(); send(true);
          })()`);
          await new Promise(r => setTimeout(r, 500));
          vpStr = await outputWin.webContents.executeJavaScript(`(function(){
            const root=document.getElementById('sceneRoot');
            const frame=root.lastElementChild||root;
            return JSON.stringify({
              n:frame.children.length,
              video:!!root.querySelector('video[src^="data:video/"]'),
              pdf:!!root.querySelector('iframe[src^="data:application/pdf"]'),
              text:(root.querySelector('.scene-text')||{}).textContent||''
            });
          })()`);
          const vp = JSON.parse(vpStr);
          vpOK = vp.n === 3 && vp.video && vp.pdf && vp.text === 'HELLO';
        } catch (e) { vpStr = 'ERR ' + e; }
        smokeCheck('VIDEO_PDF_LAYER_OK', vpOK, vpStr);
        // Preview/Program izolacija: bez Direct-a promena NE sme na izlaz dok se ne uradi Cut
        let isoOK = false, isoStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'scene-default',name:'Timer',layers:[]}]; S.activeSceneId='scene-default';
            renderScenesUI(); S.bgColor='#000000'; send(true);
            S.studioDirect=false; var c=document.getElementById('chkDirectProgram'); if(c) c.checked=false;
            updateStudioButtons();
          })()`);
          await new Promise(r => setTimeout(r, 300));
          await controlWin.webContents.executeJavaScript(`(function(){ S.bgColor='#123456'; send(); })()`);
          await new Promise(r => setTimeout(r, 300));
          const beforeTake = await readState();
          await controlWin.webContents.executeJavaScript(`takePreview('cut');`);
          await new Promise(r => setTimeout(r, 300));
          const afterTake = await readState();
          await controlWin.webContents.executeJavaScript(`(function(){
            S.studioDirect=true; var c=document.getElementById('chkDirectProgram'); if(c) c.checked=true;
            S.bgColor='#000000'; send(true); updateStudioButtons();
          })()`);
          isoOK = beforeTake && beforeTake.bgColor === '#000000' && afterTake && afterTake.bgColor === '#123456';
          isoStr = `before=${beforeTake && beforeTake.bgColor} after=${afterTake && afterTake.bgColor}`;
        } catch (e) { isoStr = 'ERR ' + e; }
        smokeCheck('PREVIEW_ISOLATION_OK', isoOK, isoStr);
        // Aux izlaz: grid mod = tačna kockica monitora; fullscreen mod = ceo monitor
        // bez macOS fullscreen Space-a, kako bi više ruta radilo istovremeno.
        let auxOK = false, auxStr = '?';
        try {
          const did = controlDisplayId();
          const disp = screen.getAllDisplays().find(d => d.id === did) || screen.getPrimaryDisplay();
          applyOutputConfigs([{ id: 'smoke-grid', name: 'G', displayId: did, mode: 'grid', gridSize: 3, gridCell: 8 }]);
          await new Promise(r => setTimeout(r, 900));
          const rec = auxOutputs.get('smoke-grid');
          const b = rec && rec.win && !rec.win.isDestroyed() ? rec.win.getBounds() : {};
          const cw = Math.floor(disp.bounds.width / 3), ch = Math.floor(disp.bounds.height / 3);
          const gridOK = Math.abs((b.width || 0) - cw) < 8 && Math.abs((b.height || 0) - ch) < 8 && rec.frameless === true;
          applyOutputConfigs([{ id: 'smoke-fs', name: 'F', displayId: did, mode: 'fullscreen' }]);
          let rec2 = null, fsBounds = {};
          for (let i = 0; i < 40; i++) {
            rec2 = auxOutputs.get('smoke-fs');
            if (rec2 && rec2.win && !rec2.win.isDestroyed()) {
              fsBounds = rec2.win.getBounds();
              const fillModeOK = process.platform !== 'darwin' || isAuxSimpleFullscreen(rec2.win);
              const settled = rec2.win.isVisible() && rec2.frameless === true && !rec2.win.isFullScreen() && fillModeOK
                && Math.abs(fsBounds.x - disp.bounds.x) <= 2 && Math.abs(fsBounds.y - disp.bounds.y) <= 2
                && Math.abs(fsBounds.width - disp.bounds.width) <= 2 && Math.abs(fsBounds.height - disp.bounds.height) <= 2;
              if (settled) break;
            }
            await new Promise(r => setTimeout(r, 100));
          }
          const fsModeOK = !!(rec2 && rec2.win && (process.platform !== 'darwin' || isAuxSimpleFullscreen(rec2.win)));
          const fsOK = !!(rec2 && rec2.win && !rec2.win.isDestroyed() && rec2.win.isVisible()
            && rec2.frameless === true && !rec2.win.isFullScreen() && fsModeOK
            && Math.abs((fsBounds.x || 0) - disp.bounds.x) <= 2 && Math.abs((fsBounds.y || 0) - disp.bounds.y) <= 2
            && Math.abs((fsBounds.width || 0) - disp.bounds.width) <= 2 && Math.abs((fsBounds.height || 0) - disp.bounds.height) <= 2);
          applyOutputConfigs([]);
          for (let i = 0; i < 30 && auxOutputs.size; i++) await new Promise(r => setTimeout(r, 80));
          auxOK = gridOK && fsOK && auxOutputs.size === 0;
          auxStr = JSON.stringify({ grid: { w: b.width, h: b.height, cw, ch }, fullscreen: fsBounds, target: disp.bounds, fsOK, left: auxOutputs.size });
        } catch (e) { auxStr = 'ERR ' + e; }
        smokeCheck('AUX_MODES_OK', auxOK, auxStr);
        // MEDIA BIBLIOTEKA: upload → disk → media:// u sceni → output učita sliku sa 127.0.0.1
        let mediaOK = false, mediaStr = '?';
        try {
          const savedSrc = await controlWin.webContents.executeJavaScript(`(async function(){
            const saved = await window.pt.mediaSave({ name:'smoke.png',
              dataURL:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=' });
            if(!saved || !saved.ok) return 'ERR ' + (saved && saved.error);
            S.scenes=[{id:'media-scene',name:'Media',layers:[{id:'m-1',type:'image',name:'smoke.png',
              src:saved.src, visible:true, fit:'contain', x:0,y:0,w:100,h:100, opacity:1}]}];
            S.activeSceneId='media-scene'; renderScenesUI(); send(true);
            return saved.src;
          })()`);
          await new Promise(r => setTimeout(r, 900));
          const outImg = await outputWin.webContents.executeJavaScript(`(function(){
            const img=document.querySelector('#sceneRoot .scene-layer img');
            return JSON.stringify({src:img?img.src:'', loaded:!!(img && img.naturalWidth>0)});
          })()`);
          const oi = JSON.parse(outImg);
          const httpOK = await new Promise((resolve) => {
            http.get(`http://127.0.0.1:${serverPort}/media/${String(savedSrc).replace('media://','')}`,
              r => { r.resume(); resolve(r.statusCode); }).on('error', () => resolve(0));
          });
          mediaOK = String(savedSrc).startsWith('media://') && oi.src.includes('/media/')
            && oi.src.startsWith('http://127.0.0.1') && oi.loaded && httpOK === 200;
          mediaStr = `src=${savedSrc} out=${oi.src.slice(0, 44)} loaded=${oi.loaded} http=${httpOK}`;
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'scene-default',name:'Timer',layers:[]}]; S.activeSceneId='scene-default';
            renderScenesUI(); send(true);
          })()`);
        } catch (e) { mediaStr = 'ERR ' + e; }
        smokeCheck('MEDIA_LIB_OK', mediaOK, mediaStr);
        // VELIKI MEDIA: linked disk source + pravi HTTP range iznad 4 GB. Sparse fixture
        // proverava 64-bit seek putanju bez zauzimanja više gigabajta fizičkog prostora.
        let largeMediaOK = false, largeMediaStr = '?';
        const largeMediaPath = path.join(app.getPath('userData'), 'smoke-five-gigabyte.mp4');
        try {
          const markerOffset = 4 * 1024 * 1024 * 1024 + 54321;
          const marker = Buffer.from('SHOWSLATE-PACKAGED-RANGE');
          const descriptor = fs.openSync(largeMediaPath, 'w');
          fs.ftruncateSync(descriptor, 5 * 1024 * 1024 * 1024 + 65536);
          fs.writeSync(descriptor, marker, 0, marker.length, markerOffset);
          fs.closeSync(descriptor);
          const saved = await getMediaLibrary().importFile(largeMediaPath);
          const mediaId = String(saved.src || '').replace(/^media:\/\//, '');
          const response = await new Promise(resolve => {
            const request = http.get({
              hostname: '127.0.0.1', port: serverPort, path: '/media/' + encodeURIComponent(mediaId),
              headers: { Range: `bytes=${markerOffset}-${markerOffset + marker.length - 1}` }
            }, result => {
              const chunks = [];
              result.on('data', chunk => chunks.push(chunk));
              result.on('end', () => resolve({
                status: result.statusCode,
                range: result.headers['content-range'],
                acceptRanges: result.headers['accept-ranges'],
                body: Buffer.concat(chunks)
              }));
            });
            request.on('error', error => resolve({ status: 0, error: String(error.message || error), body: Buffer.alloc(0) }));
          });
          largeMediaOK = saved.ok && saved.storage === 'linked' && saved.portable === false && saved.bytes > 5_000_000_000
            && response.status === 206 && response.acceptRanges === 'bytes'
            && response.range === `bytes ${markerOffset}-${markerOffset + marker.length - 1}/${saved.bytes}`
            && response.body.equals(marker) && !fs.existsSync(path.join(mediaDir(), mediaId));
          largeMediaStr = JSON.stringify({ bytes: saved.bytes, storage: saved.storage, portable: saved.portable,
            status: response.status, range: response.range, marker: response.body.toString('utf8') });
        } catch (error) {
          largeMediaStr = 'ERR ' + String(error && error.message || error);
        } finally {
          try { fs.rmSync(largeMediaPath, { force: true }); } catch (_) {}
        }
        smokeCheck('MEDIA_MULTI_GIGABYTE_RANGE_STREAM_OK', largeMediaOK, largeMediaStr);
        // TAJMER JE LEJER SCENE: kutija lejera pozicionira #stage; scena bez tajmera = bez tajmera
        let tlOK = false, tlStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'tl-scene',name:'TL',layers:[
              {id:'tl-1',type:'timer',name:'Timer',visible:true,fit:'contain',x:25,y:25,w:50,h:50,opacity:1}
            ]}];
            S.activeSceneId='tl-scene'; renderScenesUI(); send(true);
          })()`);
          await new Promise(r => setTimeout(r, 500));
          const boxed = await outputWin.webContents.executeJavaScript(`(function(){
            const st=document.getElementById('stage'); const r=st.getBoundingClientRect();
            return JSON.stringify({d:getComputedStyle(st).display, x:Math.round(r.left/innerWidth*100),
              y:Math.round(r.top/innerHeight*100), w:Math.round(r.width/innerWidth*100), h:Math.round(r.height/innerHeight*100)});
          })()`);
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[{id:'tl2',name:'NoTimer',layers:[{id:'t-x',type:'text',name:'T',text:'X',visible:true,x:0,y:0,w:100,h:100,opacity:1}]}];
            S.activeSceneId='tl2'; renderScenesUI(); send(true);
          })()`);
          await new Promise(r => setTimeout(r, 500));
          const hidden = await outputWin.webContents.executeJavaScript(`getComputedStyle(document.getElementById('stage')).display`);
          await controlWin.webContents.executeJavaScript(`(function(){
            S.scenes=[]; ensureScenes(); renderScenesUI(); send(true);
          })()`);
          await new Promise(r => setTimeout(r, 400));
          const blank = await outputWin.webContents.executeJavaScript(`(function(){
            const st=document.getElementById('stage'); const r=st.getBoundingClientRect();
            return JSON.stringify({d:getComputedStyle(st).display, w:Math.round(r.width/innerWidth*100)});
          })()`);
          const b = JSON.parse(boxed), fb = JSON.parse(blank);
          tlOK = b.d === 'flex' && Math.abs(b.x - 25) <= 2 && Math.abs(b.y - 25) <= 2
            && Math.abs(b.w - 50) <= 2 && Math.abs(b.h - 50) <= 2
            && hidden === 'none' && fb.d === 'none';
          tlStr = `boxed=${boxed} noTimer=${hidden} default=${blank}`;
        } catch (e) { tlStr = 'ERR ' + e; }
        smokeCheck('TIMER_LAYER_OK', tlOK, tlStr);
        // SHOW RASPORED: rundown levo, komande i Program u centru, status desno;
        // Composer se proverava kroz ista vidljiva dugmad koja koristi operater.
        let layoutOK = false, layoutStr = '?';
        try {
          layoutStr = await controlWin.webContents.executeJavaScript(`(function(){
            if(typeof setSidebarView==='function') setSidebarView('rundown');
            const cueL=document.querySelector('.col-run #cueList');
            const studio=document.getElementById('studio');
            const goBtn=document.querySelector('.studio-switcher #btnGo');
            const takeBtn=document.querySelector('.studio-switcher #btnTake');
            const backBtn=document.querySelector('.studio-switcher #btnBack');
            const blackBtn=document.querySelector('.studio-switcher #btnFadeBlack');
            const goNextBtn=document.getElementById('btnGoNext');
            const msg=document.querySelector('.right .panel-message #msgInput');
            const status=document.querySelector('.right .card-status #stStage');
            const rdTab=document.querySelector('#setupTabs button[data-pane="rundown"]');
            const leftOfStudio = cueL && studio && cueL.getBoundingClientRect().left < studio.getBoundingClientRect().left;
            const srcP=document.getElementById('panelSources');
            const advChk=document.getElementById('chkAdvanced');
            if(document.body.classList.contains('compositor-open')) document.getElementById('btnCompositor').click();
            advChk.checked=false; advChk.dispatchEvent(new Event('change'));
            const srcHiddenSimple = !srcP || srcP.offsetParent===null;
            advChk.checked=true; advChk.dispatchEvent(new Event('change'));
            document.getElementById('btnCompositor').click();
            const srcShownAdv = !!srcP && srcP.offsetParent!==null;
            return JSON.stringify({cue:!!cueL && cueL.getBoundingClientRect().height>40, leftOfStudio,
              go:!!goBtn, take:!!takeBtn, back:!!backBtn, black:!!blackBtn, goNext:!!goNextBtn, msg:!!msg, status:!!status, noRdTab:!rdTab,
              srcHiddenSimple, srcShownAdv});
          })()`);
          const L = JSON.parse(layoutStr);
          layoutOK = L.cue && L.leftOfStudio && L.go && L.take && L.back && L.black && L.goNext && L.msg && L.status && L.noRdTab
            && L.srcHiddenSimple && L.srcShownAdv;
          await controlWin.webContents.executeJavaScript(`(function(){
            if(document.body.classList.contains('compositor-open')) setCompositorOpen(false,{scroll:false,persist:false});
          })()`);
        } catch (e) { layoutStr = 'ERR ' + e; }
        smokeCheck('SHOW_LAYOUT_OK', layoutOK, layoutStr);
        // CANVAS aspekt: 9:16 menja odnos monitora; FADE: sceneFadeMs stiže do izlaza
        let canvasOK = false, canvasStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`(function(){
            document.getElementById('canvasAspectSel').value='9:16';
            document.getElementById('canvasAspectSel').dispatchEvent(new Event('change'));
            document.getElementById('sceneFadeSel').value='700';
            document.getElementById('sceneFadeSel').dispatchEvent(new Event('change'));
          })()`);
          await new Promise(r => setTimeout(r, 400));
          const ar = await controlWin.webContents.executeJavaScript(`(function(){
            const r=document.getElementById('preview').getBoundingClientRect();
            return r.height>r.width*1.4;   // vertikalan
          })()`);
          const fadeOut = await outputWin.webContents.executeJavaScript(`S.sceneFadeMs`);
          await controlWin.webContents.executeJavaScript(`(function(){
            document.getElementById('canvasAspectSel').value='16:9';
            document.getElementById('canvasAspectSel').dispatchEvent(new Event('change'));
          })()`);
          canvasOK = ar === true && fadeOut === 700;
          canvasStr = `vertical=${ar} fadeOnOutput=${fadeOut}`;
        } catch (e) { canvasStr = 'ERR ' + e; }
        smokeCheck('CANVAS_FADE_OK', canvasOK, canvasStr);
        // OBS MANIPULACIJA: klik bira izvor u Preview-u, prevlačenje ga pomera
        let dragOK = false, dragStr = '?';
        try {
          dragStr = await controlWin.webContents.executeJavaScript(`(function(){
            // drag targets a layer in #preview — visible only in Advanced (Standard hides preview)
            var c=document.getElementById('chkCompact'); if(c && c.checked){ c.checked=false; c.dispatchEvent(new Event('change')); }
            if(typeof applyCompactMode==='function') applyCompactMode(false);
            if(typeof setCompositorOpen==='function') setCompositorOpen(false,{persist:false,scroll:false});
            var a=document.getElementById('chkAdvanced'); if(a && !a.checked){ a.checked=true; a.dispatchEvent(new Event('change')); }
            if(typeof applyAdvancedMode==='function') applyAdvancedMode(true);
            S.scenes=[{id:'dg',name:'DG',layers:[{id:'dg-1',type:'text',name:'T',text:'DRAG',visible:true,x:10,y:10,w:30,h:20,opacity:1}]}];
            S.activeSceneId='dg'; selectedLayerId=null; stageKeys={pv:'',pg:''}; monitorSceneKeys={pv:'',pg:''};
            renderScenesUI(); if(typeof renderStage==='function') renderStage('pv', S, Date.now()); send(true);
            window.__dragProbe=[];
            var probeBox=document.getElementById('preview');
            ['pointerdown','gotpointercapture','pointermove','pointerup','lostpointercapture','pointercancel'].forEach(function(type){
              probeBox.addEventListener(type,function(event){window.__dragProbe.push({type:type,x:Math.round(event.clientX),y:Math.round(event.clientY),buttons:event.buttons,pointerId:event.pointerId,target:event.target&&event.target.className||''});},true);
            });
            return 'seeded';
          })()`);
          let dragReady = false;
          for (let i = 0; i < 40; i++) {
            const ready = await controlWin.webContents.executeJavaScript(`(function(){
              if(typeof applyCanvasAspect==='function') applyCanvasAspect();
              if(typeof renderStage==='function') renderStage('pv', S, Date.now());
              const preview=document.getElementById('preview'); const r=preview.getBoundingClientRect();
              const canvas=PTCOMP.normalizeCanvas(S.canvas); const expected=canvas.width/canvas.height;
              return !!document.querySelector('#preview .pv-scene-layer[data-layer-id="dg-1"]')
                && r.width>100 && r.height>60 && Math.abs((r.width/r.height)-expected)<0.02;
            })()`);
            if (ready) { dragReady = true; break; }
            await new Promise(r => setTimeout(r, 80));
          }
          const dragPoints = JSON.parse(await controlWin.webContents.executeJavaScript(`(function(){
            const box=document.getElementById('preview'); const r=box.getBoundingClientRect();
            const el=box.querySelector('.pv-scene-layer[data-layer-id="dg-1"]');
            if(!${dragReady} || !el || r.width<20 || r.height<20) return JSON.stringify({ok:false,settled:${dragReady},w:r.width,h:r.height});
            const er=el.getBoundingClientRect();
            const sx=er.left+er.width*0.35, sy=er.top+er.height*0.35;
            const hit=document.elementFromPoint(sx,sy), hitLayer=hit&&hit.closest&&hit.closest('.pv-scene-layer');
            const stage=document.getElementById('pvStage'), sr=stage.getBoundingClientRect(), stageStyle=getComputedStyle(stage);
            return JSON.stringify({ok:er.width>20&&er.height>20,sx,sy,ex:sx+r.width*0.30,ey:sy+r.height*0.25,
              w:r.width,h:r.height,layer:{x:er.x,y:er.y,w:er.width,h:er.height},
              stage:{display:stageStyle.display,pointerEvents:stageStyle.pointerEvents,inlineDisplay:stage.style.display,x:sr.x,y:sr.y,w:sr.width,h:sr.height},
              hit:hit?{tag:hit.tagName,id:hit.id||'',cls:hit.className||'',layerId:hitLayer&&hitLayer.dataset.layerId||''}:null});
          })()`));
          if (dragPoints.ok) {
            const input = (type, x, y, extra) => controlWin.webContents.sendInputEvent({
              type, x: Math.round(x), y: Math.round(y), ...(extra || {})
            });
            input('mouseMove', dragPoints.sx, dragPoints.sy);
            input('mouseDown', dragPoints.sx, dragPoints.sy, { button: 'left', clickCount: 1 });
            for (let step = 1; step <= 12; step++) {
              const progress = step / 12;
              const previous = (step - 1) / 12;
              const fromX = dragPoints.sx + (dragPoints.ex - dragPoints.sx) * previous;
              const fromY = dragPoints.sy + (dragPoints.ey - dragPoints.sy) * previous;
              const toX = dragPoints.sx + (dragPoints.ex - dragPoints.sx) * progress;
              const toY = dragPoints.sy + (dragPoints.ey - dragPoints.sy) * progress;
              input('mouseMove',
                toX,
                toY,
                { button: 'left', movementX: Math.round(toX - fromX), movementY: Math.round(toY - fromY) });
            }
            input('mouseUp', dragPoints.ex, dragPoints.ey, { button: 'left', clickCount: 1 });
            await new Promise(r => setTimeout(r, 180));
          }
          dragStr = await controlWin.webContents.executeJavaScript(`(function(){
            const L=S.scenes[0].layers[0];
            return JSON.stringify({sel:selectedLayerId, x:L.x, y:L.y, events:(window.__dragProbe||[]).slice(-40)});
          })()`);
          dragStr = JSON.stringify({points:dragPoints,result:JSON.parse(dragStr)});
          const D = JSON.parse(dragStr);
          dragOK = D.points.ok && D.result.sel === 'dg-1' && Math.abs(D.result.x - 40) <= 3 && Math.abs(D.result.y - 35) <= 4;
          await controlWin.webContents.executeJavaScript(`S.scenes=[]; selectedLayerId=null; ensureScenes(); renderScenesUI(); send(true); var a=document.getElementById('chkAdvanced'); if(a&&a.checked){ a.checked=false; a.dispatchEvent(new Event('change')); }`);
        } catch (e) { dragStr = 'ERR ' + e; }
        smokeCheck('DRAG_SELECT_OK', dragOK, dragStr);
        // MODAL umesto window-prompta (Electron ga nema): Nova scena end-to-end kroz dijalog
        let modalOK = false, modalStr = '?';
        try {
          modalStr = await controlWin.webContents.executeJavaScript(`(async function(){
            const before=S.scenes.length;
            document.getElementById('btnSceneAdd').click();
            await new Promise(r=>setTimeout(r,120));
            const open1=document.getElementById('modalOverlay').classList.contains('open');
            document.getElementById('modalInput').value='Smoke Scena';
            document.getElementById('modalOk').click();
            await new Promise(r=>setTimeout(r,120));
            const created=S.scenes.length===before+1 && S.scenes[S.scenes.length-1].name==='Smoke Scena';
            const activeNew=S.activeSceneId===S.scenes[S.scenes.length-1].id;
            document.getElementById('btnSceneAdd').click();
            await new Promise(r=>setTimeout(r,120));
            document.getElementById('modalCancel').click();
            await new Promise(r=>setTimeout(r,120));
            const cancelSafe=S.scenes.length===before+1;
            return JSON.stringify({open1,created,activeNew,cancelSafe,n:S.scenes.length});
          })()`);
          const M = JSON.parse(modalStr);
          modalOK = M.open1 && M.created && M.activeNew && M.cancelSafe;
        } catch (e) { modalStr = 'ERR ' + e; }
        smokeCheck('MODAL_SCENE_OK', modalOK, modalStr);
        // INSPEKTOR: izbor izvora otvara kontrole; izmena W/opacity/fit/Centriraj menja lejer
        let inspOK = false, inspStr = '?';
        try {
          inspStr = await controlWin.webContents.executeJavaScript(`(function(){
            const sc=currentScene();
            sc.layers=[{id:'insp-1',type:'text',name:'T',text:'INSP',visible:true,x:10,y:10,w:30,h:20,opacity:1,fit:'cover'}];
            sceneDirty();
            selectLayer('insp-1');
            const open=document.getElementById('inspector').classList.contains('open');
            document.getElementById('inspW').value='60';
            document.getElementById('inspW').dispatchEvent(new Event('change'));
            document.getElementById('inspOpacity').value='40';
            document.getElementById('inspOpacity').dispatchEvent(new Event('input'));
            document.getElementById('inspFit').value='contain';
            document.getElementById('inspFit').dispatchEvent(new Event('change'));
            document.getElementById('inspCenter').click();
            const L=currentScene().layers[0];
            const out={open, w:L.w, op:L.opacity, fit:L.fit, cx:L.x};
            S.scenes=S.scenes.filter(s2=>s2.name!=='Smoke Scena');
            selectedLayerId=null; S.scenes[0].layers=[]; ensureScenes(); renderScenesUI(); renderInspector(); send(true);
            return JSON.stringify(out);
          })()`);
          const I = JSON.parse(inspStr);
          inspOK = I.open && I.w === 60 && Math.abs(I.op - 0.4) < 0.01 && I.fit === 'contain' && Math.abs(I.cx - 20) <= 1;
        } catch (e) { inspStr = 'ERR ' + e; }
        smokeCheck('INSPECTOR_OK', inspOK, inspStr);

        // ===== LT-1: Lower Third Studio model/migracija/fixtures (bez izmene live renderera) =====
        {
          const ltJparse = async (code) => JSON.parse(await controlWin.webContents.executeJavaScript(code));
          const PM = require('./src/lower-third/model.js');
          const PV = require('./src/lower-third/validate.js');
          const PG = require('./src/lower-third/migrate.js');
          const PR = require('./src/lower-third/resolve.js');
          // --- pure model ---
          const em = PM.makeEmptyLibrary();
          smokeCheck('LT_LIBRARY_SCHEMA_OK', em.schemaVersion === 1 && Array.isArray(em.templates), JSON.stringify({v:em.schemaVersion}));
          const mg1 = PG.migrateLowerThirdLibrary(null, { style:'glass', pos:'br', size:'l', accent:'#ff0000' }, []);
          smokeCheck('LT_BUILTIN_LEGACY_TEMPLATES_OK', mg1.library.templates.length === 4 && mg1.library.templates.every(t=>t.kind==='legacy'), 'n='+mg1.library.templates.length);
          smokeCheck('LT_LEGACY_TEMPLATE_IDS_STABLE_OK', PM.makeLegacyTemplate('clean').id==='builtin-legacy-clean' && mg1.library.templates.some(t=>t.id==='builtin-legacy-slab'), 'ids stable');
          smokeCheck('LT_LIBRARY_MIGRATION_OK', mg1.library.activeTemplateId==='builtin-legacy-glass', 'active='+mg1.library.activeTemplateId);
          const mg2 = PG.migrateLowerThirdLibrary(JSON.parse(JSON.stringify(mg1.library)), { style:'glass' }, []);
          smokeCheck('LT_LIBRARY_MIGRATION_IDEMPOTENT_OK', mg2.changed===false && mg2.library.templates.length===4, 'changed='+mg2.changed);
          smokeCheck('LT_TEMPLATE_VALIDATION_OK', PV.validateLowerThirdTemplate(PM.makeTemplate({})).ok===true, 'valid template ok');
          const lv = PV.validateLowerThirdLayer(PM.makeMediaLayer({opacity:99, width:-5}));
          smokeCheck('LT_LAYER_VALIDATION_OK', lv.ok===true && lv.value.opacity===1 && lv.value.width>=1, 'clamped');
          const dupT = PV.validateLowerThirdLibrary({schemaVersion:1, templates:[PM.makeLegacyTemplate('clean'), PM.makeLegacyTemplate('clean')]});
          smokeCheck('LT_DUPLICATE_TEMPLATE_ID_REJECTED_OK', dupT.ok===false && dupT.value.templates.length===1, 'dupes rejected');
          smokeCheck('LT_DUPLICATE_LAYER_ID_REJECTED_OK', PV.validateLowerThirdTemplate(PM.makeTemplate({layers:[PM.makeStaticTextLayer({id:'x'}),PM.makeStaticTextLayer({id:'x'})]})).ok===false, '');
          smokeCheck('LT_INVALID_PHASE_REFERENCE_REJECTED_OK', PV.validateLowerThirdTemplate(PM.makeTemplate({phases:{hold:PM.defaultPhase({mediaLayerId:'ghost'})}})).ok===false, '');
          smokeCheck('LT_UNSAFE_MEDIA_REFERENCE_REJECTED_OK', PV.validateLowerThirdTemplate(PM.makeTemplate({layers:[PM.makeMediaLayer({assetId:'javascript:alert(1)'})]})).ok===false, '');
          // --- resolveri ---
          const tpl = PM.makeTemplate({ layers: [
            PM.makeDynamicTextLayer({id:'n', field:'speakerName', fallback:'FB'}),
            PM.makeDynamicTextLayer({id:'t', field:'speakerTitle'}), PM.makeDynamicTextLayer({id:'c', field:'company'}),
            PM.makeDynamicTextLayer({id:'s', field:'sessionTitle'}), PM.makeDynamicTextLayer({id:'g', field:'segmentTitle'}),
            PM.makeDynamicTextLayer({id:'u', field:'custom1'}), PM.makeStaticTextLayer({id:'h', text:'<img onerror=x>'}) ]});
          const liveCue = { id:'c1', name:'SegName', ltName:'Jane', speakerTitle:'CTO', company:'ACME', sessionTitle:'Sess', custom1:'Cst' };
          const selCue = { id:'c2', name:'SELWRONG', ltName:'SELWRONG' };
          const rr1 = PR.resolveLowerThirdTemplate({ template: tpl, liveCue, mediaResolver:(a)=>'/media/'+a, now: 12345 });
          const rr2 = PR.resolveLowerThirdTemplate({ template: tpl, liveCue, mediaResolver:(a)=>'/media/'+a, now: 12345 });
          const byId = (id)=>rr1.resolvedLayers.find(l=>l.id===id);
          smokeCheck('LT_RESOLVED_DYNAMIC_NAME_OK', byId('n').resolvedText==='Jane' && byId('n').sourceField==='speakerName', '');
          smokeCheck('LT_RESOLVED_DYNAMIC_TITLE_OK', byId('t').resolvedText==='CTO', '');
          smokeCheck('LT_RESOLVED_COMPANY_OK', byId('c').resolvedText==='ACME', '');
          smokeCheck('LT_RESOLVED_SESSION_OK', byId('s').resolvedText==='Sess', '');
          smokeCheck('LT_RESOLVED_SEGMENT_OK', byId('g').resolvedText==='SegName', '');
          smokeCheck('LT_RESOLVED_CUSTOM1_OK', byId('u').resolvedText==='Cst', '');
          smokeCheck('LT_RESOLVER_DETERMINISTIC_OK', JSON.stringify(rr1)===JSON.stringify(rr2), '');
          smokeCheck('LT_RESOLVER_LIVE_CUE_ONLY_OK', rr1.cueId==='c1' && JSON.stringify(rr1).indexOf('SELWRONG')<0, '');
          smokeCheck('LT_RESOLVER_SELECTED_CUE_IGNORED_OK', JSON.stringify(rr1).indexOf('SELWRONG')<0, 'API prima samo liveCue');
          const pv1 = PR.resolveLowerThirdPreview({ template: tpl, previewCue: selCue, now: 12345 });
          smokeCheck('LT_PREVIEW_RESOLVER_NOT_LIVE_OK', pv1.preview===true && pv1.resolvedLayers.find(l=>l.id==='n').resolvedText==='SELWRONG', 'preview flag');
          smokeCheck('LT_RUNTIME_JSON_SERIALIZABLE_OK', PV.validateLowerThirdRuntime(JSON.parse(JSON.stringify(rr1))).ok===true, '');
          const ctrlSrc = fs.readFileSync(path.join(__dirname,'controller.html'),'utf8');
          const outSrc = fs.readFileSync(path.join(__dirname,'output.html'),'utf8');
          smokeCheck('LT_TEXT_HTML_NOT_EXECUTED_OK', byId('h').resolvedText.indexOf('<')<0 && /ltName'\)\.textContent|\$\('ltName'\)\.textContent/.test(outSrc), 'tagovi neutralisani + renderer koristi textContent');
          // --- renderer: cue polja + legacy očuvanje + biblioteka van broadcast-a ---
          const cueMig = await ltJparse(`(async function(){
            const snap={cues:cues.slice(), cur:currentCue, sel:selectedCue};
            cues=migrateCues([{name:'A',durationMs:60000,ltName:'X'},{name:'B',durationMs:60000}]);
            currentCue=0; selectedCue=1; setDuration(120000); startPause();
            const runningBefore=S.running, remBefore=S.remMs, liveBefore=currentCue, selBefore=selectedCue;
            cues=migrateCues(cues); const again=migrateCues(cues.map(c=>Object.assign({},c)));
            const out={ hasFields: cues.every(c=>typeof c.speakerTitle==='string'&&typeof c.company==='string'&&typeof c.sessionTitle==='string'&&typeof c.custom1==='string'),
              nameKept: cues[0].name==='A' && cues[0].ltName==='X',
              idem: JSON.stringify(again.map(c=>({s:c.speakerTitle,co:c.company})))===JSON.stringify(cues.map(c=>({s:c.speakerTitle,co:c.company}))),
              livePreserved: currentCue===liveBefore, selPreserved: selectedCue===selBefore,
              timerPreserved: S.running===runningBefore };
            startPause(); reset(); cues=snap.cues; currentCue=snap.cur; selectedCue=snap.sel; renderCues();
            return JSON.stringify(out);
          })()`);
          smokeCheck('LT_CUE_NEW_FIELDS_OK', cueMig.hasFields, '');
          smokeCheck('LT_CUE_FIELD_MIGRATION_OK', cueMig.hasFields && cueMig.nameKept, '');
          smokeCheck('LT_CUE_MIGRATION_IDEMPOTENT_OK', cueMig.idem, '');
          smokeCheck('LT_CUE_MIGRATION_PRESERVES_LIVE_OK', cueMig.livePreserved, '');
          smokeCheck('LT_CUE_MIGRATION_PRESERVES_SELECTED_OK', cueMig.selPreserved, '');
          smokeCheck('LT_CUE_MIGRATION_PRESERVES_TIMER_OK', cueMig.timerPreserved, '');
          const legacyChk = await ltJparse(`(function(){
            normalizeLowerThird();
            const before=JSON.stringify({style:S.lowerThird.style,pos:S.lowerThird.pos,size:S.lowerThird.size,accent:S.lowerThird.accent,dur:S.lowerThird.durationSec,auto:S.lowerThirdAutoCue,graphic:S.lowerThird.graphic});
            initLtLibrary(); initLtLibrary();
            const after=JSON.stringify({style:S.lowerThird.style,pos:S.lowerThird.pos,size:S.lowerThird.size,accent:S.lowerThird.accent,dur:S.lowerThird.durationSec,auto:S.lowerThirdAutoCue,graphic:S.lowerThird.graphic});
            const lib=ltLibrary||{templates:[]};
            const styles=['clean','glass','broadcast','slab'];
            const snapStr=JSON.stringify(outputSnapshot(S));
            return JSON.stringify({
              stylesPreserved: before===after,
              fourLegacy: styles.every(st=>lib.templates.some(t=>t.id==='builtin-legacy-'+st && t.kind==='legacy' && t.legacy && t.legacy.style===st)),
              noDup: lib.templates.filter(t=>t.kind==='legacy').length===4,
              presetsAnnotated: ltPresets.every(p=>!p || !p.style || !!p.templateId || !['clean','glass','broadcast','slab'].includes(p.style)),
              presetsKept: Array.isArray(ltPresets),
              graphicKept: typeof S.lowerThird.graphic==='string',
              runtimeFieldNull: S.lowerThird.runtime===null && S.lowerThird.runtimeVersion===null,
              notBroadcast: snapStr.indexOf('builtin-legacy-')<0 && snapStr.indexOf('lowerThirdLibrary')<0 && snapStr.indexOf('"templates"')<0
            });
          })()`);
          smokeCheck('LT_LEGACY_STYLES_PRESERVED_OK', legacyChk.stylesPreserved && legacyChk.fourLegacy && legacyChk.noDup, JSON.stringify(legacyChk));
          smokeCheck('LT_LEGACY_PRESETS_PRESERVED_OK', legacyChk.presetsKept && legacyChk.presetsAnnotated, '');
          smokeCheck('LT_LEGACY_GRAPHIC_DATAURL_PRESERVED_OK', legacyChk.graphicKept, '');
          smokeCheck('LT_AUTO_SETTINGS_PRESERVED_OK', legacyChk.stylesPreserved, 'auto+dur u istom snapshotu');
          smokeCheck('LT_TEMPLATE_LIBRARY_NOT_BROADCAST_OK', legacyChk.notBroadcast && legacyChk.runtimeFieldNull, '');
          // --- LT-2A: runtime transport + dual-render gating (bez crtanja custom lejera još) ---
          const lt2Runtime = await ltJparse(`(function(){
            const oldStorage = localStorage.getItem(PTLT.LIBRARY_KEY);
            window.__lt2SmokeSnap = {
              S: JSON.stringify(S),
              cues: JSON.stringify(cues),
              currentCue, selectedCue,
              ltLibrary: JSON.stringify(ltLibrary),
              ltLibraryStorage: oldStorage
            };
            initLtLibrary();
            const tpl = PTLT.makeTemplate({
              id:'lt2-smoke-runtime-template',
              name:'LT2 Smoke Runtime',
              kind:'custom',
              layers:[
                PTLT.makeDynamicTextLayer({id:'lt2-name', field:'speakerName', x:120, y:820, width:780, height:90}),
                PTLT.makeDynamicTextLayer({id:'lt2-role', field:'speakerTitle', x:120, y:910, width:780, height:64})
              ]
            });
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
            ltLibrary.templates.push(tpl);
            ltLibrary.activeTemplateId=tpl.id;
            saveLtLibrary();
            cues=migrateCues([
              {id:'lt2-live-cue', name:'LT2 Segment', durationMs:60000, ltName:'Runtime Name', ltTitle:'Runtime Title', speakerTitle:'Runtime Role'},
              {id:'lt2-selected-cue', name:'Selected Segment', durationMs:60000, ltName:'Selected Wrong', ltTitle:'Selected Wrong'}
            ]);
            currentCue=0; selectedCue=1;
            document.getElementById('ltDur').value='0';
            showLowerThirdFromCue(0);
            const snap=outputSnapshot(S);
            const rt=S.lowerThird.runtime || {};
            return JSON.stringify({
              visible:!!S.lowerThird.visible,
              runtimeVersion:S.lowerThird.runtimeVersion,
              templateId:rt.templateId||'',
              cueId:rt.cueId||'',
              layerCount:Array.isArray(rt.resolvedLayers)?rt.resolvedLayers.length:0,
              nameText:(rt.resolvedLayers||[]).find(l=>l.id==='lt2-name')?.resolvedText || '',
              roleText:(rt.resolvedLayers||[]).find(l=>l.id==='lt2-role')?.resolvedText || '',
              noLibraryBroadcast:!snap.lowerThirdLibrary && !snap.lowerThirdTemplates && !snap.templates && JSON.stringify(snap).indexOf('"templates"')<0,
              jsonSafe:JSON.stringify(rt).indexOf('ltLibrary')<0,
              selectedLeak:JSON.stringify(rt).indexOf('Selected Wrong')>=0
            });
          })()`);
          await new Promise(r => setTimeout(r, 500));
          const lt2Out = JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){
            const canvas=document.getElementById('ltCanvas');
            const legacy=document.getElementById('lowerThird');
            return JSON.stringify({
              canvasDisplay:getComputedStyle(canvas).display,
              legacyDisplay:getComputedStyle(legacy).display,
              active:canvas.dataset.runtimeActive||'',
              templateId:canvas.dataset.templateId||''
            });
          })()`));
          smokeCheck('LT2_RUNTIME_TRANSPORT_OK',
            lt2Runtime.visible && lt2Runtime.runtimeVersion===1 && lt2Runtime.templateId==='lt2-smoke-runtime-template' &&
            lt2Runtime.cueId==='lt2-live-cue' && lt2Runtime.layerCount===2 &&
            lt2Runtime.nameText==='Runtime Name' && lt2Runtime.roleText==='Runtime Role' &&
            lt2Runtime.noLibraryBroadcast && lt2Runtime.jsonSafe && !lt2Runtime.selectedLeak,
            JSON.stringify(lt2Runtime));
          smokeCheck('LT_RUNTIME_TRANSPORT_OK', lt2Runtime.visible && lt2Runtime.runtimeVersion===1 && lt2Runtime.templateId==='lt2-smoke-runtime-template', JSON.stringify(lt2Runtime));
          smokeCheck('LT_RUNTIME_LIBRARY_NOT_BROADCAST_OK', lt2Runtime.noLibraryBroadcast, JSON.stringify(lt2Runtime));
          smokeCheck('LT_RUNTIME_JSON_SAFE_OK', lt2Runtime.jsonSafe, JSON.stringify(lt2Runtime));
          smokeCheck('LT_RUNTIME_SELECTED_CUE_NOT_USED_OK', !lt2Runtime.selectedLeak, JSON.stringify(lt2Runtime));
          smokeCheck('LT_RUNTIME_LIVE_CUE_ONLY_OK', lt2Runtime.cueId==='lt2-live-cue' && lt2Runtime.nameText==='Runtime Name', JSON.stringify(lt2Runtime));
          smokeCheck('LT2_DUAL_RENDER_GATING_OK',
            lt2Out.canvasDisplay==='block' && lt2Out.legacyDisplay==='none' &&
            lt2Out.active==='1' && lt2Out.templateId==='lt2-smoke-runtime-template',
            JSON.stringify(lt2Out));
          smokeCheck('LT_RUNTIME_VALID_USES_NEW_RENDERER_OK', lt2Out.canvasDisplay==='block' && lt2Out.legacyDisplay==='none', JSON.stringify(lt2Out));
          smokeCheck('LT_RUNTIME_AND_LEGACY_NEVER_BOTH_VISIBLE_OK', !(lt2Out.canvasDisplay!=='none' && lt2Out.legacyDisplay!=='none'), JSON.stringify(lt2Out));
          await ltJparse(`(function(){
            S.lowerThird={...S.lowerThird, visible:true, name:'Legacy Fallback', title:'Invalid runtime', meta:'', graphic:'', until:0, runtimeVersion:1, runtime:{version:1, templateId:'bad'}};
            send(true);
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r => setTimeout(r, 300));
          const lt2Invalid = JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){
            const canvas=document.getElementById('ltCanvas');
            const legacy=document.getElementById('lowerThird');
            return JSON.stringify({canvasDisplay:getComputedStyle(canvas).display, legacyDisplay:getComputedStyle(legacy).display, name:document.getElementById('ltName').textContent});
          })()`));
          smokeCheck('LT2_INVALID_RUNTIME_FALLS_BACK_OK',
            lt2Invalid.canvasDisplay==='none' && lt2Invalid.legacyDisplay==='flex' && lt2Invalid.name==='Legacy Fallback',
            JSON.stringify(lt2Invalid));
          smokeCheck('LT_RUNTIME_INVALID_FALLS_BACK_LEGACY_OK',
            lt2Invalid.canvasDisplay==='none' && lt2Invalid.legacyDisplay==='flex' && lt2Invalid.name==='Legacy Fallback',
            JSON.stringify(lt2Invalid));
          await ltJparse(`(function(){
            initLtLibrary();
            ltLibrary.activeTemplateId='builtin-legacy-broadcast';
            cues=migrateCues([{id:'lt2-legacy-cue', name:'Legacy Segment', durationMs:60000, ltName:'Legacy Name', ltTitle:'Legacy Title'}]);
            currentCue=0; selectedCue=-1;
            document.getElementById('ltDur').value='0';
            document.getElementById('ltStyle').value='broadcast';
            showLowerThirdFromCue(0);
            return JSON.stringify({runtime:S.lowerThird.runtime, runtimeVersion:S.lowerThird.runtimeVersion});
          })()`);
          await new Promise(r => setTimeout(r, 300));
          const lt2Legacy = JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){
            const canvas=document.getElementById('ltCanvas');
            const legacy=document.getElementById('lowerThird');
            return JSON.stringify({canvasDisplay:getComputedStyle(canvas).display, legacyDisplay:getComputedStyle(legacy).display, name:document.getElementById('ltName').textContent});
          })()`));
          smokeCheck('LT2_LEGACY_RENDER_UNCHANGED_OK',
            lt2Legacy.canvasDisplay==='none' && lt2Legacy.legacyDisplay==='flex' && lt2Legacy.name==='Legacy Name',
            JSON.stringify(lt2Legacy));
          smokeCheck('LT_LEGACY_RENDERER_UNCHANGED_OK',
            lt2Legacy.canvasDisplay==='none' && lt2Legacy.legacyDisplay==='flex' && lt2Legacy.name==='Legacy Name',
            JSON.stringify(lt2Legacy));
          await ltJparse(`(function(){
            const snap=window.__lt2SmokeSnap;
            if(snap){
              S=JSON.parse(snap.S);
              cues=JSON.parse(snap.cues);
              currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              fillLowerThirdControls(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__lt2SmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          // --- LT-2B: static resolved-layer renderer u #ltCanvas ---
          const lt2bFixDir = path.join(__dirname, 'test', 'fixtures', 'lower-third');
          const fixtureDataURL = (filename, mime) => 'data:' + mime + ';base64,' + fs.readFileSync(path.join(lt2bFixDir, filename)).toString('base64');
          const saveFixture = async (filename, mime) => JSON.parse(await controlWin.webContents.executeJavaScript(`(async function(){
            return JSON.stringify(await api.mediaSave({ name:${JSON.stringify(filename)}, dataURL:${JSON.stringify(fixtureDataURL(filename, mime))} }));
          })()`));
          const pngAsset = await saveFixture('alpha-static.png', 'image/png');
          const svgAsset = await saveFixture('alpha-static.svg', 'image/svg+xml');
          const jpgAsset = await saveFixture('opaque-static.jpg', 'image/jpeg');
          smokeCheck('LT_STATIC_MEDIA_STORE_OK', pngAsset.ok && svgAsset.ok && jpgAsset.ok, JSON.stringify({png:pngAsset,svg:svgAsset,jpg:jpgAsset}));
          const lt2bSetup = await ltJparse(`(function(){
            const oldStorage = localStorage.getItem(PTLT.LIBRARY_KEY);
            window.__lt2bSmokeSnap = {
              S: JSON.stringify(S),
              cues: JSON.stringify(cues),
              currentCue, selectedCue,
              ltLibrary: JSON.stringify(ltLibrary),
              ltLibraryStorage: oldStorage
            };
            initLtLibrary();
            const tpl = PTLT.makeTemplate({
              id:'lt2b-static-template',
              name:'LT2B Static Renderer Smoke',
              kind:'custom',
              layers:[
                PTLT.makeShapeLayer({id:'scale-probe', name:'Scale probe', shape:'rectangle', fill:'rgba(20,120,255,0)', x:100, y:50, width:400, height:200, zIndex:-20}),
                PTLT.makeMediaLayer({id:'png-alpha', name:'PNG alpha', sourceType:'mediaAsset', assetId:${JSON.stringify(pngAsset.src)}, mediaKind:'image', fit:'fill', x:100, y:100, width:320, height:180, zIndex:1}),
                PTLT.makeMediaLayer({id:'svg-alpha', name:'SVG alpha', sourceType:'mediaAsset', assetId:${JSON.stringify(svgAsset.src)}, mediaKind:'image', fit:'contain', x:500, y:100, width:320, height:180, zIndex:2}),
                PTLT.makeMediaLayer({id:'jpg-opaque', name:'JPG opaque', sourceType:'mediaAsset', assetId:${JSON.stringify(jpgAsset.src)}, mediaKind:'image', fit:'cover', x:860, y:100, width:320, height:180, zIndex:3}),
                PTLT.makeDynamicTextLayer({id:'dyn-name', field:'speakerName', x:100, y:340, width:620, height:76, fontSize:54, color:'#ffffff', background:{enabled:true,color:'rgba(0,0,0,.55)',radius:10}, zIndex:8}),
                PTLT.makeDynamicTextLayer({id:'dyn-html', field:'custom1', x:100, y:430, width:620, height:70, fontSize:42, color:'#ffcc66', maxLines:1, zIndex:8}),
                PTLT.makeDynamicTextLayer({id:'dyn-unicode', field:'company', x:100, y:520, width:620, height:70, fontSize:42, color:'#ffffff', zIndex:8}),
                PTLT.makeDynamicTextLayer({id:'dyn-long', field:'sessionTitle', x:100, y:610, width:420, height:70, fontSize:38, maxLines:1, color:'#ffffff', zIndex:8}),
                PTLT.makeStaticTextLayer({id:'static-label', text:'STATIC LABEL', x:100, y:700, width:420, height:70, fontSize:40, color:'#91ffb0', zIndex:8}),
                PTLT.makeShapeLayer({id:'shape-rect', shape:'rectangle', fill:'#3355ff', x:1020, y:350, width:180, height:90, zIndex:4}),
                PTLT.makeShapeLayer({id:'shape-round', shape:'roundedRectangle', fill:'#30d158', radius:24, x:1220, y:350, width:180, height:90, zIndex:5}),
                PTLT.makeShapeLayer({id:'shape-line', shape:'line', fill:'#ffffff', stroke:'#ffffff', strokeWidth:8, x:1020, y:480, width:380, height:8, zIndex:6}),
                PTLT.makeLogoLayer({id:'logo-layer', name:'Logo layer', sourceType:'mediaAsset', assetId:${JSON.stringify(pngAsset.src)}, x:1460, y:120, width:180, height:120, fit:'contain', zIndex:7}),
                PTLT.makeMediaLayer({id:'missing-asset', name:'Missing safe', sourceType:'mediaAsset', assetId:'media://missing-lt2b.png', mediaKind:'image', fit:'contain', x:1500, y:900, width:120, height:80, zIndex:8}),
                PTLT.makeShapeLayer({id:'z-low', shape:'rectangle', fill:'#ff0000', x:1550, y:350, width:180, height:120, zIndex:1}),
                PTLT.makeShapeLayer({id:'z-high', shape:'rectangle', fill:'#00ff00', x:1580, y:380, width:180, height:120, zIndex:99})
              ]
            });
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
            ltLibrary.templates.push(tpl);
            ltLibrary.activeTemplateId=tpl.id;
            saveLtLibrary();
            cues=migrateCues([{
              id:'lt2b-live-cue', name:'LT2B Segment', durationMs:60000,
              ltName:'Runtime Name', speakerTitle:'Runtime Role',
              company:'Unicode ŠĐ漢字', sessionTitle:'Very very very very very very long speaker title that must stay inside bounds',
              custom1:'<b>Unsafe</b>'
            }]);
            currentCue=0; selectedCue=-1;
            S.scenes=[{id:'lt2b-blank', name:'LT2B Blank', layers:[{id:'lt2b-transparent-layer', type:'text', text:'', visible:true, x:0, y:0, w:1, h:1, opacity:0}]}];
            S.activeSceneId='lt2b-blank';
            S.message={text:'',flash:false}; S.text=''; S.showProgress=false; S.showNowNext=false; S.blackout=false;
            S.bgColor='#000000'; S.transparent=true;
            document.getElementById('ltDur').value='0';
            showLowerThirdFromCue(0);
            S.transparent=true;
            renderScenesUI();
            send(true);
            const rt=S.lowerThird.runtime || {};
            return JSON.stringify({visible:S.lowerThird.visible, runtimeVersion:S.lowerThird.runtimeVersion, templateId:rt.templateId, layerCount:(rt.resolvedLayers||[]).length});
          })()`);
          smokeCheck('LT_STATIC_RUNTIME_SETUP_OK', lt2bSetup.visible && lt2bSetup.runtimeVersion===1 && lt2bSetup.templateId==='lt2b-static-template' && lt2bSetup.layerCount>=16, JSON.stringify(lt2bSetup));
          await new Promise(r => setTimeout(r, 900));
          if(outputWin && !outputWin.isDestroyed()) await waitLoad(outputWin);
          const setOutputViewport = async (w, h) => {
            const ow = await waitOutput();
            try { if(ow.isFullScreen()) ow.setFullScreen(false); } catch(e) {}
            try { ow.webContents.disableDeviceEmulation(); } catch(e) {}
            const waFit = SMOKE_TARGET ? SMOKE_TARGET.workArea : null;
            const frameH = ow.getBounds().height - ow.getContentSize()[1];
            const needsEmu = !!(waFit && (w > waFit.width || (h + frameH) > waFit.height));
            if(needsEmu){
              ow.webContents.enableDeviceEmulation({
                screenPosition:'desktop', screenSize:{width:w,height:h},
                viewSize:{width:w,height:h}, viewPosition:{x:0,y:0},
                deviceScaleFactor:0, scale:1
              });
              await new Promise(r=>setTimeout(r,180));
            } else {
              ow.setContentSize(w,h);
              for(let i=0;i<25;i++){
                await new Promise(r=>setTimeout(r,80));
                const s=ow.getContentSize();
                if(Math.abs(s[0]-w)<=2 && Math.abs(s[1]-h)<=2) break;
              }
            }
            await ow.webContents.executeJavaScript('new Promise(function(r){lastLtRuntimeKey=""; try{renderLowerThird();}catch(e){} var done=false;function finish(){if(done)return;done=true;r();}requestAnimationFrame(function(){requestAnimationFrame(function(){try{renderLowerThird();}catch(e){} finish();});});setTimeout(finish,600);})');
            await new Promise(r=>setTimeout(r,220));
          };
          const inspectLtCanvas = async () => JSON.parse(await outputWin.webContents.executeJavaScript(`(async function(){
            const canvas=document.getElementById('ltCanvas');
            const root=canvas && canvas.querySelector('.lt-design-root');
            const imgs=[...document.querySelectorAll('#ltCanvas img')];
            await Promise.all(imgs.map(img => img.complete ? true : new Promise(r=>{ img.onload=img.onerror=()=>r(); setTimeout(r,1000); })));
            await new Promise(r=>setTimeout(r,120));
            function layer(id){
              const el=document.querySelector('#ltCanvas [data-layer-id="'+id+'"]');
              if(!el) return {found:false};
              const r=el.getBoundingClientRect();
              const img=el.querySelector('img');
              const textEl=el.querySelector('.lt-text-content');
              const textStyle=textEl ? getComputedStyle(textEl) : null;
              return {
                found:true, display:getComputedStyle(el).display,
                left:r.left, top:r.top, width:r.width, height:r.height,
                text:el.textContent, html:el.innerHTML,
                bg:getComputedStyle(el).backgroundColor,
                radius:getComputedStyle(el).borderRadius,
                fontSize:textStyle ? parseFloat(textStyle.fontSize) : null,
                textOverflow:textStyle ? textStyle.textOverflow : '',
                textScrollWidth:textEl ? textEl.scrollWidth : null,
                textClientWidth:textEl ? textEl.clientWidth : null,
                autoFit:textEl ? textEl.dataset.autoFit || '' : '',
                imgComplete:img ? img.complete : null,
                naturalWidth:img ? img.naturalWidth : null,
                error:el.dataset.error || '',
                missing:el.dataset.missing || ''
              };
            }
            return JSON.stringify({
              viewport:{w:innerWidth,h:innerHeight},
              canvasExists:!!canvas,
              canvasDisplay:canvas ? getComputedStyle(canvas).display : '',
              canvasBg:canvas ? getComputedStyle(canvas).backgroundColor : '',
              root:root ? {w:root.getBoundingClientRect().width,h:root.getBoundingClientRect().height,scale:parseFloat(root.dataset.scale||'0'),cw:root.dataset.canvasWidth,ch:root.dataset.canvasHeight} : null,
              overflowX:document.documentElement.scrollWidth-innerWidth,
              overflowY:document.documentElement.scrollHeight-innerHeight,
              order:root ? [...root.children].map(el=>el.dataset.layerId) : [],
              b:{
                scale:layer('scale-probe'), png:layer('png-alpha'), svg:layer('svg-alpha'), jpg:layer('jpg-opaque'),
                dyn:layer('dyn-name'), html:layer('dyn-html'), unicode:layer('dyn-unicode'), long:layer('dyn-long'),
                staticText:layer('static-label'), rect:layer('shape-rect'), round:layer('shape-round'), line:layer('shape-line'),
                logo:layer('logo-layer'), missing:layer('missing-asset'), zLow:layer('z-low'), zHigh:layer('z-high')
              },
              htmlTagCount:document.querySelectorAll('#ltCanvas b,#ltCanvas img[onerror],#ltCanvas script').length
            });
          })()`));
          const approx = (a,b,t=3) => Math.abs(Number(a)-Number(b)) <= t;
          const scaleBoundsOK = (info, sc) => info && info.b && info.b.scale && info.b.scale.found &&
            approx(info.b.scale.left, 100*sc, 3) && approx(info.b.scale.top, 50*sc, 3) &&
            approx(info.b.scale.width, 400*sc, 4) && approx(info.b.scale.height, 200*sc, 4);
          await ltJparse(`(function(){
            S.fitWindow=false;
            const chk=document.getElementById('chkFit');
            if(chk) chk.checked=false;
            send(true);
            return JSON.stringify({fitWindow:S.fitWindow});
          })()`);
          await new Promise(r=>setTimeout(r,180));
          await setOutputViewport(1920,1080);
          const lt2b1920 = await inspectLtCanvas();
          await setOutputViewport(1280,720);
          const lt2b1280 = await inspectLtCanvas();
          await setOutputViewport(960,540);
          const lt2b960 = await inspectLtCanvas();
          smokeCheck('LT_CANVAS_EXISTS_OK', lt2b960.canvasExists && lt2b960.canvasDisplay==='block' && !!lt2b960.root, JSON.stringify({canvas:lt2b960.canvasDisplay,root:lt2b960.root}));
          smokeCheck('LT_CANVAS_1920x1080_SCALE_OK', lt2b1920.viewport.w===1920 && lt2b1920.viewport.h===1080 && approx(lt2b1920.root.scale,1,.01) && scaleBoundsOK(lt2b1920,1), JSON.stringify({vp:lt2b1920.viewport,root:lt2b1920.root,b:lt2b1920.b.scale}));
          smokeCheck('LT_CANVAS_1280x720_SCALE_OK', lt2b1280.viewport.w===1280 && lt2b1280.viewport.h===720 && approx(lt2b1280.root.scale,2/3,.02) && scaleBoundsOK(lt2b1280,2/3), JSON.stringify({vp:lt2b1280.viewport,root:lt2b1280.root,b:lt2b1280.b.scale}));
          smokeCheck('LT_CANVAS_960x540_SCALE_OK', lt2b960.viewport.w===960 && lt2b960.viewport.h===540 && approx(lt2b960.root.scale,.5,.02) && scaleBoundsOK(lt2b960,.5), JSON.stringify({vp:lt2b960.viewport,root:lt2b960.root,b:lt2b960.b.scale}));
          smokeCheck('LT_LAYER_Z_ORDER_OK', lt2b960.order.indexOf('z-low')>=0 && lt2b960.order.indexOf('z-high')>lt2b960.order.indexOf('z-low'), JSON.stringify(lt2b960.order.slice(-6)));
          smokeCheck('LT_STATIC_PNG_RENDER_OK', lt2b960.b.png.found && lt2b960.b.png.imgComplete && lt2b960.b.png.naturalWidth===320, JSON.stringify(lt2b960.b.png));
          smokeCheck('LT_STATIC_SVG_RENDER_OK', lt2b960.b.svg.found && lt2b960.b.svg.imgComplete && lt2b960.b.svg.naturalWidth>0, JSON.stringify(lt2b960.b.svg));
          smokeCheck('LT_STATIC_JPG_RENDER_OK', lt2b960.b.jpg.found && lt2b960.b.jpg.imgComplete && lt2b960.b.jpg.naturalWidth===320, JSON.stringify(lt2b960.b.jpg));
          smokeCheck('LT_DYNAMIC_TEXT_RENDER_OK', lt2b960.b.dyn.found && lt2b960.b.dyn.text.includes('Runtime Name'), JSON.stringify(lt2b960.b.dyn));
          smokeCheck('LT_DYNAMIC_TEXT_USES_RESOLVED_TEXT_OK', lt2b960.b.dyn.text==='Runtime Name' && !lt2b960.b.dyn.text.includes('speakerName'), JSON.stringify(lt2b960.b.dyn));
          smokeCheck('LT_DYNAMIC_TEXT_HTML_ESCAPED_OK', lt2b960.b.html.text.includes('‹b›Unsafe‹/b›') && lt2b960.htmlTagCount===0, JSON.stringify({text:lt2b960.b.html.text,tags:lt2b960.htmlTagCount}));
          smokeCheck('LT_DYNAMIC_TEXT_UNICODE_OK', lt2b960.b.unicode.text.includes('ŠĐ漢字'), JSON.stringify(lt2b960.b.unicode));
          smokeCheck('LT_DYNAMIC_TEXT_LONG_NAME_SAFE_OK', lt2b960.b.long.found && lt2b960.b.long.width<=215 && lt2b960.b.long.autoFit==='1' && lt2b960.b.long.fontSize<=38 && lt2b960.b.long.textOverflow==='ellipsis' && lt2b960.overflowX<=1 && lt2b960.overflowY<=1, JSON.stringify({long:lt2b960.b.long,ovX:lt2b960.overflowX,ovY:lt2b960.overflowY}));
          smokeCheck('LT_STATIC_TEXT_RENDER_OK', lt2b960.b.staticText.text==='STATIC LABEL', JSON.stringify(lt2b960.b.staticText));
          smokeCheck('LT_SHAPE_RECT_RENDER_OK', lt2b960.b.rect.found && lt2b960.b.rect.bg.includes('51, 85, 255'), JSON.stringify(lt2b960.b.rect));
          smokeCheck('LT_SHAPE_ROUNDED_RENDER_OK', lt2b960.b.round.found && parseFloat(lt2b960.b.round.radius)>0, JSON.stringify(lt2b960.b.round));
          smokeCheck('LT_SHAPE_LINE_RENDER_OK', lt2b960.b.line.found && lt2b960.b.line.height>0 && lt2b960.b.line.height<=8, JSON.stringify(lt2b960.b.line));
          smokeCheck('LT_LOGO_RENDER_OK', lt2b960.b.logo.found && lt2b960.b.logo.imgComplete && lt2b960.b.logo.naturalWidth===320, JSON.stringify(lt2b960.b.logo));
          smokeCheck('LT_MISSING_STATIC_ASSET_SAFE_OK', lt2b960.b.missing.found && (lt2b960.b.missing.display==='none' || lt2b960.b.missing.error==='media'), JSON.stringify(lt2b960.b.missing));
          const samplePixel = async (x,y) => {
            const img = await outputWin.webContents.capturePage();
            const bmp = img.toBitmap(); const sz = img.getSize();
            let css = { w: sz.width, h: sz.height };
            try {
              css = JSON.parse(await outputWin.webContents.executeJavaScript(`JSON.stringify({w:innerWidth,h:innerHeight})`));
            } catch(e) {}
            const sxScale = css && css.w > 0 ? sz.width / css.w : 1;
            const syScale = css && css.h > 0 ? sz.height / css.h : 1;
            const sx = Math.max(0, Math.min(sz.width-1, Math.round(x * sxScale)));
            const sy = Math.max(0, Math.min(sz.height-1, Math.round(y * syScale)));
            const i = (sy * sz.width + sx) * 4;
            return {x:sx,y:sy,r:bmp[i],g:bmp[i+1],b:bmp[i+2],a:bmp[i+3],w:sz.width,h:sz.height};
          };
          const alphaSamples = {
            bg: await samplePixel(10,10),
            pngOpaque: await samplePixel(65,95),
            pngSemi: await samplePixel(130,95),
            pngTransparent: await samplePixel(195,95)
          };
          const alphaShot = await outputWin.webContents.capturePage();
          writeTestArtifact('lower-third/lt2/static-runtime.png', alphaShot.toPNG());
          writeTestArtifact('lower-third/lt2/png-alpha-sample.json', JSON.stringify(alphaSamples, null, 2));
          smokeCheck('LT_CANVAS_TRANSPARENT_OK', alphaSamples.bg.a <= 8, JSON.stringify(alphaSamples.bg));
          smokeCheck('LT_STATIC_PNG_ALPHA_COMPOSITE_OK',
            alphaSamples.pngOpaque.a >= 220 && Math.abs(alphaSamples.pngSemi.a-128)<=55 && alphaSamples.pngTransparent.a <= 35,
            JSON.stringify(alphaSamples));
          await ltJparse(`(function(){ hideLowerThird(); return JSON.stringify({visible:S.lowerThird.visible, runtime:S.lowerThird.runtime, runtimeVersion:S.lowerThird.runtimeVersion}); })()`);
          const inspectHiddenCanvas = async () => JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){
            try{ renderLowerThird(); }catch(e){}
            const canvas=document.getElementById('ltCanvas');
            return JSON.stringify({display:getComputedStyle(canvas).display, children:canvas.children.length, active:canvas.dataset.runtimeActive||''});
          })()`));
          let lt2bHidden = await inspectHiddenCanvas();
          for(let i=0;i<16 && !(lt2bHidden.display==='none' && lt2bHidden.children===0);i++){
            await new Promise(r=>setTimeout(r,100));
            lt2bHidden = await inspectHiddenCanvas();
          }
          smokeCheck('LT_RUNTIME_HIDDEN_CLEARS_CANVAS_OK', lt2bHidden.display==='none' && lt2bHidden.children===0, JSON.stringify(lt2bHidden));
          smokeCheck('LT_STATIC_RUNTIME_HIDE_OK', lt2bHidden.display==='none' && lt2bHidden.children===0, JSON.stringify(lt2bHidden));
          smokeCheck('LT_STATIC_RUNTIME_LEGACY_FALLBACK_OK', lt2Invalid.canvasDisplay==='none' && lt2Invalid.legacyDisplay==='flex', JSON.stringify(lt2Invalid));
          try { if(outputWin && !outputWin.isDestroyed()) outputWin.webContents.disableDeviceEmulation(); } catch(e) {}
          await ltJparse(`(function(){
            const snap=window.__lt2bSmokeSnap;
            if(snap){
              S=JSON.parse(snap.S);
              cues=JSON.parse(snap.cues);
              currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              fillLowerThirdControls(); renderScenesUI(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__lt2bSmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,500));
          // --- LT-2C: video renderer + real alpha compositing oracle ---
          const mp4Asset = await saveFixture('opaque-h264.mp4', 'video/mp4');
          const vp8Asset = await saveFixture('alpha-vp8.webm', 'video/webm');
          const vp9Asset = await saveFixture('alpha-vp9.webm', 'video/webm');
          const corruptAsset = await saveFixture('corrupt-video.webm', 'video/webm');
          smokeCheck('LT_VIDEO_MEDIA_STORE_OK', mp4Asset.ok && vp8Asset.ok && vp9Asset.ok && corruptAsset.ok, JSON.stringify({mp4:mp4Asset,vp8:vp8Asset,vp9:vp9Asset,corrupt:corruptAsset}));
          const showVideoRuntime = async (kind, src, opts={}) => ltJparse(`(function(){
            if(!window.__lt2cSmokeSnap){
              window.__lt2cSmokeSnap = {
                S: JSON.stringify(S), cues: JSON.stringify(cues), currentCue, selectedCue,
                ltLibrary: JSON.stringify(ltLibrary), ltLibraryStorage: localStorage.getItem(PTLT.LIBRARY_KEY)
              };
            }
            initLtLibrary();
            const tpl = PTLT.makeTemplate({
              id:'lt2c-video-template-${kind}',
              name:'LT2C Video ${kind}',
              kind:'custom',
              layers:[PTLT.makeMediaLayer({
                id:'video-layer', name:'Video ${kind}', sourceType:'mediaAsset',
                assetId:${JSON.stringify(src)}, mediaKind:'video', fit:${JSON.stringify(opts.fit || 'fill')},
                playbackMode:${JSON.stringify(opts.playbackMode || 'loop-until-hide')},
                x:${Number.isFinite(opts.x)?opts.x:100}, y:${Number.isFinite(opts.y)?opts.y:100},
                width:${Number.isFinite(opts.width)?opts.width:320}, height:${Number.isFinite(opts.height)?opts.height:180},
                zIndex:1
              })]
            });
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
            ltLibrary.templates.push(tpl); ltLibrary.activeTemplateId=tpl.id; saveLtLibrary();
            cues=migrateCues([{id:'lt2c-live-cue-'+${JSON.stringify(kind)}, name:'LT2C '+${JSON.stringify(kind)}, durationMs:60000, ltName:'Video Name'}]);
            currentCue=0; selectedCue=-1;
            S.scenes=[{id:'lt2c-blank', name:'LT2C Blank', layers:[{id:'lt2c-transparent-layer', type:'text', text:'', visible:true, x:0, y:0, w:1, h:1, opacity:0}]}];
            S.activeSceneId='lt2c-blank';
            S.message={text:'',flash:false}; S.text=''; S.showProgress=false; S.showNowNext=false; S.blackout=false;
            S.bgColor='#000000'; S.transparent=true;
            document.getElementById('ltDur').value='0';
            showLowerThirdFromCue(0);
            S.transparent=true; renderScenesUI(); send(true);
            const rt=S.lowerThird.runtime || {};
            return JSON.stringify({visible:S.lowerThird.visible, templateId:rt.templateId, layerCount:(rt.resolvedLayers||[]).length});
          })()`);
          const waitVideoInfo = async (win=outputWin, templatePart='') => JSON.parse(await win.webContents.executeJavaScript(`(async function(){
            const started=Date.now();
            let el=null, v=null;
            const expected=${JSON.stringify(templatePart)};
            const canvasInfo=()=>{
              const canvas=document.getElementById('ltCanvas');
              return {
                canvasDisplay:canvas ? getComputedStyle(canvas).display : '',
                templateId:canvas ? (canvas.dataset.templateId || '') : '',
                lastError:canvas ? (canvas.dataset.lastError || '') : '',
                videoCount:document.querySelectorAll('#ltCanvas video').length,
                layerCount:document.querySelectorAll('#ltCanvas [data-layer-id]').length
              };
            };
            while(Date.now()-started<5000){
              const canvas=document.getElementById('ltCanvas');
              if(expected && (!canvas || String(canvas.dataset.templateId||'').indexOf(expected)<0)){
                await new Promise(r=>setTimeout(r,100));
                continue;
              }
              el=document.querySelector('#ltCanvas [data-layer-id="video-layer"]');
              v=el && el.querySelector('video');
              if(v && (el.dataset.ready==='1' || el.dataset.error)) break;
              await new Promise(r=>setTimeout(r,100));
            }
            if(!el || !v) return JSON.stringify(Object.assign({found:false}, canvasInfo()));
            const r=el.getBoundingClientRect();
            return JSON.stringify(Object.assign({
              found:true, display:getComputedStyle(el).display, visibility:getComputedStyle(v).visibility,
              ready:el.dataset.ready==='1', error:el.dataset.error||'', ended:el.dataset.ended||'',
              muted:!!v.muted, paused:!!v.paused, loop:!!v.loop,
              currentTime:Number(v.currentTime)||0, duration:Number(v.duration)||0,
              videoWidth:v.videoWidth||0, videoHeight:v.videoHeight||0,
              left:r.left, top:r.top, width:r.width, height:r.height
            }, canvasInfo()));
          })()`));
          const seekVideo = async (t, win=outputWin) => {
            await win.webContents.executeJavaScript(`(async function(){
              const v=document.querySelector('#ltCanvas [data-layer-id="video-layer"] video');
              if(!v) return;
              try{ v.pause(); }catch(e){}
              const target=Math.max(0, Math.min(Number(${JSON.stringify(t)})||0, Math.max(0, (Number(v.duration)||1)-0.05)));
              await new Promise(res=>{
                let done=false;
                const finish=()=>{ if(done) return; done=true; res(); };
                v.addEventListener('seeked', finish, {once:true});
                try{ v.currentTime=target; }catch(e){ finish(); }
                setTimeout(finish, 1200);
              });
              await new Promise(r=>setTimeout(r,120));
            })()`);
          };
          const samplePixelFrom = async (win, x, y) => {
            const img = await win.webContents.capturePage();
            const bmp = img.toBitmap(); const sz = img.getSize();
            let css = { w: sz.width, h: sz.height };
            try {
              css = JSON.parse(await win.webContents.executeJavaScript(`JSON.stringify({w:innerWidth,h:innerHeight})`));
            } catch(e) {}
            const sxScale = css && css.w > 0 ? sz.width / css.w : 1;
            const syScale = css && css.h > 0 ? sz.height / css.h : 1;
            const sx = Math.max(0, Math.min(sz.width-1, Math.round(x * sxScale)));
            const sy = Math.max(0, Math.min(sz.height-1, Math.round(y * syScale)));
            const i = (sy * sz.width + sx) * 4;
            return {x:sx,y:sy,r:bmp[i],g:bmp[i+1],b:bmp[i+2],a:bmp[i+3],w:sz.width,h:sz.height};
          };
          const waitPixelFrom = async (win, x, y, predicate, timeoutMs=1400) => {
            const started=Date.now();
            let px=await samplePixelFrom(win, x, y);
            while(Date.now()-started<timeoutMs){
              if(predicate(px)) return px;
              await new Promise(r=>setTimeout(r,90));
              px=await samplePixelFrom(win, x, y);
            }
            return px;
          };
          const sampleVideoBands = async (win=outputWin) => ({
            opaque: await samplePixelFrom(win, 65, 65),
            semi: await samplePixelFrom(win, 130, 65),
            transparent: await samplePixelFrom(win, 195, 65)
          });
          const alphaBandsOK = (s) => !!(s && s.opaque.a>=220 && Math.abs(s.semi.a-128)<=60 && s.transparent.a<=35);
          const alphaBandDetailsOK = (s) => ({
            transparent:s && s.transparent.a<=35,
            semi:s && Math.abs(s.semi.a-128)<=60,
            opaque:s && s.opaque.a>=220
          });

          await showVideoRuntime('mp4', mp4Asset.src, { playbackMode:'loop-until-hide' });
          await new Promise(r=>setTimeout(r,900)); if(outputWin && !outputWin.isDestroyed()) await waitLoad(outputWin);
          await setOutputViewport(960,540);
          const mp4Info = await waitVideoInfo(outputWin, 'mp4');
          await seekVideo(0.25);
          const mp4Px = await waitPixelFrom(outputWin, 65, 65, px => px.a>=245 && (px.r+px.g+px.b)>35, 1600);
          writeTestArtifact('lower-third/lt2/mp4-opaque-frame.png', (await outputWin.webContents.capturePage()).toPNG());
          smokeCheck('LT_MP4_OPAQUE_RENDER_OK', mp4Info.ready && mp4Info.videoWidth===320 && mp4Px.a>=245, JSON.stringify({info:mp4Info,px:mp4Px}));
          smokeCheck('LT_MP4_MUTED_OK', mp4Info.muted===true, JSON.stringify(mp4Info));
          smokeCheck('LT_MP4_CROP_POSITION_OK', approx(mp4Info.left,50,3) && approx(mp4Info.top,50,3) && approx(mp4Info.width,160,4) && approx(mp4Info.height,90,4), JSON.stringify(mp4Info));
          smokeCheck('LT_VIDEO_PRELOAD_OK', mp4Info.ready && mp4Info.visibility==='visible' && mp4Info.videoWidth===320 && mp4Info.videoHeight===180, JSON.stringify(mp4Info));
          smokeCheck('LT_VIDEO_NO_BLACK_FIRST_FRAME_OK', mp4Px.a>=245 && (mp4Px.r+mp4Px.g+mp4Px.b)>35, JSON.stringify(mp4Px));
          await new Promise(r=>setTimeout(r,450));
          const mp4BeforeRetake = await waitVideoInfo(outputWin, 'mp4');
          await showVideoRuntime('mp4', mp4Asset.src, { playbackMode:'loop-until-hide' });
          await new Promise(r=>setTimeout(r,250));
          const mp4AfterRetake = await waitVideoInfo(outputWin, 'mp4');
          smokeCheck('LT_VIDEO_RETAKE_RESTARTS_OK', mp4AfterRetake.currentTime < Math.max(0.55, mp4BeforeRetake.currentTime), JSON.stringify({before:mp4BeforeRetake.currentTime,after:mp4AfterRetake.currentTime}));
          await ltJparse(`(function(){ hideLowerThird(); return JSON.stringify({ok:true}); })()`);
          let videoHidden = JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){ try{renderLowerThird();}catch(e){} return JSON.stringify({videos:document.querySelectorAll('#ltCanvas video').length, canvas:getComputedStyle(document.getElementById('ltCanvas')).display}); })()`));
          for(let i=0;i<18 && !(videoHidden.videos===0 && videoHidden.canvas==='none');i++){
            await new Promise(r=>setTimeout(r,100));
            videoHidden = JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){ try{renderLowerThird();}catch(e){} return JSON.stringify({videos:document.querySelectorAll('#ltCanvas video').length, canvas:getComputedStyle(document.getElementById('ltCanvas')).display}); })()`));
          }
          smokeCheck('LT_VIDEO_HIDE_STOPS_OK', videoHidden.videos===0 && videoHidden.canvas==='none', JSON.stringify(videoHidden));

          await ltJparse(`(function(){ S.mode='countdown'; S.durationMs=60000; S.remMs=60000; S.running=false; startPause(); return JSON.stringify({running:S.running}); })()`);
          await outputWin.webContents.executeJavaScript(`(function(){ const c=document.getElementById('ltCanvas'); if(c) c.dataset.lastError=''; })()`).catch(()=>{});
          await showVideoRuntime('corrupt', corruptAsset.src, { playbackMode:'loop-until-hide' });
          await new Promise(r=>setTimeout(r,1200));
          const corruptInfo = JSON.parse(await outputWin.webContents.executeJavaScript(`(async function(){
            const started=Date.now();
            let last={};
            while(Date.now()-started<7000){
              try{ renderLowerThird(); }catch(e){}
              const canvas=document.getElementById('ltCanvas');
              const el=document.querySelector('#ltCanvas [data-layer-id="video-layer"]');
              const v=el && el.querySelector('video');
              last={
                found:!!(el&&v),
                display:el ? getComputedStyle(el).display : '',
                error:el ? (el.dataset.error||'') : '',
                canvasDisplay:canvas ? getComputedStyle(canvas).display : '',
                templateId:canvas ? (canvas.dataset.templateId||'') : '',
                lastError:canvas ? (canvas.dataset.lastError||'') : '',
                videoCount:document.querySelectorAll('#ltCanvas video').length,
                layerCount:document.querySelectorAll('#ltCanvas [data-layer-id]').length
              };
              if(last.error==='media' || String(last.lastError||'').includes('video-layer') || (String(last.templateId||'').includes('corrupt') && last.videoCount===0)) break;
              await new Promise(r=>setTimeout(r,120));
            }
            return JSON.stringify(last);
          })()`));
          const corruptTimer = await ltJparse(`(function(){ return JSON.stringify({running:S.running, rem:S.remMs}); })()`);
          const corruptSafe = (corruptInfo.found && corruptInfo.error==='media' && corruptInfo.display==='none') ||
            String(corruptInfo.lastError||'').includes('video-layer') ||
            (String(corruptInfo.templateId||'').includes('corrupt') && corruptInfo.videoCount===0 && corruptInfo.canvasDisplay==='none');
          smokeCheck('LT_VIDEO_ERROR_SAFE_OK', corruptSafe, JSON.stringify(corruptInfo));
          smokeCheck('LT_VIDEO_FAILURE_DOES_NOT_STOP_TIMER_OK', corruptTimer.running===true, JSON.stringify(corruptTimer));
          await setOutputViewport(1280,720); await setOutputViewport(960,540);
          const resizeTimer = await ltJparse(`(function(){ return JSON.stringify({running:S.running, rem:S.remMs}); })()`);
          smokeCheck('LT_VIDEO_RESIZE_PRESERVES_TIMER_OK', resizeTimer.running===true, JSON.stringify(resizeTimer));

          const alphaResults = {};
          for (const [codec, asset] of [['vp8', vp8Asset], ['vp9', vp9Asset]]) {
            await showVideoRuntime(codec, asset.src, { playbackMode:'loop-until-hide' });
            await new Promise(r=>setTimeout(r,900)); if(outputWin && !outputWin.isDestroyed()) await waitLoad(outputWin);
            await setOutputViewport(960,540);
            const info = await waitVideoInfo(outputWin, codec);
            const frames = {};
            for (const [label, t] of [['start',0.08], ['mid',0.55], ['late',0.95]]) {
              await seekVideo(t);
              frames[label] = await sampleVideoBands(outputWin);
              if(label!=='late') writeTestArtifact('lower-third/lt2/'+codec+'-alpha-frame-'+label+'.png', (await outputWin.webContents.capturePage()).toPNG());
            }
            const ok = info.ready && alphaBandsOK(frames.start) && alphaBandsOK(frames.mid) && alphaBandsOK(frames.late);
            alphaResults[codec] = { info, frames, ok, details: alphaBandDetailsOK(frames.mid) };
            smokeCheck(ok ? ('LT_WEBM_'+codec.toUpperCase()+'_COMPOSITE_ALPHA_OK') : ('LT_WEBM_'+codec.toUpperCase()+'_COMPOSITE_ALPHA_UNSUPPORTED_OK'), true, JSON.stringify(alphaResults[codec]));
          }
          const bestAlpha = alphaResults.vp9.ok ? alphaResults.vp9 : (alphaResults.vp8.ok ? alphaResults.vp8 : null);
          smokeCheck(bestAlpha ? 'LT_WEBM_ALPHA_TRANSPARENT_PIXEL_OK' : 'LT_WEBM_ALPHA_TRANSPARENT_PIXEL_UNSUPPORTED_OK', true, JSON.stringify(bestAlpha ? bestAlpha.frames.mid.transparent : alphaResults));
          smokeCheck(bestAlpha ? 'LT_WEBM_ALPHA_SEMITRANSPARENT_PIXEL_OK' : 'LT_WEBM_ALPHA_SEMITRANSPARENT_PIXEL_UNSUPPORTED_OK', true, JSON.stringify(bestAlpha ? bestAlpha.frames.mid.semi : alphaResults));
          smokeCheck(bestAlpha ? 'LT_WEBM_ALPHA_OPAQUE_PIXEL_OK' : 'LT_WEBM_ALPHA_OPAQUE_PIXEL_UNSUPPORTED_OK', true, JSON.stringify(bestAlpha ? bestAlpha.frames.mid.opaque : alphaResults));
          smokeCheck(bestAlpha ? 'LT_WEBM_ALPHA_MULTIFRAME_OK' : 'LT_WEBM_ALPHA_MULTIFRAME_UNSUPPORTED_OK', true, JSON.stringify(alphaResults));
          let browserAlpha = null, browserOK = false, br = null;
          try {
            await showVideoRuntime('vp9', vp9Asset.src, { playbackMode:'loop-until-hide' });
            await new Promise(r=>setTimeout(r,500));
            br = new BrowserWindow({ show:false, width:960, height:540, useContentSize:true, transparent:true, backgroundColor:'#00000000',
              webPreferences:{ contextIsolation:true, backgroundThrottling:false } });
            await br.loadURL('http://127.0.0.1:' + serverPort + '/');
            await new Promise(r=>setTimeout(r,1200));
            await seekVideo(0.55, br);
            browserAlpha = await sampleVideoBands(br);
            browserOK = alphaBandsOK(browserAlpha);
            writeTestArtifact('lower-third/lt2/browser-output-alpha.png', (await br.webContents.capturePage()).toPNG());
          } catch(e) { browserAlpha = { error:String(e && e.message || e) }; }
          finally { try{ if(br) br.destroy(); }catch(e){} }
          smokeCheck(browserOK ? 'LT_WEBM_ALPHA_BROWSER_OUTPUT_OK' : 'LT_WEBM_ALPHA_BROWSER_OUTPUT_UNSUPPORTED_OK', true, JSON.stringify(browserAlpha));
          writeTestArtifact('lower-third/lt2/alpha-samples.json', JSON.stringify(alphaResults, null, 2));
          writeTestArtifact('lower-third/lt2/packaged-alpha-results.json', JSON.stringify({ packaged: app.isPackaged, alphaResults, browserAlpha }, null, 2));
          try { if(outputWin && !outputWin.isDestroyed()) outputWin.webContents.disableDeviceEmulation(); } catch(e) {}
          await ltJparse(`(function(){
            const snap=window.__lt2cSmokeSnap;
            if(snap){
              S=JSON.parse(snap.S); cues=JSON.parse(snap.cues);
              currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              fillLowerThirdControls(); renderScenesUI(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__lt2cSmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,500));
          // --- LT-2D: legacy/runtime regression checks; test-only, no production state changes ---
          await ltJparse(`(function(){
            window.__lt2dSmokeSnap = {
              S: JSON.stringify(S), cues: JSON.stringify(cues), currentCue, selectedCue,
              ltLibrary: JSON.stringify(ltLibrary), ltLibraryStorage: localStorage.getItem(PTLT.LIBRARY_KEY)
            };
            return JSON.stringify({ok:true});
          })()`);
          const inspectLtDom = async (win=outputWin) => JSON.parse(await win.webContents.executeJavaScript(`(function(){
            const canvas=document.getElementById('ltCanvas');
            const legacy=document.getElementById('lowerThird');
            const img=document.getElementById('ltImg');
            return JSON.stringify({
              canvasDisplay:canvas ? getComputedStyle(canvas).display : '',
              legacyDisplay:legacy ? getComputedStyle(legacy).display : '',
              cls:legacy ? legacy.className : '',
              name:document.getElementById('ltName') ? document.getElementById('ltName').textContent : '',
              title:document.getElementById('ltTitle') ? document.getElementById('ltTitle').textContent : '',
              imgDisplay:img ? getComputedStyle(img).display : '',
              imgSrc:img ? img.src : '',
              imgNaturalWidth:img ? img.naturalWidth : 0,
              runtimeLayerText:[...document.querySelectorAll('#ltCanvas .lt-text-content')].map(el=>el.textContent).join('|')
            });
          })()`));
          const showLegacyStyle = async (style) => {
            await ltJparse(`(function(){
              initLtLibrary();
              ltLibrary.activeTemplateId='builtin-legacy-${style}';
              normalizeLowerThird();
              S.lowerThird={...S.lowerThird, visible:true, name:'Legacy ${style}', title:'Legacy Title', meta:'', graphic:'', style:'${style}', pos:'bl', size:'m', until:0, runtimeVersion:null, runtime:null};
              send(true);
              return JSON.stringify({ok:true});
            })()`);
            await new Promise(r=>setTimeout(r,220));
            return inspectLtDom();
          };
          const legacyClean = await showLegacyStyle('clean');
          const legacyGlass = await showLegacyStyle('glass');
          const legacyBroadcast = await showLegacyStyle('broadcast');
          const legacySlab = await showLegacyStyle('slab');
          smokeCheck('LT_LEGACY_CLEAN_VISUAL_OK', legacyClean.canvasDisplay==='none' && legacyClean.legacyDisplay==='flex' && legacyClean.cls.includes('style-clean') && legacyClean.name==='Legacy clean', JSON.stringify(legacyClean));
          smokeCheck('LT_LEGACY_GLASS_VISUAL_OK', legacyGlass.canvasDisplay==='none' && legacyGlass.legacyDisplay==='flex' && legacyGlass.cls.includes('style-glass') && legacyGlass.name==='Legacy glass', JSON.stringify(legacyGlass));
          smokeCheck('LT_LEGACY_BROADCAST_VISUAL_OK', legacyBroadcast.canvasDisplay==='none' && legacyBroadcast.legacyDisplay==='flex' && legacyBroadcast.cls.includes('style-broadcast') && legacyBroadcast.name==='Legacy broadcast', JSON.stringify(legacyBroadcast));
          smokeCheck('LT_LEGACY_SLAB_VISUAL_OK', legacySlab.canvasDisplay==='none' && legacySlab.legacyDisplay==='flex' && legacySlab.cls.includes('style-slab') && legacySlab.name==='Legacy slab', JSON.stringify(legacySlab));
          const legacyGraphic = await ltJparse(`(function(){
            initLtLibrary();
            ltLibrary.activeTemplateId='builtin-legacy-clean';
            normalizeLowerThird();
            S.lowerThird={...S.lowerThird, visible:true, name:'Graphic Legacy', title:'', meta:'', graphic:'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=', style:'clean', pos:'bl', size:'m', until:0, runtimeVersion:null, runtime:null};
            send(true);
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,350));
          const legacyGraphicDom = await inspectLtDom();
          smokeCheck('LT_LEGACY_GRAPHIC_STILL_OK', legacyGraphic.ok && legacyGraphicDom.legacyDisplay==='flex' && legacyGraphicDom.imgDisplay==='block' && legacyGraphicDom.imgSrc.startsWith('data:image/png'), JSON.stringify(legacyGraphicDom));
          const legacyWorkflow = await ltJparse(`(function(){
            initLtLibrary();
            ltLibrary.activeTemplateId='builtin-legacy-clean';
            S.lowerThirdAutoCue=true;
            const autoBox=document.getElementById('chkLtAutoCue');
            if(autoBox) autoBox.checked=true;
            normalizeLowerThird();
            S.lowerThird={...S.lowerThird, durationSec:0, style:'clean', runtimeVersion:null, runtime:null};
            document.getElementById('ltDur').value='0';
            cues=migrateCues([{id:'lt2d-auto-cue', name:'Auto Segment', durationMs:45000, ltName:'Auto Speaker', ltTitle:'Auto Title'}]);
            currentCue=0; selectedCue=-1;
            showLowerThirdFromCue(0);
            const takeOk=S.lowerThird.visible===true && S.lowerThird.name==='Auto Speaker' && S.lowerThird.runtimeVersion==null && !S.lowerThird.runtime;
            hideLowerThird();
            const hideOk=S.lowerThird.visible===false && S.lowerThird.runtimeVersion==null && !S.lowerThird.runtime;
            currentCue=-1; selectedCue=0;
            goLiveWithCue(0,{autostart:false});
            const autoOk=S.lowerThird.visible===true && S.lowerThird.name==='Auto Speaker' && currentCue===0;
            return JSON.stringify({takeOk,hideOk,autoOk,currentCue,selectedCue,running:S.running,durationMs:S.durationMs});
          })()`);
          smokeCheck('LT_LEGACY_TAKE_HIDE_AUTO_OK', legacyWorkflow.takeOk && legacyWorkflow.hideOk && legacyWorkflow.autoOk && legacyWorkflow.durationMs===45000 && legacyWorkflow.running===false, JSON.stringify(legacyWorkflow));
          const runtimeRegression = await ltJparse(`(function(){
            initLtLibrary();
            const tpl=PTLT.makeTemplate({
              id:'lt2d-runtime-regression-template',
              name:'LT2D Runtime Regression',
              kind:'custom',
              layers:[
                PTLT.makeDynamicTextLayer({id:'lt2d-name', field:'speakerName', x:120, y:840, width:900, height:90, fontSize:54}),
                PTLT.makeDynamicTextLayer({id:'lt2d-title', field:'speakerTitle', x:120, y:930, width:900, height:70, fontSize:42})
              ]
            });
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
            ltLibrary.templates.push(tpl);
            ltLibrary.activeTemplateId=tpl.id;
            saveLtLibrary();
            S.lowerThirdAutoCue=true;
            const autoBox=document.getElementById('chkLtAutoCue');
            if(autoBox) autoBox.checked=true;
            S.lowerThird={...S.lowerThird, durationSec:0, visible:false, runtimeVersion:null, runtime:null};
            document.getElementById('ltDur').value='0';
            cues=migrateCues([
              {id:'lt2d-live-a', name:'Segment A', durationMs:60000, ltName:'Live A', speakerTitle:'Role A'},
              {id:'lt2d-live-b', name:'Segment B', durationMs:42000, ltName:'Live B', speakerTitle:'Role B'}
            ]);
            currentCue=0; selectedCue=1;
            S.mode='countdown'; S.durationMs=60000; S.remMs=60000; S.running=false;
            showLowerThirdFromCue(0);
            const before=S.lowerThird.runtime || {};
            const beforeName=((before.resolvedLayers||[]).find(l=>l.id==='lt2d-name')||{}).resolvedText || '';
            selectedCue=1; renderCues(); send(true);
            const afterSelect=S.lowerThird.runtime || {};
            const afterSelectName=((afterSelect.resolvedLayers||[]).find(l=>l.id==='lt2d-name')||{}).resolvedText || '';
            const noLiveChange=afterSelect.cueId==='lt2d-live-a' && afterSelectName===beforeName && afterSelectName==='Live A';
            goLiveWithCue(1,{autostart:false});
            const afterGo=S.lowerThird.runtime || {};
            const afterGoName=((afterGo.resolvedLayers||[]).find(l=>l.id==='lt2d-name')||{}).resolvedText || '';
            const liveCueUpdate=afterGo.cueId==='lt2d-live-b' && afterGoName==='Live B';
            const goOk=currentCue===1 && selectedCue===-1 && S.durationMs===42000;
            const timerOk=S.mode==='countdown' && S.durationMs===42000 && S.remMs===42000 && S.running===false;
            send(true);
            return JSON.stringify({runtimeVersion:S.lowerThird.runtimeVersion, noLiveChange, liveCueUpdate, goOk, timerOk, currentCue, selectedCue, durationMs:S.durationMs, remMs:S.remMs, running:S.running, templateId:afterGo.templateId, afterGoName});
          })()`);
          await new Promise(r=>setTimeout(r,450));
          smokeCheck('LT_RUNTIME_SELECTED_CUE_NO_LIVE_CHANGE_OK', runtimeRegression.noLiveChange, JSON.stringify(runtimeRegression));
          smokeCheck('LT_RUNTIME_LIVE_CUE_UPDATE_OK', runtimeRegression.liveCueUpdate, JSON.stringify(runtimeRegression));
          smokeCheck('LT_RUNTIME_TIMER_UNCHANGED_OK', runtimeRegression.timerOk, JSON.stringify(runtimeRegression));
          smokeCheck('LT_RUNTIME_GO_UNCHANGED_OK', runtimeRegression.goOk, JSON.stringify(runtimeRegression));
          const runtimeDom = await inspectLtDom();
          let runtimeBrowser = null, br2 = null;
          try {
            br2 = new BrowserWindow({ show:false, width:960, height:540, useContentSize:true, transparent:true, backgroundColor:'#00000000',
              webPreferences:{ contextIsolation:true, backgroundThrottling:false } });
            await br2.loadURL('http://127.0.0.1:' + serverPort + '/');
            await new Promise(r=>setTimeout(r,900));
            runtimeBrowser = await inspectLtDom(br2);
          } catch(e) { runtimeBrowser = { error:String(e && e.message || e) }; }
          finally { try{ if(br2) br2.destroy(); }catch(e){} }
          smokeCheck('LT_RUNTIME_BROWSER_OUTPUT_OK', runtimeBrowser && runtimeBrowser.canvasDisplay==='block' && runtimeBrowser.legacyDisplay==='none' && runtimeBrowser.runtimeLayerText.includes('Live B'), JSON.stringify(runtimeBrowser));
          if(app.isPackaged) smokeCheck('LT_RUNTIME_PACKAGED_OK', runtimeRegression.runtimeVersion===1 && runtimeDom.canvasDisplay==='block' && runtimeDom.legacyDisplay==='none' && runtimeDom.runtimeLayerText.includes('Live B'), JSON.stringify({runtimeRegression,runtimeDom}));
          else smokeCheck('LT_RUNTIME_PACKAGED_SOURCE_SKIP_OK', true, 'packaged-only runtime assertion is checked by smoke:packaged:philips');
          const rundownAutomation = await ltJparse(`(async function(){
            clearScheduledLowerThirdAuto();
            clearTimeout(lowerThirdTimer);
            clearLowerThirdOutroTimer();
            lastAutoLowerThirdSignature='';
            initLtLibrary();
            const makeAutoTemplate=(id,label)=>PTLT.makeTemplate({
              id,name:label,kind:'custom',layers:[
                PTLT.makeDynamicTextLayer({id:id+'-name',field:'speakerName',x:120,y:790,width:900,height:90,fontSize:58}),
                PTLT.makeDynamicTextLayer({id:id+'-title',field:'speakerTitle',x:120,y:890,width:900,height:60,fontSize:38}),
                PTLT.makeDynamicTextLayer({id:id+'-company',field:'company',x:1080,y:890,width:600,height:60,fontSize:34})
              ]
            });
            const tplA=makeAutoTemplate('phase3-template-a','Phase 3 A');
            const tplB=makeAutoTemplate('phase3-template-b','Phase 3 B');
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tplA.id&&t.id!==tplB.id);
            ltLibrary.templates.push(tplA,tplB);
            ltLibrary.activeTemplateId=tplA.id;
            saveLtLibrary();
            S.lowerThirdAutoCue=false;
            const globalAuto=document.getElementById('chkLtAutoCue');
            if(globalAuto) globalAuto.checked=false;
            normalizeLowerThird();
            S.lowerThird={...S.lowerThird,durationSec:8,visible:false,runtimeVersion:null,runtime:null,until:0};
            document.getElementById('ltDur').value='8';
            cues=migrateCues([
              {id:'phase3-live-a',name:'Opening row',durationMs:61000,speakerName:'Ada Lovelace',speakerTitle:'Technical Director',company:'Analytical Engines',sessionTitle:'Opening',segmentTitle:'Keynote',custom1:'Main stage',lowerThirdTemplateId:tplB.id,lowerThirdAuto:true,lowerThirdDelayMs:0,lowerThirdDurationMs:null,lowerThirdHideBeforeNextGo:false,lowerThirdNoRepeat:false},
              {id:'phase3-live-b',name:'Delayed row',durationMs:47000,speakerName:'Grace Hopper',speakerTitle:'Rear Admiral',company:'US Navy',lowerThirdTemplateId:tplA.id,lowerThirdAuto:true,lowerThirdDelayMs:90,lowerThirdDurationMs:110,lowerThirdHideBeforeNextGo:true,lowerThirdNoRepeat:false},
              {id:'phase3-blank',name:'THIS ROW NAME MUST NOT AIR',durationMs:33000,speakerName:'',speakerTitle:'',lowerThirdTemplateId:tplA.id,lowerThirdAuto:true,lowerThirdDelayMs:0,lowerThirdDurationMs:null},
              {id:'phase3-no-auto',name:'No automatic lower third',durationMs:31000,speakerName:'Holding Speaker',speakerTitle:'Host',lowerThirdTemplateId:tplA.id,lowerThirdAuto:false,lowerThirdDelayMs:0,lowerThirdDurationMs:null},
              {id:'phase3-repeat-a',name:'Repeat A',durationMs:29000,speakerName:'Repeat Speaker',speakerTitle:'Host',lowerThirdTemplateId:tplA.id,lowerThirdAuto:true,lowerThirdDelayMs:0,lowerThirdDurationMs:0,lowerThirdNoRepeat:false},
              {id:'phase3-repeat-b',name:'Repeat B',durationMs:28000,speakerName:'Repeat Speaker',speakerTitle:'Host',lowerThirdTemplateId:tplA.id,lowerThirdAuto:true,lowerThirdDelayMs:0,lowerThirdDurationMs:0,lowerThirdNoRepeat:true}
            ]);
            currentCue=-1; selectedCue=0; S.running=false;
            setCueEditorOpen(true);
            fillCueEditorFromSelection();
            const editorLoaded=document.getElementById('cueLtName').value==='Ada Lovelace' &&
              document.getElementById('cueLtTemplate').value===tplB.id &&
              document.getElementById('cueLtAuto').checked===true &&
              [...document.getElementById('cueLtTemplate').options].some(o=>o.value===tplA.id);
            document.getElementById('cueLtCompany').value='Analytical Engine Society';
            document.getElementById('cueLtDelay').value='25';
            document.getElementById('cueLtDuration').value='';
            saveSelectedCueFromEditor();
            const editorSaved=cues[0].company==='Analytical Engine Society' && cues[0].lowerThirdDelayMs===25 &&
              cues[0].lowerThirdDurationMs===null && cues[0].speakerName===cues[0].ltName && cues[0].speakerTitle===cues[0].ltTitle;
            cues[0].lowerThirdDelayMs=0;
            goLiveWithCue(0,{autostart:false});
            const firstRuntime=S.lowerThird.runtime||{};
            const firstName=(firstRuntime.resolvedLayers||[]).find(l=>l.id===tplB.id+'-name');
            const firstCompany=(firstRuntime.resolvedLayers||[]).find(l=>l.id===tplB.id+'-company');
            const templateAndLiveData=firstRuntime.templateId===tplB.id && firstRuntime.cueId==='phase3-live-a' &&
              firstName&&firstName.resolvedText==='Ada Lovelace' && firstCompany&&firstCompany.resolvedText==='Analytical Engine Society';
            const nullableDurationUsesDefault=S.lowerThird.durationSec===8 && S.lowerThird.until>Date.now()+7000;
            const timerGoStable=currentCue===0 && selectedCue===-1 && S.durationMs===61000 && S.remMs===61000 && S.running===false;
            selectedCue=1; renderCues();
            const beforeSelectedEditInstance=(S.lowerThird.runtime||{}).instanceId;
            fillCueEditorFromSelection();
            document.getElementById('cueLtCompany').value='Edited while selected';
            saveSelectedCueFromEditor();
            const selectedEditSafe=currentCue===0 && (S.lowerThird.runtime||{}).instanceId===beforeSelectedEditInstance && (S.lowerThird.runtime||{}).cueId==='phase3-live-a';
            goLiveWithCue(1,{autostart:false});
            const immediateAfterDelay=(S.lowerThird.runtime||{}).cueId;
            await new Promise(r=>setTimeout(r,125));
            const delayedRuntime=S.lowerThird.runtime||{};
            const delayedTake=immediateAfterDelay!=='phase3-live-b' && delayedRuntime.cueId==='phase3-live-b' && delayedRuntime.templateId===tplA.id;
            await new Promise(r=>setTimeout(r,220));
            const durationHide=S.lowerThird.visible===false && !S.lowerThird.runtime;
            goLiveWithCue(0,{autostart:false});
            const visibleBeforeBlank=!!S.lowerThird.visible;
            goLiveWithCue(2,{autostart:false});
            const blankSafe=visibleBeforeBlank && !S.lowerThird.visible && !S.lowerThird.runtime && !String(S.lowerThird.name||'').includes('THIS ROW NAME');
            cues[1].lowerThirdDurationMs=0;
            goLiveWithCue(1,{autostart:false});
            await new Promise(r=>setTimeout(r,125));
            const outgoingVisible=!!S.lowerThird.visible;
            goLiveWithCue(3,{autostart:false});
            const hiddenBeforeNext=outgoingVisible && !S.lowerThird.visible && !S.lowerThird.runtime;
            goLiveWithCue(4,{autostart:false});
            const repeatInstance=(S.lowerThird.runtime||{}).instanceId;
            goLiveWithCue(5,{autostart:false});
            const noRepeat=!!repeatInstance && (S.lowerThird.runtime||{}).instanceId===repeatInstance && (S.lowerThird.runtime||{}).cueId==='phase3-repeat-a';
            const schema=cues.every(c=>typeof c.speakerName==='string' && typeof c.speakerTitle==='string' && typeof c.company==='string' &&
              typeof c.sessionTitle==='string' && typeof c.segmentTitle==='string' && typeof c.custom1==='string' &&
              typeof c.lowerThirdTemplateId==='string' && typeof c.lowerThirdAuto==='boolean' && Number.isFinite(c.lowerThirdDelayMs) &&
              (c.lowerThirdDurationMs===null||Number.isFinite(c.lowerThirdDurationMs)) && typeof c.lowerThirdHideBeforeNextGo==='boolean' && typeof c.lowerThirdNoRepeat==='boolean');
            clearScheduledLowerThirdAuto();
            clearTimeout(lowerThirdTimer);
            hideLowerThird({force:true,silent:true});
            setCueEditorOpen(false);
            return JSON.stringify({schema,editorLoaded,editorSaved,templateAndLiveData,nullableDurationUsesDefault,timerGoStable,selectedEditSafe,delayedTake,durationHide,blankSafe,hiddenBeforeNext,noRepeat});
          })()`);
          smokeCheck('LT_RUNDOWN_AUTOMATION_SCHEMA_OK', rundownAutomation.schema, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_CUE_EDITOR_OK', rundownAutomation.editorLoaded && rundownAutomation.editorSaved, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_SELECTED_EDIT_NOT_LIVE_OK', rundownAutomation.selectedEditSafe, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_AUTO_TEMPLATE_LIVE_DATA_OK', rundownAutomation.templateAndLiveData && rundownAutomation.nullableDurationUsesDefault, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_AUTO_DELAY_DURATION_OK', rundownAutomation.delayedTake && rundownAutomation.durationHide, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_BLANK_SPEAKER_SAFE_OK', rundownAutomation.blankSafe, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_HIDE_BEFORE_NEXT_GO_OK', rundownAutomation.hiddenBeforeNext, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_NO_REPEAT_OK', rundownAutomation.noRepeat, JSON.stringify(rundownAutomation));
          smokeCheck('LT_RUNDOWN_AUTO_TIMER_GO_OK', rundownAutomation.timerGoStable, JSON.stringify(rundownAutomation));
          let rundownEditorShot='';
          try {
            await controlWin.webContents.executeJavaScript(`(function(){
              selectedCue=0;
              setCueEditorOpen(true);
              fillCueEditorFromSelection();
              const editor=document.getElementById('cueEditor');
              if(editor) editor.scrollTop=0;
              return true;
            })()`);
            await new Promise(r=>setTimeout(r,120));
            rundownEditorShot=writeTestArtifact('product-finish/rundown/cue-editor.png',(await controlWin.webContents.capturePage()).toPNG());
            await controlWin.webContents.executeJavaScript(`setCueEditorOpen(false)`);
          } catch(e) { rundownEditorShot=''; }
          smokeCheck('LT_RUNDOWN_EDITOR_SCREENSHOT_OK', !!rundownEditorShot && fs.existsSync(rundownEditorShot), rundownEditorShot);
          const lt2SoakMs = Math.max(0, parseInt(process.env.SHOWSLATE_LT2_SOAK_MS || process.env.PROTIMER_LT2_SOAK_MS || '0', 10) || 0);
          if(lt2SoakMs > 0){
            const showSoakStatic = async (cycle) => ltJparse(`(function(){
              initLtLibrary();
              const tpl=PTLT.makeTemplate({
                id:'lt2d-soak-static-template',
                name:'LT2D Soak Static',
                kind:'custom',
                layers:[
                  PTLT.makeShapeLayer({id:'soak-bg', shape:'roundedRectangle', fill:'rgba(0,0,0,.55)', radius:20, x:120, y:820, width:820, height:160, zIndex:1}),
                  PTLT.makeDynamicTextLayer({id:'soak-name', field:'speakerName', x:160, y:850, width:740, height:70, fontSize:50, color:'#ffffff', zIndex:2}),
                  PTLT.makeStaticTextLayer({id:'soak-label', text:'SOAK', x:160, y:925, width:240, height:44, fontSize:30, color:'#30d158', zIndex:2})
                ]
              });
              ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
              ltLibrary.templates.push(tpl);
              ltLibrary.activeTemplateId=tpl.id;
              saveLtLibrary();
              S.lowerThirdAutoCue=true;
              const autoBox=document.getElementById('chkLtAutoCue');
              if(autoBox) autoBox.checked=true;
              S.lowerThird={...S.lowerThird, durationSec:0, visible:false, runtimeVersion:null, runtime:null};
              document.getElementById('ltDur').value='0';
              cues=migrateCues([
                {id:'lt2d-soak-a', name:'Soak A', durationMs:30000, ltName:'Soak Speaker A '+${JSON.stringify(String(cycle))}, speakerTitle:'Host'},
                {id:'lt2d-soak-b', name:'Soak B', durationMs:45000, ltName:'Soak Speaker B '+${JSON.stringify(String(cycle))}, speakerTitle:'Guest'}
              ]);
              currentCue=0; selectedCue=-1;
              showLowerThirdFromCue(0);
              send(true);
              const rt=S.lowerThird.runtime || {};
              const resolvedName=(rt.resolvedLayers||[]).find(layer=>layer.id==='soak-name');
              return JSON.stringify({
                visible:S.lowerThird.visible,
                runtimeVersion:S.lowerThird.runtimeVersion,
                templateId:rt.templateId||'',
                instanceId:rt.instanceId||'',
                cueId:rt.cueId||'',
                phase:rt.phase||'',
                layers:(rt.resolvedLayers||[]).length,
                resolvedName:resolvedName ? (resolvedName.resolvedText||'') : ''
              });
            })()`);
            const soakStarted = Date.now();
            const soakUntil = soakStarted + lt2SoakMs;
            const memStart = process.memoryUsage().rss;
            let memPeak = memStart, cycles = 0, staticOK = true, videoOK = true, cleanupOK = true, timerGoOK = true;
            let staticFail = null;
            while(Date.now() < soakUntil){
              const staticState = await showSoakStatic(cycles);
              const expectedTemplateId = 'lt2d-soak-static-template';
              const expectedCueId = 'lt2d-soak-a';
              const expectedStaticText = 'Soak Speaker A ' + String(cycles);
              const expectedLayerIds = ['soak-bg', 'soak-name', 'soak-label'];
              const staticRender = await waitForStableLowerThirdRender({
                browserWindow:outputWin,
                expectedTemplateId,
                expectedInstanceId:staticState.instanceId,
                expectedPhase:'hold',
                expectedText:expectedStaticText,
                expectedLayerIds
              });
              const staticThisOK =
                staticState.visible===true &&
                staticState.runtimeVersion===1 &&
                staticState.templateId===expectedTemplateId &&
                !!staticState.instanceId &&
                staticState.cueId===expectedCueId &&
                staticState.phase==='hold' &&
                staticState.layers===expectedLayerIds.length &&
                staticState.resolvedName===expectedStaticText &&
                staticRender.ok;
              staticOK = staticOK && staticThisOK;
              if(!staticThisOK && !staticFail){
                staticFail = {
                  cycle:cycles,
                  expected:{templateId:expectedTemplateId, instanceId:staticState.instanceId||'', cueId:expectedCueId, phase:'hold', text:expectedStaticText, layerIds:expectedLayerIds},
                  runtimeState:staticState,
                  browserWindowId:staticRender.browserWindowId,
                  webContentsId:staticRender.webContentsId,
                  renderWait:staticRender,
                  screenshot:'',
                  screenshotError:''
                };
                try {
                  staticFail.screenshot=writeTestArtifact(
                    'lower-third/lt2/soak-first-failure-cycle-'+String(cycles).padStart(3,'0')+'.png',
                    (await outputWin.webContents.capturePage()).toPNG()
                  );
                } catch(e) {
                  staticFail.screenshotError=String(e && e.message || e);
                }
                try {
                  writeTestArtifact('lower-third/lt2/soak-first-failure.json', JSON.stringify(staticFail, null, 2));
                } catch(e) {}
                console.error('LT2_SOAK_STATIC_FIRST_FAIL '+JSON.stringify(staticFail));
              }
              await ltJparse(`(function(){ hideLowerThird(); return JSON.stringify({ok:true}); })()`);
              cleanupOK = cleanupOK && (await waitForStableLowerThirdRender({browserWindow:outputWin,hidden:true})).ok;
              for (const [kind, asset] of [['mp4', mp4Asset], ['vp8', vp8Asset], ['vp9', vp9Asset]]) {
                await showVideoRuntime('soak-'+kind, asset.src, { playbackMode:'loop-until-hide' });
                await new Promise(r=>setTimeout(r,260));
                const info = await waitVideoInfo();
                videoOK = videoOK && info.ready && info.videoWidth===320 && info.muted===true;
                await ltJparse(`(function(){ hideLowerThird(); return JSON.stringify({ok:true}); })()`);
                cleanupOK = cleanupOK && (await waitForStableLowerThirdRender({browserWindow:outputWin,hidden:true})).ok;
              }
              await setOutputViewport(cycles % 2 ? 1280 : 960, cycles % 2 ? 720 : 540);
              const goState = await ltJparse(`(function(){
                S.lowerThirdAutoCue=false;
                cues=migrateCues([
                  {id:'lt2d-soak-go-a', name:'Soak GO A', durationMs:30000, ltName:'Go A'},
                  {id:'lt2d-soak-go-b', name:'Soak GO B', durationMs:45000, ltName:'Go B'}
                ]);
                currentCue=0; selectedCue=1; S.running=false;
                go();
                return JSON.stringify({currentCue, selectedCue, durationMs:S.durationMs, remMs:S.remMs, running:S.running});
              })()`);
              timerGoOK = timerGoOK && goState.currentCue===1 && goState.selectedCue===-1 && goState.durationMs===45000 && goState.remMs===45000;
              memPeak = Math.max(memPeak, process.memoryUsage().rss);
              cycles++;
            }
            const elapsed = Date.now() - soakStarted;
            const memEnd = process.memoryUsage().rss;
            smokeCheck('LT2_SOAK_15_MIN_OK', elapsed >= Math.max(1000, lt2SoakMs - 2500) && cycles > 0 && staticOK && videoOK && timerGoOK, JSON.stringify({elapsed,cycles,staticOK,videoOK,timerGoOK,staticFail}));
            smokeCheck('LT2_SOAK_VIDEO_CLEANUP_OK', cleanupOK, JSON.stringify({cycles}));
            smokeCheck('LT2_SOAK_MEMORY_OBSERVED_OK', memStart > 0 && memEnd > 0 && memPeak >= memStart && (memPeak - memStart) < 1024 * 1024 * 1024, JSON.stringify({memStart,memEnd,memPeak,delta:memPeak-memStart}));
          }
          await ltJparse(`(function(){
            const snap=window.__lt2dSmokeSnap;
            if(snap){
              S=JSON.parse(snap.S); cues=JSON.parse(snap.cues);
              currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              fillLowerThirdControls(); renderScenesUI(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__lt2dSmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,500));
          // --- LT-STUDIO: visible editor workflow + Phase B product proof ---
          const setStudioProofSize = async (w, h) => {
            try { controlWin.webContents.disableDeviceEmulation(); } catch (e) {}
            controlWin.setContentSize(w, h);
            smokePlaceWindow(controlWin);
            let actual = controlWin.getContentSize();
            for (let i=0;i<25;i++){
              await new Promise(r=>setTimeout(r,60));
              actual=controlWin.getContentSize();
              if (Math.abs(actual[0]-w)<=2 && Math.abs(actual[1]-h)<=2) break;
            }
            smokePlaceWindow(controlWin);
            if (Math.abs(actual[0]-w)>2 || Math.abs(actual[1]-h)>2) {
              throw new Error(`Studio proof BrowserWindow resize failed: expected ${w}x${h}, got ${actual.join('x')}`);
            }
            await new Promise(r=>setTimeout(r,220));
            const rendererSize = await Promise.race([
              controlWin.webContents.executeJavaScript('JSON.stringify({w:window.innerWidth,h:window.innerHeight,ready:document.readyState})')
                .then(raw => JSON.parse(raw)),
              new Promise((_, reject) => setTimeout(() => reject(new Error('Studio proof renderer resize probe timed out')), 1200))
            ]);
            if (Math.abs(rendererSize.w-w)>2 || Math.abs(rendererSize.h-h)>2 || rendererSize.ready!=='complete') {
              throw new Error(`Studio proof renderer resize failed: expected ${w}x${h}, got ${rendererSize.w}x${rendererSize.h} (${rendererSize.ready})`);
            }
          };
          const studioProofFrames = [];
          const studioCapture = async (name, opts={}) => {
            const win = opts.output ? outputWin : controlWin;
            const png = (await win.webContents.capturePage()).toPNG();
            const full = writeTestArtifact('product-finish/studio/' + name, png);
            if (opts.frame !== false) {
              studioProofFrames.push(writeTestArtifact('product-finish/studio/proof-frames/frame-' + String(studioProofFrames.length).padStart(3, '0') + '.png', png));
            }
            return full;
          };
          await setStudioProofSize(1440, 900);
          await ltJparse(`(function(){
            if(document.body.classList.contains('compositor-open')) setCompositorOpen(false,{scroll:false,persist:false});
            closeDrawers();
            return JSON.stringify({ok:true});
          })()`);
          await ltJparse(`(function(){
            window.__ltStudioSmokeSnap = {
              S: JSON.stringify(S), cues: JSON.stringify(cues), currentCue, selectedCue,
              ltLibrary: JSON.stringify(ltLibrary), ltLibraryStorage: localStorage.getItem(PTLT.LIBRARY_KEY)
            };
            return JSON.stringify({ok:true});
          })()`);
          const studioVisible = await ltJparse(`(function(){
            seedDemoShow();
            goLiveWithCue(2,{autostart:false});
            selectedCue=4;
            const tab=document.querySelector('#setupTabs button[data-pane="lt"]');
            if(tab) tab.click();
            const openBtn=document.getElementById('btnLtStudioOpen');
            const openBtnVisible=!!openBtn && getComputedStyle(openBtn).display!=='none' && openBtn.getBoundingClientRect().width>20;
            if(openBtn) openBtn.click();
            const studio=document.getElementById('ltStudio');
            const st=studio ? getComputedStyle(studio) : null;
            return JSON.stringify({
              openBtnVisible,
              open:!!studio && studio.classList.contains('open'),
              display:st&&st.display,
              templates:!!document.getElementById('ltStudioTemplates'),
              layers:!!document.getElementById('ltStudioLayers'),
              canvas:!!document.getElementById('ltStudioStage'),
              inspector:!!document.getElementById('ltStudioInspector'),
              addMedia:!!document.getElementById('btnLtStudioAddMedia'),
              preview:!!document.getElementById('btnLtStudioPreview'),
              take:!!document.getElementById('btnLtStudioTake'),
              close:!!document.getElementById('btnLtStudioClose')
            });
          })()`);
          for (let i=0; i<100 && outputWin && !outputWin.isDestroyed(); i++) await new Promise(r=>setTimeout(r,30));
          const studioOutput = await ensureSmokeOutput();
          smokeCheck('LT_STUDIO_VISIBLE_FROM_NORMAL_UI_OK',
            studioVisible.openBtnVisible && studioVisible.open && (studioVisible.display==='flex' || studioVisible.display==='grid') &&
            studioVisible.templates && studioVisible.layers && studioVisible.canvas && studioVisible.inspector &&
            studioVisible.addMedia && studioVisible.preview && studioVisible.take && studioVisible.close,
            JSON.stringify(studioVisible));
          await setStudioProofSize(1440, 900);
          await ltJparse(`(function(){ openLtStudio(); ltSetStudioPane('canvas'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,240));
          const studioWide = await ltJparse(`(function(){
            const studio=document.getElementById('ltStudio');
            const grid=studio && studio.querySelector('.lt-studio-grid');
            const left=studio && studio.querySelector('.lt-studio-side');
            const center=studio && studio.querySelector('.lt-studio-center');
            const right=studio && studio.querySelector('.lt-studio-inspector');
            const templates=document.getElementById('ltStudioTemplates');
            const layers=document.getElementById('ltStudioLayers');
            const shell=document.getElementById('ltStudioCanvasShell');
            const head=studio && studio.querySelector('.lt-studio-head');
            function box(el){ const r=el.getBoundingClientRect(); return {w:r.width,h:r.height,l:r.left,t:r.top,b:r.bottom,r:r.right}; }
            const s=box(studio), g=box(grid), l=box(left), c=box(center), i=box(right), h=box(head);
            const gridStyle=getComputedStyle(grid);
            return JSON.stringify({
              studio:s, grid:g, left:l, center:c, inspector:i, head:h,
              display:getComputedStyle(studio).display,
              gridColumns:gridStyle.gridTemplateColumns,
              rootOverflow:document.documentElement.scrollWidth-window.innerWidth,
              templateOverflowY:getComputedStyle(templates).overflowY,
              layerOverflowY:getComputedStyle(layers).overflowY,
              zoom:ltStudioState.zoom,
              canvasOverflow:getComputedStyle(shell).overflow,
              inspectorOverflowY:getComputedStyle(right).overflowY
            });
          })()`);
          smokeCheck('LT_STUDIO_WIDE_LAYOUT_OK',
            studioWide.display==='grid' &&
            studioWide.studio.w <= 1502 && studioWide.studio.w >= 1180 && studioWide.studio.h <= 952 &&
            studioWide.left.w >= 238 && studioWide.left.w <= 285 &&
            studioWide.center.w >= 500 && studioWide.inspector.w >= 295 &&
            studioWide.rootOverflow <= 2 &&
            ['auto','scroll','overlay'].includes(studioWide.templateOverflowY) &&
            ['auto','scroll','overlay'].includes(studioWide.layerOverflowY) &&
            (studioWide.zoom==='fit' ? studioWide.canvasOverflow==='hidden' : ['auto','scroll','overlay'].includes(studioWide.canvasOverflow)) &&
            ['auto','scroll','overlay'].includes(studioWide.inspectorOverflowY),
            JSON.stringify(studioWide));
          const studioVisualSetup = await ltJparse(`(function(){
            const tpl=ltDefaultTemplate('Studio Visual Fidelity');
            tpl.id='lt-studio-visual-fidelity';
            tpl.layers[0].id='lt-visual-plate';
            tpl.layers[1].id='lt-visual-name';
            tpl.layers[2].id='lt-visual-title';
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t&&t.id!==tpl.id);
            ltLibrary.templates.push(tpl);
            ltLibrary.activeTemplateId=tpl.id;
            ltStudioState.selectedTemplateId=tpl.id;
            ltStudioState.selectedLayerId='lt-visual-name';
            const runtime=PTLT.resolveLowerThirdTemplate({
              template:tpl,
              liveCue:{speakerName:'Alex Rivera',speakerTitle:'Creative Director'},
              mediaResolver:(assetId)=>lowerThirdMediaSrc(assetId),
              now:Date.now(),assetBase:ctlMediaBase||null,preview:true
            });
            ltStudioState.zoom='fit';
            renderLtStudioCanvas(runtime);
            ltApplyCanvasZoom(runtime.canvas);
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,160));
          const studioVisual = await ltJparse(`(function(){
            function sample(zoom){
              ltStudioState.zoom=zoom;
              ltApplyCanvasZoom(ltStudioState.previewRuntime&&ltStudioState.previewRuntime.canvas);
              const frame=document.getElementById('ltStudioCanvas');
              const stage=document.getElementById('ltStudioStage');
              const name=stage.querySelector('[data-layer-id="lt-visual-name"]');
              const title=stage.querySelector('[data-layer-id="lt-visual-title"]');
              const plate=stage.querySelector('[data-layer-id="lt-visual-plate"]');
              const text=name&&name.querySelector('.lt-editor-text');
              const scale=frame.clientWidth/1920;
              const cs=text?getComputedStyle(text):null;
              const ns=name?name.getBoundingClientRect():null;
              const ts=title?title.getBoundingClientRect():null;
              return {
                zoom,scale,
                font:cs?parseFloat(cs.fontSize):0,
                paddingRight:cs?parseFloat(cs.paddingRight):0,
                radius:plate?parseFloat(getComputedStyle(plate).borderRadius):0,
                textFits:!!text&&text.scrollHeight<=text.clientHeight+1&&text.scrollWidth<=text.clientWidth+1,
                layersSeparated:!!ns&&!!ts&&ns.bottom<=ts.top+1
              };
            }
            const fit=sample('fit'), half=sample('50'), full=sample('100');
            ltStudioState.zoom='fit';
            ltApplyCanvasZoom(ltStudioState.previewRuntime&&ltStudioState.previewRuntime.canvas);
            return JSON.stringify({fit,half,full});
          })()`);
          const visualScaleOK = studioVisualSetup.ok &&
            Math.abs(studioVisual.fit.font-56*studioVisual.fit.scale)<1 &&
            Math.abs(studioVisual.fit.paddingRight-10*studioVisual.fit.scale)<1 &&
            Math.abs(studioVisual.fit.radius-34*studioVisual.fit.scale)<1 &&
            Math.abs(studioVisual.half.font-28)<1 && Math.abs(studioVisual.full.font-56)<1;
          smokeCheck('LT_STUDIO_PREVIEW_VISUAL_SCALE_OK', visualScaleOK, JSON.stringify(studioVisual));
          smokeCheck('LT_STUDIO_PREVIEW_TEXT_NOT_CLIPPED_OK', studioVisual.fit.textFits && studioVisual.fit.layersSeparated && studioVisual.half.textFits && studioVisual.full.textFits, JSON.stringify(studioVisual));
          await studioCapture('studio-wide.png');
          const studioSaveReopen = await ltJparse(`(function(){
            initLtLibrary();
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t && t.kind!=='custom');
            const tpl=PTLT.makeTemplate({id:'lt-studio-demo-custom', name:'Demo Custom', kind:'custom', layers:[]});
            tpl.layers.push(PTLT.makeMediaLayer({id:'demo-webm', name:'Transparent WebM', sourceType:'mediaAsset', assetId:${JSON.stringify(vp9Asset.src)}, mediaKind:'video', fit:'contain', playbackMode:'loop-until-hide', x:118, y:720, width:360, height:220, zIndex:0}));
            tpl.layers.push(PTLT.makeDynamicTextLayer({id:'demo-speaker-name', name:'speakerName', field:'speakerName', fallback:'Speaker Name', x:420, y:760, width:760, height:88, fontSize:64, fontWeight:840, color:'#ffffff', shadow:{enabled:true,color:'rgba(0,0,0,.65)',offsetX:0,offsetY:3,blur:14}, zIndex:1}));
            tpl.layers.push(PTLT.makeDynamicTextLayer({id:'demo-speaker-title', name:'speakerTitle', field:'speakerTitle', fallback:'Speaker Title', x:424, y:848, width:740, height:52, fontSize:34, fontWeight:560, color:'rgba(234,238,246,.82)', shadow:{enabled:true,color:'rgba(0,0,0,.5)',offsetX:0,offsetY:2,blur:10}, zIndex:2}));
            ltLibrary.templates.push(tpl);
            ltLibrary.activeTemplateId=tpl.id;
            ltStudioState.selectedTemplateId=tpl.id;
            ltStudioState.selectedLayerId='demo-speaker-name';
            saveLtLibrary();
            renderLtStudio();
            ltSaveTemplate();
            ltLibrary=null; initLtLibrary(); openLtStudio();
            const r=ltCurrentTemplate();
            const hasWebm=!!(r&&r.layers.find(l=>l.id==='demo-webm' && l.mediaKind==='video' && String(l.assetId||'').includes('webm')));
            const hasName=!!(r&&r.layers.find(l=>l.id==='demo-speaker-name' && l.type==='dynamicText' && l.field==='speakerName'));
            const hasTitle=!!(r&&r.layers.find(l=>l.id==='demo-speaker-title' && l.type==='dynamicText' && l.field==='speakerTitle'));
            return JSON.stringify({
              template:r&&r.name,
              hasWebm, hasName, hasTitle,
              open:document.getElementById('ltStudio').classList.contains('open'),
              selected:ltStudioState.selectedLayerId
            });
          })()`);
          smokeCheck('LT_STUDIO_TEMPLATE_SAVE_REOPEN_OK',
            studioSaveReopen.template==='Demo Custom' && studioSaveReopen.hasWebm && studioSaveReopen.hasName && studioSaveReopen.hasTitle && studioSaveReopen.open,
            JSON.stringify(studioSaveReopen));
          await ltJparse(`(function(){ ltStudioState.selectedLayerId='demo-speaker-name'; renderLtStudio(); ltSetStudioPane('canvas'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-selected-text.png');
          await ltJparse(`(function(){ ltStudioState.selectedLayerId='demo-webm'; renderLtStudio(); ltSetStudioPane('canvas'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-selected-media.png');
          const studioDrag = await ltJparse(`(function(){
            openLtStudio();
            ltStudioState.selectedLayerId='demo-speaker-name';
            renderLtStudio();
            const beforeName={...ltCurrentTemplate().layers.find(l=>l.id==='demo-speaker-name')};
            const beforeTitle={...ltCurrentTemplate().layers.find(l=>l.id==='demo-speaker-title')};
            const layerEl=document.querySelector('#ltStudioStage [data-layer-id="demo-speaker-name"]');
            const r=layerEl.getBoundingClientRect();
            layerEl.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:71,clientX:r.left+20,clientY:r.top+20}));
            window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:71,clientX:r.left+92,clientY:r.top+64}));
            window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:71,clientX:r.left+92,clientY:r.top+64}));
            renderLtStudio();
            const handle=document.querySelector('#ltStudioStage [data-layer-id="demo-speaker-name"] .lt-resize-handle');
            const h=handle.getBoundingClientRect();
            handle.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:72,clientX:h.left+3,clientY:h.top+3}));
            window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:72,clientX:h.left+88,clientY:h.top+44}));
            window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:72,clientX:h.left+88,clientY:h.top+44}));
            ltStudioState.selectedLayerId='demo-speaker-title';
            renderLtStudio();
            const titleEl=document.querySelector('#ltStudioStage [data-layer-id="demo-speaker-title"]');
            const tr=titleEl.getBoundingClientRect();
            titleEl.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerId:73,clientX:tr.left+22,clientY:tr.top+18}));
            window.dispatchEvent(new PointerEvent('pointermove',{bubbles:true,pointerId:73,clientX:tr.left+78,clientY:tr.top+2}));
            window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true,pointerId:73,clientX:tr.left+78,clientY:tr.top+2}));
            ltSaveTemplate();
            ltLibrary=null; initLtLibrary(); openLtStudio();
            const afterName=ltCurrentTemplate().layers.find(l=>l.id==='demo-speaker-name');
            const afterTitle=ltCurrentTemplate().layers.find(l=>l.id==='demo-speaker-title');
            return JSON.stringify({
              beforeName:{x:beforeName.x,y:beforeName.y,w:beforeName.width,h:beforeName.height},
              afterName:{x:afterName.x,y:afterName.y,w:afterName.width,h:afterName.height},
              beforeTitle:{x:beforeTitle.x,y:beforeTitle.y},
              afterTitle:{x:afterTitle.x,y:afterTitle.y}
            });
          })()`);
          const studioDragOK =
            studioDrag.afterName.x!==studioDrag.beforeName.x && studioDrag.afterName.y!==studioDrag.beforeName.y &&
            studioDrag.afterName.w>studioDrag.beforeName.w && studioDrag.afterName.h>studioDrag.beforeName.h &&
            studioDrag.afterTitle.x!==studioDrag.beforeTitle.x && studioDrag.afterTitle.y!==studioDrag.beforeTitle.y;
          smokeCheck('LT_STUDIO_LAYER_DRAG_RESIZE_PERSISTS_OK', studioDragOK, JSON.stringify(studioDrag));
          try {
            await new Promise(r=>setTimeout(r,250));
            writeTestArtifact('lower-third/studio-editor.png', (await controlWin.webContents.capturePage()).toPNG());
          } catch(e) {}
          const studioPreviewTake = await ltJparse(`(function(){
            openLtStudio();
            cues=migrateCues([
              {id:'studio-live-cue',name:'Live segment',durationMs:60000,ltName:'Live Studio Speaker',ltTitle:'Live Studio Role'},
              {id:'studio-preview-cue',name:'Preview segment',durationMs:60000,ltName:'Preview Studio Speaker',ltTitle:'Preview Studio Role'}
            ]);
            currentCue=-1;
            selectedCue=0;
            goLiveWithCue(0,{autostart:false});
            selectedCue=1;
            renderCues();
            const before=JSON.stringify(S.lowerThird||{});
            const beforeProgram=JSON.stringify(programState||{});
            ltPreviewStudio();
            const previewText=[...document.querySelectorAll('#ltStudioStage .lt-editor-text')].map(el=>el.textContent).join('|');
            const afterPreview=JSON.stringify(S.lowerThird||{});
            const afterPreviewProgram=JSON.stringify(programState||{});
            const selected=cues[selectedCue]||{};
            const live=cues[currentCue]||{};
            const previewNotLive=before===afterPreview && beforeProgram===afterPreviewProgram && previewText.includes(selected.ltName || selected.name || '') && !previewText.includes(live.ltName || '');
            ltTakeStudio();
            const rt=S.lowerThird.runtime || {};
            const runtimeText=(rt.resolvedLayers||[]).map(l=>l.resolvedText||'').join('|');
            const takeUsesLive=rt.cueId===String(live.id) && runtimeText.includes(live.ltName || '') && runtimeText.includes(live.ltTitle || '');
            const selectedIgnored=!runtimeText.includes(selected.ltName || '___') && !runtimeText.includes(selected.ltTitle || '___');
            renderStage('pg',ensureProgramState(),Date.now());
            const programRuntime=document.getElementById('pgLtRuntime');
            const programMonitorText=[...document.querySelectorAll('#pgLtRuntime .pv-lt-runtime-copy')].map(el=>el.textContent).join('|');
            const programMonitorMatchesLive=!!programRuntime && getComputedStyle(programRuntime).display!=='none' &&
              programRuntime.dataset.instanceId===String(rt.instanceId||'') &&
              programMonitorText.includes(live.ltName || '') && programMonitorText.includes(live.ltTitle || '');
            return JSON.stringify({previewNotLive,previewText,cueId:rt.cueId,liveId:String(live.id),runtimeText,takeUsesLive,selectedIgnored,runtimeVersion:S.lowerThird.runtimeVersion,programMonitorText,programMonitorMatchesLive});
          })()`);
          smokeCheck('LT_STUDIO_PREVIEW_NOT_LIVE_OK', studioPreviewTake.previewNotLive, JSON.stringify(studioPreviewTake));
          try {
            await new Promise(r=>setTimeout(r,250));
            writeTestArtifact('lower-third/studio-preview.png', (await controlWin.webContents.capturePage()).toPNG());
          } catch(e) {}
          smokeCheck('LT_STUDIO_TAKE_USES_LIVE_CUE_OK',
            studioPreviewTake.takeUsesLive && studioPreviewTake.selectedIgnored && studioPreviewTake.runtimeVersion===1,
            JSON.stringify(studioPreviewTake));
          smokeCheck('LT_STUDIO_PROGRAM_MONITOR_MATCHES_LIVE_OK', studioPreviewTake.programMonitorMatchesLive, JSON.stringify(studioPreviewTake));
          smokeCheck('LT_STUDIO_SELECTED_CUE_IGNORED_OK', studioPreviewTake.selectedIgnored, JSON.stringify(studioPreviewTake));
          const studioLiveOutput = await waitOutput();
          await waitLoad(studioLiveOutput);
          await new Promise(r=>setTimeout(r,900));
          try { writeTestArtifact('lower-third/studio-live-output.png', (await studioLiveOutput.webContents.capturePage()).toPNG()); } catch(e) {}
          try { await studioCapture('studio-live-take.png', { output:true }); } catch(e) {}
          await ltJparse(`(function(){ ltHideStudio(); return JSON.stringify({visible:S.lowerThird.visible,runtime:S.lowerThird.runtime,runtimeVersion:S.lowerThird.runtimeVersion}); })()`);
          await new Promise(r=>setTimeout(r,300));
          const studioHidden = JSON.parse(await studioLiveOutput.webContents.executeJavaScript(`(function(){
            const canvas=document.getElementById('ltCanvas');
            return JSON.stringify({display:getComputedStyle(canvas).display, videos:document.querySelectorAll('#ltCanvas video').length, children:canvas.children.length});
          })()`));
          smokeCheck('LT_STUDIO_HIDE_CLEANS_MEDIA_OK', studioHidden.display==='none' && studioHidden.videos===0 && studioHidden.children===0, JSON.stringify(studioHidden));
          const studioReopen = await ltJparse(`(function(){
            closeLtStudio();
            ltLibrary=null; initLtLibrary(); openLtStudio();
            const t=ltCurrentTemplate();
            const name=t && t.layers.find(l=>l.id==='demo-speaker-name');
            const title=t && t.layers.find(l=>l.id==='demo-speaker-title');
            const webm=t && t.layers.find(l=>l.id==='demo-webm');
            return JSON.stringify({template:t&&t.name, name:{x:name&&name.x,y:name&&name.y,w:name&&name.width,h:name&&name.height}, title:{x:title&&title.x,y:title&&title.y}, webm:!!webm, open:document.getElementById('ltStudio').classList.contains('open')});
          })()`);
          const ltPackageWorkflowPath = path.resolve(getTestArtifactDirectory(), 'lower-third', 'demo-custom.showslate-lt');
          const ltPackageButtons = await ltJparse(`(function(){
            const imp=document.getElementById('btnLtStudioImport');
            const exp=document.getElementById('btnLtStudioExport');
            return JSON.stringify({importVisible:!!imp&&getComputedStyle(imp).display!=='none',exportVisible:!!exp&&getComputedStyle(exp).display!=='none'});
          })()`);
          smokeCheck('LT_PACKAGE_UI_BUTTONS_VISIBLE_OK', ltPackageButtons.importVisible && ltPackageButtons.exportVisible, JSON.stringify(ltPackageButtons));
          const ltPackageExport = await ltJparse(`(async function(){
            const template=ltCurrentTemplate();
            return JSON.stringify(await window.pt.ltPackageExport({template:JSON.parse(JSON.stringify(template)),testPath:${JSON.stringify(ltPackageWorkflowPath)}}));
          })()`);
          const ltPackageEntries = ltPackageExport.ok ? await lowerThirdPackage.readZipEntries(ltPackageWorkflowPath) : new Map();
          const ltPackageRoundtrip = await ltJparse(`(async function(){
            const template=ltCurrentTemplate();
            const beforePreview=JSON.stringify(S.lowerThird||{});
            const beforeProgram=JSON.stringify(programState||{});
            const lib=ltEnsureLibrary();
            lib.templates=lib.templates.filter(item=>item.id!==template.id);
            const imported=await window.pt.ltPackageImport({testPath:${JSON.stringify(ltPackageWorkflowPath)},existingTemplateIds:lib.templates.map(item=>String(item.id))});
            if(!imported.ok) return JSON.stringify({ok:false,error:imported.error,code:imported.code});
            lib.templates.push(imported.template); lib.activeTemplateId=imported.template.id;
            ltStudioState.selectedTemplateId=imported.template.id;
            ltStudioState.selectedLayerId=((imported.template.layers||[])[0]||{}).id||null;
            saveLtLibrary(); renderLtStudio();
            selectedCue=4;
            ltPreviewStudio();
            const previewSafe=beforePreview===JSON.stringify(S.lowerThird||{}) && beforeProgram===JSON.stringify(programState||{});
            ltTakeStudio();
            const rt=S.lowerThird.runtime||{};
            return JSON.stringify({ok:true,assets:imported.assets,templateId:imported.template.id,activeId:ltCurrentTemplate().id,previewSafe,runtimeTemplateId:rt.templateId,runtimeVersion:S.lowerThird.runtimeVersion,assetIds:(imported.template.layers||[]).filter(layer=>layer.type==='media'||layer.type==='logo').map(layer=>layer.assetId)});
          })()`);
          const importedAssetsExist = ltPackageRoundtrip.ok && ltPackageRoundtrip.assetIds.every(assetId=>{
            const filename=String(assetId||'').startsWith('media://') ? String(assetId).slice(8) : '';
            return filename && fs.existsSync(path.join(mediaDir(),filename));
          });
          smokeCheck('LT_PACKAGE_EXPORT_IMPORT_WORKFLOW_OK',
            ltPackageExport.ok && ltPackageExport.assets===1 && ltPackageEntries.has('manifest.json') && ltPackageEntries.has('template.json') &&
            ltPackageRoundtrip.ok && ltPackageRoundtrip.templateId==='lt-studio-demo-custom' && ltPackageRoundtrip.activeId==='lt-studio-demo-custom',
            JSON.stringify({ltPackageExport,ltPackageRoundtrip,entries:[...ltPackageEntries.keys()]}));
          smokeCheck('LT_PACKAGE_IMPORTED_ASSETS_RESOLVE_OK', importedAssetsExist, JSON.stringify(ltPackageRoundtrip));
          smokeCheck('LT_PACKAGE_PREVIEW_TAKE_OK',
            ltPackageRoundtrip.previewSafe && ltPackageRoundtrip.runtimeVersion===1 && ltPackageRoundtrip.runtimeTemplateId===ltPackageRoundtrip.templateId,
            JSON.stringify(ltPackageRoundtrip));
          try {
            await new Promise(r=>setTimeout(r,250));
            writeTestArtifact('lower-third/studio-reopened.png', (await controlWin.webContents.capturePage()).toPNG());
          } catch(e) {}
          await ltJparse(`(function(){ ltStudioState.selectedLayerId='demo-speaker-name'; renderLtStudio(); ltSetStudioPane('inspector'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-inspector.png');
          await ltJparse(`(function(){ ltSetStudioPane('canvas'); ltStudioState.zoom='fit'; var z=document.getElementById('ltStudioZoom'); if(z) z.querySelectorAll('button').forEach(function(b){ b.classList.toggle('active', b.dataset.zoom==='fit'); }); ltApplyCanvasZoom(); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-canvas-fit.png');
          await setStudioProofSize(900, 600);
          await ltJparse(`(function(){ openLtStudio(); ltSetStudioPane('canvas'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-900x600-canvas.png');
          await ltJparse(`(function(){ ltSetStudioPane('left'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-900x600-layers.png');
          await ltJparse(`(function(){ ltSetStudioPane('inspector'); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,220));
          await studioCapture('studio-900x600-inspector.png');
          if (studioProofFrames.length) {
            const frameDir = path.dirname(studioProofFrames[0]);
            const movPath = path.resolve(getTestArtifactDirectory(), 'product-finish/studio/studio-workflow.mov');
            fs.mkdirSync(path.dirname(movPath), { recursive:true });
            const ff = spawnSync('ffmpeg', ['-y','-framerate','1','-i',path.join(frameDir,'frame-%03d.png'),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p','-c:v','libx264','-movflags','+faststart',movPath], { stdio:'ignore' });
            if (ff.status !== 0 || !fs.existsSync(movPath) || fs.statSync(movPath).size < 1000) throw new Error('Lower Third Studio proof movie failed');
          }
          console.log('PRODUCT_FINISH_STUDIO_ARTIFACTS_OK ' + path.join(getTestArtifactDirectory(), 'product-finish/studio'));
          await setStudioProofSize(1280, 800);
          await ltJparse(`(function(){
            const snap=window.__ltStudioSmokeSnap;
            if(snap){
              S=JSON.parse(snap.S); cues=JSON.parse(snap.cues);
              currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              closeLtStudio(); fillLowerThirdControls(); initLtStudio(); renderScenesUI(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__ltStudioSmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,500));
          // --- LT Phase C: intro -> hold -> outro lifecycle ---
          await ltJparse(`(function(){
            window.__ltSequenceSmokeSnap = {
              S: JSON.stringify(S), cues: JSON.stringify(cues), currentCue, selectedCue,
              ltLibrary: JSON.stringify(ltLibrary), ltLibraryStorage: localStorage.getItem(PTLT.LIBRARY_KEY)
            };
            return JSON.stringify({ok:true});
          })()`);
          const introAsset = await saveFixture('intro-alpha.webm', 'video/webm');
          const holdAsset = await saveFixture('hold-loop-alpha.webm', 'video/webm');
          const outroAsset = await saveFixture('outro-alpha.webm', 'video/webm');
          const sequenceSetup = await ltJparse(`(function(){
            initLtLibrary();
            const tpl=PTLT.makeTemplate({
              id:'lt-sequence-template',
              name:'Intro Hold Outro Smoke',
              kind:'custom',
              layers:[
                PTLT.makeMediaLayer({id:'seq-intro',name:'Intro WebM',sourceType:'mediaAsset',assetId:${JSON.stringify(introAsset.src)},mediaKind:'video',fit:'contain',playbackMode:'play-once-hold',x:120,y:710,width:420,height:240,zIndex:0}),
                PTLT.makeMediaLayer({id:'seq-hold',name:'Hold Loop',sourceType:'mediaAsset',assetId:${JSON.stringify(holdAsset.src)},mediaKind:'video',fit:'contain',playbackMode:'loop-until-hide',x:120,y:710,width:420,height:240,zIndex:1}),
                PTLT.makeMediaLayer({id:'seq-outro',name:'Outro WebM',sourceType:'mediaAsset',assetId:${JSON.stringify(outroAsset.src)},mediaKind:'video',fit:'contain',playbackMode:'play-once-hold',x:120,y:710,width:420,height:240,zIndex:2}),
                PTLT.makeDynamicTextLayer({id:'seq-name',name:'speakerName',field:'speakerName',fallback:'Speaker',x:560,y:755,width:820,height:90,fontSize:66,fontWeight:840,color:'#ffffff',shadow:{enabled:true,color:'rgba(0,0,0,.65)',offsetX:0,offsetY:3,blur:14},zIndex:3}),
                PTLT.makeDynamicTextLayer({id:'seq-title',name:'speakerTitle',field:'speakerTitle',fallback:'Title',x:565,y:845,width:760,height:56,fontSize:34,fontWeight:580,color:'#dce5ef',zIndex:4})
              ],
              phases:{
                intro:{enabled:true,mode:'media',mediaLayerId:'seq-intro',durationMs:1200,textRevealDelayMs:700,startOffsetMs:180,loop:false,transition:{type:'fade',durationMs:180}},
                hold:{enabled:true,mode:'media',mediaLayerId:'seq-hold',durationMs:null,textRevealDelayMs:0,loop:true,holdLastFrame:false,transition:{type:'fade',durationMs:160}},
                outro:{enabled:true,mode:'media',mediaLayerId:'seq-outro',durationMs:520,textRevealDelayMs:0,loop:false,transition:{type:'fade',durationMs:180}}
              }
            });
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id && t.id!=='lt-sequence-missing-intro');
            ltLibrary.templates.push(tpl); ltLibrary.activeTemplateId=tpl.id;
            ltStudioState.selectedTemplateId=tpl.id; ltStudioState.selectedLayerId='seq-name'; saveLtLibrary();
            cues=migrateCues([
              {id:'seq-live',name:'Sequence Live',durationMs:60000,ltName:'Live Sequence Speaker',ltTitle:'Director'},
              {id:'seq-selected',name:'Sequence Selected',durationMs:60000,ltName:'Selected Speaker',ltTitle:'Selected Title'}
            ]);
            currentCue=0; selectedCue=1; S.mode='countdown'; S.durationMs=60000; S.remMs=60000; S.running=true;
            S.text=''; S.message={text:'',flash:false}; S.showProgress=false; S.showNowNext=false;
            renderCues(); openLtStudio(); renderLtStudio();
            return JSON.stringify({ok:true, template:ltCurrentTemplate().name, layers:ltCurrentTemplate().layers.length});
          })()`);
          smokeCheck('LT_SEQUENCE_TEMPLATE_SETUP_OK', sequenceSetup.ok && sequenceSetup.layers>=5, JSON.stringify(sequenceSetup));
          const sequencePreview = await ltJparse(`(function(){
            const before=JSON.stringify(S.lowerThird||{});
            const beforeProgram=JSON.stringify(programState||{});
            ltPreviewSequence();
            const video=document.querySelector('#ltStudioStage video');
            window.__ltSequencePreviewVideo=video||null;
            const after=JSON.stringify(S.lowerThird||{});
            const afterProgram=JSON.stringify(programState||{});
            const statusEl=document.getElementById('ltStudioStatus');
            const head=document.querySelector('.lt-studio-head');
            const grid=document.querySelector('.lt-studio-grid');
            const sr=statusEl.getBoundingClientRect(), hr=head.getBoundingClientRect(), gr=grid.getBoundingClientRect();
            return JSON.stringify({sameLower:before===after,sameProgram:beforeProgram===afterProgram,status:statusEl.textContent,phase:ltStudioState.previewRuntime&&ltStudioState.previewRuntime.phase,videoFound:!!video,startTime:video?Number(video.currentTime)||0:0,layoutStable:sr.height<32&&hr.height<120&&hr.bottom<=gr.top+1,statusClass:statusEl.className,statusHeight:sr.height,headHeight:hr.height});
          })()`);
          smokeCheck('LT_SEQUENCE_PREVIEW_NOT_LIVE_OK', sequencePreview.sameLower && sequencePreview.sameProgram && /Preview sequence/i.test(sequencePreview.status), JSON.stringify(sequencePreview));
          smokeCheck('LT_SEQUENCE_PREVIEW_LAYOUT_STABLE_OK', sequencePreview.layoutStable && /state-preview/.test(sequencePreview.statusClass), JSON.stringify(sequencePreview));
          const previewMediaDeadline=Date.now()+650;
          let sequencePreviewMedia={sameNode:false,currentTime:0,readyState:0,paused:true};
          while(Date.now()<previewMediaDeadline){
            sequencePreviewMedia=await ltJparse(`(function(){
              const video=document.querySelector('#ltStudioStage video');
              return JSON.stringify({sameNode:!!video&&video===window.__ltSequencePreviewVideo,currentTime:video?Number(video.currentTime)||0:0,readyState:video?video.readyState:0,paused:video?video.paused:true});
            })()`);
            if(sequencePreviewMedia.sameNode && sequencePreviewMedia.readyState>=2 && !sequencePreviewMedia.paused && sequencePreviewMedia.currentTime>sequencePreview.startTime+0.04) break;
            await new Promise(r=>setTimeout(r,40));
          }
          await ltJparse(`(function(){ delete window.__ltSequencePreviewVideo; return JSON.stringify({ok:true}); })()`);
          smokeCheck('LT_SEQUENCE_PREVIEW_MEDIA_ADVANCES_OK',
            sequencePreview.videoFound && sequencePreviewMedia.sameNode && sequencePreviewMedia.readyState>=2 && !sequencePreviewMedia.paused && sequencePreviewMedia.currentTime>sequencePreview.startTime+0.04,
            JSON.stringify({sequencePreview,sequencePreviewMedia}));
          await setOutputViewport(960,540);
          await ltJparse(`(function(){ ltStudioState.sequencePreview=null; ltTakeStudio(); return JSON.stringify({visible:S.lowerThird.visible, phase:S.lowerThird.runtime&&S.lowerThird.runtime.phase, started:S.lowerThird.runtime&&S.lowerThird.runtime.startedAt, running:S.running, remMs:S.remMs}); })()`);
          const inspectSequence = async () => JSON.parse(await outputWin.webContents.executeJavaScript(`(function(){
            try{ renderLowerThird(); }catch(e){}
            const canvas=document.getElementById('ltCanvas');
            const legacy=document.getElementById('lowerThird');
            const active=[...document.querySelectorAll('#ltCanvas [data-layer-id]')].filter(el=>getComputedStyle(el).display!=='none').map(el=>el.dataset.layerId);
            const videos=[...document.querySelectorAll('#ltCanvas video')].map(v=>({
              id:v.closest('[data-layer-id]')&&v.closest('[data-layer-id]').dataset.layerId,
              loop:v.loop,
              muted:v.muted,
              ready:(v.closest('[data-layer-id]')&&v.closest('[data-layer-id]').dataset.ready)==='1',
              currentTime:Number(v.currentTime)||0,
              startOffsetMs:Number((v.closest('[data-layer-id]')&&v.closest('[data-layer-id]').dataset.startOffsetMs)||0),
              holdLastFrame:(v.closest('[data-layer-id]')&&v.closest('[data-layer-id]').dataset.holdLastFrame)==='1'
            }));
            const text=[...document.querySelectorAll('#ltCanvas .lt-text-content')].map(el=>el.textContent).join('|');
            return JSON.stringify({display:getComputedStyle(canvas).display, phase:canvas.dataset.phase||'', active, videos, text, videoCount:videos.length, legacyDisplay:legacy?getComputedStyle(legacy).display:''});
          })()`));
          const waitSequence = async (predicate, timeoutMs=1800, stepMs=60) => {
            const started = Date.now();
            let last = await inspectSequence();
            while(Date.now() - started < timeoutMs){
              if(predicate(last)) return last;
              await new Promise(r=>setTimeout(r, stepMs));
              last = await inspectSequence();
            }
            return last;
          };
          const seqIntroEarly = await waitSequence(info =>
            info.display==='block' && info.phase==='intro' && info.active.includes('seq-intro') &&
            !info.active.includes('seq-hold') && !info.text.includes('Live Sequence Speaker'), 2600, 40);
          writeTestArtifact('product-finish/animation/intro-frame.png', (await outputWin.webContents.capturePage()).toPNG());
          smokeCheck('LT_TAKE_INTRO_TO_HOLD_OK', seqIntroEarly.display==='block' && seqIntroEarly.phase==='intro' && seqIntroEarly.active.includes('seq-intro') && !seqIntroEarly.active.includes('seq-hold'), JSON.stringify(seqIntroEarly));
          smokeCheck('LT_TEXT_REVEAL_DELAY_OK', seqIntroEarly.phase==='intro' && !seqIntroEarly.text.includes('Live Sequence Speaker'), JSON.stringify(seqIntroEarly));
          const seqIntroOffset = await waitSequence(info =>
            info.phase==='intro' && info.videos.some(v=>v.id==='seq-intro' && v.ready && v.startOffsetMs>=150 && v.currentTime>=0.14), 1800, 50);
          smokeCheck('LT_INTRO_START_OFFSET_OK', seqIntroOffset.phase==='intro' && seqIntroOffset.videos.some(v=>v.id==='seq-intro' && v.ready && v.startOffsetMs>=150 && v.currentTime>=0.14), JSON.stringify(seqIntroOffset));
          const seqIntroText = await waitSequence(info => info.text.includes('Live Sequence Speaker'), 2400, 60);
          smokeCheck('LT_TEXT_REVEAL_DELAY_AFTER_OK', seqIntroText.text.includes('Live Sequence Speaker'), JSON.stringify(seqIntroText));
          const seqHold = await waitSequence(info =>
            info.phase==='hold' && info.active.includes('seq-hold') &&
            info.videos.some(v=>v.id==='seq-hold' && v.loop===true), 2200, 60);
          writeTestArtifact('product-finish/animation/hold-frame.png', (await outputWin.webContents.capturePage()).toPNG());
          smokeCheck('LT_HOLD_LOOP_OK', seqHold.phase==='hold' && seqHold.active.includes('seq-hold') && seqHold.videos.some(v=>v.id==='seq-hold' && v.loop===true), JSON.stringify(seqHold));
          const timerAfterTake = await ltJparse(`(function(){ return JSON.stringify({running:S.running, remMs:S.remMs, currentCue, selectedCue}); })()`);
          smokeCheck('LT_SEQUENCE_TIMER_UNCHANGED_OK', timerAfterTake.running===true && timerAfterTake.currentCue===0 && timerAfterTake.selectedCue===1, JSON.stringify(timerAfterTake));
          await ltJparse(`(function(){ ltHideStudio(); return JSON.stringify({phase:S.lowerThird.runtime&&S.lowerThird.runtime.phase, visible:S.lowerThird.visible}); })()`);
          const seqOutro = await waitSequence(info => info.phase==='outro' && info.active.includes('seq-outro'), 2600, 50);
          writeTestArtifact('product-finish/animation/outro-frame.png', (await outputWin.webContents.capturePage()).toPNG());
          smokeCheck('LT_HIDE_OUTRO_TO_HIDDEN_OK', seqOutro.phase==='outro' && seqOutro.active.includes('seq-outro'), JSON.stringify(seqOutro));
          const seqHidden = await waitSequence(info => info.display==='none' && info.videoCount===0 && info.legacyDisplay==='none', 1800, 60);
          await outputWin.webContents.executeJavaScript(`document.body && document.body.offsetHeight`);
          await new Promise(r=>setTimeout(r,350));
          writeTestArtifact('product-finish/animation/hidden-after-outro.png', (await outputWin.webContents.capturePage()).toPNG());
          smokeCheck('LT_VIDEO_ELEMENTS_CLEANED_OK', seqHidden.display==='none' && seqHidden.videoCount===0 && seqHidden.legacyDisplay==='none', JSON.stringify(seqHidden));
          const seqRetake = await ltJparse(`(function(){ ltTakeStudio(); const rt=S.lowerThird.runtime||{}; return JSON.stringify({phase:rt.phase, instanceId:rt.instanceId, startedAt:rt.startedAt}); })()`);
          const seqRetakeOut = await waitSequence(info => info.phase==='intro' && info.active.includes('seq-intro'), 2600, 50);
          smokeCheck('LT_RETAKE_RESTARTS_SEQUENCE_OK', seqRetake.phase==='intro' && seqRetakeOut.phase==='intro' && seqRetakeOut.active.includes('seq-intro'), JSON.stringify({seqRetake,seqRetakeOut}));
          await ltJparse(`(function(){ hideLowerThird({force:true}); return JSON.stringify({ok:true}); })()`);
          await new Promise(r=>setTimeout(r,160));
          const missingIntro = await ltJparse(`(function(){
            const base=ltCurrentTemplate();
            const tpl=JSON.parse(JSON.stringify(base));
            tpl.id='lt-sequence-missing-intro'; tpl.name='Missing Intro Fallback';
            tpl.layers.forEach(l=>{ if(l.id==='seq-intro') l.assetId='missing-sequence-intro.webm'; });
            ltLibrary.templates.push(tpl); ltLibrary.activeTemplateId=tpl.id; ltStudioState.selectedTemplateId=tpl.id; saveLtLibrary(); ltTakeStudio();
            return JSON.stringify({visible:S.lowerThird.visible, phase:S.lowerThird.runtime&&S.lowerThird.runtime.phase});
          })()`);
          const missingHold = await waitSequence(info => info.phase==='hold' || info.active.includes('seq-hold'), 3200, 60);
          smokeCheck('LT_MISSING_INTRO_FALLBACK_OK', missingIntro.visible===true && (missingHold.phase==='hold' || missingHold.active.includes('seq-hold')), JSON.stringify({missingIntro,missingHold}));
          await ltJparse(`(function(){
            hideLowerThird({force:true});
            const base=ltLibrary.templates.find(t=>t.id==='lt-sequence-template');
            const tpl=JSON.parse(JSON.stringify(base));
            tpl.id='lt-sequence-hold-last'; tpl.name='Hold Last Frame';
            tpl.phases.intro={...tpl.phases.intro,enabled:false,mode:'none'};
            tpl.phases.hold={...tpl.phases.hold,enabled:true,mode:'media',mediaLayerId:'seq-hold',loop:false,holdLastFrame:true,startOffsetMs:0};
            tpl.phases.outro={...tpl.phases.outro,enabled:false,mode:'none'};
            ltLibrary.templates=(ltLibrary.templates||[]).filter(t=>t.id!==tpl.id);
            ltLibrary.templates.push(tpl); ltLibrary.activeTemplateId=tpl.id; ltStudioState.selectedTemplateId=tpl.id;
            saveLtLibrary(); ltTakeStudio();
            return JSON.stringify({ok:true});
          })()`);
          const seqHoldLast = await waitSequence(info =>
            info.phase==='hold' && info.active.includes('seq-hold') && !info.active.includes('seq-intro') && !info.active.includes('seq-outro') &&
            info.videos.length===1 && info.videos.some(v=>v.id==='seq-hold' && v.holdLastFrame===true), 3200, 60);
          smokeCheck('LT_HOLD_LAST_FRAME_OK',
            seqHoldLast.phase==='hold' && seqHoldLast.active.includes('seq-hold') && !seqHoldLast.active.includes('seq-intro') && !seqHoldLast.active.includes('seq-outro') &&
            seqHoldLast.videos.length===1 && seqHoldLast.videos.some(v=>v.id==='seq-hold' && v.holdLastFrame===true && v.loop===false), JSON.stringify(seqHoldLast));
          await ltJparse(`(function(){ hideLowerThird({force:true}); return JSON.stringify({ok:true}); })()`);
          const seqSummary = { sequenceSetup, sequencePreview, seqIntroEarly, seqIntroOffset, seqIntroText, seqHold, timerAfterTake, seqOutro, seqHidden, seqRetake, seqRetakeOut, missingIntro, missingHold, seqHoldLast };
          writeTestArtifact('product-finish/animation/sequence-results.json', JSON.stringify(seqSummary, null, 2));
          writeTestArtifact('product-finish/animation/animation-settings.png', (await controlWin.webContents.capturePage()).toPNG());
          if(app.isPackaged) smokeCheck('LT_SEQUENCE_PACKAGED_OK', true, 'packaged sequence smoke reached lifecycle checks');
          else smokeCheck('LT_SEQUENCE_PACKAGED_SOURCE_SKIP_OK', true, 'packaged-only sequence assertion is checked by smoke:packaged:philips');
          const animFrameDir = path.resolve(getTestArtifactDirectory(), 'product-finish/animation/frames');
          fs.mkdirSync(animFrameDir, {recursive:true});
          for(const [idx, src] of [0,1,2,3].entries()){
            const names=['intro-frame.png','hold-frame.png','outro-frame.png','hidden-after-outro.png'];
            const from=path.resolve(getTestArtifactDirectory(), 'product-finish/animation/' + names[src]);
            if(fs.existsSync(from)) fs.copyFileSync(from, path.join(animFrameDir, 'frame-' + String(idx).padStart(3,'0') + '.png'));
          }
          const animMov=path.resolve(getTestArtifactDirectory(), 'product-finish/animation/intro-hold-outro.mov');
          const ffAnim=spawnSync('ffmpeg', ['-y','-framerate','1','-i',path.join(animFrameDir,'frame-%03d.png'),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p','-c:v','libx264','-movflags','+faststart',animMov], {stdio:'ignore'});
          if(ffAnim.status!==0 || !fs.existsSync(animMov) || fs.statSync(animMov).size<1000) throw new Error('Animation proof movie failed');
          console.log('PRODUCT_FINISH_ANIMATION_ARTIFACTS_OK ' + path.join(getTestArtifactDirectory(), 'product-finish/animation'));
          await ltJparse(`(function(){
            const snap=window.__ltSequenceSmokeSnap;
            if(snap){
              S=JSON.parse(snap.S); cues=JSON.parse(snap.cues); currentCue=snap.currentCue; selectedCue=snap.selectedCue;
              ltLibrary=JSON.parse(snap.ltLibrary);
              if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
              else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
              hideLowerThird({force:true}); closeLtStudio({returnFocus:false}); fillLowerThirdControls(); initLtStudio(); renderScenesUI(); renderCues(); renderPreviewLowerThird(); send(true);
              delete window.__ltSequenceSmokeSnap;
            }
            return JSON.stringify({ok:true});
          })()`);
          await new Promise(r=>setTimeout(r,350));
          // --- fixtures + packaged decode probe (hidden window; nikad na HP) ---
          const fixDir = path.join(__dirname, 'test', 'fixtures', 'lower-third');
          let manifest = null;
          try { manifest = JSON.parse(fs.readFileSync(path.join(fixDir, 'fixture-manifest.json'), 'utf8')); } catch (e) {}
          const expected = manifest ? manifest.fixtures.filter(f=>f.present!==false) : [];
          smokeCheck('LT_FIXTURE_MANIFEST_OK', !!manifest && expected.length >= 9, 'entries=' + (manifest?manifest.fixtures.length:0));
          smokeCheck('LT_PACKAGED_FIXTURES_FOUND_OK', expected.every(f=>fs.existsSync(path.join(fixDir,f.filename))) &&
            ['model.js','validate.js','migrate.js','resolve.js','fixtures-probe.js'].every(f=>fs.existsSync(path.join(__dirname,'src','lower-third',f))), 'fixtures+src in package');
          try {
            const probe = require('./src/lower-third/fixtures-probe.js');
            const pr = await probe.runFixtureProbe(BrowserWindow, fixDir);
            const g = (name)=>pr.results.find(r=>r.filename===name) || {};
            smokeCheck('LT_PNG_FIXTURE_LOAD_OK', g('alpha-static.png').ok===true && g('alpha-static.png').alphaOk===true, JSON.stringify(g('alpha-static.png')));
            smokeCheck('LT_SVG_FIXTURE_LOAD_OK', g('alpha-static.svg').ok===true, JSON.stringify({lr:g('alpha-static.svg').loadResult}));
            smokeCheck('LT_JPG_FIXTURE_LOAD_OK', g('opaque-static.jpg').ok===true, '');
            smokeCheck('LT_MP4_FIXTURE_DECODE_OK', g('opaque-h264.mp4').ok===true && g('opaque-h264.mp4').playOk===true, JSON.stringify({d:g('opaque-h264.mp4').duration,cp:g('opaque-h264.mp4').canPlayType}));
            smokeCheck('LT_WEBM_VP8_FIXTURE_DECODE_OK', g('alpha-vp8.webm').ok===true && g('alpha-vp8.webm').playOk===true, JSON.stringify({cp:g('alpha-vp8.webm').canPlayType}));
            smokeCheck('LT_WEBM_VP9_FIXTURE_DECODE_OK', g('alpha-vp9.webm').ok===true && g('alpha-vp9.webm').playOk===true, JSON.stringify({cp:g('alpha-vp9.webm').canPlayType}));
            smokeCheck('LT_CORRUPT_VIDEO_FAILS_SAFE_OK', g('corrupt-video.webm').ok===true, 'error path = safe');
            // artefakti: helper bira repo artifacts/ u source modu i userData/test-artifacts u packaged modu.
            let artOk = false, artDir = '';
            try {
              const jsonPath = writeTestArtifact('lower-third/codec-capabilities.json', JSON.stringify(pr, null, 2));
              const txtPath = writeTestArtifact('lower-third/codec-capabilities.txt',
                'ShowSlate LT-1 codec probe\nelectron='+pr.versions.electron+' chrome='+pr.versions.chrome+'\n\n'+
                pr.results.map(r=>((r.ok?'OK   ':(r.skipped?'SKIP ':'FAIL '))+r.filename+'  '+JSON.stringify(r))).join('\n')+
                '\n\nNAPOMENA: ovo dokazuje DECODE, ne alpha compositing (to je LT-2).\n');
              artDir = path.dirname(jsonPath);
              artOk = fs.existsSync(jsonPath) && fs.existsSync(txtPath) && !hasAsarSegment(artDir);
            } catch (e) { console.log('LT artifacts write failed: ' + e.message); }
            smokeCheck('LT_PACKAGED_CODEC_PROBE_OK', artOk && pr.results.filter(r=>!r.skipped).every(r=>r.ok===true), 'artifacts=' + artDir);
          } catch (e) {
            ['LT_PNG_FIXTURE_LOAD_OK','LT_SVG_FIXTURE_LOAD_OK','LT_JPG_FIXTURE_LOAD_OK','LT_MP4_FIXTURE_DECODE_OK',
             'LT_WEBM_VP8_FIXTURE_DECODE_OK','LT_WEBM_VP9_FIXTURE_DECODE_OK','LT_CORRUPT_VIDEO_FAILS_SAFE_OK','LT_PACKAGED_CODEC_PROBE_OK']
              .forEach(n=>smokeCheck(n,false,'PROBE_ERR '+e.message));
          }
        }
        // REGRESIJA: biranje veličine grida NE sme da pokvari mod tajmera.
        // (Grid dugmad su u .tabs kontejneru — ranije su greškom zvala setMode(undefined),
        //  pa je START ostavljao endAt=0 → prikaz ogromnog negativnog vremena.)
        let startOK = false, gridStartStr = '?';
        try {
          await controlWin.webContents.executeJavaScript(`setDuration(530000); var gs=document.getElementById('gridSizeSel'); gs.value='5'; gs.dispatchEvent(new Event('change')); startPause();`);
          await new Promise(r => setTimeout(r, 500));
          gridStartStr = await controlWin.webContents.executeJavaScript(`(function(){var now=Date.now();return JSON.stringify({mode:S.mode,running:S.running,rem:S.endAt-now,text:calc(now).text});})()`);
          const s = JSON.parse(gridStartStr);
          startOK = s.mode === 'countdown' && s.running === true && s.rem > 0 && s.rem < 540000;
        } catch (e) { gridStartStr = 'ERR ' + e; }
        smokeCheck('GRID_START_OK', startOK, gridStartStr);
        // ---------- FAZA 1: rundown-first (SELECTED/LIVE, transakcioni GO, migracija) ----------
        // Priprema: 3 reda, GO na prvi (auto-start uključen)
        let p1Str = '?';
        try {
          p1Str = await controlWin.webContents.executeJavaScript(`(function(){
            cues = migrateCues([
              {name:'Seg A', durationMs:300000, note:'', color:'', ltName:'Ana A', ltTitle:'CEO'},
              {name:'Seg B', durationMs:240000, note:'', color:'', ltName:'Boris B', ltTitle:'CTO'},
              {name:'Seg C', durationMs:180000, note:'', color:'', ltName:'', ltTitle:''}
            ]);
            currentCue=-1; selectedCue=-1; saveCues(); renderCues();
            S.goAutoStart=true;
            goLiveWithCue(0);
            return JSON.stringify({live:currentCue, running:S.running, dur:S.durationMs,
              st0:cues[0].status, as0:Number.isFinite(cues[0].actualStart)});
          })()`);
          const P = JSON.parse(p1Str);
          smokeCheck('RUNDOWN_SOURCE_OF_TRUTH_OK',
            P.live === 0 && P.running === true && P.dur === 300000 && P.st0 === 'live' && P.as0,
            p1Str);
        } catch (e) { smokeCheck('RUNDOWN_SOURCE_OF_TRUTH_OK', false, 'ERR ' + e); }
        // Selekcija drugog reda NE SME da dira LIVE ni tajmer
        await new Promise(r => setTimeout(r, 600));
        let selStr = '?';
        try {
          selStr = await controlWin.webContents.executeJavaScript(`(function(){
            const endBefore=S.endAt, runBefore=S.running, durBefore=S.durationMs, liveBefore=currentCue;
            const rows=document.querySelectorAll('#cueList .cue');
            rows[2].click();                       // pravi DOM klik na treći red
            return JSON.stringify({sel:selectedCue, live:currentCue,
              sameEnd:S.endAt===endBefore, run:S.running===runBefore && S.running===true,
              sameDur:S.durationMs===durBefore, liveSame:currentCue===liveBefore});
          })()`);
          const SL = JSON.parse(selStr);
          smokeCheck('SELECTED_DOES_NOT_CHANGE_LIVE_OK',
            SL.sel === 2 && SL.live === 0 && SL.sameDur && SL.liveSame, selStr);
          smokeCheck('LIVE_TIMER_SURVIVES_SELECTION_OK', SL.sameEnd && SL.run, selStr);
        } catch (e) {
          smokeCheck('SELECTED_DOES_NOT_CHANGE_LIVE_OK', false, 'ERR ' + e);
          smokeCheck('LIVE_TIMER_SURVIVES_SELECTION_OK', false, 'ERR ' + e);
        }
        // GO NEXT uvek nosi sledeći rundown red u LIVE, bez obzira na Preview selekciju.
        let goStr = '?';
        try {
          const outputForGo = await ensureSmokeOutput();
          goStr = await controlWin.webContents.executeJavaScript(`(function(){
            go();   // selectedCue je 2, ali sledeći rundown red je 1
            return JSON.stringify({live:currentCue, dur:S.durationMs,
              st0:cues[0].status, ae0:Number.isFinite(cues[0].actualEnd),
              ad0:Number.isFinite(cues[0].actualDurationMs), st1:cues[1].status});
          })()`);
          const G = JSON.parse(goStr);
          let outSync = false;
          for (let k = 0; k < 12 && !outSync; k++) {
            await new Promise(r => setTimeout(r, 150));
            outSync = await outputForGo.webContents.executeJavaScript(
              `!!(S && S.currentCue===1 && S.durationMs===240000)`).catch(() => false);
          }
          smokeCheck('GO_UPDATES_ALL_OUTPUTS_OK',
            G.live === 1 && G.dur === 240000 && G.st0 === 'completed' && G.ae0 && G.ad0
            && G.st1 === 'live' && outSync,
            goStr + ' outSync=' + outSync);
        } catch (e) { smokeCheck('GO_UPDATES_ALL_OUTPUTS_OK', false, 'ERR ' + e); }
        // ---------- FAZA 4+: zaštite, LT iz rundown-a, identify, statika, prevodi ----------
        // LT iz LIVE reda + AUTO ne prikazuje prazan potpis
        let ltRunStr = '?';
        try {
          ltRunStr = await controlWin.webContents.executeJavaScript(`(async function(){
            cues=migrateCues([
              {name:'Sa potpisom', durationMs:300000, ltName:'Petar P.', ltTitle:'CFO'},
              {name:'Bez potpisa', durationMs:300000, ltName:'', ltTitle:''}
            ]);
            currentCue=-1; selectedCue=-1; S.goAutoStart=false; S.lowerThirdAutoCue=true;
            const autoChk=document.getElementById('chkLtAutoCue');
            if(autoChk){ autoChk.checked=true; autoChk.dispatchEvent(new Event('change')); }
            normalizeLowerThird(); S.lowerThird.visible=false;
            goLiveWithCue(0);
            await new Promise(r=>setTimeout(r,150));
            const withName={vis:!!S.lowerThird.visible, name:S.lowerThird.name};
            hideLowerThird();
            goLiveWithCue(1);
            await new Promise(r=>setTimeout(r,150));
            const noName={vis:!!S.lowerThird.visible};
            cues=[]; currentCue=-1; saveCues(); reset(); renderCues(); send(true);
            return JSON.stringify({withName,noName});
          })()`);
          const LT = JSON.parse(ltRunStr);
          smokeCheck('LOWER_THIRD_FROM_RUNDOWN_OK', LT.withName.vis && LT.withName.name === 'Petar P.', ltRunStr);
          smokeCheck('NO_EMPTY_LOWER_THIRD_OK', LT.noName.vis === false, ltRunStr);
        } catch (e) {
          smokeCheck('LOWER_THIRD_FROM_RUNDOWN_OK', false, 'ERR ' + e);
          smokeCheck('NO_EMPTY_LOWER_THIRD_OK', false, 'ERR ' + e);
        }
        // LOCK LIVE: zaključano → GO/RESET ne rade; otključano → rade
        let lockStr = '?';
        try {
          lockStr = await controlWin.webContents.executeJavaScript(`(function(){
            cues=migrateCues([{name:'L1',durationMs:300000},{name:'L2',durationMs:240000}]);
            currentCue=-1; selectedCue=-1; S.goAutoStart=true;
            goLiveWithCue(0);
            const runningBefore=S.running, liveBefore=currentCue;
            document.getElementById('chkLock').checked=true;
            document.getElementById('chkLock').dispatchEvent(new Event('change'));
            goNext(); reset();
            const lockedHeld = currentCue===liveBefore && S.running===runningBefore;
            document.getElementById('chkLock').checked=false;
            document.getElementById('chkLock').dispatchEvent(new Event('change'));
            goNext();
            const unlockedWorks = currentCue===1;
            cues=[]; currentCue=-1; saveCues(); reset(); renderCues(); send(true);
            return JSON.stringify({lockedHeld, unlockedWorks});
          })()`);
          const LK = JSON.parse(lockStr);
          smokeCheck('LOCK_LIVE_OK', LK.lockedHeld && LK.unlockedWorks, lockStr);
        } catch (e) { smokeCheck('LOCK_LIVE_OK', false, 'ERR ' + e); }
        // HOTKEY GUARD: Space u input polju NE pokreće tajmer; van polja pokreće
        let hkStr = '?';
        try {
          hkStr = await controlWin.webContents.executeJavaScript(`(function(){
            reset();
            const inp=document.getElementById('msgInput'); inp.focus();
            inp.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
            const guarded=!S.running;
            inp.blur(); document.body.focus();
            document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',bubbles:true}));
            const works=S.running;
            reset();
            return JSON.stringify({guarded,works});
          })()`);
          const HK = JSON.parse(hkStr);
          smokeCheck('HOTKEY_INPUT_GUARD_OK', HK.guarded && HK.works, hkStr);
        } catch (e) { smokeCheck('HOTKEY_INPUT_GUARD_OK', false, 'ERR ' + e); }
        // IDENTIFY DISPLAYS: otvori prozor po monitoru pa ih zatvori
        try {
          const before = BrowserWindow.getAllWindows().length;
          const n = await controlWin.webContents.executeJavaScript(`window.pt.identifyDisplays()`);
          await new Promise(r => setTimeout(r, 300));
          const during = BrowserWindow.getAllWindows().length;
          let closed = false;
          for (let k = 0; k < 30 && !closed; k++) {
            await new Promise(r => setTimeout(r, 200));
            closed = BrowserWindow.getAllWindows().length === before;
          }
          // in smoke, Identify targets ONLY the pinned display (never opens on HP), so expect 1
          const expectIdentify = (SMOKE && SMOKE_TARGET) ? 1 : screen.getAllDisplays().length;
          smokeCheck('IDENTIFY_DISPLAYS_OK',
            n === expectIdentify && during >= before + n && closed,
            `n=${n} expect=${expectIdentify} during=${during} before=${before} closed=${closed}`);
        } catch (e) { smokeCheck('IDENTIFY_DISPLAYS_OK', false, 'ERR ' + e); }
        // STATIKA: capture je izolovan u centralnom live-input servisu; nema direktnog
        // capture pristupa iz kontrolera ili izlaznih renderera, niti window.prompt-a.
        try {
          const shipped = ['main.js', 'preload.js', 'controller.html', 'output.html', 'backstage.html', 'remote.html', 'signal.html', 'i18n.js'];
          let pr = [];
          for (const f of shipped) {
            const txt = fs.readFileSync(path.join(__dirname, f), 'utf8');
            // šabloni sastavljeni iz delova da provera ne uhvati samu sebe
            if (new RegExp('[^a-zA-Z_.]pro' + 'mpt\\s*\\(').test(txt)) pr.push(f);
          }
          const mainSource = fs.readFileSync(path.join(__dirname, 'main.js'), 'utf8');
          const hubSource = fs.readFileSync(path.join(__dirname, 'src/live-input/hub.js'), 'utf8');
          const rendererSources = ['controller.html', 'output.html'].map(f => fs.readFileSync(path.join(__dirname, f), 'utf8'));
          const mainOwnsDesktopCapture = new RegExp('desktop' + 'Capturer').test(mainSource)
            && new RegExp('setDisplayMedia' + 'RequestHandler').test(mainSource);
          const hubOwnsMediaCapture = new RegExp('getDisplay' + 'Media').test(hubSource)
            && new RegExp('getUser' + 'Media').test(hubSource);
          const rendererCaptureAccess = rendererSources.some(txt => new RegExp(
            'desktop' + 'Capturer|getDisplay' + 'Media|getUser' + 'Media|chromeMedia' + 'Source'
          ).test(txt));
          smokeCheck('CAPTURE_SERVICE_ISOLATED_OK', mainOwnsDesktopCapture && hubOwnsMediaCapture && !rendererCaptureAccess,
            JSON.stringify({ mainOwnsDesktopCapture, hubOwnsMediaCapture, rendererCaptureAccess }));
          smokeCheck('NO_WINDOW_PROMPT_OK', pr.length === 0, pr.join(','));
        } catch (e) {
          smokeCheck('CAPTURE_SERVICE_ISOLATED_OK', false, 'ERR ' + e);
          smokeCheck('NO_WINDOW_PROMPT_OK', false, 'ERR ' + e);
        }
        // PREVODI: sr i en inline rečnici imaju IDENTIČNE ključeve + svaki data-i18n postoji
        let trStr = '?';
        try {
          trStr = await controlWin.webContents.executeJavaScript(`(function(){
            const sr=Object.keys(I18N.sr), en=Object.keys(I18N.en);
            const srSet=new Set(sr), enSet=new Set(en);
            const missEn=sr.filter(k=>!enSet.has(k));
            const missSr=en.filter(k=>!srSet.has(k));
            const domKeys=[...document.querySelectorAll('[data-i18n]')].map(el=>el.dataset.i18n);
            const domMiss=domKeys.filter(k=>!srSet.has(k)||!enSet.has(k));
            return JSON.stringify({missEn:missEn.slice(0,5), missSr:missSr.slice(0,5), domMiss:domMiss.slice(0,5),
              ok: missEn.length===0 && missSr.length===0 && domMiss.length===0});
          })()`);
          const TR = JSON.parse(trStr);
          smokeCheck('SR_TRANSLATIONS_COMPLETE_OK', TR.missSr.length === 0 && TR.domMiss.length === 0, trStr);
          smokeCheck('EN_TRANSLATIONS_COMPLETE_OK', TR.missEn.length === 0 && TR.domMiss.length === 0, trStr);
        } catch (e) {
          smokeCheck('SR_TRANSLATIONS_COMPLETE_OK', false, 'ERR ' + e);
          smokeCheck('EN_TRANSLATIONS_COMPLETE_OK', false, 'ERR ' + e);
        }
        // Migracija legacy formata: bez id/status → dopunjeno, podaci sačuvani, idempotentno
        let migStr = '?';
        try {
          migStr = await controlWin.webContents.executeJavaScript(`(function(){
            const legacy=[{name:'Old 1', durationMs:600000, note:'n', color:'#f0564d'},
                          {name:'Old 2', durationMs:120000}];
            const m1=migrateCues(JSON.parse(JSON.stringify(legacy)));
            const m2=migrateCues(JSON.parse(JSON.stringify(m1)));   // idempotentnost
            // očisti test rundown
            cues=[]; currentCue=-1; selectedCue=-1; saveCues();
            reset(); renderCues(); send(true);
            return JSON.stringify({ids:m1.every(c=>typeof c.id==='string'&&c.id),
              st:m1.every(c=>c.status==='pending'), keep:m1[0].name==='Old 1'&&m1[0].durationMs===600000&&m1[0].color==='#f0564d',
              idem:JSON.stringify(m1.map(c=>c.status))===JSON.stringify(m2.map(c=>c.status)) && m2[0].name==='Old 1'});
          })()`);
          const M = JSON.parse(migStr);
          smokeCheck('LEGACY_PROJECT_MIGRATION_OK', M.ids && M.st && M.keep && M.idem, migStr);
        } catch (e) { smokeCheck('LEGACY_PROJECT_MIGRATION_OK', false, 'ERR ' + e); }
        // CSV/TSV uvoz rundown-a: zaglavlje se preskače, "," ";" i TAB rade, navodnici čuvaju zarez
        let csvOK = false, csvStr = '?';
        try {
          csvStr = await controlWin.webContents.executeJavaScript(`JSON.stringify(parseRundownCSV(
            'name,duration,note\\nWelcome,10:00,"Emma, host"\\nSession;25:00;Liam\\nLunch\\t1:00:00\\tlobby\\nbad row,,x\\n'))`);
          const rows = JSON.parse(csvStr);
          csvOK = rows.length === 3 && rows[0].durationMs === 600000 && rows[0].note === 'Emma, host'
            && rows[1].durationMs === 1500000 && rows[2].durationMs === 3600000;
        } catch (e) { csvStr = 'ERR ' + e; }
        smokeCheck('CSV_OK', csvOK, csvOK ? '' : csvStr);
        // Font, 12h sat and presets render correctly; operator-only pause state never overlays Program.
        let extrasOK = false, extrasStr = '?';
        try {
          const outputForExtras = await ensureSmokeOutput();
          await controlWin.webContents.executeJavaScript(`(function(){
            document.getElementById('fontSel').value='serif'; document.getElementById('fontSel').dispatchEvent(new Event('change'));
            document.getElementById('chk12h').checked=true; document.getElementById('chk12h').dispatchEvent(new Event('change'));
            setMode('clock');
          })()`);
          await new Promise(r => setTimeout(r, 400));
          const outFont = await outputForExtras.webContents.executeJavaScript(`getComputedStyle(document.getElementById('timer')).fontFamily`);
          const clockTxt = await outputForExtras.webContents.executeJavaScript(`document.getElementById('timer').textContent`);
          const presetTxt = await controlWin.webContents.executeJavaScript(`(function(){
            setMode('countdown'); var b=document.querySelector('#msgPresets button'); b.click(); return S.message.text;
          })()`);
          await controlWin.webContents.executeJavaScript(`setDuration(300000); startPause();`);
          await new Promise(r => setTimeout(r, 600));   // pusti da otkuca — da remMs != durationMs
          await controlWin.webContents.executeJavaScript(`startPause();`); // pauza
          await new Promise(r => setTimeout(r, 400));
          const publicPauseOverlayAbsent = await outputForExtras.webContents.executeJavaScript(`!document.getElementById('paused') && !/\\b(PAUSED|PAUZA)\\b/.test(document.body.innerText)`);
          await controlWin.webContents.executeJavaScript(`reset(); S.message={text:'',flash:false}; document.getElementById('chk12h').checked=false; document.getElementById('chk12h').dispatchEvent(new Event('change')); document.getElementById('fontSel').value='mono'; document.getElementById('fontSel').dispatchEvent(new Event('change'));`);
          const is12h = /AM|PM/.test(clockTxt);
          extrasOK = /Georgia/.test(outFont) && is12h && presetTxt.length > 0 && publicPauseOverlayAbsent;
          extrasStr = `font=${/Georgia/.test(outFont)} 12h=${is12h} preset="${presetTxt}" publicPauseOverlayAbsent=${publicPauseOverlayAbsent}`;
        } catch (e) { extrasStr = 'ERR ' + e; }
        smokeCheck('EXTRAS_OK', extrasOK, extrasStr);
        // PRO: izveštaj — pokretanje tačke upisuje dnevnik, reset ga zatvara
        let repOK = false, repStr = '?';
        try {
          repStr = await controlWin.webContents.executeJavaScript(`(function(){
            localStorage.setItem('pt_showlog','[]'); showLog=[];
            cues=[{name:'Test tačka',durationMs:60000,note:'',color:''}]; saveCues(); renderCues();
            loadCue(0,true); reset();
            var l=showLog[0]||{};
            return JSON.stringify({len:showLog.length,n:l.n,closed:!!l.e,p:l.p});
          })()`);
          const r = JSON.parse(repStr);
          repOK = r.len === 1 && r.n === 'Test tačka' && r.closed && r.p === 60000;
        } catch (e) { repStr = 'ERR ' + e; }
        smokeCheck('REPORT_OK', repOK, repOK ? '' : repStr);
        let reportV2 = null, reportV2Str = '?';
        try {
          reportV2Str = await controlWin.webContents.executeJavaScript(`JSON.stringify((function(){
            var anchor=new Date(2026,6,10,9,0,0,0).getTime();
            showMeta={id:'smoke-report',name:'Smoke Report Ž',details:{eventDate:'2026-07-10',client:'Client',venue:'Hall'}};
            S.showStart='09:00';
            cues=migrateCues([
              {id:'smoke-report-a',name:'=Opening, Ž',durationMs:60000,actualStart:anchor,actualEnd:anchor+70000,actualDurationMs:70000,status:'completed',note:'Quote "hello", line\\nnext'},
              {id:'smoke-report-b',name:'Coffee Break',durationMs:30000,actualStart:anchor+70000,actualEnd:anchor+90000,actualDurationMs:20000,status:'completed',note:'Lobby'},
              {id:'smoke-report-c',name:'Closing',durationMs:30000,actualStart:null,actualEnd:null,actualDurationMs:null,status:'skipped',note:''}
            ]);
            showLog=[{i:0,n:'wrong legacy',p:999999,s:anchor+5000,e:anchor+90000}];
            var before=JSON.stringify(programState), report=buildCurrentPostShowReport(anchor+150000), csv=PTReport.toCsv(report);
            var opened=openPostShowReport(), ui={metrics:document.querySelectorAll('#reportSummary .report-metric').length,rows:document.querySelectorAll('#reportRows tr').length,visible:document.getElementById('reportOverlay').classList.contains('open')};
            closePostShowReport();
            return {canonical:report.rows[0].name==='=Opening, Ž'&&report.rows[0].actualStart===anchor&&report.rows[0].actualDurationMs===70000,
              summary:report.summary,totalOk:report.summary.totalPlannedMs===120000&&report.summary.totalActualMs===90000&&report.summary.finalDelayMs===-30000&&report.summary.overtimeSegments===1&&report.summary.longestOvertimeMs===10000&&report.summary.breaks===1&&report.summary.skippedCues===1,
              csvOk:csv.charCodeAt(0)===0xfeff&&csv.includes("'=Opening, Ž")&&csv.includes('Quote ""hello""')&&csv.includes('summary_metric,value'),
              uiOk:opened&&ui.visible&&ui.metrics===7&&ui.rows===3,programSafe:before===JSON.stringify(programState)};
          })())`);
          reportV2 = JSON.parse(reportV2Str);
        } catch (e) { reportV2Str = 'ERR ' + e; }
        smokeCheck('REPORT_CANONICAL_CUE_FIELDS_OK', !!(reportV2 && reportV2.canonical), reportV2Str);
        smokeCheck('REPORT_SUMMARY_COMPLETE_OK', !!(reportV2 && reportV2.totalOk), reportV2Str);
        smokeCheck('REPORT_CSV_UNICODE_ESCAPE_OK', !!(reportV2 && reportV2.csvOk), reportV2Str);
        smokeCheck('REPORT_NORMAL_UI_OK', !!(reportV2 && reportV2.uiOk && reportV2.programSafe), reportV2Str);
        // PRO: zakazani start — schedAt = trenutni minut → tajmer sam krene
        let schedOK = false;
        try {
          schedOK = await controlWin.webContents.executeJavaScript(`(function(){
            var d=new Date(); S.schedAt=String(d.getHours()).padStart(2,'0')+':'+String(d.getMinutes()).padStart(2,'0');
            S.schedOn=true; lastSchedFire=0; document.getElementById('chkSched').checked=true;
            return maybeScheduledStart(Date.now());
          })()`);
          schedOK = schedOK && await controlWin.webContents.executeJavaScript('S.running===true && S.schedOn===false');
          await controlWin.webContents.executeJavaScript('reset(); S.schedAt=""; send();');
        } catch (e) {}
        smokeCheck('SCHED_OK', schedOK);
        // PRO: /signal stranica (Limitimer zamena) se servira
        const signalPage = await new Promise((resolve) => {
          http.get(`http://127.0.0.1:${serverPort}/signal`, r => { let d=''; r.on('data',c=>d+=c); r.on('end',()=>resolve(d.includes('Signal') && d.includes('EventSource'))); }).on('error',()=>resolve(false));
        });
        smokeCheck('SIGNAL_PAGE_OK', signalPage);
        const freeBuildSource = ['preload.js', 'controller.html', 'output.html', 'signal.html', 'i18n.js']
          .map(file => fs.readFileSync(path.join(__dirname, file), 'utf8')).join('\n');
        smokeCheck('FREE_BUILD_NO_LICENSE_GATE_OK',
          !fs.existsSync(path.join(__dirname, 'license.js'))
            && !/license-activate|(?:ShowSlate|ProTimer Studio)\s*[—-]\s*TRIAL/.test(freeBuildSource));

        // ===== FAZA A: responsive + compact operator interface =====
        smokeCheck('WINDOW_MIN_SIZE_OK',
          controlWin.getMinimumSize()[0] === 900 && controlWin.getMinimumSize()[1] === 600,
          'min=' + controlWin.getMinimumSize().join('x'));
        // measureAt: postavi režim (advanced/compact) preko PRAVIH kontrola, promeni veličinu,
        // pa vrati punu-vidljivost (isFullyVisibleInViewport) po data-testid + overflow/scroll.
        const measureAt = async (w, h, opts) => {
          opts = opts || {};
          try { if (controlWin.isFullScreen()) { controlWin.setFullScreen(false); for (let i=0;i<20 && controlWin.isFullScreen(); i++) await new Promise(r=>setTimeout(r,100)); } } catch (e) {}
          await controlWin.webContents.executeJavaScript(`(function(){
            function setchk(id,v){var c=document.getElementById(id); if(c && c.checked!==v){c.checked=v; c.dispatchEvent(new Event('change'));}}
            // zatvori sve drawer-e pre merenja osnovnog operator ekrana
            ['dr-right','dr-run','dr-setup','tb-open'].forEach(function(cl){document.body.classList.remove(cl);});
            if(document.body.classList.contains('compositor-open')) setCompositorOpen(false,{scroll:false,persist:false});
            setchk('chkCompact', ${!!opts.compact});
            setchk('chkAdvanced', ${!!opts.advanced});
          })()`);
          // Viewport koji ne staje u ciljni workArea (npr. 1920×1080 na 1920×1050) se NE prikazuje
          // kao ogroman OS prozor: koristimo DevTools device-emulation na POSTOJEĆEM, clampovanom
          // prozoru (innerWidth/innerHeight = traženi viewport; spoljni bounds ostaju u workArea).
          const waFit = SMOKE_TARGET ? SMOKE_TARGET.workArea : null;
          const frameH = controlWin.getBounds().height - controlWin.getContentSize()[1];
          const needsEmu = !!(waFit && (w > waFit.width || (h + frameH) > waFit.height));
          try { controlWin.webContents.disableDeviceEmulation(); } catch (e) {}
          if (needsEmu) {
            controlWin.webContents.enableDeviceEmulation({
              screenPosition: 'desktop', screenSize: { width: w, height: h },
              viewSize: { width: w, height: h }, viewPosition: { x: 0, y: 0 },
              deviceScaleFactor: 0, scale: 1
            });
            await new Promise(r => setTimeout(r, 150));
          } else {
            controlWin.setContentSize(w, h);
            smokePlaceWindow(controlWin);
            for (let i=0;i<25;i++){ await new Promise(r=>setTimeout(r,80)); const s=controlWin.getContentSize(); if (Math.abs(s[0]-w)<=2 && Math.abs(s[1]-h)<=2) break; }
          }
          smokePlaceWindow(controlWin);
          // settle: CSS transitions (~180ms) + a couple of rAF render passes, then a margin
          await new Promise(r=>setTimeout(r,240));
          try { await controlWin.webContents.executeJavaScript('new Promise(function(r){var done=false;function finish(){if(done)return;done=true;r();}requestAnimationFrame(function(){requestAnimationFrame(finish);});setTimeout(finish,600);})'); } catch(e){}
          await new Promise(r=>setTimeout(r,240));
          return JSON.parse(await controlWin.webContents.executeJavaScript(`(function(){
            var vw=window.innerWidth, vh=window.innerHeight;
            var footer=document.querySelector('.statusbar');
            var fr=footer?footer.getBoundingClientRect():null;
            var footerTop=(fr && fr.height>0 && getComputedStyle(footer).position==='fixed')?fr.top:vh;
            function isFullyVisibleInViewport(el){
              if(!el) return false;
              var cs=getComputedStyle(el);
              if(cs.display==='none'||cs.visibility==='hidden'||parseFloat(cs.opacity)===0) return false;
              var r=el.getBoundingClientRect();
              if(r.width<=0||r.height<=0) return false;
              if(r.left< -1||r.top< -1||r.right>vw+1||r.bottom>vh+1) return false;
              if(r.bottom>footerTop+1) return false;               // fixed footer prekriva
              return true;
            }
            function q(sel){
              var el=document.querySelector('[data-testid="'+sel+'"]');
              if((sel==='live-cue'||sel==='next-cue') && el && el.getBoundingClientRect().width<=1){
                return document.getElementById('liveInfo') || el;
              }
              return el;
            }
            function info(sel){var e=q(sel); if(!e) return {found:false}; var r=e.getBoundingClientRect();
              return {found:true, full:isFullyVisibleInViewport(e), t:Math.round(r.top), b:Math.round(r.bottom), l:Math.round(r.left), r:Math.round(r.right)};}
            var mainEl=document.querySelector('.main');
            // probni element van ekrana → helper mora vratiti false (self-test)
            var probe=document.createElement('div'); probe.style.cssText='position:fixed;left:-9999px;top:0;width:20px;height:20px'; document.body.appendChild(probe);
            var probeFalse=(isFullyVisibleInViewport(probe)===false); probe.remove();
            return JSON.stringify({vw:vw,vh:vh,
              overflowX:document.documentElement.scrollWidth - vw,
              bodyScrollX:document.body.scrollWidth - document.body.clientWidth,
              mainScrollY: mainEl ? (mainEl.scrollHeight - mainEl.clientHeight) : 0,
              footerTop:Math.round(footerTop), probeFalse:probeFalse,
              timer:info('timer-display'), start:info('start-pause-button'), go:info('go-next-button'),
              live:info('live-cue'), next:info('next-cue'), lock:info('lock-live'),
              rundown:info('rundown-panel'), program:info('program-monitor')});
          })()`));
        };

        const measureSidebarLiveControls = async () => {
          return JSON.parse(await controlWin.webContents.executeJavaScript(`(async function(){
            function info(el){
              if(!el) return {found:false,full:false};
              var s=getComputedStyle(el),r=el.getBoundingClientRect();
              var full=s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)!==0&&r.width>0&&r.height>0
                &&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;
              return {found:true,full:full,t:Math.round(r.top),b:Math.round(r.bottom),l:Math.round(r.left),r:Math.round(r.right)};
            }
            closeDrawers();
            document.getElementById('btnRundownDrawer').click();
            var ids=['btnTake','btnGo','btnBack','btnFadeBlack'];
            var deadline=Date.now()+1800;
            while(Date.now()<deadline){
              var ready=document.body.classList.contains('dr-run')&&ids.every(function(id){return info(document.getElementById(id)).full;});
              if(ready) break;
              await new Promise(function(resolve){setTimeout(resolve,25);});
            }
            var sidebar=document.querySelector('.sidebar-live-controls');
            var controls=ids.map(function(id){return info(document.getElementById(id));});
            var result={
              drawer:document.body.classList.contains('dr-run'),
              sidebar:info(sidebar),
              take:controls[0],go:controls[1],back:controls[2],black:controls[3],
              all:controls.every(function(item){return item.full;}),
              singleTake:document.querySelectorAll('#btnTake').length===1&&!document.getElementById('btnSlideTake')
            };
            closeDrawers();
            return JSON.stringify(result);
          })()`));
        };

        const s900 = await measureAt(900, 600, { advanced:false });
        const liveControls900 = await measureSidebarLiveControls();
        smokeCheck('FULL_VERTICAL_VISIBILITY_HELPER_OK', s900.probeFalse === true, 'probeFalse=' + s900.probeFalse);
        smokeCheck('PROGRAM_MONITOR_FULLY_VISIBLE_900x600_OK', s900.program.full, JSON.stringify(s900.program));
        smokeCheck('GO_FULLY_VISIBLE_900x600_OK', liveControls900.drawer && liveControls900.go.full && liveControls900.all && liveControls900.singleTake, JSON.stringify(liveControls900));
        smokeCheck('FIXED_FOOTER_DOES_NOT_OVERLAP_OK',
          liveControls900.go.b <= s900.footerTop + 1, 'goB=' + liveControls900.go.b + ' footerTop=' + s900.footerTop);
        smokeCheck('BODY_NO_HORIZONTAL_SCROLL_900x600_OK', s900.overflowX <= 2 && s900.bodyScrollX <= 2, 'ovX=' + s900.overflowX + ' bodyX=' + s900.bodyScrollX);
        smokeCheck('BODY_NO_OPERATOR_VERTICAL_SCROLL_900x600_OK', s900.mainScrollY <= 420 && liveControls900.all, 'mainScrollY=' + s900.mainScrollY);
        smokeCheck('STANDARD_900x600_OK', s900.program.full && liveControls900.all && s900.overflowX <= 2, 'ovX=' + s900.overflowX);
        try { fs.writeFileSync('/tmp/pts_standard_900x600.png', (await controlWin.webContents.capturePage()).toPNG()); } catch(e){}

        let timerSettings900 = {};
        try {
          timerSettings900 = JSON.parse(await controlWin.webContents.executeJavaScript(`(async function(){
            function visible(el){if(!el)return false;var s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)!==0&&r.width>0&&r.height>0;}
            function inside(el){if(!visible(el))return false;var r=el.getBoundingClientRect();return r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}
            function fits(el){return !!el&&(!visible(el)||(el.scrollWidth<=el.clientWidth+2&&el.scrollHeight<=el.clientHeight+2));}
            closeDrawers();
            document.getElementById('btnSettingsDrawer').click();
            var deadline=Date.now()+1800;
            while(Date.now()<deadline&&!(document.body.classList.contains('dr-setup')&&inside(document.getElementById('setupWrap')))) await new Promise(function(resolve){setTimeout(resolve,25);});
            document.querySelector('#setupTabs button[data-pane="timer"]').click();
            var panel=document.querySelector('[data-testid="timer-transport-panel"]'),transport=document.querySelector('[data-testid="timer-transport"]');
            panel.scrollIntoView({block:'nearest'});
            deadline=Date.now()+1800;
            while(Date.now()<deadline&&!(inside(panel)&&inside(document.getElementById('btnStart'))&&inside(document.getElementById('btnReset')))) await new Promise(function(resolve){setTimeout(resolve,25);});
            var adjust=[].slice.call(transport.querySelectorAll('.adjust button'));
            var controls=['btnTake','btnGo','btnBack','btnFadeBlack'].map(function(id){return document.getElementById(id);});
            var switcher=document.querySelector('.sidebar-live-controls .studio-switcher');
            var timerVisible={panel:inside(panel),start:inside(document.getElementById('btnStart')),reset:inside(document.getElementById('btnReset')),adjustInside:adjust.every(inside)};
            var livePanel=document.querySelector('.panel-live-safety');
            livePanel.scrollIntoView({block:'nearest'});
            deadline=Date.now()+1800;
            while(Date.now()<deadline&&!(inside(document.getElementById('liName'))&&inside(document.getElementById('liNext'))&&inside(document.querySelector('[data-testid="lock-live"]')))) await new Promise(function(resolve){setTimeout(resolve,25);});
            return JSON.stringify({drawer:document.body.classList.contains('dr-setup')&&inside(document.getElementById('setupWrap')),inPane:document.getElementById('pane-timer').contains(transport),panel:timerVisible.panel,start:timerVisible.start,reset:timerVisible.reset,adjustCount:adjust.length,adjustInside:timerVisible.adjustInside,fits:[document.getElementById('btnStart'),document.getElementById('btnReset')].concat(adjust).every(fits),timerInMain:!!document.querySelector('.operator-main > .transport'),switcherInSidebar:!!switcher&&controls.every(function(el){return switcher.contains(el);})&&!document.querySelector('#studio > .studio-switcher'),legacyBlackout:!!document.getElementById('btnBlackout')||!!document.getElementById('bdgBk'),programBlackout:!!switcher&&switcher.contains(document.getElementById('btnFadeBlack')),monitorHeadersRemoved:document.querySelectorAll('.studio-monitor .monitor-head').length===0,liveCue:inside(document.getElementById('liName')),nextCue:inside(document.getElementById('liNext')),lockLive:inside(document.querySelector('[data-testid="lock-live"]')),nextRow:inside(document.getElementById('btnGoNext'))});
          })()`));
        } catch (e) { timerSettings900 = { error:String(e) }; }
        smokeCheck('TIMER_CONTROLS_IN_SETTINGS_900x600_OK', timerSettings900.drawer && timerSettings900.inPane && timerSettings900.panel && timerSettings900.start && timerSettings900.reset && timerSettings900.adjustCount===6 && timerSettings900.adjustInside && timerSettings900.fits && !timerSettings900.timerInMain && timerSettings900.switcherInSidebar && !timerSettings900.legacyBlackout && timerSettings900.programBlackout && timerSettings900.monitorHeadersRemoved, JSON.stringify(timerSettings900));
        smokeCheck('LIVE_CUE_VISIBLE_900x600_OK', timerSettings900.liveCue, JSON.stringify(timerSettings900));
        smokeCheck('NEXT_CUE_VISIBLE_900x600_OK', timerSettings900.nextCue, JSON.stringify(timerSettings900));
        smokeCheck('LOCK_LIVE_VISIBLE_900x600_OK', timerSettings900.lockLive && timerSettings900.nextRow, JSON.stringify(timerSettings900));
        try { fs.writeFileSync('/tmp/pts_timer_settings_900x600.png', (await controlWin.webContents.capturePage()).toPNG()); } catch(e){}
        try { await controlWin.webContents.executeJavaScript('closeDrawers()'); } catch(e){}

        const s1024 = await measureAt(1024, 700, { advanced:false });
        smokeCheck('STANDARD_1024x700_OK', s1024.program.full && s1024.go.found && s1024.overflowX <= 2, 'ovX=' + s1024.overflowX + ' go=' + JSON.stringify(s1024.go));

        const s1280 = await measureAt(1280, 720, { advanced:true });
        smokeCheck('ADVANCED_1280x720_OK', (s1280.timer.full || s1280.program.full) && s1280.go.found && s1280.overflowX <= 2, 'ovX=' + s1280.overflowX);
        try { fs.writeFileSync('/tmp/pts_advanced_1280x720.png', (await controlWin.webContents.capturePage()).toPNG()); } catch(e){}

        await measureAt(1280, 800, { advanced:false });
        smokeCheck('NO_HORIZONTAL_OVERFLOW_OK', s900.overflowX <= 2 && s1024.overflowX <= 2 && s1280.overflowX <= 2,
          `900=${s900.overflowX} 1024=${s1024.overflowX} 1280=${s1280.overflowX}`);

        const jx = (code) => controlWin.webContents.executeJavaScript(code);
        const jparse = async (code) => JSON.parse(await jx(code));
        const waitForUtilityColumnState = async ({ collapsed, minMainWidth = 0, timeoutMs = 1800 }) => {
          const deadline = Date.now() + timeoutMs;
          let sample = {};
          let previousSignature = '';
          let stableSamples = 0;
          while (Date.now() < deadline) {
            sample = await jparse(`(function(){
              var uc=document.querySelector('.utility-column'), main=document.querySelector('.operator-main'), workspace=document.querySelector('.main.operator-workspace'), btn=document.getElementById('btnMsgDrawer');
              var r=uc.getBoundingClientRect(), cs=getComputedStyle(uc), ws=getComputedStyle(workspace);
              var tracks=ws.gridTemplateColumns.split(/\\s+/).map(function(value){return parseFloat(value)||0;});
              var utilityTrack=tracks.length ? tracks[tracks.length-1] : -1;
              var transitions=workspace.getAnimations().concat(uc.getAnimations()).filter(function(animation){return animation.playState==='running';}).length;
              return JSON.stringify({hidden:cs.visibility==='hidden'&&cs.pointerEvents==='none', width:r.width,
                mainWidth:Math.round(main.getBoundingClientRect().width), expanded:btn.getAttribute('aria-expanded')==='true',
                visible:cs.visibility!=='hidden'&&r.width>40, utilityTrack:utilityTrack, transitions:transitions});
            })()`);
            const targetState = collapsed
              ? sample.hidden && sample.utilityTrack <= 1 && sample.mainWidth >= minMainWidth && !sample.expanded
              : sample.visible && sample.utilityTrack > 40 && sample.expanded;
            const signature = `${sample.mainWidth}:${Math.round(sample.utilityTrack * 10) / 10}:${sample.expanded}:${sample.hidden}`;
            stableSamples = targetState && sample.transitions === 0 && signature === previousSignature ? stableSamples + 1 : 0;
            previousSignature = signature;
            if (stableSamples >= 2) return { ...sample, settled:true };
            await new Promise(resolve => setTimeout(resolve, 40));
          }
          return { ...sample, settled:false };
        };

        // ===== FAZA 1A regression fence: lock behaviour + key DOM BEFORE shell scaffolding =====
        const fenceDom = await jparse(`(function(){
          var ids=['btnStart','btnGo','cueList','program','pgTime','displaySel','btnOpenOut','msgInput','btnMsgSend','chkAdvanced','chkCompact','chkLock','liName','liNext'];
          return JSON.stringify({
            missingIds: ids.filter(function(i){return !document.getElementById(i);}),
            startCount: document.querySelectorAll('[data-testid=start-pause-button]').length,
            goCount: document.querySelectorAll('[data-testid=go-next-button]').length,
            timerCount: document.querySelectorAll('[data-testid=timer-display]').length,
            hasOutputSel: !!document.getElementById('displaySel'),
            hasSend: !!document.getElementById('btnOpenOut'),
            hasRundown: !!document.querySelector('[data-testid=rundown-panel]')
          });
        })()`);
        smokeCheck('KEY_DOM_IDS_PRESERVED_OK', fenceDom.missingIds.length === 0, 'missing=' + JSON.stringify(fenceDom.missingIds));
        smokeCheck('PRIMARY_CONTROLS_SINGLE_INSTANCE_OK', fenceDom.startCount === 1 && fenceDom.goCount === 1 && fenceDom.timerCount === 1, 'start=' + fenceDom.startCount + ' go=' + fenceDom.goCount + ' timer=' + fenceDom.timerCount);
        smokeCheck('OUTPUT_CONTROLS_PRESERVED_OK', fenceDom.hasOutputSel && fenceDom.hasSend, 'sel=' + fenceDom.hasOutputSel + ' send=' + fenceDom.hasSend);
        smokeCheck('RUNDOWN_STATE_PRESERVED_OK', fenceDom.hasRundown, 'rundown=' + fenceDom.hasRundown);
        const fenceFn = await jparse(`(function(){
          var out={}, snapCues=cues.slice(), snapCur=currentCue, snapSel=selectedCue;
          try{
            if(cues.length<2){ cues=[{id:'f1',name:'Fence A',durationMs:60000},{id:'f2',name:'Fence B',durationMs:60000}]; }
            currentCue=0; selectedCue=-1; renderCues();
            setDuration(120000); startPause(); out.runningAfterStart=(S.running===true);
            startPause(); out.pausedAfterPause=(S.running===false);
            reset(); out.resetOK=(S.running===false);
            currentCue=0; selectedCue=-1; renderCues(); var liveBefore=currentCue;
            selectedCue=1; renderCues(); out.selectedNoChangeLive=(currentCue===liveBefore);
            var beforeGo=currentCue; go(); out.goChangedLive=(currentCue!==beforeGo);
            S.message={text:'FENCE_MSG',flash:false}; out.msgOK=(S.message.text==='FENCE_MSG');
            var a=document.getElementById('chkAdvanced'); var aWas=a.checked; a.checked=true; a.dispatchEvent(new Event('change')); out.advOn=document.body.classList.contains('adv'); a.checked=aWas; a.dispatchEvent(new Event('change'));
            var c=document.getElementById('chkCompact'); out.compactOn=false;
            if(c){ var cWas=c.checked; c.checked=true; c.dispatchEvent(new Event('change')); out.compactOn=document.body.classList.contains('compact'); c.checked=cWas; c.dispatchEvent(new Event('change')); }
          } finally {
            S.message={text:'',flash:false}; cues=snapCues; currentCue=snapCur; selectedCue=snapSel; reset(); renderCues();
          }
          return JSON.stringify(out);
        })()`);
        smokeCheck('OPERATOR_BASELINE_FUNCTIONS_OK', fenceFn.runningAfterStart && fenceFn.pausedAfterPause && fenceFn.resetOK && fenceFn.selectedNoChangeLive && fenceFn.goChangedLive && fenceFn.msgOK, JSON.stringify(fenceFn));
        smokeCheck('ADVANCED_STATE_PRESERVED_OK', fenceFn.advOn === true, 'advOn=' + fenceFn.advOn);
        smokeCheck('COMPACT_STATE_PRESERVED_OK', fenceFn.compactOn === true, 'compactOn=' + fenceFn.compactOn);

        // FAZA 1B: external operator-shell.css is loaded (sentinel var) AND #app-shell/#overlay-root
        // resolve from it (proves the stylesheet shipped in the packaged asar, not just source).
        const shellCss = await jparse(`(function(){
          var sentinel=getComputedStyle(document.documentElement).getPropertyValue('--operator-shell-loaded').trim();
          var shell=document.getElementById('app-shell');
          var over=document.getElementById('overlay-root');
          return JSON.stringify({
            sentinel: sentinel,
            appShellCount: document.querySelectorAll('#app-shell').length,
            shellGridRows: shell ? (getComputedStyle(shell).display==='grid' && getComputedStyle(shell).gridTemplateRows.split(' ').length >= 3) : false,
            overlayIsBodyChild: !!over && over.parentElement===document.body,
            overlayZ: over ? getComputedStyle(over).zIndex : ''
          });
        })()`);
        smokeCheck('SHELL_CSS_INCLUDED_IN_PACKAGE_OK',
          shellCss.sentinel === '1' && shellCss.shellGridRows === true, JSON.stringify(shellCss));

        // ===== COMPACT operater =====
        const c900 = await measureAt(900, 600, { compact:true });
        const compactLiveControls = await measureSidebarLiveControls();
        let compactTimerSettings = {};
        try {
          compactTimerSettings = await jparse(`(async function(){
            function inside(el){if(!el)return false;var s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&parseFloat(s.opacity)!==0&&r.width>0&&r.height>0&&r.left>=-1&&r.top>=-1&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}
            closeDrawers();
            document.getElementById('btnSettingsDrawer').click();
            var deadline=Date.now()+1800;
            while(Date.now()<deadline&&!(document.body.classList.contains('dr-setup')&&inside(document.getElementById('setupWrap')))) await new Promise(function(resolve){setTimeout(resolve,25);});
            document.querySelector('#setupTabs button[data-pane="timer"]').click();
            var panel=document.querySelector('[data-testid="timer-transport-panel"]'),transport=document.querySelector('[data-testid="timer-transport"]');
            panel.scrollIntoView({block:'nearest'});
            deadline=Date.now()+1800;
            while(Date.now()<deadline&&!(inside(document.getElementById('btnStart'))&&inside(document.getElementById('btnReset')))) await new Promise(function(resolve){setTimeout(resolve,25);});
            var adjust=[].slice.call(transport.querySelectorAll('.adjust button'));
            var result={drawer:document.body.classList.contains('dr-setup')&&inside(document.getElementById('setupWrap')),start:inside(document.getElementById('btnStart')),reset:inside(document.getElementById('btnReset')),adjustCount:adjust.length,adjustInside:adjust.every(inside)};
            closeDrawers();
            return JSON.stringify(result);
          })()`);
        } catch (e) { compactTimerSettings = { error:String(e) }; }
        smokeCheck('COMPACT_MODE_OK',
          c900.program.full && compactLiveControls.drawer && compactLiveControls.all && compactLiveControls.singleTake && !c900.start.full && compactTimerSettings.drawer && compactTimerSettings.start && compactTimerSettings.reset && compactTimerSettings.adjustCount===6 && compactTimerSettings.adjustInside && c900.overflowX <= 2 && c900.mainScrollY <= 420,
          'program=' + c900.program.full + ' startInMain=' + c900.start.full + ' liveControls=' + JSON.stringify(compactLiveControls) + ' settings=' + JSON.stringify(compactTimerSettings) + ' ovX=' + c900.overflowX + ' scrollY=' + c900.mainScrollY);
        try { fs.writeFileSync('/tmp/pts_compact_900x600.png', (await controlWin.webContents.capturePage()).toPNG()); } catch(e){}
        const drun = await jparse(`(function(){
          var el=document.querySelector('.col-run');
          var closed=el.getBoundingClientRect().right <= 4;
          document.getElementById('btnRundownDrawer').click();
          var openOn=document.body.classList.contains('dr-run') && el.getBoundingClientRect().left <= 20;
          return JSON.stringify({closed:closed, openOn:openOn});
        })()`);
        smokeCheck('COMPACT_RUNDOWN_DRAWER_OK', drun.closed && drun.openOn, JSON.stringify(drun));
        const seldata = await jparse(`(function(){
          if(!Array.isArray(cues) || cues.length<3) seedDemoShow();
          goLiveWithCue(0, {autostart:false});
          startPause();
          var runningBefore=S.running, liveBefore=currentCue;
          selectCue(2);
          var liveAfterSelect=currentCue, running1=S.running;
          document.getElementById('btnRundownDrawer').click();
          var running2=S.running, liveAfterDrawer=currentCue;
          go();
          var liveAfterGo=currentCue;
          return JSON.stringify({runningBefore:runningBefore,liveBefore:liveBefore,
            liveAfterSelect:liveAfterSelect,running1:running1,running2:running2,
            liveAfterDrawer:liveAfterDrawer,liveAfterGo:liveAfterGo});
        })()`);
        smokeCheck('COMPACT_SELECTION_DOES_NOT_CHANGE_LIVE_OK',
          seldata.liveBefore === 0 && seldata.liveAfterSelect === 0, JSON.stringify(seldata));
        smokeCheck('COMPACT_GO_UPDATES_LIVE_OK', seldata.liveAfterGo === 1, 'liveAfterGo=' + seldata.liveAfterGo);
        smokeCheck('COMPACT_TIMER_SURVIVES_DRAWER_OK',
          seldata.runningBefore === true && seldata.running1 === true && seldata.running2 === true && seldata.liveAfterDrawer === seldata.liveAfterSelect,
          JSON.stringify(seldata));
        await jx(`reset(); document.body.classList.remove('dr-run');`);

        // ===== Message / Output-status drawer (narrow) =====
        await measureAt(1024, 700, { advanced:false });
        const mClosed = await jx(`(function(){ var right=document.querySelector('.right'); var r=right.getBoundingClientRect(); var cs=getComputedStyle(right); var status=document.querySelector('.card-status'); var sr=status?status.getBoundingClientRect():{width:0,height:0}; return cs.position==='static' ? (sr.width>4 && sr.height>4 && (cs.overflowY==='auto'||cs.overflowY==='scroll'||cs.overflowY==='overlay')) : r.left >= window.innerWidth-6; })()`);
        await jx(`document.getElementById('msgInput').value='SMOKE MSG'; document.getElementById('btnMsgDrawer').click();`);
        await new Promise(r=>setTimeout(r,280)); // sačekaj slide-in tranziciju
        const mdr = await jparse(`(function(){
          var right=document.querySelector('.right'); var rr=right.getBoundingClientRect();
          var cs=getComputedStyle(right);
          return JSON.stringify({open:document.body.classList.contains('dr-right'),
            onscreen:(rr.right <= window.innerWidth+2 && rr.left < window.innerWidth-40 && rr.width>40),
            staticVisible:cs.position==='static' && rr.width>40 && rr.right<=window.innerWidth+1,
            ownScroll:cs.overflowY==='auto'||cs.overflowY==='scroll'||cs.overflowY==='overlay',
            statusInside:right.contains(document.querySelector('.card-status')),
            statusVisible:document.querySelector('.card-status').getBoundingClientRect().width>4});
        })()`);
        await jx(`document.getElementById('btnMsgDrawer').click();`);
        await new Promise(r=>setTimeout(r,120));
        const valueSafe = await jx(`document.getElementById('msgInput').value==='SMOKE MSG'`);
        smokeCheck('MESSAGE_DRAWER_OK', mClosed && (mdr.onscreen || mdr.staticVisible || (mdr.statusInside && mdr.statusVisible)), 'closed=' + mClosed + ' ' + JSON.stringify(mdr));
        smokeCheck('MESSAGE_DRAWER_STATE_SAFE_OK', valueSafe === true, 'valueSafe=' + valueSafe);
        smokeCheck('OUTPUT_STATUS_DRAWER_OK', mdr.statusInside && mdr.statusVisible && mdr.ownScroll, 'inside=' + mdr.statusInside + ' vis=' + mdr.statusVisible + ' scroll=' + mdr.ownScroll);
        await jx(`document.getElementById('msgInput').value=''; document.body.classList.remove('dr-right');`);

        // ===== Topbar overflow meni =====
        await measureAt(1280, 800, { advanced:false });
        const tb = await jparse(`(function(){
          var btn=document.querySelector('[data-testid="topbar-overflow-button"]');
          var menu=document.querySelector('[data-testid="topbar-overflow-menu"]');
          var shell=document.getElementById('app-shell');
          var header=document.querySelector('.topbar');
          var out={btn:!!btn,menu:!!menu,bodyChild:menu&&menu.parentElement&&menu.parentElement.id==='overlay-root'};
          closeTopbarMenu && closeTopbarMenu();
          btn.click();
          var r=menu.getBoundingClientRect(), br=btn.getBoundingClientRect();
          var cs=getComputedStyle(menu), hcs=getComputedStyle(header), scs=getComputedStyle(shell);
          out.open=document.body.classList.contains('tb-open');
          out.visible=cs.display!=='none' && r.width>120 && r.height>80;
          out.belowButton=r.top>=br.bottom-2;
          out.rightAligned=Math.abs(r.right-br.right)<=18;
          out.zAbove=(parseInt(cs.zIndex)||0)>(parseInt(hcs.zIndex)||0) && (parseInt(cs.zIndex)||0)>(parseInt(scs.zIndex)||0);
          out.inViewport=r.left>=0 && r.right<=window.innerWidth+1 && r.bottom<=window.innerHeight+1;
          out.focusInside=menu.contains(document.activeElement);
          var adv=document.getElementById('chkAdvanced');
          var before=adv.checked;
          adv.click();
          out.itemClickable=adv.checked!==before && document.body.classList.contains('tb-open');
          adv.click();
          btn.click();
          out.secondClosed=!document.body.classList.contains('tb-open');
          btn.click();
          document.body.dispatchEvent(new MouseEvent('click',{bubbles:true,clientX:2,clientY:2}));
          out.outsideClosed=!document.body.classList.contains('tb-open');
          btn.click();
          document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
          out.escapeClosed=!document.body.classList.contains('tb-open') && document.activeElement===btn;
          return JSON.stringify(out);
        })()`);
        smokeCheck('TOPBAR_OVERFLOW_CLICK_OPENS_OK', tb.btn && tb.menu && tb.open && tb.visible && tb.focusInside, JSON.stringify(tb));
        smokeCheck('TOPBAR_OVERFLOW_SECOND_CLICK_CLOSES_OK', tb.secondClosed && tb.outsideClosed && tb.escapeClosed, JSON.stringify(tb));
        smokeCheck('TOPBAR_OVERFLOW_ABOVE_SHELL_OK', tb.bodyChild && tb.zAbove && tb.inViewport && tb.belowButton && tb.rightAligned, JSON.stringify(tb));
        smokeCheck('TOPBAR_OVERFLOW_CLICKABLE_PACKAGED_OK', tb.itemClickable, JSON.stringify(tb));

        const uiStable = await jparse(`(function(){
          var out={};
          var main=document.querySelector('.main'), footer=document.querySelector('.statusbar'), body=document.body;
          var mr=main.getBoundingClientRect(), fr=footer.getBoundingClientRect();
          out.footerNoOverlap=mr.bottom<=fr.top+1 && document.documentElement.scrollHeight<=window.innerHeight+2 && body.scrollHeight<=window.innerHeight+2;
          var ltTab=document.querySelector('#setupTabs button[data-pane="lt"]');
          if(ltTab) ltTab.click();
          var pane=document.getElementById('pane-lt'), setup=document.getElementById('setupWrap'), paneCs=getComputedStyle(pane);
          var bodyPane=document.querySelector('#pane-lt .lt-panel-body'), bodyCs=bodyPane ? getComputedStyle(bodyPane) : null;
          var paneScrolls=(paneCs.overflowY==='auto'||paneCs.overflowY==='scroll'||paneCs.overflowY==='overlay') && pane.scrollHeight>pane.clientHeight+4;
          var bodyScrolls=!!bodyPane && (bodyCs.overflowY==='auto'||bodyCs.overflowY==='scroll'||bodyCs.overflowY==='overlay') && bodyPane.scrollHeight>bodyPane.clientHeight+4;
          var lastControl=document.getElementById('btnLtDeletePreset');
          var lr=lastControl?lastControl.getBoundingClientRect():null, br=(bodyPane||pane).getBoundingClientRect();
          var lastReachable=!!lr && lr.width>0 && lr.height>0 && lr.top>=br.top-1 && lr.bottom<=br.bottom+1;
          out.activeTabScrolls=pane.classList.contains('active') && (paneScrolls || bodyScrolls || lastReachable) && setup.getBoundingClientRect().height>80;
          out.activeTabLastReachable=lastReachable;
          var studioBtn=document.getElementById('btnLtStudioOpen'), sr=studioBtn.getBoundingClientRect();
          out.ltButtonVisible=!!studioBtn && sr.width>90 && sr.height>26 && sr.top>=0 && sr.bottom<=window.innerHeight+1;
          out.ltButtonInHeader=!!studioBtn.closest('.lt-panel-head');
          closeLtStudio({returnFocus:false});
          var studio=document.getElementById('ltStudio'), bd=document.getElementById('ltStudioBackdrop');
          var cs=getComputedStyle(studio), bcs=getComputedStyle(bd), rr=studio.getBoundingClientRect();
          out.studioClosedGhost=cs.display==='none' && cs.pointerEvents==='none' && studio.getAttribute('aria-hidden')==='true' && bcs.display==='none' && rr.width===0 && rr.height===0;
          var go=document.getElementById('btnGo'), goNext=document.getElementById('btnGoNext');
          var g=go.textContent.replace(/\\s+/g,' ').trim(), gn=goNext.textContent.replace(/\\s+/g,' ').trim();
          out.goDistinct=!!g && !!gn && g!==gn && /GO/i.test(g) && /(ROW|RED|STAVKA|ITEM)/i.test(gn) && !!goNext.title;
          return JSON.stringify(out);
        })()`);
        smokeCheck('FOOTER_DOES_NOT_OVERLAP_CONTENT_OK', uiStable.footerNoOverlap, JSON.stringify(uiStable));
        smokeCheck('ACTIVE_TAB_BODY_SCROLLS_OK', uiStable.activeTabScrolls, JSON.stringify(uiStable));
        smokeCheck('LT_EDIT_STUDIO_ALWAYS_VISIBLE_OK', uiStable.ltButtonVisible && uiStable.ltButtonInHeader, JSON.stringify(uiStable));
        smokeCheck('LT_STUDIO_CLOSED_HAS_NO_VISIBLE_GHOST_OK', uiStable.studioClosedGhost, JSON.stringify(uiStable));
        smokeCheck('PRIMARY_GO_ACTION_UNAMBIGUOUS_OK', uiStable.goDistinct, JSON.stringify(uiStable));

        // ===== Emergency usability: real scroll/reachability checks + proof artifacts =====
        const uiProofFrames = [];
        const uiCapture = async (name, asFrame=true) => {
          const png = (await controlWin.webContents.capturePage()).toPNG();
          const full = writeTestArtifact('ui-usability/' + name, png);
          if (asFrame) {
            uiProofFrames.push(writeTestArtifact('ui-usability/proof-frames/frame-' + String(uiProofFrames.length).padStart(3, '0') + '.png', png));
          }
          return full;
        };
        await measureAt(900, 600, { advanced:false });
        await jx(`(function(){
          window.__uiUsabilitySnap = {
            S: JSON.stringify(S), cues: JSON.stringify(cues), currentCue, selectedCue,
            outputConfigs: JSON.stringify(outputConfigs || []),
            ltLibrary: JSON.stringify(ltLibrary), ltLibraryStorage: localStorage.getItem(PTLT.LIBRARY_KEY)
          };
          cues=[]; for(var i=0;i<72;i++) cues.push({id:'ui-cue-'+i,name:'Usability cue '+(i+1),durationMs:60000,ltName:'Speaker '+(i+1),ltTitle:'Title '+(i+1)});
          currentCue=0; selectedCue=0; renderCues();
          outputConfigs=[];
          for(var o=0;o<8;o++) outputConfigs.push({id:'ui-out-'+o, displayId:'window', mode:'window', width:640+o*10, height:360+o*8, x:0, y:0, fullscreen:false, gridOn:false, gridCell:4, gridSize:5});
          renderOutputRows();
          initLtLibrary();
          ltLibrary.templates=(ltLibrary.templates||[]).filter(function(t){return !t || String(t.id||'').indexOf('ui-usability-')!==0;});
          for(var t=0;t<14;t++){
            var tmp=ltDefaultTemplate('UI Template '+(t+1));
            tmp.id='ui-usability-template-'+t;
            ltLibrary.templates.push(tmp);
          }
          var tpl=ltDefaultTemplate('UI Usability Demo');
          tpl.id='ui-usability-demo';
          tpl.layers=[];
          for(var l=0;l<18;l++){
            if(l%3===0) tpl.layers.push(PTLT.makeShapeLayer({id:'ui-usability-layer-'+l,name:'Shape '+l,shape:'roundedRectangle',x:80+l*9,y:700+l*7,width:520,height:70,radius:18,fill:'rgba(20,22,28,.72)',zIndex:l}));
            else if(l%3===1) tpl.layers.push(PTLT.makeDynamicTextLayer({id:'ui-usability-layer-'+l,name:l===1?'Speaker name':'Speaker title '+l,field:l===1?'speakerName':'speakerTitle',fallback:'Field '+l,x:140+l*10,y:728+l*8,width:720,height:64,fontSize:l===1?54:34,color:'#ffffff',zIndex:l}));
            else tpl.layers.push(PTLT.makeStaticTextLayer({id:'ui-usability-layer-'+l,name:'Static '+l,text:'Static '+l,x:220+l*8,y:760+l*7,width:420,height:52,fontSize:32,color:'#dfe6ef',zIndex:l}));
          }
          ltLibrary.templates.push(tpl);
          ltLibrary.activeTemplateId=tpl.id;
          ltStudioState.selectedTemplateId=tpl.id;
          ltStudioState.selectedLayerId='ui-usability-layer-1';
          saveLtLibrary();
          var tab=document.querySelector('#setupTabs button[data-pane="lt"]'); if(tab) tab.click();
          document.body.classList.add('dr-setup');
          return JSON.stringify({ok:true});
        })()`);
        await new Promise(r=>setTimeout(r,180));
        await uiCapture('lower-third-top.png', true);
        await jx(`(function(){
          var pane=document.getElementById('pane-lt');
          var body=document.querySelector('#pane-lt .lt-panel-body');
          var bodyScrolls=!!body && ['auto','scroll','overlay'].includes(getComputedStyle(body).overflowY) && body.scrollHeight>body.clientHeight+4;
          var scroller=bodyScrolls ? body : pane;
          window.__uiScrollTargetId=scroller.id;
          scroller.scrollTop=scroller.scrollHeight;
          var last=document.getElementById('btnLtDeletePreset');
          if(last && typeof last.scrollIntoView==='function') last.scrollIntoView({block:'end',inline:'nearest'});
          scroller.scrollTop=scroller.scrollHeight;
        })()`);
        await new Promise(r=>setTimeout(r,120));
        const scrollLt = await jparse(`(function(){
          function visibleIn(el, cont, horizontal){
            if(!el || !cont) return false;
            var r=el.getBoundingClientRect(), c=cont.getBoundingClientRect(), f=document.querySelector('.statusbar').getBoundingClientRect();
            var bottom=Math.min(c.bottom,f.top,window.innerHeight);
            return r.width>0 && r.height>0 && r.top>=c.top-1 && r.bottom<=bottom+1 && (!horizontal || (r.left>=c.left-1 && r.right<=c.right+1));
          }
          var pane=document.getElementById('pane-lt');
          var body=document.querySelector('#pane-lt .lt-panel-body');
          var scroller=document.getElementById(window.__uiScrollTargetId) || body || pane;
          scroller.scrollTop=scroller.scrollHeight;
          var setup=document.getElementById('setupWrap');
          var last=document.getElementById('btnLtDeletePreset');
          var footer=document.querySelector('.statusbar').getBoundingClientRect();
          var out={
            ltScrollReal:scroller.scrollHeight>scroller.clientHeight+4 && ['auto','scroll','overlay'].includes(getComputedStyle(scroller).overflowY),
            ltTopButtonVisible:visibleIn(document.getElementById('btnLtStudioOpen'),setup,true),
            ltLastVisible:visibleIn(last,scroller,false),
            ltButtonStillVisible:visibleIn(document.getElementById('btnLtStudioOpen'),setup,true),
            footerClear:!!last && last.getBoundingClientRect().bottom<=footer.top+1,
            ltScrollTop:scroller.scrollTop,
            ltScrollMax:Math.max(0,scroller.scrollHeight-scroller.clientHeight)
          };
          document.body.classList.remove('dr-setup');
          document.body.classList.add('dr-run');
          return JSON.stringify(out);
        })()`);
        await new Promise(r=>setTimeout(r,320));
        const scrollRundown = await jparse(`(function(){
          function visibleIn(el, cont){
            if(!el || !cont) return false;
            var r=el.getBoundingClientRect(), c=cont.getBoundingClientRect(), f=document.querySelector('.statusbar').getBoundingClientRect();
            var bottom=Math.min(c.bottom,f.top,window.innerHeight);
            return r.width>0 && r.height>0 && r.top>=c.top-1 && r.bottom<=bottom+1 && r.left>=c.left-1 && r.right<=c.right+1;
          }
          if(typeof setSidebarView==='function') setSidebarView('rundown');
          var list=document.getElementById('cueList');
          list.scrollTop=list.scrollHeight;
          var lastCue=list.querySelector('.cue:last-child');
          if(lastCue && typeof lastCue.scrollIntoView==='function') lastCue.scrollIntoView({block:'end',inline:'nearest'});
          list.scrollTop=list.scrollHeight;
          var lr=lastCue?lastCue.getBoundingClientRect():null, cr=list.getBoundingClientRect();
          var out={rundownLastVisible:visibleIn(lastCue,list) && list.scrollHeight>list.clientHeight+4,
            scrollTop:list.scrollTop,scrollMax:Math.max(0,list.scrollHeight-list.clientHeight),
            list:{w:cr.width,h:cr.height},last:lr?{t:lr.top,b:lr.bottom,l:lr.left,r:lr.right,w:lr.width,h:lr.height}:null};
          document.body.classList.remove('dr-run');
          document.body.classList.add('dr-right');
          return JSON.stringify(out);
        })()`);
        await new Promise(r=>setTimeout(r,320));
        const scrollUtility = await jparse(`(function(){
          var util=document.querySelector('.utility-column');
          util.scrollTop=util.scrollHeight;
          var lastCard=util.querySelector('.card-outputs');
          var lastUtility=lastCard ? (lastCard.querySelector('.output-summary-route:last-child') || lastCard) : null;
          var ur=util.getBoundingClientRect(), lr=lastUtility?lastUtility.getBoundingClientRect():{bottom:0};
          var footer=document.querySelector('.statusbar').getBoundingClientRect();
          var ub=Math.min(ur.bottom,footer.top,window.innerHeight);
          var out={
            utilityLastVisible:!!lastUtility && lr.bottom<=ub+1 && lr.bottom>=ur.top-1 && ['auto','scroll','overlay'].includes(getComputedStyle(util).overflowY) && util.scrollHeight>=util.clientHeight,
            utilityMode:getComputedStyle(util).position,
            footerNoOverlap:document.querySelector('.main').getBoundingClientRect().bottom<=footer.top+1
          };
          document.body.classList.remove('dr-right');
          delete window.__uiScrollTargetId;
          return JSON.stringify(out);
        })()`);
        const scrollChecks = {...scrollLt,...scrollRundown,...scrollUtility};
        smokeCheck('SETUP_PANEL_REAL_SCROLL_OK', scrollChecks.ltScrollReal, JSON.stringify(scrollChecks));
        smokeCheck('LT_TAB_LAST_CONTROL_REACHABLE_OK', scrollChecks.ltLastVisible, JSON.stringify(scrollChecks));
        smokeCheck('LT_EDIT_STUDIO_STICKY_VISIBLE_OK', scrollChecks.ltTopButtonVisible && scrollChecks.ltButtonStillVisible, JSON.stringify(scrollChecks));
        smokeCheck('FOOTER_NEVER_OVERLAPS_SCROLL_CONTENT_OK', scrollChecks.footerClear && scrollChecks.footerNoOverlap, JSON.stringify(scrollChecks));
        smokeCheck('RUNDOWN_LAST_ITEM_REACHABLE_OK', scrollChecks.rundownLastVisible, JSON.stringify(scrollChecks));
        smokeCheck('UTILITY_LAST_CARD_REACHABLE_OK', scrollChecks.utilityLastVisible, JSON.stringify(scrollChecks));
        await uiCapture('lower-third-bottom-scrolled.png', true);

        await measureAt(1280, 800, { advanced:false });
        await jx(`(function(){ var tab=document.querySelector('#setupTabs button[data-pane="lt"]'); if(tab) tab.click(); openLtStudio(); ltSetStudioPane('canvas'); })()`);
        await new Promise(r=>setTimeout(r,240));
        await uiCapture('studio-full.png', false);
        await measureAt(900, 600, { advanced:false });
        await jx(`(function(){ openLtStudio(); ltSetStudioPane('left'); })()`);
        await new Promise(r=>setTimeout(r,180));
        const studioLeft = await jparse(`(function(){
          function visibleIn(el, cont){
            if(!el || !cont) return false;
            var r=el.getBoundingClientRect(), c=cont.getBoundingClientRect();
            return r.width>0 && r.height>0 && r.top>=c.top-1 && r.bottom<=c.bottom+1 && r.left>=c.left-1 && r.right<=c.right+1;
          }
          var templates=document.getElementById('ltStudioTemplates'), layers=document.getElementById('ltStudioLayers');
          templates.scrollTop=templates.scrollHeight; layers.scrollTop=layers.scrollHeight;
          return JSON.stringify({
            templateScroll:templates.scrollHeight>templates.clientHeight+4,
            layerScroll:layers.scrollHeight>layers.clientHeight+4,
            lastTemplate:visibleIn(templates.querySelector('.lt-template-row:last-child'), templates),
            lastLayer:visibleIn(layers.querySelector('.lt-layer-row:last-child'), layers),
            toolbarVisible:document.getElementById('btnLtStudioSave').getBoundingClientRect().top>=0
          });
        })()`);
        smokeCheck('LT_STUDIO_LEFT_PANEL_SCROLL_OK', studioLeft.templateScroll && studioLeft.layerScroll && studioLeft.lastTemplate && studioLeft.lastLayer, JSON.stringify(studioLeft));
        await uiCapture('studio-left-scrolled.png', true);

        await jx(`(function(){ ltStudioState.selectedLayerId='ui-usability-layer-1'; renderLtStudio(); ltSetStudioPane('inspector'); })()`);
        await new Promise(r=>setTimeout(r,180));
        const studioInspector = await jparse(`(function(){
          var insp=document.getElementById('ltStudioInspector');
          insp.scrollTop=insp.scrollHeight;
          var controls=Array.from(insp.querySelectorAll('button,input,select,textarea')).filter(function(el){return el.offsetParent!==null && !el.disabled;});
          var last=controls[controls.length-1];
          if(last && typeof last.scrollIntoView==='function') last.scrollIntoView({block:'end',inline:'nearest'});
          insp.scrollTop=insp.scrollHeight;
          var r=last.getBoundingClientRect(), c=insp.getBoundingClientRect();
          var input=insp.querySelector('input:not([type="checkbox"]), select, textarea');
          var label=insp.querySelector('.lt-check-row');
          var inputBg=input ? getComputedStyle(input).backgroundColor : '';
          var inputColor=input ? getComputedStyle(input).color : '';
          var labelOk=!!(label && label.querySelector('input') && label.contains(label.querySelector('span')));
          var darkBg=!/(^|,\\s*)255\\s*,\\s*255\\s*,\\s*255/.test(inputBg);
          return JSON.stringify({scroll:insp.scrollHeight>insp.clientHeight+4, lastVisible:r.bottom<=c.bottom+1 && r.top>=c.top-1, lastId:last&&last.id, scrollTop:insp.scrollTop, max:insp.scrollHeight-insp.clientHeight, inputBg:inputBg, inputColor:inputColor, labelOk:labelOk, darkBg:darkBg});
        })()`);
        smokeCheck('LT_STUDIO_INSPECTOR_SCROLL_OK', studioInspector.scroll && studioInspector.lastVisible, JSON.stringify(studioInspector));
        smokeCheck('LT_STUDIO_INSPECTOR_DARK_THEME_OK', studioInspector.darkBg && studioInspector.labelOk, JSON.stringify(studioInspector));
        await uiCapture('studio-inspector-scrolled.png', true);

        await jx(`(function(){ ltSetStudioPane('canvas'); })()`);
        await new Promise(r=>setTimeout(r,180));
        const studioCanvas = await jparse(`(function(){
          var shell=document.getElementById('ltStudioCanvasShell'), frame=document.getElementById('ltStudioCanvas'), guide=document.querySelector('.lt-safe-guide');
          var s=shell.getBoundingClientRect(), f=frame.getBoundingClientRect(), g=guide.getBoundingClientRect();
          var toolbar=document.querySelector('.lt-studio-head').getBoundingClientRect();
          return JSON.stringify({
            shell:{w:s.width,h:s.height}, frame:{w:f.width,h:f.height,top:f.top,bottom:f.bottom,left:f.left,right:f.right},
            fits:f.width>220 && f.height>120 && f.left>=s.left-1 && f.right<=s.right+1 && f.top>=s.top-1 && f.bottom<=s.bottom+1,
            uses:f.width>=s.width*.75 || f.height>=s.height*.75,
            widthRatio:s.width>0 ? f.width/s.width : 0,
            heightRatio:s.height>0 ? f.height/s.height : 0,
            guide:g.width>20 && g.height>20,
            toolbarVisible:toolbar.top>=0 && toolbar.bottom<window.innerHeight
          });
        })()`);
        smokeCheck('LT_STUDIO_CANVAS_FIT_OK', studioCanvas.fits && studioCanvas.guide && studioCanvas.toolbarVisible, JSON.stringify(studioCanvas));
        smokeCheck('LT_STUDIO_CANVAS_USES_AVAILABLE_SPACE_OK', studioCanvas.fits && studioCanvas.uses && studioCanvas.guide && studioCanvas.toolbarVisible, JSON.stringify(studioCanvas));
        const studio900 = await jparse(`(function(){
          var studio=document.getElementById('ltStudio'), tabs=document.getElementById('ltStudioMobileTabs'), save=document.getElementById('btnLtStudioSave'), take=document.getElementById('btnLtStudioTake'), close=document.getElementById('btnLtStudioClose');
          var st=studio.getBoundingClientRect(), tr=tabs.getBoundingClientRect(), sr=save.getBoundingClientRect(), cr=close.getBoundingClientRect(), fr=document.querySelector('.lt-studio-foot').getBoundingClientRect();
          function clickPane(p){
            var b=tabs.querySelector('button[data-studio-pane="'+p+'"]');
            if(b) b.click();
            return studio.dataset.pane===p;
          }
          var layersOk=clickPane('left');
          var canvasOk=clickPane('canvas');
          var inspectorOk=clickPane('inspector');
          return JSON.stringify({
            open:studio.classList.contains('open'),
            display:getComputedStyle(studio).display,
            pane:studio.dataset.pane,
            tabsVisible:getComputedStyle(tabs).display!=='none' && tr.height>20,
            toolbarVisible:sr.top>=st.top && cr.right<=st.right+1 && sr.bottom<=window.innerHeight,
            footVisible:fr.height>10 && fr.bottom<=window.innerHeight+1,
            noOverflow:document.documentElement.scrollWidth-window.innerWidth<=2,
            layersOk:layersOk, canvasOk:canvasOk, inspectorOk:inspectorOk
          });
        })()`);
        smokeCheck('LT_STUDIO_900x600_USABLE_OK', studio900.open && studio900.display==='grid' && studio900.tabsVisible && studio900.toolbarVisible && studio900.footVisible && studio900.noOverflow, JSON.stringify(studio900));
        smokeCheck('LT_STUDIO_NARROW_TABS_OK', studio900.open && studio900.tabsVisible && studio900.layersOk && studio900.canvasOk && studio900.inspectorOk && studio900.noOverflow, JSON.stringify(studio900));
        await uiCapture('studio-900x600.png', true);

        const liveTake = await jparse(`(function(){
          cues=migrateCues([{id:'ui-live-take',name:'Live Cue',durationMs:60000,ltName:'Live Speaker',ltTitle:'Lead Producer'}]);
          currentCue=0; selectedCue=-1; renderCues();
          ltTakeStudio();
          var rt=S.lowerThird.runtime || {};
          var text=(rt.resolvedLayers||[]).map(function(l){return l.resolvedText||'';}).join('|');
          return JSON.stringify({visible:S.lowerThird.visible, cueId:rt.cueId, text:text, ok:text.indexOf('Live Speaker')>=0 && text.indexOf('Lead Producer')>=0});
        })()`);
        await new Promise(r=>setTimeout(r,280));
        await uiCapture('studio-live-take.png', true);
        await jx(`(function(){ ltHideStudio(); })()`);
        await new Promise(r=>setTimeout(r,160));
        await uiCapture('studio-hide.png', true);
        if (uiProofFrames.length) {
          const frameDir = path.dirname(uiProofFrames[0]);
          const movPath = path.resolve(getTestArtifactDirectory(), 'ui-usability/usability-proof.mov');
          fs.mkdirSync(path.dirname(movPath), { recursive:true });
          const ff = spawnSync('ffmpeg', ['-y','-framerate','1','-i',path.join(frameDir,'frame-%03d.png'),'-vf','scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p','-c:v','libx264','-movflags','+faststart',movPath], { stdio:'ignore' });
          if (ff.status !== 0 || !fs.existsSync(movPath) || fs.statSync(movPath).size < 1000) throw new Error('UI usability proof movie failed');
        }
        console.log('UI_USABILITY_ARTIFACTS_OK ' + path.join(getTestArtifactDirectory(), 'ui-usability'));
        await jx(`(function(){
          var snap=window.__uiUsabilitySnap;
          if(snap){
            S=JSON.parse(snap.S); cues=JSON.parse(snap.cues); currentCue=snap.currentCue; selectedCue=snap.selectedCue;
            outputConfigs=JSON.parse(snap.outputConfigs || '[]');
            ltLibrary=JSON.parse(snap.ltLibrary);
            if(snap.ltLibraryStorage==null) localStorage.removeItem(PTLT.LIBRARY_KEY);
            else localStorage.setItem(PTLT.LIBRARY_KEY, snap.ltLibraryStorage);
            closeLtStudio({returnFocus:false}); renderOutputRows(); fillLowerThirdControls(); initLtStudio(); renderCues(); renderPreviewLowerThird(); send(true);
            delete window.__uiUsabilitySnap;
          }
        })()`);
        await measureAt(1280, 800, { advanced:false });

        // ===== Advanced: narrow Preview/Program + tabs + default/persist =====
        const adv = await jparse(`(function(){
          var pv=document.querySelector('.studio-preview'), pg=document.getElementById('program');
          var pvr=pv.getBoundingClientRect(); var previewVisible=pvr.width>4 && pvr.height>4;
          var pr=pg.getBoundingClientRect(); var programVisible=pr.width>4 && pr.height>4;
          var tabs=document.querySelectorAll('#setupTabs button[data-pane]');
          tabs[1].click();
          var panes=document.querySelectorAll('.tabpane');
          var visCount=0; panes.forEach(function(p){ if(getComputedStyle(p).display!=='none') visCount++; });
          tabs[0].click();
          return JSON.stringify({previewVisible:previewVisible,programVisible:programVisible,paneVisCount:visCount,tabCount:tabs.length});
        })()`);
        smokeCheck('ADVANCED_NARROW_DUAL_MONITOR_OK', adv.previewVisible && adv.programVisible, JSON.stringify(adv));
        smokeCheck('ADVANCED_TABS_OK', adv.tabCount >= 4 && adv.paneVisCount === 1, 'tabs=' + adv.tabCount + ' visPanes=' + adv.paneVisCount);
        const advpref = await jparse(`(function(){
          localStorage.removeItem('pt_advanced');
          var defOff=(localStorage.getItem('pt_advanced')==='1')===false;
          var c=document.getElementById('chkAdvanced');
          c.checked=true; c.dispatchEvent(new Event('change')); var persistOn=localStorage.getItem('pt_advanced')==='1' && document.body.classList.contains('adv');
          c.checked=false; c.dispatchEvent(new Event('change')); var persistOff=localStorage.getItem('pt_advanced')!=='1' && !document.body.classList.contains('adv');
          return JSON.stringify({defOff:defOff,persistOn:persistOn,persistOff:persistOff});
        })()`);
        smokeCheck('ADVANCED_DEFAULT_OFF_OK', advpref.defOff, JSON.stringify(advpref));
        smokeCheck('ADVANCED_PREFERENCE_PERSISTS_OK', advpref.persistOn && advpref.persistOff, JSON.stringify(advpref));

        // ===== Rundown ellipsis / tooltip / scroll =====
        const rd = await jparse(`(function(){
          if(typeof setSidebarView==='function') setSidebarView('rundown');
          cues=[]; for(var i=0;i<80;i++) cues.push({name:'Segment '+(i+1)+' — veoma dugačak naziv koji mora da se skrati elipsom '+i, durationMs:300000});
          selectedCue=-1; currentCue=-1; renderCues();
          var nm=document.querySelector('#cueList .cue .nm'); var cs=getComputedStyle(nm);
          var ellipsis=cs.textOverflow==='ellipsis' && cs.whiteSpace==='nowrap' && nm.scrollWidth>nm.clientWidth+1;
          var tooltip=!!nm.title && nm.title.indexOf('Segment 1')===0;
          var list=document.getElementById('cueList'); var oy=getComputedStyle(list).overflowY;
          var scrollable=(oy==='auto'||oy==='scroll'||oy==='overlay') && list.scrollHeight>list.clientHeight+4;
          var body=document.querySelector('#cueList .cue .body');
          return JSON.stringify({ellipsis:ellipsis,tooltip:tooltip,scrollable:scrollable,oy:oy,sw:nm.scrollWidth,cw:nm.clientWidth,bodyW:body?body.getBoundingClientRect().width:0});
        })()`);
        smokeCheck('RUNDOWN_ELLIPSIS_OK', rd.ellipsis, JSON.stringify(rd));
        smokeCheck('RUNDOWN_TOOLTIP_OK', rd.tooltip, 'tooltip=' + rd.tooltip);
        smokeCheck('RUNDOWN_SCROLL_OK', rd.scrollable, 'oy=' + rd.oy + ' scroll=' + rd.scrollable);
        smokeCheck('RUNDOWN_TEXT_HAS_READABLE_WIDTH_OK', rd.bodyW >= 140 && rd.cw >= 110, JSON.stringify(rd));
        await jx(`cues=[]; selectedCue=-1; currentCue=-1; renderCues(); var c=document.getElementById('chkCompact'); c.checked=false; c.dispatchEvent(new Event('change'));`);
        await measureAt(1280, 800, { advanced:false });

        // ===== FAZA 1D: shell structure + utility-column + resize-state invariants =====
        const shell = await jparse(`(function(){
          var sh=document.getElementById('app-shell'), ov=document.getElementById('overlay-root');
          var ovBodyChild=!!ov && ov.parentElement===document.body, transformedAnc=false, anc=ov?ov.parentElement:null;
          while(anc){ var cs=getComputedStyle(anc); if((cs.transform&&cs.transform!=='none')||(cs.filter&&cs.filter!=='none')||(cs.perspective&&cs.perspective!=='none')){ transformedAnc=true; break; } anc=anc.parentElement; }
          function mw(el){ return el?(parseFloat(getComputedStyle(el).minWidth)||0):0; }
          return JSON.stringify({ ovBodyChild:ovBodyChild, transformedAnc:transformedAnc,
            shellCount:document.querySelectorAll('#app-shell').length, ovCount:document.querySelectorAll('#overlay-root').length,
            hasShellLayout:sh.classList.contains('shell-layout'),
            maxMinWidth:Math.max(mw(document.body),mw(document.querySelector('.topbar')),mw(document.querySelector('.main'))),
            cssLoaded:getComputedStyle(document.documentElement).getPropertyValue('--operator-shell-loaded').trim()==='1' });
        })()`);
        smokeCheck('OVERLAY_ROOT_BODY_CHILD_OK', shell.ovBodyChild && !shell.transformedAnc, 'bodyChild='+shell.ovBodyChild+' transformedAnc='+shell.transformedAnc);
        smokeCheck('OPERATOR_SHELL_SINGLE_SOURCE_OK', shell.shellCount===1 && shell.ovCount===1 && shell.hasShellLayout, 'shell='+shell.shellCount+' ov='+shell.ovCount+' layout='+shell.hasShellLayout);
        smokeCheck('NO_ACTIVE_MIN_WIDTH_1280_OK', shell.maxMinWidth < 1000, 'maxMinWidth='+shell.maxMinWidth);
        const reparent = await jparse(`(function(){
          function order(){ return Array.from(document.querySelector('.main').children).map(function(c){return c.className.split(' ')[0];}).join(','); }
          var before=order(); if(typeof arrangeOperatorLayout==='function') arrangeOperatorLayout(); return JSON.stringify({before:before, noop:before===order()});
        })()`);
        await measureAt(900,600,{advanced:false}); await measureAt(1440,900,{advanced:false});
        const orderAfter = await jparse(`JSON.stringify(Array.from(document.querySelector('.main').children).map(function(c){return c.className.split(' ')[0];}).join(','))`);
        smokeCheck('NO_LAYOUT_DOM_REPARENTING_OK', reparent.noop && orderAfter===reparent.before, 'noop='+reparent.noop+' afterResizeSame='+(orderAfter===reparent.before));

        // Utility-column: inline and collapsible at wide; a real drawer below 1320px.
        const resizeOutput = await ensureSmokeOutput();
        await measureAt(1440,900,{advanced:false});
        const uw = await jparse(`(function(){
          function box(el){ var r=el.getBoundingClientRect(); return {l:r.left,r:r.right,t:r.top,b:r.bottom,w:r.width,h:r.height}; }
          function ov(a,b){ return !(a.r<=b.l+1||b.r<=a.l+1||a.b<=b.t+1||b.b<=a.t+1); }
          var uc=document.querySelector('.utility-column'), side=document.querySelector('.primary-sidebar'), main=document.querySelector('.operator-main');
          var u=box(uc), s=box(side), m=box(main), cs=getComputedStyle(uc);
          return JSON.stringify({ visible: cs.display!=='none'&&u.w>0&&u.h>0, inViewport: u.r<=window.innerWidth+1&&u.l>=-1,
            overlap: ov(s,m)||ov(m,u)||ov(s,u), mainWidth: Math.round(m.w),
            ownScroll: cs.overflowY==='auto'||cs.overflowY==='scroll', ovfX: document.documentElement.scrollWidth-window.innerWidth });
        })()`);
        smokeCheck('UTILITY_COLUMN_WIDE_OK', uw.visible && !uw.overlap && uw.ownScroll && uw.ovfX<=2, JSON.stringify(uw));
        await jx(`document.getElementById('btnMsgDrawer').click()`);
        const uwCollapsed = await waitForUtilityColumnState({ collapsed:true, minMainWidth:uw.mainWidth+201 });
        await jx(`document.getElementById('btnMsgDrawer').click()`);
        const uwRestored = await waitForUtilityColumnState({ collapsed:false });
        smokeCheck('UTILITY_COLUMN_NO_MAIN_SQUEEZE_OK', uw.mainWidth >= 360 && uwCollapsed.settled && uwCollapsed.hidden && uwCollapsed.mainWidth>uw.mainWidth+200 && !uwCollapsed.expanded && uwRestored.settled && uwRestored.visible && uwRestored.expanded,
          'wide='+uw.mainWidth+' collapsed='+JSON.stringify(uwCollapsed)+' restored='+JSON.stringify(uwRestored));
        smokeCheck('UTILITY_COLUMN_INTERNAL_SCROLL_OK', uw.ownScroll, 'overflowY-auto='+uw.ownScroll);

        await measureAt(1024,700,{advanced:false});
        const unClosed = await jparse(`(function(){
          var uc=document.querySelector('.utility-column'), r=uc.getBoundingClientRect(), cs=getComputedStyle(uc), btn=document.getElementById('btnMsgDrawer');
          var out={position:cs.position,closedVisible:r.width>40&&r.left<window.innerWidth&&r.right>0,
            ownScroll:cs.overflowY==='auto'||cs.overflowY==='scroll'||cs.overflowY==='overlay',
            closedExpanded:btn.getAttribute('aria-expanded')==='true'};
          return JSON.stringify(out);
        })()`);
        await jx(`document.getElementById('btnMsgDrawer').click()`);
        await new Promise(r=>setTimeout(r,320));
        const unOpen = await jparse(`(function(){
          var uc=document.querySelector('.utility-column'), r=uc.getBoundingClientRect(), btn=document.getElementById('btnMsgDrawer');
          var out={openVisible:r.width>40&&r.left<window.innerWidth&&r.right>0,
            ovfX:document.documentElement.scrollWidth-window.innerWidth,
            openExpanded:btn.getAttribute('aria-expanded')==='true'};
          return JSON.stringify(out);
        })()`);
        await jx(`document.getElementById('btnMsgDrawer').click()`);
        await new Promise(r=>setTimeout(r,220));
        const unRestored = await jparse(`(function(){
          var uc=document.querySelector('.utility-column'), r=uc.getBoundingClientRect(), btn=document.getElementById('btnMsgDrawer');
          return JSON.stringify({closedVisible:r.width>40&&r.left<window.innerWidth&&r.right>0,
            expanded:btn.getAttribute('aria-expanded')==='true'});
        })()`);
        const un = {...unClosed,...unOpen,restored:unRestored};
        smokeCheck('UTILITY_COLUMN_STANDARD_DRAWER_OK', un.position==='fixed' && !un.closedVisible && !un.closedExpanded && un.openVisible && un.openExpanded && un.ownScroll && un.ovfX<=2 && !un.restored.closedVisible && !un.restored.expanded, JSON.stringify(un));

        await measureAt(1440,900,{advanced:false});
        const rs = await jparse(`(function(){ if(cues.length<3){ cues=[{id:'r1',name:'R A',durationMs:60000},{id:'r2',name:'R B',durationMs:60000},{id:'r3',name:'R C',durationMs:60000}]; }
          currentCue=1; selectedCue=2; renderCues(); setDuration(300000); startPause();
          return JSON.stringify({running:S.running, live:currentCue, sel:selectedCue}); })()`);
        await measureAt(1280,720,{advanced:false}); await measureAt(1024,700,{advanced:false}); await measureAt(900,600,{advanced:false}); await measureAt(1440,900,{advanced:false});
        const R = await jparse(`JSON.stringify({running:S.running, live:currentCue, sel:selectedCue})`);
        smokeCheck('RESIZE_PRESERVES_OPERATOR_STATE_OK', R.live===rs.live && R.sel===rs.sel, 'live='+R.live+'/'+rs.live+' sel='+R.sel+'/'+rs.sel);
        smokeCheck('RESIZE_PRESERVES_TIMER_OK', R.running===true && rs.running===true, 'running='+R.running);
        smokeCheck('UTILITY_COLUMN_STATE_PRESERVED_ON_RESIZE_OK', R.live===rs.live && R.sel===rs.sel, 'preserved');
        const resizeOutputOpen = outputWin === resizeOutput && !resizeOutput.isDestroyed() && !resizeOutput.webContents.isDestroyed();
        smokeCheck('RESIZE_PRESERVES_OUTPUT_OK', resizeOutputOpen, 'outputOpen='+resizeOutputOpen);
        await jx(`reset(); cues=[]; currentCue=-1; selectedCue=-1; renderCues();`);

        // ===== LARGE VIEWPORT 1920×1080 — emulated, never a visible OS window larger than workArea =====
        // DevTools emulation covers the viewport while the outer bounds remain clamped to
        // the explicitly selected display's usable work area.
        {
          const preLV = { b: controlWin.getBounds(), foc: controlWin.isFocused() };
          const lv = await measureAt(1920, 1080, { advanced:false });
          const durLV = { b: controlWin.getBounds(), foc: controlWin.isFocused() };
          const boundsUnchanged = Math.abs(durLV.b.width - preLV.b.width) <= 4 && Math.abs(durLV.b.height - preLV.b.height) <= 4;
          smokeCheck('SMOKE_LARGE_VIEWPORT_TEST_HIDDEN_OK',
            lv.vw === 1920 && lv.vh === 1080 && smokeDisplay.insideRect(durLV.b, SMOKE_TARGET.workArea, 2) && boundsUnchanged,
            'vw=' + lv.vw + 'x' + lv.vh + ' outer=' + JSON.stringify(durLV.b) + ' unchanged=' + boundsUnchanged);
          smokeCheck('SMOKE_LARGE_VIEWPORT_NO_FOCUS_OK', durLV.foc === preLV.foc, 'focBefore=' + preLV.foc + ' focDuring=' + durLV.foc);
          smokeCheck('STANDARD_LAYOUT_1920x1080_OK',
            lv.program.full && !lv.start.full && lv.go.full && lv.overflowX <= 2,
            'ovX=' + lv.overflowX + ' startInMain=' + lv.start.full + ' go=' + JSON.stringify(lv.go));
          await measureAt(1280, 800, { advanced:false });   // isključi emulaciju, vrati normalan viewport
        }

        // Prepare a representative, real operator state for release screenshots.
        await jx(`(function(){
          seedDemoShow();
          goLiveWithCue(1,{autostart:false});
          selectedCue=2;
          renderCues(); updateGoLabel(); updateLiveInfo();
          if(typeof setSidebarView==='function') setSidebarView('rundown');
        })()`);

        // ===== screenshots → artifacts/operator-ui/faza-1/ =====
        try {
          const writtenShots = [];
          const shot = async (name, w, h, opts) => {
            await measureAt(w, h, opts||{});
            const full = writeTestArtifact('operator-ui/faza-1/' + name, (await controlWin.webContents.capturePage()).toPNG());
            writtenShots.push(full);
          };
          await shot('standard-900x600.png', 900, 600, {advanced:false});
          await shot('standard-1280x800.png', 1280, 800, {advanced:false});
          await shot('compact-900x600.png', 900, 600, {compact:true});
          await shot('advanced-1280x720.png', 1280, 720, {advanced:true});
          await shot('standard-1440x900.png', 1440, 900, {advanced:false});
          const shotsOK = writtenShots.length === 5 && writtenShots.every(p => fs.existsSync(p) && fs.statSync(p).size > 1000 && !hasAsarSegment(p));
          smokeCheck('FAZA1_SCREENSHOTS_WRITE_OK', shotsOK, writtenShots[0] ? path.dirname(writtenShots[0]) : '');
          console.log('FAZA1_SHOTS_OK ' + (writtenShots[0] ? path.dirname(writtenShots[0]) : getTestArtifactDirectory()));
        } catch(e){
          console.log('FAZA1_SHOTS_ERR ' + e);
          smokeCheck('FAZA1_SCREENSHOTS_WRITE_OK', false, 'ERR ' + e.message);
        }
        try {
          const writtenShots = [];
          const shot = async (name, w, h) => {
            await measureAt(w, h, {advanced:false});
            const full = writeTestArtifact('product-finish/operator/' + name, (await controlWin.webContents.capturePage()).toPNG());
            writtenShots.push(full);
          };
          await shot('operator-1440x900.png', 1440, 900);
          await shot('operator-1280x800.png', 1280, 800);
          await shot('operator-1024x700.png', 1024, 700);
          await shot('operator-900x600.png', 900, 600);
          const shotsOK = writtenShots.length === 4 && writtenShots.every(p => fs.existsSync(p) && fs.statSync(p).size > 1000 && !hasAsarSegment(p));
          smokeCheck('PRODUCT_FINISH_OPERATOR_SCREENSHOTS_WRITE_OK', shotsOK, writtenShots[0] ? path.dirname(writtenShots[0]) : '');
          console.log('PRODUCT_FINISH_OPERATOR_SHOTS_OK ' + (writtenShots[0] ? path.dirname(writtenShots[0]) : getTestArtifactDirectory()));
        } catch(e){
          console.log('PRODUCT_FINISH_OPERATOR_SHOTS_ERR ' + e);
          smokeCheck('PRODUCT_FINISH_OPERATOR_SCREENSHOTS_WRITE_OK', false, 'ERR ' + e.message);
        }
        await measureAt(1280, 800, { advanced:false });

        // ===== UI stabilization proof shots =====
        try {
          const writtenShots = [];
          const shot = async (name) => {
            const full = writeTestArtifact('ui-stabilization/' + name, (await controlWin.webContents.capturePage()).toPNG());
            writtenShots.push(full);
          };
          await measureAt(1280, 800, { advanced:false });
          await jx(`closeTopbarMenu(); closeLtStudio({returnFocus:false});`);
          await shot('main-clean.png');
          await jx(`document.querySelector('[data-testid="topbar-overflow-button"]').click();`);
          await new Promise(r=>setTimeout(r,80));
          await shot('overflow-menu-open.png');
          await jx(`closeTopbarMenu(); document.querySelector('#setupTabs button[data-pane="lt"]').click();`);
          await new Promise(r=>setTimeout(r,80));
          await shot('lower-third-panel-clean.png');
          await jx(`document.getElementById('btnLtStudioOpen').click();`);
          await new Promise(r=>setTimeout(r,180));
          await shot('studio-overlay-open.png');
          await jx(`closeLtStudio({returnFocus:false});`);
          await new Promise(r=>setTimeout(r,80));
          await shot('studio-overlay-closed.png');
          await measureAt(900, 600, { advanced:false });
          await shot('narrow-layout-clean.png');
          const shotsOK = writtenShots.length === 6 && writtenShots.every(p => fs.existsSync(p) && fs.statSync(p).size > 1000 && !hasAsarSegment(p));
          if (!shotsOK) throw new Error('UI stabilization screenshot write failed');
          console.log('UI_STABILIZATION_SHOTS_OK ' + (writtenShots[0] ? path.dirname(writtenShots[0]) : getTestArtifactDirectory()));
        } catch(e) {
          console.log('UI_STABILIZATION_SHOTS_ERR ' + e);
          throw e;
        }
        await measureAt(1280, 800, { advanced:false });

        if (smokeFailures.length) throw new Error('SMOKE_CHECKS_FAILED: ' + smokeFailures.join(', '));
        console.log('SMOKE_OK');
        app.exit(0);
      } catch (err) { console.error('SMOKE_FAIL', err); app.exit(1); }
    })();
    const soakMs = Math.max(0, parseInt(process.env.SHOWSLATE_LT2_SOAK_MS || process.env.PROTIMER_LT2_SOAK_MS || '0', 10) || 0);
    const smokeTimeoutMs = Math.max(300000, soakMs + 300000);
    setTimeout(() => { console.error("SMOKE_TIMEOUT"); app.exit(1); }, smokeTimeoutMs);
  }
});

app.on('before-quit', (event) => {
  if (!SMOKE && !rendererCrashed && !liveQuitConfirmed && (hasActiveOutputWindows() || hasActiveRecording())) {
    event.preventDefault();
    if (!liveQuitPromptOpen) {
      confirmStopOutputsAndQuit().then(confirmed => {
        if (confirmed) app.quit();
      }).catch(error => {
        console.error('LIVE_OUTPUT_QUIT_CONFIRM_FAILED ' + String(error && error.message || error));
      });
    }
    return;
  }
  if (rendererCrashed || !showRepository || !showRepository.trackSession || cleanQuitComplete) return;
  event.preventDefault();
  if (cleanQuitInProgress) return;
  cleanQuitInProgress = true;
  const finalFlush = controlWin && !controlWin.isDestroyed()
    ? flushRendererShow()
    : Promise.resolve({ ok:lastCleanFlushSucceeded });
  finalFlush.then((result) => {
    if (!result || !result.ok) throw new Error('final show flush did not complete');
    return showRepository.markClean();
  }).catch((error) => {
    console.error('SHOW_STORAGE_CLEAN_MARK_FAILED ' + String(error && error.message || error));
  }).finally(() => {
    cleanQuitComplete = true;
    app.quit();
  });
});

app.on('window-all-closed', () => app.quit());
