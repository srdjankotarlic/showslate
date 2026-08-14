(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateLiveMode = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const TRIGGER_MODES = new Set(['preview', 'direct']);
  const TRANSITIONS = new Set(['cut', 'fade']);

  function clone(value) {
    return JSON.parse(JSON.stringify(value == null ? null : value));
  }

  function text(value, fallback = '') {
    const clean = String(value == null ? '' : value)
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .trim();
    return clean || fallback;
  }

  function normalizePreferences(raw = {}) {
    return {
      triggerMode: TRIGGER_MODES.has(raw.triggerMode) ? raw.triggerMode : 'preview',
      transition: TRANSITIONS.has(raw.transition) ? raw.transition : 'fade'
    };
  }

  function layerSlotKey(layer = {}, index = 0) {
    const slot = text(layer.liveSlot).toLowerCase();
    if (slot) return `slot:${slot}`;
    const type = text(layer.type, 'source').toLowerCase();
    const name = text(layer.name || layer.sourceName).toLowerCase();
    return name ? `named:${type}:${name}` : `stack:${type}:${index}`;
  }

  function normalizeCell(layer, scene, stackIndex) {
    if (!layer) return null;
    return {
      id: text(layer.id, `layer-${stackIndex + 1}`),
      sceneId: text(scene.id),
      sceneName: text(scene.name, 'Scene'),
      name: text(layer.name || layer.sourceName, text(layer.type, 'Source')),
      type: text(layer.type, 'source').toLowerCase(),
      visible: layer.visible !== false,
      persistent: layer.livePersistent === true,
      liveSlot: text(layer.liveSlot),
      inputId: text(layer.inputId),
      thumbnail: text(layer.thumbnail || (layer.type === 'image' ? layer.src : '')),
      sourceWidth: Number(layer.sourceWidth) || 0,
      sourceHeight: Number(layer.sourceHeight) || 0,
      stackIndex
    };
  }

  function buildDeck(rawScenes, options = {}) {
    const scenes = (Array.isArray(rawScenes) ? rawScenes : [])
      .filter(scene => scene && scene.internal !== true)
      .map((scene, sceneIndex) => {
        const layers = Array.isArray(scene.layers) ? scene.layers : [];
        const topFirst = [...layers].reverse();
        return {
          id: text(scene.id, `scene-${sceneIndex + 1}`),
          name: text(scene.name, `Scene ${sceneIndex + 1}`),
          index: sceneIndex,
          activePreview: String(scene.id) === String(options.previewSceneId || ''),
          activeProgram: String(scene.id) === String(options.programSceneId || ''),
          layerCount: layers.length,
          layers: topFirst.map((layer, stackIndex) => normalizeCell(layer, scene, stackIndex))
        };
      });
    const rowCount = scenes.reduce((maximum, scene) => Math.max(maximum, scene.layers.length), 0);
    const rows = Array.from({ length: rowCount }, (_, rowIndex) => ({
      index: rowIndex,
      label: `Layer ${rowIndex + 1}`,
      cells: scenes.map(scene => scene.layers[rowIndex] || null)
    }));
    return { scenes, rows, rowCount };
  }

  function sourceIdentity(layer = {}) {
    return text(layer.programSourceLayerId || layer.id);
  }

  function mergePersistentLayers(targetScene, programScene) {
    const target = clone(targetScene || { id: '', name: 'Scene', layers: [] });
    target.layers = Array.isArray(target.layers) ? target.layers : [];
    const current = Array.isArray(programScene && programScene.layers) ? programScene.layers : [];
    const targetIds = new Set();
    const targetSlots = new Set();
    target.layers.forEach((layer, index) => {
      targetIds.add(String(layer.id || ''));
      targetIds.add(String(layer.programSourceLayerId || ''));
      targetSlots.add(layerSlotKey(layer, index));
    });
    const retained = [];
    current.forEach((layer, index) => {
      if (!layer || layer.livePersistent !== true || layer.visible === false) return;
      const sourceId = sourceIdentity(layer);
      const slot = layerSlotKey(layer, index);
      if (targetIds.has(sourceId) || targetIds.has(String(layer.id || '')) || targetSlots.has(slot)) return;
      const copy = clone(layer);
      copy.programSourceLayerId = sourceId;
      copy.programSourceSceneId = text(layer.programSourceSceneId || (programScene && programScene.id));
      retained.push(copy);
      targetIds.add(sourceId);
      targetSlots.add(slot);
    });
    target.layers.push(...retained);
    return { scene: target, retained };
  }

  function sceneAtOffset(rawScenes, currentId, offset) {
    const scenes = (Array.isArray(rawScenes) ? rawScenes : []).filter(scene => scene && scene.internal !== true);
    if (!scenes.length) return null;
    const current = scenes.findIndex(scene => String(scene.id) === String(currentId || ''));
    const base = current >= 0 ? current : 0;
    const index = Math.max(0, Math.min(scenes.length - 1, base + Number(offset || 0)));
    return scenes[index] || null;
  }

  return {
    TRIGGER_MODES: [...TRIGGER_MODES],
    TRANSITIONS: [...TRANSITIONS],
    normalizePreferences,
    layerSlotKey,
    buildDeck,
    mergePersistentLayers,
    sceneAtOffset
  };
});
