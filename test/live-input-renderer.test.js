'use strict';

const assert = require('node:assert/strict');
const { app, BrowserWindow, ipcMain, webContents, session } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(process.env.SHOWSLATE_TEST_APP_ROOT || path.join(__dirname, '..'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-live-input-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const windows = [];
const consumers = new Map();
const statuses = [];
let hub;
let hubReady = false;
let checks = 0;
let finished = false;

function finish(code, error) {
  if (finished) return;
  finished = true;
  if (error) console.error(error.stack || error);
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(code);
}
const deadline = setTimeout(() => finish(1, new Error('Hidden live-input integration exceeded 40 seconds.')), 40000);
function check(name, condition) { assert.ok(condition, name); console.log(name + '=true'); checks++; }
async function until(label, probe, timeout = 10000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const result = await probe();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 80));
  }
  throw new Error(label + ' timed out. Hub status: ' + JSON.stringify(statuses));
}
function send(command) { hub.webContents.send('live-hub-command', command); }

ipcMain.on('live-hub-ready', () => { hubReady = true; });
ipcMain.on('live-hub-status', (event, payload) => {
  statuses.push(payload);
  for (const id of consumers.keys()) webContents.fromId(id)?.send('live-input-status', payload);
});
ipcMain.on('live-hub-signal', (event, payload) => {
  if (consumers.has(payload.consumerId)) webContents.fromId(payload.consumerId)?.send('live-input-signal', payload);
});
ipcMain.handle('live-input-subscribe', (event, inputId) => {
  if (!consumers.has(event.sender.id)) return { ok: false };
  send({ type: 'subscribe', consumerId: event.sender.id, inputId, profile: consumers.get(event.sender.id) });
  return { ok: true };
});
ipcMain.on('live-input-unsubscribe', (event, inputId) => send({ type: 'unsubscribe', consumerId: event.sender.id, inputId }));
ipcMain.handle('live-input-signal-to-hub', (event, payload) => {
  send({ type: 'signal', payload: { ...payload, consumerId: event.sender.id } });
  return { ok: true };
});

