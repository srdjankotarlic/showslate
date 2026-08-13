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
  assert.strictEqual(compositor.canvasPreset({ width: 3840, height: 960 }), 'led-wide');
  assert.strictEqual(compositor.canvasPreset({ width: 5376, height: 768 }), 'custom');
});

check('COMPOSITOR_MULTIPLE_COMPOSITIONS_AND_PROJECTOR_MAPPING_OK', () => {
  const compositions = compositor.normalizeCompositions([
    { id: 'main', name: 'Main', canvas: { width: 1920, height: 1080 } },
    { id: 'led', name: 'LED Wall', canvas: { width: 5376, height: 768, fps: 50 }, mappings: [
      { id: 'left', name: 'Left projector', outputId: 'output-left', x: 0, y: 0, width: 2688, height: 768, blend: { right: 96 } },
      { id: 'right', name: 'Right projector', outputId: 'output-right', x: 2688, y: 0, width: 99999, height: 99999, blend: { left: 96 } }
    ] }
  ]);
  assert.strictEqual(compositions.length, 2);
  assert.deepStrictEqual(compositions[1].canvas, { schemaVersion: 1, width: 5376, height: 768, fps: 50, background: '#000000', transparent: false });
  assert.deepStrictEqual(
    compositions[1].mappings.map(mapping => ({ id: mapping.id, outputId: mapping.outputId, x: mapping.input.x, width: mapping.input.width, height: mapping.input.height })),
    [
      { id: 'left', outputId: 'output-left', x: 0, width: 2688, height: 768 },
      { id: 'right', outputId: 'output-right', x: 2688, width: 2688, height: 768 }
    ]
  );
});

check('COMPOSITOR_PROJECTOR_CORNER_PIN_AND_GRID_OK', () => {
  const warp = compositor.normalizeProjectorWarp({
    enabled: true,
    corners: {
      topLeft: { x: 4, y: 7 }, topRight: { x: 97, y: 2 },
      bottomRight: { x: 92, y: 95 }, bottomLeft: { x: 8, y: 98 }
    },
    grid: { visible: true, columns: 12, rows: 9, opacity: 0.8 }
  });
  assert.strictEqual(compositor.projectorWarpIsValid(warp), true);
  assert.deepStrictEqual(warp.corners.topLeft, { x: 4, y: 7 });
  assert.deepStrictEqual(warp.corners.bottomRight, { x: 92, y: 95 });
  assert.deepStrictEqual(warp.grid, { visible: true, columns: 12, rows: 9, opacity: 0.8, pattern: 'grid', labels: true });
  const guarded = compositor.normalizeProjectorWarp({
    enabled: true,
    corners: { topLeft: { x: 120, y: 120 }, topRight: { x: -20, y: -20 } }
  });
  assert.strictEqual(compositor.projectorWarpIsValid(guarded), true);
  assert.ok(guarded.corners.topLeft.x < guarded.corners.topRight.x);
});

check('COMPOSITOR_ADVANCED_OUTPUT_SURFACE_NORMALIZES_OK', () => {
  const mapping = compositor.normalizeProjectorMapping({
    id: 'stage-left', outputId: 'projector-a', enabled: true, solo: true,
    input: { x: 960, y: 0, width: 960, height: 1080, flipX: true },
    output: { x: 5, y: 8, width: 86, height: 72, rotation: 3 },
    mask: { enabled: true, points: [{x:0,y:0},{x:100,y:12},{x:88,y:100},{x:8,y:90}] },
    warp: { enabled: true, mode: 'mesh', mesh: { columns: 2, rows: 2, points: [
      {x:0,y:0},{x:50,y:3},{x:100,y:0},{x:2,y:50},{x:48,y:54},{x:98,y:49},{x:0,y:100},{x:52,y:97},{x:100,y:100}
    ] }, grid: { visible: true, pattern: 'checker', labels: false } },
    blend: { left: 120, gamma: 1.4, blackLevel: 0.08 }
  }, 0, { width: 1920, height: 1080 });
  assert.deepStrictEqual(mapping.input, { x: 960, y: 0, width: 960, height: 1080, flipX: true, flipY: false });
  assert.strictEqual(mapping.output.width, 86);
  assert.strictEqual(mapping.mask.points.length, 4);
  assert.strictEqual(mapping.warp.mode, 'mesh');
  assert.strictEqual(mapping.warp.mesh.points.length, 9);
  assert.strictEqual(mapping.blend.gamma, 1.4);
  assert.strictEqual(compositor.projectorWarpIsValid(mapping.warp), true);
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
  const input = compositor.normalizeLiveInput({ id: 'capture-1', type: 'device', videoDeviceId: 'video-1', audioDeviceId: 'audio-1', withAudio: true, width: 3840, height: 2160, fps: 59.94, captureMode: 'compatible', qualityProfile: 'quality' });
  assert.strictEqual(input.withAudio, true);
  assert.deepStrictEqual({ width: input.width, height: input.height, fps: input.fps, captureMode: input.captureMode, qualityProfile: input.qualityProfile }, { width: 3840, height: 2160, fps: 59.94, captureMode: 'compatible', qualityProfile: 'quality' });
  assert.strictEqual(compositor.normalizeLiveInput({ type: 'device', captureMode: 'invalid' }).captureMode, 'low-latency');
  assert.strictEqual(compositor.normalizeLiveInput({ type: 'device', qualityProfile: 'invalid' }).qualityProfile, 'auto');
});

