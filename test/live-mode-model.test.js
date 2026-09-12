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

check('LIVE_MODE_PIN_IGNORES_SCENE_LAUNCH_FOR_ITS_ROW_OK', () => {
  const result = liveMode.mergePersistentLayers(
    { id: 'camera', layers: [{ id: 'camera-card', type: 'capture' }, { id: 'new-overlay', type: 'text' }] },
    { id: 'opening', layers: [
      { id: 'background', type: 'color' },
      { id: 'logo-program', programSourceLayerId: 'logo', programSourceSceneId: 'opening', type: 'image', livePersistent: true }
    ] }
  );
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['camera-card', 'logo-program']);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.programLiveRow), [1, 0]);
  assert.strictEqual(result.retained.length, 1);
  const second = liveMode.mergePersistentLayers(result.scene, result.scene);
  assert.deepStrictEqual(second.scene, result.scene);
});

check('LIVE_MODE_PINNED_EXPLICIT_SLOT_IGNORES_COLUMN_REPLACEMENT_OK', () => {
  const result = liveMode.mergePersistentLayers(
    { id: 'sponsor-b', layers: [{ id: 'sponsor-b-logo', type: 'image', name: 'Sponsor B', liveSlot: 'sponsor' }] },
    { id: 'sponsor-a', layers: [{ id: 'sponsor-a-logo', type: 'image', name: 'Sponsor A', liveSlot: 'sponsor', livePersistent: true }] }
  );
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['sponsor-a-logo']);
  assert.strictEqual(result.retained.length, 1);
  assert.strictEqual(result.retained[0].programSourceSceneId, 'sponsor-a');
});

check('LIVE_MODE_PIN_NEVER_USES_DEFAULT_NAMES_AS_SLOT_IDS_OK', () => {
  const target = { id: 'next', layers: [{ id: 'background', type: 'image', name: 'Image' }, { id: 'top', type: 'text' }] };
  const current = { id: 'live', layers: [{ id: 'logo', type: 'image', name: 'Image', livePersistent: true }] };
  const result = liveMode.mergePersistentLayers(target, current);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['background', 'logo']);
  assert.strictEqual(liveMode.layerSlotKey({ type: 'image', name: 'Image' }, 0), 'row:0');
  assert.strictEqual(liveMode.layerSlotKey({ liveSlot: ' Sponsor ' }, 0), 'slot:sponsor');
});

check('LIVE_MODE_PIN_PRESERVES_RUNTIME_AND_DOES_NOT_MUTATE_PREVIEW_OK', () => {
  const target = { id: 'next', layers: [{ id: 'same-id', type: 'image' }, { id: 'top', type: 'text' }] };
  const current = { id: 'live', layers: [{ id: 'same-id', type: 'video', livePersistent: true, playbackPosition: 42, playbackState: 'playing' }] };
  const before = JSON.stringify({ target, current });
  const result = liveMode.mergePersistentLayers(target, current);
  assert.strictEqual(JSON.stringify({ target, current }), before);
  assert.strictEqual(new Set(result.scene.layers.map(layer => layer.id)).size, 2);
  const retained = result.retained[0];
  assert.strictEqual(retained.programSourceLayerId, 'same-id');
  assert.strictEqual(retained.programSourceSceneId, 'live');
  assert.strictEqual(retained.playbackPosition, 42);
  assert.strictEqual(retained.playbackState, 'playing');
  assert.strictEqual(result.scene.layers[0].programSourceSceneId, 'next');
});

check('LIVE_MODE_HIDDEN_PIN_DOES_NOT_SUPPRESS_NEXT_SCENE_OK', () => {
  const result = liveMode.mergePersistentLayers(
    { id: 'next', layers: [{ id: 'next-clip', type: 'video' }] },
    { id: 'live', layers: [{ id: 'hidden', type: 'image', livePersistent: true, visible: false }] }
  );
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['next-clip']);
  assert.strictEqual(result.retained.length, 0);
});

check('LIVE_MODE_MULTIPLE_PINS_FOLLOW_EXPLICIT_SLOTS_WITHOUT_DROPPING_EACH_OTHER_OK', () => {
  const current = { id: 'live', layers: [
    { id: 'back-pin', liveSlot: 'background', livePersistent: true },
    { id: 'front-pin', liveSlot: 'title', livePersistent: true }
  ] };
  const target = { id: 'next', layers: [
    { id: 'new-title', liveSlot: 'title' },
    { id: 'new-background', liveSlot: 'background' }
  ] };
  const result = liveMode.mergePersistentLayers(target, current);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['front-pin', 'back-pin']);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.programLiveRow), [1, 0]);
  assert.strictEqual(result.retained.length, 2);
});

check('LIVE_MODE_PINNED_BACK_ROW_DOES_NOT_JUMP_FORWARD_IN_A_SHORTER_SCENE_OK', () => {
  const current = { id: 'live', layers: [
    { id: 'background-pin', livePersistent: true, programLiveRow: 2 },
    { id: 'front', programLiveRow: 0 }
  ] };
  const target = { id: 'next', layers: [{ id: 'next-front' }] };
  const result = liveMode.mergePersistentLayers(target, current);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['background-pin', 'next-front']);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.programLiveRow), [2, 0]);
  const replacement = liveMode.takeClip(result.scene, { id: 'new-front', layers: [{ id: 'replacement' }] }, 'replacement');
  assert.deepStrictEqual(replacement.scene.layers.map(layer => layer.id), ['background-pin', 'replacement']);
  assert.deepStrictEqual(replacement.scene.layers.map(layer => layer.programLiveRow), [2, 0]);
});

