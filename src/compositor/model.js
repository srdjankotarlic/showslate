(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateCompositor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LAYER_TYPES = new Set(['color', 'image', 'video', 'pdf', 'text', 'timer', 'window', 'capture']);
  const LIVE_INPUT_TYPES = new Set(['window', 'device']);
  const FITS = new Set(['cover', 'contain', 'fill']);
  const CANVAS_PRESETS = Object.freeze([
    { id: '1080p', label: 'HD 1080p', width: 1920, height: 1080 },
    { id: '720p', label: 'HD 720p', width: 1280, height: 720 },
    { id: 'vertical', label: 'Vertical 1080', width: 1080, height: 1920 },
    { id: 'square', label: 'Square 1080', width: 1080, height: 1080 },
    { id: 'uhd', label: 'UHD 4K', width: 3840, height: 2160 }
  ]);

  function finite(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function integer(value, fallback, min, max) {
    return Math.round(finite(value, fallback, min, max));
  }

  function id(value, fallback) {
    const clean = String(value || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 160);
    return clean || fallback;
  }

  function cleanName(value, fallback) {
    const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
    return clean || fallback;
  }

  function cleanColor(value, fallback = '#000000') {
    const color = String(value || '').trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent)$/i.test(color)
      ? color : fallback;
  }

  function normalizeCanvas(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const width = integer(source.width, 1920, 320, 8192);
    const height = integer(source.height, 1080, 180, 8192);
    return {
      schemaVersion: SCHEMA_VERSION,
      width,
      height,
      fps: integer(source.fps, 30, 1, 60),
      background: cleanColor(source.background, '#000000'),
      transparent: source.transparent === true
    };
  }

  function canvasPreset(canvas) {
    const clean = normalizeCanvas(canvas);
    const preset = CANVAS_PRESETS.find(row => row.width === clean.width && row.height === clean.height);
    return preset ? preset.id : 'custom';
  }

  function canvasAspect(canvas) {
    const clean = normalizeCanvas(canvas);
    return `${clean.width} / ${clean.height}`;
  }

  function normalizeLiveInput(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = LIVE_INPUT_TYPES.has(source.type) ? source.type : 'device';
    const fallbackName = type === 'window' ? `Window ${index + 1}` : `Video input ${index + 1}`;
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `input-${index + 1}`),
      type,
      name: cleanName(source.name, fallbackName),
      desktopSourceId: type === 'window' ? String(source.desktopSourceId || '').slice(0, 512) : '',
      desktopSourceName: type === 'window' ? cleanName(source.desktopSourceName, '') : '',
      videoDeviceId: type === 'device' ? String(source.videoDeviceId || '').slice(0, 1024) : '',
      videoDeviceLabel: type === 'device' ? cleanName(source.videoDeviceLabel, '') : '',
      audioDeviceId: type === 'device' ? String(source.audioDeviceId || '').slice(0, 1024) : '',
      audioDeviceLabel: type === 'device' ? cleanName(source.audioDeviceLabel, '') : '',
      withAudio: type === 'device' && source.withAudio === true && !!String(source.audioDeviceId || ''),
      width: integer(source.width, 1920, 160, 7680),
      height: integer(source.height, 1080, 120, 4320),
      fps: integer(source.fps, 30, 1, 60),
      autoReconnect: source.autoReconnect !== false,
      active: source.active !== false
    };
  }

  function normalizeLiveInputs(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    return rows.map(normalizeLiveInput).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  function layerType(raw) {
    const requested = String(raw && raw.type || '').toLowerCase();
    if (requested === 'device' || requested === 'camera' || requested === 'capture-card') return 'capture';
    if (requested === 'window-capture' || requested === 'screen') return 'window';
    return LAYER_TYPES.has(requested) ? requested : 'image';
  }

  function normalizeLayer(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = layerType(source);
    const isLive = type === 'window' || type === 'capture';
    const isColor = type === 'color';
    const layer = {
      ...source,
      id: id(source.id, `layer-${index + 1}`),
      type,
      name: cleanName(source.name || source.sourceName, type === 'capture' ? 'Video input' : type === 'window' ? 'Window capture' : type[0].toUpperCase() + type.slice(1)),
      visible: source.visible !== false,
      locked: source.locked === true,
      x: finite(source.x, 0, -100, 200),
      y: finite(source.y, 0, -100, 200),
      w: finite(source.w, 100, 1, 300),
      h: finite(source.h, 100, 1, 300),
      rotation: finite(source.rotation, 0, -360, 360),
      opacity: finite(source.opacity, 1, 0, 1),
      fit: FITS.has(source.fit) ? source.fit : (type === 'pdf' ? 'contain' : 'cover')
    };
    if (isColor) {
      layer.color = cleanColor(source.color || source.bg, '#20242c');
      layer.bg = layer.color;
    }
    if (isLive) {
      layer.inputId = id(source.inputId || source.sourceId, '');
      layer.audioEnabled = source.audioEnabled !== false;
      layer.volume = finite(source.volume, 1, 0, 1);
    }
    if (type === 'video') {
      layer.loop = source.loop !== false;
      layer.muted = source.muted !== false;
      layer.volume = finite(source.volume, 1, 0, 1);
    }
    return layer;
  }

  function normalizeScene(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      ...source,
      id: id(source.id, `scene-${index + 1}`),
      name: cleanName(source.name, `Scene ${index + 1}`),
      layers: (Array.isArray(source.layers) ? source.layers : []).map(normalizeLayer)
    };
  }

  function liveInputIds(scenes, visibleOnly) {
    const ids = new Set();
    (Array.isArray(scenes) ? scenes : []).forEach(scene => {
      (Array.isArray(scene && scene.layers) ? scene.layers : []).forEach(layer => {
        const type = layerType(layer);
        if ((type === 'window' || type === 'capture') && (!visibleOnly || layer.visible !== false) && layer.inputId) ids.add(String(layer.inputId));
      });
    });
    return [...ids];
  }

  function referencedLiveInputIds(scenes) {
    return liveInputIds(scenes, false);
  }

  function activeLiveInputIds(scenes) {
    return liveInputIds(scenes, true);
  }

  function liveLayersForState(state) {
    const scenes = Array.isArray(state && state.scenes) ? state.scenes : [];
    const scene = scenes.find(row => row && row.id === state.activeSceneId) || scenes[0];
    return (scene && Array.isArray(scene.layers) ? scene.layers : []).filter(layer => {
      const type = layerType(layer);
      return layer && layer.visible !== false && (type === 'window' || type === 'capture') && layer.inputId;
    }).map(normalizeLayer);
  }

  function activateReferencedInputs(inputs, scenes) {
    const references = new Set(activeLiveInputIds(scenes));
    return normalizeLiveInputs(inputs).map(input => ({ ...input, active: references.has(input.id) }));
  }

  function outputAudioConflicts(configs) {
    const enabled = (Array.isArray(configs) ? configs : []).filter(config => config && config.enabled !== false && config.liveAudio === true);
    return enabled.length > 1 ? enabled.map(config => String(config.name || config.id || 'Output')) : [];
  }

  return {
    SCHEMA_VERSION,
    LAYER_TYPES: [...LAYER_TYPES],
    LIVE_INPUT_TYPES: [...LIVE_INPUT_TYPES],
    CANVAS_PRESETS,
    normalizeCanvas,
    canvasPreset,
    canvasAspect,
    normalizeLiveInput,
    normalizeLiveInputs,
    normalizeLayer,
    normalizeScene,
    referencedLiveInputIds,
    activeLiveInputIds,
    liveLayersForState,
    activateReferencedInputs,
    outputAudioConflicts
  };
});