check('COMPOSITOR_UHD_PROGRAM_AND_OPERATOR_PROXY_PROFILES_OK', () => {
  const definition = compositor.normalizeLiveInput({
    id: 'capture-uhd', type: 'device', videoDeviceId: 'card-1', width: 3840, height: 2160,
    fps: 59.94, qualityProfile: 'quality'
  });
  const settings = { width: 3840, height: 2160, frameRate: 59.94 };
  const program = compositor.liveTransportProfile(definition, settings, 'program');
  const operator = compositor.liveTransportProfile(definition, settings, 'operator');
  assert.deepStrictEqual(
    { tier: program.sourceTier, width: program.targetWidth, height: program.targetHeight, fps: program.targetFrameRate, scale: program.scaleResolutionDownBy, preference: program.degradationPreference },
    { tier: 'UHD', width: 3840, height: 2160, fps: 59.94, scale: 1, preference: 'maintain-resolution' }
  );
  assert.deepStrictEqual(
    { width: operator.targetWidth, height: operator.targetHeight, fps: operator.targetFrameRate, scale: operator.scaleResolutionDownBy, preference: operator.degradationPreference },
    { width: 1280, height: 720, fps: 30, scale: 3, preference: 'maintain-resolution' }
  );
  assert.ok(program.maxBitrate > operator.maxBitrate);
  assert.ok(operator.maxBitrate <= 12000000);
  const automaticOperator = compositor.liveTransportProfile({ ...definition, qualityProfile: 'auto' }, settings, 'operator');
  assert.strictEqual(automaticOperator.targetFrameRate, 30);
  assert.strictEqual(automaticOperator.degradationPreference, 'maintain-resolution');
  const automaticProgram = compositor.liveTransportProfile({ ...definition, qualityProfile: 'auto' }, settings, 'program');
  assert.strictEqual(automaticProgram.degradationPreference, 'maintain-framerate');
  assert.ok(automaticProgram.maxBitrate > automaticOperator.maxBitrate);
  const realtime = compositor.liveTransportProfile({ ...definition, qualityProfile: 'realtime' }, settings, 'program');
  assert.strictEqual(realtime.degradationPreference, 'maintain-framerate');
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

check('COMPOSITOR_VIDEO_TRANSPORT_IN_OUT_LOOP_AND_AUDIO_OK', () => {
  const layer = compositor.normalizeLayer({
    id: 'clip', type: 'video', inPoint: 10, outPoint: 14, playbackState: 'playing',
    playbackPosition: 10, playbackUpdatedAt: 1000, playbackRate: 1,
    endBehavior: 'loop', restartOnTake: true, audioEnabled: true,
    videoAudioConfigured: true, audioMonitoring: 'monitor-and-output', muted: false, volume: 0.72
  });
  const looped = compositor.resolveMediaPlayback(layer, 6500, 30);
  assert.strictEqual(looped.state, 'playing');
  assert.ok(Math.abs(looped.position - 11.5) < 0.001);
  const paused = compositor.mediaTransportCommand(layer, 'pause', { now: 3000, duration: 30 });
  assert.strictEqual(paused.playbackState, 'paused');
  assert.ok(Math.abs(paused.playbackPosition - 12) < 0.001);
  const restarted = compositor.mediaTransportCommand({ ...layer, ...paused }, 'restart', { now: 4000, duration: 30 });
  assert.deepStrictEqual({ state: restarted.playbackState, position: restarted.playbackPosition }, { state: 'playing', position: 10 });
  assert.deepStrictEqual(
    { monitoring: layer.audioMonitoring, enabled: layer.audioEnabled, muted: layer.muted, volume: layer.volume, restartOnTake: layer.restartOnTake },
    { monitoring: 'monitor-and-output', enabled: true, muted: false, volume: 0.72, restartOnTake: true }
  );
});

check('COMPOSITOR_LEGACY_VIDEO_AUDIO_MIGRATES_AUDIBLE_OK', () => {
  const legacy = compositor.normalizeLayer({ id: 'legacy-clip', type: 'video', audioEnabled: false, muted: true });
  const intentional = compositor.normalizeLayer({ id: 'silent-clip', type: 'video', videoAudioConfigured: true, audioEnabled: false, muted: true });
  assert.strictEqual(legacy.audioEnabled, true);
  assert.strictEqual(legacy.muted, false);
  assert.strictEqual(intentional.audioEnabled, false);
  assert.strictEqual(intentional.muted, true);
});

console.log('COMPOSITOR_MODEL_TESTS_OK count=' + passed);
