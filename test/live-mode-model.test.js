'use strict';

const assert = require('assert');
const liveMode = require('../src/live-mode/model.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`${name}=true`);
}

check('LIVE_MODE_DECK_MAPS_SCENES_TO_COLUMNS_AND_LAYERS_TO_ROWS_OK', () => {
  const deck = liveMode.buildDeck([
    { id: 'opening', name: 'Opening', layers: [
      { id: 'background', type: 'color', name: 'Background' },
      { id: 'logo', type: 'image', name: 'Logo', livePersistent: true }
    ] },
    { id: 'camera', name: 'Camera', layers: [
      { id: 'camera-card', type: 'capture', name: 'Camera 1' }
    ] }
  ], { previewSceneId: 'camera', programSceneId: 'opening' });
  assert.deepStrictEqual(deck.scenes.map(scene => scene.id), ['opening', 'camera']);
  assert.deepStrictEqual(deck.rows[0].cells.map(cell => cell && cell.id), ['logo', 'camera-card']);
  assert.deepStrictEqual(deck.rows[1].cells.map(cell => cell && cell.id), ['background', null]);
  assert.strictEqual(deck.scenes[0].activeProgram, true);
  assert.strictEqual(deck.scenes[1].activePreview, true);
  assert.strictEqual(deck.rows[0].cells[0].persistent, true);
});

check('LIVE_MODE_PERSISTENT_LAYER_SURVIVES_SCENE_TAKE_ONCE_OK', () => {
  const result = liveMode.mergePersistentLayers(
    { id: 'camera', layers: [{ id: 'camera-card', type: 'capture' }] },
    { id: 'opening', layers: [
      { id: 'background', type: 'color' },
      { id: 'logo-program', programSourceLayerId: 'logo', programSourceSceneId: 'opening', type: 'image', livePersistent: true }
    ] }
  );
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['camera-card', 'logo-program']);
  assert.strictEqual(result.retained.length, 1);
  const second = liveMode.mergePersistentLayers(result.scene, result.scene);
  assert.deepStrictEqual(second.scene.layers.map(layer => layer.id), ['camera-card', 'logo-program']);
  assert.strictEqual(second.retained.length, 0);
});

check('LIVE_MODE_TARGET_SLOT_REPLACES_PERSISTENT_OVERLAY_OK', () => {
  const result = liveMode.mergePersistentLayers(
    { id: 'sponsor-b', layers: [{ id: 'sponsor-b-logo', type: 'image', name: 'Sponsor B', liveSlot: 'sponsor' }] },
    { id: 'sponsor-a', layers: [{ id: 'sponsor-a-logo', type: 'image', name: 'Sponsor A', liveSlot: 'sponsor', livePersistent: true }] }
  );
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['sponsor-b-logo']);
  assert.strictEqual(result.retained.length, 0);
});

check('LIVE_MODE_NAVIGATION_AND_PREFERENCES_ARE_BOUNDED_OK', () => {
  const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'b', -1).id, 'a');
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'b', 1).id, 'c');
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'a', -1).id, 'a');
  assert.deepStrictEqual(liveMode.normalizePreferences({ triggerMode: 'invalid', transition: 'cut' }), { triggerMode: 'preview', transition: 'cut' });
});

console.log(`LIVE_MODE_MODEL_TESTS_OK count=${passed}`);
