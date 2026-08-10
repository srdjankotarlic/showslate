'use strict';

const assert = require('assert');
const compositor = require('../src/compositor/model.js');
const { LiveInputConsumer } = require('../src/live-input/consumer.js');

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(name + '=true'); }

check('COMPOSITOR_CANVAS_PRESETS_AND_LIMITS_OK', () => {
  const canvas = compositor.normalizeCanvas({ width: 99999, height: 2, fps: 120, background: '#123456' });
  assert.deepStrictEqual({ width: canvas.width, height: canvas.height, fps: canvas.fps }, { width: 8192, height: 180, fps: 60 });
  assert.strictEqual(compositor.canvasPreset({ width: 1920, height: 1080 }), '1080p');
});

check('COMPOSITOR_LAYER_TYPES_AND_TRANSFORMS_OK', () => {
  const layer = compositor.normalizeLayer({ type: 'capture-card', inputId: 'card-1', x: -150, y: 250, w: 400, h: 0, rotation: 45, opacity: 2 });
  assert.strictEqual(layer.type, 'capture');
  assert.strictEqual(layer.inputId, 'card-1');
  assert.deepStrictEqual({ x: layer.x, y: layer.y, w: layer.w, h: layer.h, opacity: layer.opacity }, { x: -100, y: 200, w: 300, h: 1, opacity: 1 });
});

check('COMPOSITOR_COLOR_SOURCE_NORMALIZES_OK', () => {
  const layer = compositor.normalizeLayer({ type: 'color', color: '#2468ac', name: 'Background' });
  assert.strictEqual(layer.color, '#2468ac');
  assert.strictEqual(layer.bg, '#2468ac');
});

check('COMPOSITOR_ADVANCED_LAYER_STYLE_NORMALIZES_OK', () => {
  const layer = compositor.normalizeLayer({
    type: 'video', crop: { top: 80, left: 7 }, flipX: true, transformOrigin: 'top-left',
    objectPositionX: 73, blendMode: 'screen', cornerRadius: 14, brightness: 1.2,
    contrast: 1.3, saturation: 1.4, hue: 22, blur: 3, playbackRate: 1.5
  });
  assert.deepStrictEqual(layer.crop, { top: 49, right: 0, bottom: 0, left: 7 });
  assert.strictEqual(layer.playbackRate, 1.5);
  const style = compositor.layerVisualStyle(layer);
  assert.strictEqual(style.transform, 'rotate(0deg) scale(-1, 1)');
  assert.strictEqual(style.transformOrigin, '0% 0%');
  assert.strictEqual(style.mixBlendMode, 'screen');
  assert.strictEqual(style.clipPath, 'inset(49% 0% 0% 7%)');
  assert.ok(style.filter.includes('brightness(1.2)'));
  assert.strictEqual(style.borderRadius, '14%');
  assert.strictEqual(style.objectPosition, '73% 50%');
});

check('COMPOSITOR_TEXT_STYLE_NORMALIZES_OK', () => {
  const layer = compositor.normalizeLayer({ type: 'text', text: 'Speaker name', fontFamily: 'mono', fontWeight: 800, textAlign: 'left', verticalAlign: 'bottom', italic: true, underline: true });
  assert.deepStrictEqual({ fontFamily: layer.fontFamily, fontWeight: layer.fontWeight, textAlign: layer.textAlign, verticalAlign: layer.verticalAlign, italic: layer.italic, underline: layer.underline }, { fontFamily: 'mono', fontWeight: 800, textAlign: 'left', verticalAlign: 'bottom', italic: true, underline: true });
});

check('COMPOSITOR_LIVE_INPUT_DEVICE_AUDIO_OK', () => {
  const input = compositor.normalizeLiveInput({ id: 'capture-1', type: 'device', videoDeviceId: 'video-1', audioDeviceId: 'audio-1', withAudio: true, width: 3840, height: 2160, fps: 60 });
  assert.strictEqual(input.withAudio, true);
  assert.deepStrictEqual({ width: input.width, height: input.height, fps: input.fps }, { width: 3840, height: 2160, fps: 60 });
});

check('COMPOSITOR_WINDOW_SYSTEM_AUDIO_OK', () => {
  const enabled = compositor.normalizeLiveInput({ id: 'window-audio', type: 'window', desktopSourceId: 'window:42', withAudio: true });
  const disabled = compositor.normalizeLiveInput({ id: 'window-silent', type: 'window', desktopSourceId: 'window:43', withAudio: false });
  assert.strictEqual(enabled.withAudio, true);
  assert.strictEqual(disabled.withAudio, false);
});

check('COMPOSITOR_CAPTURE_FRAMING_AND_QUALITY_OK', () => {
  assert.strictEqual(compositor.normalizeLayer({ type: 'window' }).fit, 'contain');
  assert.strictEqual(compositor.normalizeLayer({ type: 'image' }).fit, 'cover');
  const scaled = compositor.captureQuality({ width: 1308, height: 950 }, { width: 1920, height: 1080 }, 'contain');
  assert.strictEqual(scaled.ready, true);
  assert.strictEqual(scaled.needsUpscale, true);
  assert.strictEqual(scaled.aspectMismatch, true);
  assert.strictEqual(scaled.crops, false);
  const native = compositor.captureQuality({ width: 1920, height: 1080 }, { width: 1920, height: 1080 }, 'cover');
  assert.strictEqual(native.needsUpscale, false);
  assert.strictEqual(native.aspectMismatch, false);
  assert.strictEqual(native.crops, false);
});

