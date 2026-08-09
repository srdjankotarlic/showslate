'use strict';

const assert = require('assert');
const compositor = require('../src/compositor/model.js');

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

check('COMPOSITOR_LIVE_INPUT_DEVICE_AUDIO_OK', () => {
  const input = compositor.normalizeLiveInput({ id: 'capture-1', type: 'device', videoDeviceId: 'video-1', audioDeviceId: 'audio-1', withAudio: true, width: 3840, height: 2160, fps: 60 });
  assert.strictEqual(input.withAudio, true);
  assert.deepStrictEqual({ width: input.width, height: input.height, fps: input.fps }, { width: 3840, height: 2160, fps: 60 });
});

check('COMPOSITOR_LIVE_INPUT_IDS_DEDUPLICATE_OK', () => {
  const inputs = compositor.normalizeLiveInputs([{ id: 'same', type: 'window' }, { id: 'same', type: 'device' }]);
  assert.strictEqual(inputs.length, 1);
  assert.strictEqual(inputs[0].type, 'window');
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
