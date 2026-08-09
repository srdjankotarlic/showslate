(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PTSC = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TYPES = ['image', 'video', 'pdf', 'text', 'blank', 'timer', 'logo', 'color', 'window', 'capture', 'scene'];

  function sceneType(scene) {
    const layers = Array.isArray(scene && scene.layers) ? scene.layers : [];
    const visible = layers.filter(layer => layer && layer.visible !== false);
    if (visible.length > 1) return 'scene';
    if (visible.some(layer => layer && layer.type === 'timer')) return 'timer';
    const media = visible.find(layer => layer && ['image', 'video', 'pdf', 'window', 'capture'].includes(layer.type));
    if (media) return media.type;
    const color = visible.find(layer => layer && layer.type === 'color');
    if (color) return 'color';
    const text = visible.find(layer => layer && layer.type === 'text');
    if (text && String(text.text || '').trim()) return 'text';
    return 'blank';
  }

  function deriveItem(scene) {
    const type = sceneType(scene);
    const media = (scene.layers || []).find(layer => layer && ['image', 'video', 'pdf'].includes(layer.type));
    return {
      id: 'content-' + String(scene.id),
      name: String(scene.name || 'Untitled content'),
      type,
      sceneId: String(scene.id),
      assetId: media ? String(media.src || '') : '',
      page: media && media.type === 'pdf' ? Math.max(1, Number(media.page) || 1) : 1
    };
  }

  function normalizeItem(raw, scene) {
    const derived = deriveItem(scene);
    const requestedType = String(raw && raw.type || derived.type);
    return {
      ...derived,
      ...(raw && typeof raw === 'object' ? raw : {}),
      id: String(raw && raw.id || derived.id),
      name: String(raw && raw.name || scene.name || derived.name).slice(0, 160),
      type: TYPES.includes(requestedType) ? requestedType : derived.type,
      sceneId: String(scene.id),
      assetId: String(raw && raw.assetId || derived.assetId || ''),
      page: Math.max(1, Math.min(999, Math.trunc(Number(raw && raw.page || derived.page) || 1)))
    };
  }

  function normalizeModel(raw, scenes, activeSceneId) {
    const availableScenes = (Array.isArray(scenes) ? scenes : []).filter(scene => scene && scene.id && !scene.internal);
    const sceneById = new Map(availableScenes.map(scene => [String(scene.id), scene]));
    const existing = Array.isArray(raw && raw.items) ? raw.items : [];
    const usedSceneIds = new Set();
    const usedItemIds = new Set();
    const items = [];
    existing.forEach(item => {
      const scene = sceneById.get(String(item && item.sceneId || ''));
      if (!scene || usedSceneIds.has(String(scene.id))) return;
      const clean = normalizeItem(item, scene);
      if (usedItemIds.has(clean.id)) clean.id = clean.id + '-' + items.length;
      usedSceneIds.add(String(scene.id));
      usedItemIds.add(clean.id);
      items.push(clean);
    });
    availableScenes.forEach(scene => {
      if (usedSceneIds.has(String(scene.id))) return;
      const clean = normalizeItem(null, scene);
      if (usedItemIds.has(clean.id)) clean.id = clean.id + '-' + items.length;
      usedItemIds.add(clean.id);
      items.push(clean);
    });
    const selectedRequested = String(raw && raw.selectedContentItemId || '');
    const activeItem = items.find(item => item.sceneId === String(activeSceneId || ''));
    const selectedContentItemId = items.some(item => item.id === selectedRequested)
      ? selectedRequested : (activeItem ? activeItem.id : (items[0] ? items[0].id : ''));
    const liveRequested = String(raw && raw.liveContentItemId || '');
    const liveContentItemId = items.some(item => item.id === liveRequested) ? liveRequested : '';
    return { items, selectedContentItemId, liveContentItemId };
  }

  function cueTakePlan(cue, model) {
    const id = String(cue && cue.contentItemId || '');
    const item = model && Array.isArray(model.items) ? model.items.find(row => row.id === id) : null;
    return { enabled: !!(cue && cue.autoTakeContentOnGo && item), requestedId: id, item: item || null };
  }

  return { TYPES, sceneType, deriveItem, normalizeModel, cueTakePlan };
});