check('COMPOSITOR_AUDIO_INPUT_AND_MONITORING_OK', () => {
  const input = compositor.normalizeLiveInput({ id: 'mixer-1', type: 'audio', name: 'FOH mix', audioDeviceId: 'usb-audio-1', audioDeviceLabel: 'USB Audio Interface', withAudio: true });
  const layer = compositor.normalizeLayer({ id: 'audio-layer-1', type: 'audio', inputId: input.id, audioEnabled: true, audioMonitoring: 'monitor-only', volume: 0.65 });
  assert.strictEqual(input.type, 'audio');
  assert.strictEqual(input.videoDeviceId, '');
  assert.strictEqual(input.audioDeviceId, 'usb-audio-1');
  assert.strictEqual(input.withAudio, true);
  assert.strictEqual(layer.type, 'audio');
  assert.strictEqual(layer.audioMonitoring, 'monitor-only');
  assert.deepStrictEqual(compositor.activeLiveInputIds([{ id: 'scene', layers: [layer] }]), ['mixer-1']);
});

check('COMPOSITOR_LIVE_INPUT_IDS_DEDUPLICATE_OK', () => {
  const inputs = compositor.normalizeLiveInputs([{ id: 'same', type: 'window' }, { id: 'same', type: 'device' }]);
  assert.strictEqual(inputs.length, 1);
  assert.strictEqual(inputs[0].type, 'window');
});

check('COMPOSITOR_LIVE_INPUT_ERROR_WAITS_FOR_RESTART_OK', () => {
  const consumer = new LiveInputConsumer({});
  const record = { pc: null, pendingCandidates: [], subscribing: false, awaitingOffer: true, retryTimer: setTimeout(() => {}, 1000), retryCount: 2, blockedByError: false };
  consumer.peers.set('capture-1', record);
  consumer.handleStatus({ inputId: 'capture-1', state: 'error', error: 'Capture timed out.' });
  assert.strictEqual(record.blockedByError, true);
  assert.strictEqual(record.awaitingOffer, false);
  assert.strictEqual(record.retryTimer, null);
  consumer.handleStatus({ inputId: 'capture-1', state: 'restarting' });
  assert.strictEqual(record.blockedByError, false);
  consumer.dispose();
});

check('COMPOSITOR_LIVE_INPUT_REATTACHES_BOTH_MONITORS_OK', () => {
  const consumer = new LiveInputConsumer({});
  const listeners = {};
  const element = {
    dataset: {}, isConnected: true, srcObject: null, muted: true, defaultMuted: true, volume: 0,
    addEventListener(name, callback) { listeners[name] = callback; },
    play() { return Promise.resolve(); }
  };
  const first = { getTracks: () => [] };
  const second = { getTracks: () => [] };
  consumer.streams.set('window-1', first);
  consumer.attach(element, 'window-1', { muted: true, volume: 0 });
  assert.strictEqual(element.srcObject, first);
  assert.strictEqual(listeners.emptied, undefined);
  consumer.streams.set('window-1', second);
  consumer.sync(['window-1']);
  assert.strictEqual(element.srcObject, second);
  consumer.dispose();
});

check('COMPOSITOR_REFERENCED_INPUTS_AND_ACTIVATION_OK', () => {
  const scenes = [{ id: 'scene', layers: [
    { id: 'a', type: 'window', inputId: 'win-1', visible: true },
    { id: 'b', type: 'capture', inputId: 'card-1', visible: false },
    { id: 'c', type: 'capture', inputId: 'card-2', visible: true }
  ] }];
  assert.deepStrictEqual(compositor.referencedLiveInputIds(scenes), ['win-1', 'card-1', 'card-2']);
  assert.deepStrictEqual(compositor.activeLiveInputIds(scenes), ['win-1', 'card-2']);
  const active = compositor.activateReferencedInputs([
    { id: 'win-1', type: 'window' }, { id: 'card-1', type: 'device' }, { id: 'card-2', type: 'device' }
  ], scenes);
  assert.deepStrictEqual(active.map(row => row.active), [true, false, true]);
});

check('COMPOSITOR_SCENE_PRESERVES_STACK_ORDER_OK', () => {
  const scene = compositor.normalizeScene({ id: 'scene', layers: [
    { id: 'background', type: 'color' }, { id: 'camera', type: 'capture', inputId: 'card' }, { id: 'logo', type: 'image' }
  ] });
  assert.deepStrictEqual(scene.layers.map(layer => layer.id), ['background', 'camera', 'logo']);
});

check('COMPOSITOR_AUDIO_ROUTE_CONFLICT_OK', () => {
  assert.deepStrictEqual(compositor.outputAudioConflicts([
    { id: 'a', name: 'Projector', liveAudio: true }, { id: 'b', name: 'Recorder', liveAudio: true }, { id: 'c', liveAudio: false }
  ]), ['Projector', 'Recorder']);
  assert.deepStrictEqual(compositor.outputAudioConflicts([{ id: 'a', liveAudio: true }]), []);
});

console.log('COMPOSITOR_MODEL_TESTS_OK count=' + passed);
