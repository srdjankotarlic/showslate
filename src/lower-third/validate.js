// ShowSlate — Lower Third Studio: model validation (LT-1). UMD, dependency-free.
// Politika: clamp gde je bezbedno, REJECT za opasno (dupli ID, nepostojeća phase referenca,
// javascript:/file: URL, ne-JSON vrednosti). Tekst se NIKAD ne izvršava (renderer koristi textContent).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory(root.PTLT || (typeof require !== 'undefined' ? require('./model.js') : null));
  else root.PTLT = Object.assign(root.PTLT || {}, factory(root.PTLT));
})(typeof self !== 'undefined' ? self : this, function (M) {
  const num = (v, def, min, max) => {
    v = Number(v);
    if (!Number.isFinite(v)) v = def;
    if (min != null && v < min) v = min;
    if (max != null && v > max) v = max;
    return v;
  };
  const str = (v, def) => (typeof v === 'string' ? v : (def || ''));
  const oneOf = (v, list, def) => (list.indexOf(v) >= 0 ? v : def);
  const SAFE_DATAURL = /^data:image\/(png|jpe?g|gif|webp|svg\+xml);base64,/i;

  function isUnsafeUrlText(s) {
    const t = String(s || '').trim().toLowerCase();
    return t.startsWith('javascript:') || t.startsWith('file:') || t.startsWith('vbscript:') ||
           t.startsWith('\\\\') || t.startsWith('smb:');
  }

  // vraća { ok, errors[], value } — value je očišćena kopija (original se NE menja)
  function validateLowerThirdLayer(layer, ctx) {
    const errors = [];
    if (!layer || typeof layer !== 'object') return { ok: false, errors: ['layer: not an object'], value: null };
    const l = JSON.parse(JSON.stringify(layer));
    if (!l.id || typeof l.id !== 'string') errors.push('layer: missing id');
    if (M.LAYER_TYPES.indexOf(l.type) < 0) errors.push('layer ' + l.id + ': unknown type ' + l.type);
    l.name = str(l.name, l.type); l.visible = l.visible !== false; l.locked = !!l.locked;
    // design prostor 1920×1080; negativno x/y dozvoljeno do -canvas (off-canvas intro pozicije) — dokumentovano
    l.x = num(l.x, 0, -1920, 3840); l.y = num(l.y, 0, -1080, 2160);
    l.width = num(l.width, 100, 1, 1920); l.height = num(l.height, 100, 1, 1080);
    l.anchor = oneOf(l.anchor, M.ANCHORS, 'tl');
    l.opacity = num(l.opacity, 1, 0, 1); l.rotation = num(l.rotation, 0, -360, 360);
    l.zIndex = num(l.zIndex, 0, -999, 999);
    if (l.type === 'media' || l.type === 'logo') {
      l.sourceType = oneOf(l.sourceType, ['mediaAsset', 'legacyDataUrl'], 'mediaAsset');
      if (l.sourceType === 'mediaAsset') {
        l.assetId = str(l.assetId, '');
        if (l.assetId && !/^media:\/\/[A-Za-z0-9._-]+$/.test(l.assetId) && !/^[A-Za-z0-9._-]+$/.test(l.assetId))
          errors.push('layer ' + l.id + ': unsafe assetId');
        l.dataUrl = '';
      } else {
        if (!SAFE_DATAURL.test(l.dataUrl || '')) errors.push('layer ' + l.id + ': legacyDataUrl must be a base64 image data: URL');
        l.assetId = '';
      }
      if (isUnsafeUrlText(l.assetId) || isUnsafeUrlText(l.dataUrl)) errors.push('layer ' + l.id + ': unsafe media reference');
      l.mediaKind = oneOf(l.mediaKind, ['image', 'video'], 'image');
      l.fit = oneOf(l.fit, M.FITS, 'contain');
      const c = l.crop || {}; l.crop = { top: num(c.top,0,0,1080), right: num(c.right,0,0,1920), bottom: num(c.bottom,0,0,1080), left: num(c.left,0,0,1920) };
      l.playbackMode = oneOf(l.playbackMode, M.PLAYBACK_MODES, 'static');
      l.muted = true;                                  // LT-1: audio zabranjen u lower thirds
      l.startOffsetMs = num(l.startOffsetMs, 0, 0, 3600000);
      l.endOffsetMs = l.endOffsetMs == null ? null : num(l.endOffsetMs, null, 0, 3600000);
    }
    if (l.type === 'dynamicText') {
      if (M.DYNAMIC_FIELDS.indexOf(l.field) < 0) errors.push('layer ' + l.id + ': unknown dynamic field ' + l.field);
      l.fallback = str(l.fallback, '');
    }
    if (l.type === 'staticText') l.text = str(l.text, '');
    if (l.type === 'dynamicText' || l.type === 'staticText') {
      l.fontFamily = str(l.fontFamily, 'system-ui'); l.fontSize = num(l.fontSize, 48, 4, 400);
      l.fontStyle = oneOf(l.fontStyle, ['normal', 'italic'], 'normal');
      l.textAlign = oneOf(l.textAlign, ['left', 'center', 'right'], 'left');
      l.verticalAlign = oneOf(l.verticalAlign, ['top', 'middle', 'bottom'], 'middle');
      l.lineHeight = num(l.lineHeight, 1.15, 0.7, 3); l.maxLines = num(l.maxLines, 1, 1, 10);
      l.autoFit = l.autoFit !== false;
      l.minFontSize = num(l.minFontSize, 18, 4, 400); l.maxFontSize = num(l.maxFontSize, 96, l.minFontSize, 400);
    }
    if (l.type === 'shape') {
      l.shape = oneOf(l.shape, M.SHAPES, 'rectangle');
      l.fill = str(l.fill, '#000000'); l.stroke = str(l.stroke, '');
      l.strokeWidth = num(l.strokeWidth, 0, 0, 100); l.radius = num(l.radius, 0, 0, 500);
    }
    return { ok: errors.length === 0, errors, value: l };
  }

  function validateLowerThirdTemplate(tpl) {
    const errors = [];
    if (!tpl || typeof tpl !== 'object') return { ok: false, errors: ['template: not an object'], value: null };
    let t;
    try { t = JSON.parse(JSON.stringify(tpl)); }
    catch (e) { return { ok: false, errors: ['template: not JSON-serializable'], value: null }; }
    if (!t.id || typeof t.id !== 'string') errors.push('template: missing id');
    t.name = str(t.name, 'Untitled');
    t.schemaVersion = num(t.schemaVersion, M.SCHEMA_VERSION, 1, 99);
    t.kind = oneOf(t.kind, ['legacy', 'custom'], 'custom');
    t.canvas = Object.assign(M.defaultCanvas(), t.canvas || {});
    t.canvas.width = num(t.canvas.width, 1920, 320, 7680); t.canvas.height = num(t.canvas.height, 1080, 180, 4320);
    t.canvas.safeMarginPercent = num(t.canvas.safeMarginPercent, 5, 0, 25);
    t.auto = Object.assign(M.defaultAuto(), t.auto || {});
    t.auto.delayMs = num(t.auto.delayMs, 1500, 0, 60000);
    t.auto.onScreenMs = t.auto.onScreenMs == null ? null : num(t.auto.onScreenMs, 8000, 250, 3600000);
    if (t.kind === 'legacy') {
      const lg = t.legacy || {};
      if (M.LEGACY_STYLES.indexOf(lg.style) < 0) errors.push('template ' + t.id + ': legacy without valid style');
      t.legacy = { style: lg.style, pos: str(lg.pos, 'bl'), size: str(lg.size, 'm'), accent: str(lg.accent, '#30d158') };
    } else t.legacy = null;
    // lejeri + dupli ID-jevi
    const seen = {};
    const cleanLayers = [];
    (Array.isArray(t.layers) ? t.layers : []).forEach((raw) => {
      const r = validateLowerThirdLayer(raw, t);
      if (!r.ok) { errors.push.apply(errors, r.errors); return; }
      if (seen[r.value.id]) { errors.push('template ' + t.id + ': duplicate layer id ' + r.value.id); return; }
      seen[r.value.id] = true; cleanLayers.push(r.value);
    });
    t.layers = cleanLayers;
    // faze: opcione; mediaLayerId mora postojati i biti media/logo lejer
    const phases = Object.assign({ intro: null, hold: null, outro: null }, t.phases || {});
    M.PHASE_NAMES.forEach((ph) => {
      let p = phases[ph];
      if (p == null) { phases[ph] = null; return; }
      p = Object.assign(M.defaultPhase(), p);
      p.enabled = p.enabled !== false;
      p.mode = oneOf(p.mode, M.PHASE_MODES || M.PLAYBACK_MODES, 'static');
      p.durationMs = p.durationMs == null ? null : num(p.durationMs, null, 0, 3600000);
      p.textRevealDelayMs = num(p.textRevealDelayMs, 0, 0, 60000);
      p.startOffsetMs = num(p.startOffsetMs, 0, 0, 3600000);
      p.loop = !!p.loop;
      p.holdLastFrame = !!p.holdLastFrame;
      p.transition = Object.assign({ type: 'fade', durationMs: 220 }, p.transition || {});
      p.transition.type = oneOf(p.transition.type, ['none', 'fade'], 'fade');
      p.transition.durationMs = num(p.transition.durationMs, 220, 0, 5000);
      if (p.mediaLayerId != null) {
        const target = t.layers.find((l) => l.id === p.mediaLayerId);
        if (!target || (target.type !== 'media' && target.type !== 'logo'))
          errors.push('template ' + t.id + ': phase ' + ph + ' references missing media layer ' + p.mediaLayerId);
      }
      phases[ph] = p;
    });
    t.phases = phases;
    t.createdAt = str(t.createdAt, new Date().toISOString());
    t.updatedAt = str(t.updatedAt, t.createdAt);
    return { ok: errors.length === 0, errors, value: t };
  }

  function validateLowerThirdLibrary(lib) {
    const errors = [];
    if (!lib || typeof lib !== 'object') return { ok: false, errors: ['library: not an object'], value: M.makeEmptyLibrary() };
    const out = M.makeEmptyLibrary();
    out.schemaVersion = num(lib.schemaVersion, M.SCHEMA_VERSION, 1, 99);
    out.updatedAt = str(lib.updatedAt, out.updatedAt);
    const seen = {};
    (Array.isArray(lib.templates) ? lib.templates : []).forEach((raw) => {
      const r = validateLowerThirdTemplate(raw);
      if (!r.ok) { errors.push.apply(errors, r.errors); return; }   // nevalidan → preskoči, ne ruši
      if (seen[r.value.id]) { errors.push('library: duplicate template id ' + r.value.id); return; }
      seen[r.value.id] = true; out.templates.push(r.value);
    });
    out.activeTemplateId = (lib.activeTemplateId && seen[lib.activeTemplateId]) ? lib.activeTemplateId : null;
    return { ok: errors.length === 0, errors, value: out };
  }

  function validateLowerThirdRuntime(rt) {
    const errors = [];
    if (!rt || typeof rt !== 'object') return { ok: false, errors: ['runtime: not an object'], value: null };
    let r;
    try { r = JSON.parse(JSON.stringify(rt)); }
    catch (e) { return { ok: false, errors: ['runtime: not JSON-serializable'], value: null }; }
    r.version = num(r.version, 1, 1, 99);
    if (!r.instanceId) errors.push('runtime: missing instanceId');
    if (!r.templateId) errors.push('runtime: missing templateId');
    r.phase = oneOf(r.phase, ['intro', 'hold', 'outro', 'hidden'], 'hidden');
    r.visible = !!r.visible;
    const c = r.canvas || {};
    r.canvas = {
      width: num(c.width, 1920, 320, 7680),
      height: num(c.height, 1080, 180, 4320),
      safeMarginPercent: num(c.safeMarginPercent, 5, 0, 25)
    };
    r.startedAt = num(r.startedAt, 0, 0); r.phaseStartedAt = num(r.phaseStartedAt, r.startedAt, 0);
    r.hideAt = r.hideAt == null ? null : num(r.hideAt, null, 0);
    r.assetBase = r.assetBase == null ? null : str(r.assetBase, null);
    r.errors = Array.isArray(r.errors) ? r.errors.map(String) : [];
    if (!Array.isArray(r.resolvedLayers)) { errors.push('runtime: resolvedLayers not array'); r.resolvedLayers = []; }
    r.resolvedLayers.forEach((l) => {
      if (l.type === 'dynamicText' && typeof l.resolvedText !== 'string')
        errors.push('runtime: dynamicText layer without resolvedText');
      if ((l.type === 'media' || l.type === 'logo') && l.src && isUnsafeUrlText(l.src))
        errors.push('runtime: unsafe media src');
    });
    return { ok: errors.length === 0, errors, value: r };
  }

  return { validateLowerThirdLayer, validateLowerThirdTemplate, validateLowerThirdLibrary, validateLowerThirdRuntime, _isUnsafeUrlText: isUnsafeUrlText };
});
