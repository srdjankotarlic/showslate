// ShowSlate — Lower Third Studio: versioned template + runtime model (LT-1).
// Pure data + factory helpers. UMD: require() u main procesu, window.PTLT u rendereru.
// Koordinate lejera su DESIGN prostor 1920×1080 (dokumentovano u docs/lower-third-studio-audit.md §19);
// resolver/renderer kasnije skalira na stvarni canvas. Model je striktno JSON-serializable.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.PTLT = Object.assign(root.PTLT || {}, factory());
})(typeof self !== 'undefined' ? self : this, function () {
  const SCHEMA_VERSION = 1;
  const LIBRARY_KEY = 'pt_lower_third_library_v1';
  const LEGACY_STYLES = ['clean', 'glass', 'broadcast', 'slab'];
  const LEGACY_TEMPLATE_IDS = {
    clean: 'builtin-legacy-clean', glass: 'builtin-legacy-glass',
    broadcast: 'builtin-legacy-broadcast', slab: 'builtin-legacy-slab'
  };
  const LAYER_TYPES = ['media', 'dynamicText', 'staticText', 'logo', 'shape'];
  const DYNAMIC_FIELDS = ['speakerName', 'speakerTitle', 'company', 'sessionTitle', 'segmentTitle', 'custom1'];
  const PLAYBACK_MODES = ['static', 'play-once-hide', 'play-once-hold', 'loop-until-hide'];
  const PHASE_MODES = ['none', 'static', 'fade', 'media', 'webm', 'mp4', 'image', 'play-once-hide', 'play-once-hold', 'loop-until-hide'];
  const FITS = ['contain', 'cover', 'fill'];
  const ANCHORS = ['tl','tc','tr','ml','mc','mr','bl','bc','br'];
  const SHAPES = ['rectangle', 'roundedRectangle', 'line'];
  const PHASE_NAMES = ['intro', 'hold', 'outro'];

  function makeId(prefix) {
    // stabilan random ID (nije indeks niza); crypto kada postoji, fallback za stare runtime-e
    try {
      const c = (typeof crypto !== 'undefined' && crypto) || require('crypto');
      if (c.randomUUID) return (prefix ? prefix + '-' : '') + c.randomUUID();
    } catch (e) {}
    return (prefix ? prefix + '-' : '') + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }
  const nowIso = () => new Date().toISOString();

  function defaultCanvas() { return { width: 1920, height: 1080, safeMarginPercent: 5 }; }
  function defaultAuto() {
    return { enabled: false, delayMs: 1500, onScreenMs: 8000,
             onlyWithSpeakerName: true, hideBeforeNextGo: false, noRepeatOnTimerRestart: true };
  }
  function defaultPhase(partial) {
    return Object.assign({ enabled: true, mode: 'static', mediaLayerId: null, durationMs: null,
      textRevealDelayMs: 0, startOffsetMs: 0, loop: false, holdLastFrame: false,
      transition: { type: 'fade', durationMs: 220 } }, partial || {});
  }
  function baseLayer(type, partial) {
    return Object.assign({
      id: makeId('lyr'), type, name: type, visible: true, locked: false,
      x: 0, y: 0, width: 400, height: 120, anchor: 'tl',
      opacity: 1, rotation: 0, zIndex: 0
    }, partial || {});
  }
  function makeMediaLayer(partial) {
    return Object.assign(baseLayer('media'), {
      // izvor: TAČNO jedan od { sourceType:'mediaAsset', assetId } ili { sourceType:'legacyDataUrl', dataUrl }
      sourceType: 'mediaAsset', assetId: '', dataUrl: '',
      mediaKind: 'image', fit: 'contain',
      crop: { top: 0, right: 0, bottom: 0, left: 0 },
      playbackMode: 'static', muted: true, startOffsetMs: 0, endOffsetMs: null
    }, partial || {});
  }
  function textVisualDefaults() {
    return {
      fontFamily: '-apple-system, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
      fontSize: 48, fontWeight: 700, fontStyle: 'normal', color: '#ffffff',
      textAlign: 'left', verticalAlign: 'middle', lineHeight: 1.15, maxLines: 1,
      autoFit: true, minFontSize: 18, maxFontSize: 96,
      outline: { enabled: false, color: '#000000', width: 2 },
      shadow: { enabled: false, color: 'rgba(0,0,0,.6)', offsetX: 0, offsetY: 2, blur: 8 },
      background: { enabled: false, color: 'rgba(0,0,0,.55)', radius: 8 },
      padding: { top: 8, right: 16, bottom: 8, left: 16 }
    };
  }
  function makeDynamicTextLayer(partial) {
    return Object.assign(baseLayer('dynamicText'), textVisualDefaults(),
      { field: 'speakerName', fallback: '' }, partial || {});
  }
  function makeStaticTextLayer(partial) {
    return Object.assign(baseLayer('staticText'), textVisualDefaults(), { text: '' }, partial || {});
  }
  function makeLogoLayer(partial) {
    return Object.assign(makeMediaLayer({ mediaKind: 'image', playbackMode: 'static' }),
      { type: 'logo', name: 'logo' }, partial || {});
  }
  function makeShapeLayer(partial) {
    return Object.assign(baseLayer('shape'), {
      shape: 'rectangle', fill: 'rgba(0,0,0,.55)', stroke: '', strokeWidth: 0, radius: 0
    }, partial || {});
  }
  function makeTemplate(partial) {
    const t = Object.assign({
      id: makeId('lt'), name: 'Untitled', schemaVersion: SCHEMA_VERSION, kind: 'custom',
      canvas: defaultCanvas(), layers: [],
      phases: { intro: null, hold: defaultPhase(), outro: null },
      auto: defaultAuto(), legacy: null,
      createdAt: nowIso(), updatedAt: nowIso()
    }, partial || {});
    t.canvas = Object.assign(defaultCanvas(), t.canvas || {});
    t.auto = Object.assign(defaultAuto(), t.auto || {});
    t.phases = Object.assign({ intro: null, hold: null, outro: null }, t.phases || {});
    return t;
  }
  // built-in legacy templejti: DETERMINISTIČKI ID-jevi, render i dalje ide kroz legacy DOM put.
  function makeLegacyTemplate(style, opts) {
    opts = opts || {};
    return makeTemplate({
      id: LEGACY_TEMPLATE_IDS[style],
      name: 'Legacy — ' + style.charAt(0).toUpperCase() + style.slice(1),
      kind: 'legacy', layers: [],
      phases: { intro: null, hold: defaultPhase({ mode: 'static' }), outro: null },
      legacy: { style, pos: opts.pos || 'bl', size: opts.size || 'm', accent: opts.accent || '#30d158' },
      createdAt: opts.createdAt || '2026-01-01T00:00:00.000Z',   // fiksno: ID i sadržaj stabilni između startova
      updatedAt: opts.createdAt || '2026-01-01T00:00:00.000Z'
    });
  }
  function makeEmptyLibrary() {
    return { schemaVersion: SCHEMA_VERSION, activeTemplateId: null, templates: [], updatedAt: nowIso() };
  }

  return {
    SCHEMA_VERSION, LIBRARY_KEY, LEGACY_STYLES, LEGACY_TEMPLATE_IDS, LAYER_TYPES,
    DYNAMIC_FIELDS, PLAYBACK_MODES, PHASE_MODES, FITS, ANCHORS, SHAPES, PHASE_NAMES,
    makeId, defaultCanvas, defaultAuto, defaultPhase,
    makeMediaLayer, makeDynamicTextLayer, makeStaticTextLayer, makeLogoLayer, makeShapeLayer,
    makeTemplate, makeLegacyTemplate, makeEmptyLibrary
  };
});
