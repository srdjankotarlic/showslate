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
    return `row:${programRow(layer, index)}`;
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

  function programRow(layer, fallback) {
    return Number.isInteger(layer.programLiveRow) && layer.programLiveRow >= 0
      ? layer.programLiveRow : fallback;
  }

  function sceneLayers(scene) {
    return (Array.isArray(scene && scene.layers) ? scene.layers : [])
      .filter(layer => layer && typeof layer === 'object');
  }

  function programLayers(scene, fromPreview = false) {
    const layers = sceneLayers(scene);
    return layers.map((layer, index) => ({
      ...clone(layer),
      programLiveRow: fromPreview ? layers.length - index - 1 : programRow(layer, layers.length - index - 1),
      programSourceLayerId: text((!fromPreview && layer.programSourceLayerId) || layer.id),
      programSourceSceneId: text((!fromPreview && layer.programSourceSceneId) || (scene && scene.id))
    }));
  }

  function sameSource(left, right) {
    const leftId = text(left.programSourceLayerId || left.id);
    const rightId = text(right.programSourceLayerId || right.id);
    return !!leftId && leftId === rightId &&
      text(left.programSourceSceneId) === text(right.programSourceSceneId);
  }

  function sameExplicitSlot(left, right) {
    const slot = text(left.liveSlot).toLowerCase();
    return !!slot && slot === text(right.liveSlot).toLowerCase();
  }

  function uniqueProgramId(layer, layers) {
    const occupied = new Set(layers.map(row => text(row.id)));
    if (text(layer.id) && !occupied.has(text(layer.id))) return;
    // Imported scenes can use the same layer IDs. Keep source provenance separate
    // from the unique runtime ID used by the output renderer's keyed elements.
    const sceneId = text(layer.programSourceSceneId, 'scene').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 60);
    const sourceId = text(layer.programSourceLayerId, 'layer').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 70);
    const base = `live-${sceneId}:${sourceId}`;
    let candidate = base;
    let suffix = 2;
    while (occupied.has(candidate)) candidate = `${base}-${suffix++}`;
    layer.id = candidate;
  }

  function sortProgramLayers(layers) {
    return layers.sort((left, right) => right.programLiveRow - left.programLiveRow);
  }

  function takeClip(programScene, sourceScene, layerId) {
    if (!programScene || !sourceScene) return null;
    const sourceLayers = sceneLayers(sourceScene);
    const sourceIndex = sourceLayers.findIndex(layer => text(layer.id) === text(layerId));
    if (sourceIndex < 0) return null;
    const scene = clone(programScene);
    const current = programLayers(programScene);
    const layer = programLayers(sourceScene, true)[sourceIndex];
    const slotMatch = current.find(row => sameExplicitSlot(layer, row));
    const rowIndex = slotMatch ? slotMatch.programLiveRow : sourceLayers.length - sourceIndex - 1;
    layer.programLiveRow = rowIndex;
    layer.visible = true;
    const replaces = row => row.programLiveRow === rowIndex || sameSource(layer, row) || sameExplicitSlot(layer, row);
    const replaced = current.filter(replaces);
    const remaining = current.filter(row => !replaces(row));
    uniqueProgramId(layer, remaining);
    scene.layers = sortProgramLayers([...remaining, layer]);
    return { scene, layer, rowIndex, replaced };
  }

  function mergePersistentLayers(targetScene, programScene) {
    const target = clone(targetScene || { id: '', name: 'Scene', layers: [] });
    target.layers = programLayers(targetScene, true);
    const targetRows = [...target.layers];
    const current = programLayers(programScene);
    const retained = [];
    current.forEach(layer => {
      if (layer.livePersistent !== true || layer.visible === false) return;
      const copy = clone(layer);
      const slotMatch = targetRows.find(row => sameExplicitSlot(copy, row));
      if (slotMatch) copy.programLiveRow = slotMatch.programLiveRow;
      if (retained.some(row => sameSource(copy, row) || sameExplicitSlot(copy, row) || row.programLiveRow === copy.programLiveRow)) return;
      // PIN means ignore a scene/column launch for this row. Only an explicit
      // clip take may replace it; unrelated default names are never slot IDs.
      target.layers = target.layers.filter(row => row.programLiveRow !== copy.programLiveRow && !sameSource(copy, row) && !sameExplicitSlot(copy, row));
      uniqueProgramId(copy, target.layers);
      target.layers.push(copy);
      retained.push(copy);
    });
    sortProgramLayers(target.layers);
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
    takeClip,
    mergePersistentLayers,
    sceneAtOffset
  };
});
