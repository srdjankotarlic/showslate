(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateCompositor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LAYER_TYPES = new Set(['color', 'image', 'video', 'pdf', 'text', 'timer', 'window', 'capture', 'audio']);
  const LIVE_INPUT_TYPES = new Set(['window', 'device', 'audio']);
  const AUDIO_MONITORING_MODES = new Set(['off', 'monitor-only', 'monitor-and-output']);
  const FITS = new Set(['cover', 'contain', 'fill']);
  const BLEND_MODES = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']);
  const TRANSFORM_ORIGINS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
  const FONT_FAMILIES = new Set(['system', 'mono', 'serif', 'display']);
  const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
  const VERTICAL_ALIGNS = new Set(['top', 'center', 'bottom']);
  const CANVAS_PRESETS = Object.freeze([
    { id: '1080p', label: 'HD 1080p', width: 1920, height: 1080 },
    { id: '720p', label: 'HD 720p', width: 1280, height: 720 },
    { id: 'ultrawide', label: 'Ultrawide 2560', width: 2560, height: 1080 },
    { id: 'dual-1080p', label: 'Dual wide 3840', width: 3840, height: 1080 },
    { id: 'led-wide', label: 'LED wide 3840 x 960', width: 3840, height: 960 },
    { id: 'vertical', label: 'Vertical 1080', width: 1080, height: 1920 },
    { id: 'square', label: 'Square 1080', width: 1080, height: 1080 },
    { id: 'uhd', label: 'UHD 4K', width: 3840, height: 2160 },
    { id: 'dci-4k', label: 'DCI 4K', width: 4096, height: 2160 }
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

  function normalizeCrop(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      top: finite(source.top, 0, 0, 49),
      right: finite(source.right, 0, 0, 49),
      bottom: finite(source.bottom, 0, 0, 49),
      left: finite(source.left, 0, 0, 49)
    };
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

  function normalizeProjectorMapping(raw = {}, index = 0, rawCanvas = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const canvas = normalizeCanvas(rawCanvas);
    const x = integer(source.x, 0, 0, Math.max(0, canvas.width - 1));
    const y = integer(source.y, 0, 0, Math.max(0, canvas.height - 1));
    const width = integer(source.width, canvas.width - x, 1, Math.max(1, canvas.width - x));
    const height = integer(source.height, canvas.height - y, 1, Math.max(1, canvas.height - y));
    const blend = source.blend && typeof source.blend === 'object' ? source.blend : {};
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `mapping-${index + 1}`),
      name: cleanName(source.name, `Projector ${index + 1}`),
      enabled: source.enabled !== false,
      outputId: id(source.outputId, ''),
      x,
      y,
      width,
      height,
      blend: {
        left: integer(blend.left, 0, 0, Math.min(512, Math.floor(width / 2))),
        right: integer(blend.right, 0, 0, Math.min(512, Math.floor(width / 2))),
        top: integer(blend.top, 0, 0, Math.min(512, Math.floor(height / 2))),
        bottom: integer(blend.bottom, 0, 0, Math.min(512, Math.floor(height / 2)))
      }
    };
  }

  function normalizeComposition(raw = {}, index = 0, fallbackCanvas = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const canvas = normalizeCanvas(source.canvas || fallbackCanvas);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `composition-${index + 1}`),
      name: cleanName(source.name, index === 0 ? 'Main Composition' : `Composition ${index + 1}`),
      canvas,
      mappings: (Array.isArray(source.mappings) ? source.mappings : []).map((mapping, mappingIndex) => normalizeProjectorMapping(mapping, mappingIndex, canvas))
    };
  }

  function normalizeCompositions(raw, fallbackCanvas = {}) {
    const rows = Array.isArray(raw) && raw.length ? raw : [{ id: 'composition-main', name: 'Main Composition', canvas: fallbackCanvas }];
    const seen = new Set();
    return rows.map((row, index) => normalizeComposition(row, index, fallbackCanvas)).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  function captureQuality(rawStatus = {}, rawCanvas = {}, fit = 'contain') {
    const canvas = normalizeCanvas(rawCanvas);
    const sourceWidth = Math.max(0, Math.round(Number(rawStatus.width) || 0));
    const sourceHeight = Math.max(0, Math.round(Number(rawStatus.height) || 0));
    if (!sourceWidth || !sourceHeight) {
      return {
        ready: false,
        sourceWidth,
        sourceHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        scale: 1,
        needsUpscale: false,
        aspectMismatch: false,
        crops: false
      };
    }
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasRatio = canvas.width / canvas.height;
    const containScale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const coverScale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const mode = FITS.has(fit) ? fit : 'contain';
    const scale = mode === 'contain' ? containScale : coverScale;
    const aspectMismatch = Math.abs(sourceAspect - canvasRatio) / canvasRatio > 0.01;
    return {
      ready: true,
      sourceWidth,
      sourceHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      scale,
      needsUpscale: scale > 1.01,
      aspectMismatch,
      crops: mode === 'cover' && aspectMismatch
    };
  }

  function normalizeLiveInput(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = LIVE_INPUT_TYPES.has(source.type) ? source.type : 'device';
    const fallbackName = type === 'window' ? `Window ${index + 1}` : type === 'audio' ? `Audio input ${index + 1}` : `Video input ${index + 1}`;
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `input-${index + 1}`),
      type,
      name: cleanName(source.name, fallbackName),
      desktopSourceId: type === 'window' ? String(source.desktopSourceId || '').slice(0, 512) : '',
      desktopSourceName: type === 'window' ? cleanName(source.desktopSourceName, '') : '',
      videoDeviceId: type === 'device' ? String(source.videoDeviceId || '').slice(0, 1024) : '',
      videoDeviceLabel: type === 'device' ? cleanName(source.videoDeviceLabel, '') : '',
      audioDeviceId: type === 'device' || type === 'audio' ? String(source.audioDeviceId || '').slice(0, 1024) : '',
      audioDeviceLabel: type === 'device' || type === 'audio' ? cleanName(source.audioDeviceLabel, '') : '',
      withAudio: type === 'window'
        ? source.withAudio === true
        : (type === 'device' || type === 'audio') && source.withAudio !== false && !!String(source.audioDeviceId || ''),
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
    const isLive = type === 'window' || type === 'capture' || type === 'audio';
    const isColor = type === 'color';
    const layer = {
      ...source,
      id: id(source.id, `layer-${index + 1}`),
      type,
      name: cleanName(source.name || source.sourceName, type === 'capture' ? 'Video input' : type === 'audio' ? 'Audio input' : type === 'window' ? 'Window capture' : type[0].toUpperCase() + type.slice(1)),
      visible: source.visible !== false,
      locked: source.locked === true,
      x: finite(source.x, 0, -100, 200),
      y: finite(source.y, 0, -100, 200),
      w: finite(source.w, 100, 1, 300),
      h: finite(source.h, 100, 1, 300),
      rotation: finite(source.rotation, 0, -360, 360),
      opacity: finite(source.opacity, 1, 0, 1),
      fit: FITS.has(source.fit) ? source.fit : (type === 'pdf' || type === 'window' ? 'contain' : 'cover'),
      lockAspect: source.lockAspect === true,
      flipX: source.flipX === true,
      flipY: source.flipY === true,
      transformOrigin: TRANSFORM_ORIGINS.has(source.transformOrigin) ? source.transformOrigin : 'center',
      crop: normalizeCrop(source.crop),
      objectPositionX: finite(source.objectPositionX, 50, 0, 100),
      objectPositionY: finite(source.objectPositionY, 50, 0, 100),
      blendMode: BLEND_MODES.has(source.blendMode) ? source.blendMode : 'normal',
      cornerRadius: finite(source.cornerRadius, 0, 0, 50),
      brightness: finite(source.brightness, 1, 0, 2),
      contrast: finite(source.contrast, 1, 0, 2),
      saturation: finite(source.saturation, 1, 0, 3),
      hue: finite(source.hue, 0, -180, 180),
      blur: finite(source.blur, 0, 0, 40)
    };
    if (isColor) {
      layer.color = cleanColor(source.color || source.bg, '#20242c');
      layer.bg = layer.color;
    }
    if (isLive) {
      layer.inputId = id(source.inputId || source.sourceId, '');
      layer.audioEnabled = source.audioEnabled !== false;
      layer.volume = finite(source.volume, 1, 0, 1);
      layer.audioMonitoring = AUDIO_MONITORING_MODES.has(source.audioMonitoring) ? source.audioMonitoring : 'off';
    }
    if (type === 'video') {
      layer.loop = source.loop !== false;
      layer.muted = source.muted !== false;
      layer.volume = finite(source.volume, 1, 0, 1);
      layer.audioMonitoring = AUDIO_MONITORING_MODES.has(source.audioMonitoring) ? source.audioMonitoring : 'off';
      layer.playbackRate = finite(source.playbackRate, 1, 0.25, 4);
    }
    if (type === 'pdf') {
      layer.page = integer(source.page, 1, 1, 999);
    }
    if (type === 'text') {
      layer.text = String(source.text ?? source.name ?? '').slice(0, 4000);
      layer.color = cleanColor(source.color, '#ffffff');
      layer.bg = cleanColor(source.bg, 'transparent');
      layer.fontSize = finite(source.fontSize, 8, 1, 100);
      layer.fontFamily = FONT_FAMILIES.has(source.fontFamily) ? source.fontFamily : 'system';
      layer.fontWeight = integer(source.fontWeight, 700, 100, 900);
      layer.textAlign = TEXT_ALIGNS.has(source.textAlign) ? source.textAlign : 'center';
      layer.verticalAlign = VERTICAL_ALIGNS.has(source.verticalAlign) ? source.verticalAlign : 'center';
      layer.italic = source.italic === true;
      layer.underline = source.underline === true;
    }
    return layer;
  }

  const ORIGIN_CSS = Object.freeze({
    'top-left': '0% 0%', 'top-center': '50% 0%', 'top-right': '100% 0%',
    'center-left': '0% 50%', center: '50% 50%', 'center-right': '100% 50%',
    'bottom-left': '0% 100%', 'bottom-center': '50% 100%', 'bottom-right': '100% 100%'
  });

  function layerVisualStyle(raw = {}) {
    const layer = normalizeLayer(raw);
    const crop = layer.crop;
    return {
      transform: `rotate(${layer.rotation}deg) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`,
      transformOrigin: ORIGIN_CSS[layer.transformOrigin] || ORIGIN_CSS.center,
      filter: `brightness(${layer.brightness}) contrast(${layer.contrast}) saturate(${layer.saturation}) hue-rotate(${layer.hue}deg) blur(${layer.blur}px)`,
      mixBlendMode: layer.blendMode,
      clipPath: `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`,
      borderRadius: `${layer.cornerRadius}%`,
      objectPosition: `${layer.objectPositionX}% ${layer.objectPositionY}%`
    };
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
        if ((type === 'window' || type === 'capture' || type === 'audio') && (!visibleOnly || layer.visible !== false) && layer.inputId) ids.add(String(layer.inputId));
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
      return layer && layer.visible !== false && (type === 'window' || type === 'capture' || type === 'audio') && layer.inputId;
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
    AUDIO_MONITORING_MODES: [...AUDIO_MONITORING_MODES],
    BLEND_MODES: [...BLEND_MODES],
    TRANSFORM_ORIGINS: [...TRANSFORM_ORIGINS],
    CANVAS_PRESETS,
    normalizeCanvas,
    canvasPreset,
    canvasAspect,
    normalizeProjectorMapping,
    normalizeComposition,
    normalizeCompositions,
    captureQuality,
    normalizeLiveInput,
    normalizeLiveInputs,
    normalizeLayer,
    normalizeCrop,
    layerVisualStyle,
    normalizeScene,
    referencedLiveInputIds,
    activeLiveInputIds,
    liveLayersForState,
    activateReferencedInputs,
    outputAudioConflicts
  };
});
