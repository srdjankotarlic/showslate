'use strict';

const assert = require('assert');
const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = path.resolve(process.env.SHOWSLATE_TEST_APP_ROOT || path.join(__dirname, '..'));
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'showslate-output-audio-'));
app.setPath('userData', profile);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

const subscriptions = [];
const unsubscriptions = [];
ipcMain.handle('live-input-subscribe', (event, id) => {
  subscriptions.push(id);
  return { ok: true };
});
ipcMain.on('live-input-unsubscribe', (event, id) => unsubscriptions.push(id));
ipcMain.on('output-rendered', () => {});

let win;
let checks = 0;
function check(name, condition) {
  assert.ok(condition, name);
  console.log(`${name}=true`);
  checks++;
}

app.whenReady().then(async () => {
  // Real output DOM and consumer, with a silent synthetic audio source. No
  // visible window, physical device, speaker output or saved show is needed.
  win = new BrowserWindow({
    show: false, width: 640, height: 360,
    webPreferences: {
      preload: path.join(root, 'preload.js'), contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false
    }
  });
  await win.loadFile(path.join(root, 'output.html'));
  const initial = await win.webContents.executeJavaScript(`(async () => {
    window.__audioContext = new AudioContext();
    window.__audioDestination = __audioContext.createMediaStreamDestination();
    window.__silentSource = __audioContext.createOscillator();
    const gain = __audioContext.createGain();
    gain.gain.value = 0;
    __silentSource.connect(gain).connect(__audioDestination);
    __silentSource.start();
    await __audioContext.resume();
    liveInputConsumer.streams.set('sound', __audioDestination.stream);
    window.__audioState = {
      canvas: { width: 1920, height: 1080, fps: 30 },
      activeSceneId: 'audio-scene', sceneFadeMs: 0,
      scenes: [{ id: 'audio-scene', layers: [{
        id: 'sound-layer', type: 'audio', inputId: 'sound',
        audioEnabled: true, visible: true, volume: 0.4
      }] }],
      _outputRoute: { liveAudio: false }
    };
    applyState(__audioState);
    renderScene();
    const audio = document.querySelector('#sceneRoot audio');
    window.__audioElement = audio;
    window.__sinkRequests = [];
    window.__testSinkId = '';
    Object.defineProperty(audio, 'sinkId', { get: () => __testSinkId });
    audio.setSinkId = async id => { __sinkRequests.push(id); __testSinkId = id; };
    return {
      retained: liveInputConsumer.desired.has('sound') && liveInputConsumer.peers.has('sound'),
      connected: audio?.srcObject === __audioDestination.stream,
      live: __audioDestination.stream.getAudioTracks()[0].readyState === 'live',
      muted: audio?.muted && audio?.defaultMuted
    };
  })()`);
  check('OUTPUT_AUDIO_ONLY_SUBSCRIPTION_RETAINED_OK', initial.retained && initial.connected && initial.live);
  check('OUTPUT_AUDIO_DEFAULT_ROUTE_MUTED_OK', initial.muted);

  const routed = await win.webContents.executeJavaScript(`(() => {
    __audioState._outputRoute.liveAudio = true;
    __audioState._outputRoute.audioOutputDeviceId = 'test-speakers';
    applyState(__audioState); renderScene();
    const audio = document.querySelector('#sceneRoot audio');
    return { same: audio === __audioElement, muted: audio.muted, volume: audio.volume, sink: audio.sinkId };
  })()`);
  check('OUTPUT_AUDIO_ROUTE_UPDATE_REUSES_STREAM_OK', routed.same && !routed.muted && routed.volume === 0.4 && routed.sink === 'test-speakers');

  const defaultSink = await win.webContents.executeJavaScript(`(() => {
    __audioState._outputRoute.audioOutputDeviceId = '';
    applyState(__audioState); renderScene();
    applyState(__audioState); renderScene();
    return __audioElement.sinkId === '' && JSON.stringify(__sinkRequests) === JSON.stringify(['test-speakers', '']);
  })()`);
  check('OUTPUT_AUDIO_SYSTEM_DEFAULT_RESTORED_ONCE_OK', defaultSink);

  const monitoring = await win.webContents.executeJavaScript(`(() => {
    __audioState.scenes[0].layers[0].audioMonitoring = 'monitor-only';
    applyState(__audioState); renderScene();
    return document.querySelector('#sceneRoot audio').muted;
  })()`);
  check('OUTPUT_AUDIO_MONITOR_ONLY_REMAINS_MUTED_OK', monitoring);

  const disabled = await win.webContents.executeJavaScript(`(() => {
    const layer = __audioState.scenes[0].layers[0];
    layer.audioMonitoring = 'off'; layer.audioEnabled = false;
    applyState(__audioState); renderScene();
    return document.querySelector('#sceneRoot audio').muted;
  })()`);
  check('OUTPUT_AUDIO_DISABLED_LAYER_REMAINS_MUTED_OK', disabled);

  const hidden = await win.webContents.executeJavaScript(`(() => {
    __audioState.scenes[0].layers[0].visible = false;
    applyState(__audioState); renderScene();
    return !document.querySelector('#sceneRoot audio')
      && !liveInputConsumer.desired.has('sound')
      && !liveInputConsumer.peers.has('sound')
      && __audioDestination.stream.getAudioTracks()[0].readyState === 'ended';
  })()`);
  check('OUTPUT_AUDIO_HIDDEN_LAYER_RELEASES_STREAM_OK', hidden);

  const mixed = await win.webContents.executeJavaScript(`(() => {
    __audioState.scenes[0].layers = [
      { id: 'window-layer', type: 'window', inputId: 'slides' },
      { id: 'capture-layer', type: 'capture', inputId: 'camera' },
      { id: 'audio-layer', type: 'audio', inputId: 'microphone' }
    ];
    applyState(__audioState); renderScene();
    const desired = [...liveInputConsumer.desired].sort().join(',');
    applyState(__audioState); renderScene();
    return desired === 'camera,microphone,slides' && liveInputConsumer.peers.size === 3;
  })()`);
  check('OUTPUT_MIXED_LIVE_SOURCES_RETAINED_OK', mixed);
  const cleaned = await win.webContents.executeJavaScript(`(async () => {
    __audioState.scenes[0].layers = [];
    applyState(__audioState); renderScene();
    __silentSource.stop();
    await __audioContext.close();
    return liveInputConsumer.desired.size === 0 && liveInputConsumer.peers.size === 0;
  })()`);
  check('OUTPUT_EMPTY_SCENE_RELEASES_LIVE_SOURCES_OK', cleaned);
  // Round-trip through IPC before inspecting the sent unsubscribe events.
  await win.webContents.executeJavaScript('api.liveInputSubscribe("ipc-barrier")');
  check('OUTPUT_LIVE_SUBSCRIPTIONS_NOT_RESTARTED_ON_STATE_UPDATES_OK',
    ['sound', 'slides', 'camera', 'microphone'].every(id =>
      subscriptions.filter(value => value === id).length === 1
      && unsubscriptions.filter(value => value === id).length === 1));
  check('OUTPUT_AUDIO_TEST_WINDOW_HIDDEN_OK', !win.isVisible());
  console.log(`OUTPUT_AUDIO_RENDERER_TESTS_OK count=${checks}`);
  win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(0);
}).catch(error => {
  console.error(error.stack || error);
  if (win && !win.isDestroyed()) win.destroy();
  fs.rmSync(profile, { recursive: true, force: true });
  app.exit(1);
});