async function createConsumer(label) {
  const win = new BrowserWindow({
    show: false, width: 640, height: 360,
    webPreferences: { preload: path.join(root, 'preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  windows.push(win);
  consumers.set(win.webContents.id, label === 'preview' ? 'operator' : 'program');
  await win.loadURL('data:text/html,<html><body><video id="video"></video></body></html>');
  await win.webContents.executeJavaScript(fs.readFileSync(path.join(root, 'src/live-input/consumer.js'), 'utf8'));
  await win.webContents.executeJavaScript(`
    window.consumer = new ShowSlateLiveInput.LiveInputConsumer(window.pt, { label: ${JSON.stringify(label)} });
    window.video = document.getElementById('video');
    consumer.attach(video, 'synthetic', { muted: ${label === 'preview'}, volume: 1 });
  `);
  return win;
}

async function videoSnapshot(win) {
  return win.webContents.executeJavaScript(`(() => ({
    frames: video.getVideoPlaybackQuality().totalVideoFrames, width: video.videoWidth,
    muted: video.muted, defaultMuted: video.defaultMuted, time: video.currentTime,
    tracks: video.srcObject ? video.srcObject.getTracks().length : 0,
    state: consumer.peers.get('synthetic')?.pc?.connectionState
  }))()`);
}

app.whenReady().then(async () => {
  // Every window stays hidden. The existing TEST_MODE creates canvas video
  // and zero-gain audio; physical capture permissions are denied in this app.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  hub = new BrowserWindow({
    show: false, width: 640, height: 360,
    webPreferences: { preload: path.join(root, 'live-input-preload.js'), contextIsolation: true, nodeIntegration: false, backgroundThrottling: false }
  });
  windows.push(hub);
  await hub.loadFile(path.join(root, 'live-input.html'), { query: { test: '1' } });
  await until('Capture hub readiness', () => hubReady);
  send({ type: 'configure', definitions: [{
    id: 'synthetic', name: 'Hidden synthetic source', type: 'device',
    videoDeviceId: '__showslate_synthetic__', width: 640, height: 360, fps: 30,
    active: true, withAudio: true, autoReconnect: false
  }] });
  await until('Synthetic capture startup', () => statuses.some(row => row.inputId === 'synthetic' && row.state === 'live'));
  const sourceBefore = await hub.webContents.executeJavaScript(`(() => {
    const input = liveCapture.inputs.get('synthetic');
    return { startedAt: input.startedAt, trackId: input.stream.getVideoTracks()[0].id };
  })()`);
  const preview = await createConsumer('preview');
  const program = await createConsumer('program');
  const first = await until('Preview and Program real WebRTC frames', async () => {
    const rows = await Promise.all([videoSnapshot(preview), videoSnapshot(program)]);
    return rows.every(row => row.state === 'connected' && row.width > 0 && row.frames >= 3 && row.tracks === 2) ? rows : false;
  });
  check('LIVE_WEBRTC_MUTED_PREVIEW_AND_PROGRAM_CONNECTED_OK', first[0].muted && first[0].defaultMuted && !first[1].muted);
  await until('Advancing decoded frames in both consumers', async () => {
    const rows = await Promise.all([videoSnapshot(preview), videoSnapshot(program)]);
    return rows.every((row, i) => row.frames >= first[i].frames + 3 && row.time > first[i].time);
  });
  check('LIVE_WEBRTC_BOTH_CONSUMERS_ADVANCE_OK', true);
  check('LIVE_WEBRTC_SINGLE_SHARED_CAPTURE_OK', await hub.webContents.executeJavaScript('liveCapture.inputs.size === 1 && liveCapture.peers.size === 2'));

  await preview.webContents.executeJavaScript("consumer.sync([])");
  await until('Preview unsubscribe', () => hub.webContents.executeJavaScript('liveCapture.peers.size === 1'));
  const programBefore = await videoSnapshot(program);
  check('LIVE_WEBRTC_UNSUBSCRIBE_CLEARS_PREVIEW_OK', await preview.webContents.executeJavaScript('consumer.peers.size === 0 && video.srcObject === null'));
  await until('Program unaffected by Preview unsubscribe', async () => (await videoSnapshot(program)).frames >= programBefore.frames + 3);
  check('LIVE_WEBRTC_PREVIEW_ISOLATED_FROM_PROGRAM_OK', true);

  await preview.webContents.executeJavaScript("consumer.attach(video, 'synthetic', { muted: true, volume: 1 })");
  await until('Preview reconnect', async () => {
    const row = await videoSnapshot(preview);
    return row.state === 'connected' && row.tracks === 2 && row.width > 0;
  });
  await until('Both peer senders restored', () => hub.webContents.executeJavaScript('liveCapture.peers.size === 2'));
  const sourceAfter = await hub.webContents.executeJavaScript(`(() => {
    const input = liveCapture.inputs.get('synthetic');
    return { startedAt: input.startedAt, trackId: input.stream.getVideoTracks()[0].id };
  })()`);
  check('LIVE_WEBRTC_RECONNECT_REUSES_CAPTURE_OK', sourceAfter.startedAt === sourceBefore.startedAt && sourceAfter.trackId === sourceBefore.trackId);
  for (const win of [preview, program]) await win.webContents.executeJavaScript('consumer.dispose()');
  await until('Final peer release', () => hub.webContents.executeJavaScript('liveCapture.peers.size === 0'));
  check('LIVE_WEBRTC_ALL_CONSUMERS_RELEASED_OK', true);
  check('LIVE_WEBRTC_ALL_WINDOWS_HIDDEN_OK', windows.every(win => !win.isVisible()));
  check('LIVE_WEBRTC_NO_CAPTURE_ERRORS_OK', statuses.every(row => row.state !== 'error'));
  console.log('LIVE_INPUT_RENDERER_TESTS_OK count=' + checks);
  clearTimeout(deadline);
  finish(0);
}).catch(error => finish(1, error));