check('LIVE_MODE_CLIP_TAKE_REPLACES_ONE_ROW_WITHOUT_CHANGING_SCENE_OK', () => {
  const program = { id: 'program', name: 'On air', layers: [{ id: 'bottom' }, { id: 'middle' }, { id: 'top', livePersistent: true }] };
  const source = { id: 'preview', layers: [{ id: 'replacement', type: 'video', visible: false }, { id: 'unused' }] };
  const before = JSON.stringify({ program, source });
  const result = liveMode.takeClip(program, source, 'replacement');
  assert.strictEqual(JSON.stringify({ program, source }), before);
  assert.strictEqual(result.scene.id, 'program');
  assert.strictEqual(result.scene.name, 'On air');
  assert.strictEqual(result.rowIndex, 1);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['bottom', 'replacement', 'top']);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.programLiveRow), [2, 1, 0]);
  assert.deepStrictEqual(result.replaced.map(layer => layer.id), ['middle']);
  assert.strictEqual(result.layer.visible, true);
  assert.strictEqual(result.layer.programSourceLayerId, 'replacement');
  assert.strictEqual(result.layer.programSourceSceneId, 'preview');
  assert.strictEqual(result.scene.layers[2].livePersistent, true);
});

check('LIVE_MODE_ALTERNATING_CLIPS_NEVER_ACCUMULATE_IN_A_ROW_OK', () => {
  const a = { id: 'a', layers: [{ id: 'a-background' }, { id: 'a-clip' }] };
  const b = { id: 'b', layers: [{ id: 'b-background' }, { id: 'b-clip' }] };
  let program = a;
  for (let index = 0; index < 20; index++) {
    const source = index % 2 ? a : b;
    const result = liveMode.takeClip(program, source, source.layers[1].id);
    assert.strictEqual(result.scene.layers.length, 2);
    assert.strictEqual(result.scene.layers[0].id, 'a-background');
    assert.strictEqual(result.layer.programLiveRow, 0);
    program = result.scene;
  }
  assert.deepStrictEqual(program.layers.map(layer => layer.id), ['a-background', 'a-clip']);
});

check('LIVE_MODE_CLIP_TAKE_PRESERVES_EMPTY_ROW_POSITIONS_OK', () => {
  const program = { id: 'live', layers: [{ id: 'top' }] };
  const source = { id: 'source', layers: [{ id: 'bottom' }, { id: 'middle' }, { id: 'top-other' }] };
  const first = liveMode.takeClip(program, source, 'bottom');
  assert.deepStrictEqual(first.scene.layers.map(layer => layer.programLiveRow), [2, 0]);
  first.layer.visible = false;
  const second = liveMode.takeClip(first.scene, source, 'middle');
  assert.deepStrictEqual(second.scene.layers.map(layer => layer.id), ['bottom', 'middle', 'top']);
  assert.deepStrictEqual(second.scene.layers.map(layer => layer.programLiveRow), [2, 1, 0]);
  assert.strictEqual(second.scene.layers[0].visible, false);
});

check('LIVE_MODE_EXPLICIT_CLIP_TAKE_REPLACES_PIN_AND_MATCHES_NAMED_SLOT_OK', () => {
  const program = { id: 'live', layers: [{ id: 'pinned', liveSlot: 'sponsor', livePersistent: true }, { id: 'top' }] };
  const source = { id: 'preview', layers: [{ id: 'new', liveSlot: 'Sponsor' }] };
  const result = liveMode.takeClip(program, source, 'new');
  assert.strictEqual(result.rowIndex, 1);
  assert.deepStrictEqual(result.scene.layers.map(layer => layer.id), ['new', 'top']);
  assert.notStrictEqual(result.layer.livePersistent, true);
  assert.deepStrictEqual(result.replaced.map(layer => layer.id), ['pinned']);
});

check('LIVE_MODE_CLIP_IDS_ARE_UNIQUE_WITH_SCENE_SCOPED_PROVENANCE_OK', () => {
  const program = { id: 'live', layers: [{ id: 'shared' }, { id: 'top' }] };
  const source = { id: 'preview', layers: [{ id: 'shared' }] };
  const first = liveMode.takeClip(program, source, 'shared');
  assert.strictEqual(first.scene.layers.length, 2);
  assert.notStrictEqual(first.layer.id, 'shared');
  assert.strictEqual(first.layer.programSourceLayerId, 'shared');
  assert.strictEqual(first.layer.programSourceSceneId, 'preview');
  const second = liveMode.takeClip(first.scene, source, 'shared');
  assert.strictEqual(second.scene.layers.length, 2);
  assert.strictEqual(second.layer.id, first.layer.id);
  assert.strictEqual(new Set(second.scene.layers.map(layer => layer.id)).size, 2);
});

check('LIVE_MODE_INVALID_CLIP_TAKE_IS_A_NOOP_OK', () => {
  const program = { id: 'live', layers: [{ id: 'top' }] };
  const before = JSON.stringify(program);
  assert.strictEqual(liveMode.takeClip(program, { id: 'preview', layers: [] }, 'missing'), null);
  assert.strictEqual(liveMode.takeClip(null, { layers: [{ id: 'clip' }] }, 'clip'), null);
  assert.strictEqual(JSON.stringify(program), before);
});

check('LIVE_MODE_NAVIGATION_AND_PREFERENCES_ARE_BOUNDED_OK', () => {
  const scenes = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'b', -1).id, 'a');
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'b', 1).id, 'c');
  assert.strictEqual(liveMode.sceneAtOffset(scenes, 'a', -1).id, 'a');
  assert.deepStrictEqual(liveMode.normalizePreferences({ triggerMode: 'invalid', transition: 'cut' }), { triggerMode: 'preview', transition: 'cut' });
});

console.log(`LIVE_MODE_MODEL_TESTS_OK count=${passed}`);
