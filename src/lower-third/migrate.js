// ShowSlate — Lower Third Studio: idempotent migrations (LT-1). UMD, pure.
// NIŠTA se ne briše; ponovljeni pozivi ne prave duplikate; ne diraju LIVE/selected/timer.
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./model.js'), require('./validate.js'));
  } else {
    root.PTLT = Object.assign(root.PTLT || {}, factory(root.PTLT, root.PTLT));
  }
})(typeof self !== 'undefined' ? self : this, function (M, V) {
  // rawLib: parsiran JSON iz storage-a (ili null) ; legacyState: trenutni S.lowerThird ; legacyPresets: pt_lt_presets niz
  // Vraća { library, changed, errors } — library je validirana; korumpirani templejti su preskočeni (uz error zapis),
  // originalni sirovi podatak čuva POZIVALAC kao backup pre prepisivanja (dokumentovano).
  function migrateLowerThirdLibrary(rawLib, legacyState, legacyPresets) {
    const errors = [];
    let changed = false;
    let lib;
    if (!rawLib || typeof rawLib !== 'object') { lib = M.makeEmptyLibrary(); changed = true; }
    else {
      const r = V.validateLowerThirdLibrary(rawLib);
      lib = r.value;
      if (!r.ok) { errors.push.apply(errors, r.errors); changed = true; }
    }
    // 4 built-in legacy templejta — deterministički ID-jevi, dodaj SAMO ako fale
    M.LEGACY_STYLES.forEach((style) => {
      const id = M.LEGACY_TEMPLATE_IDS[style];
      if (!lib.templates.some((t) => t.id === id)) {
        const src = (legacyState && legacyState.style === style) ? legacyState : null;
        lib.templates.push(M.makeLegacyTemplate(style, src ? { pos: src.pos, size: src.size, accent: src.accent } : {}));
        changed = true;
      }
    });
    // aktivni stil → activeTemplateId (samo ako nije već postavljen)
    if (!lib.activeTemplateId && legacyState && M.LEGACY_TEMPLATE_IDS[legacyState.style]) {
      lib.activeTemplateId = M.LEGACY_TEMPLATE_IDS[legacyState.style];
      changed = true;
    }
    // legacy preseti: dobijaju templateId mapiranjem stila; sirovi preset podaci ostaju vlasništvo
    // postojećeg pt_lt_presets ključa (NE kopiramo dataURL u templejte, NE brišemo ništa)
    if (Array.isArray(legacyPresets)) {
      legacyPresets.forEach((p) => {
        if (p && typeof p === 'object' && !p.templateId && M.LEGACY_TEMPLATE_IDS[p.style]) {
          p.templateId = M.LEGACY_TEMPLATE_IDS[p.style];   // in-place annotate (pozivalac čuva)
          changed = true;
        }
      });
    }
    if (changed) lib.updatedAt = new Date().toISOString();
    return { library: lib, changed, errors };
  }

  // Cue migracija: dodaje SAMO nedostajuća optional polja; ne dira name/note/ltName/ltTitle,
  // ne dira status/actual*, ne bira cue, ne pokreće ništa. Idempotentna.
  function migrateCueLowerThirdFields(cue) {
    if (!cue || typeof cue !== 'object') return { cue, changed: false };
    let changed = false;
    if (typeof cue.speakerName !== 'string') { cue.speakerName = typeof cue.ltName === 'string' ? cue.ltName : ''; changed = true; }
    if (cue.ltName !== cue.speakerName) { cue.ltName = cue.speakerName; changed = true; }
    if (typeof cue.speakerTitle !== 'string') { cue.speakerTitle = typeof cue.ltTitle === 'string' ? cue.ltTitle : ''; changed = true; }
    if (cue.ltTitle !== cue.speakerTitle) { cue.ltTitle = cue.speakerTitle; changed = true; }
    ['company', 'sessionTitle', 'segmentTitle', 'custom1', 'lowerThirdTemplateId'].forEach((f) => {
      if (typeof cue[f] !== 'string') { cue[f] = ''; changed = true; }
    });
    ['lowerThirdAuto', 'lowerThirdHideBeforeNextGo', 'lowerThirdNoRepeat'].forEach((f) => {
      if (typeof cue[f] !== 'boolean') { cue[f] = false; changed = true; }
    });
    const delay = Number(cue.lowerThirdDelayMs);
    if (!Number.isFinite(delay) || delay < 0) { cue.lowerThirdDelayMs = 0; changed = true; }
    else {
      const nextDelay = Math.min(60000, Math.round(delay));
      if (cue.lowerThirdDelayMs !== nextDelay) { cue.lowerThirdDelayMs = nextDelay; changed = true; }
    }
    if (cue.lowerThirdDurationMs == null || cue.lowerThirdDurationMs === '') {
      if (cue.lowerThirdDurationMs !== null) { cue.lowerThirdDurationMs = null; changed = true; }
    } else {
      const duration = Number(cue.lowerThirdDurationMs);
      if (!Number.isFinite(duration) || duration < 0) { cue.lowerThirdDurationMs = null; changed = true; }
      else {
        const nextDuration = Math.min(600000, Math.round(duration));
        if (cue.lowerThirdDurationMs !== nextDuration) { cue.lowerThirdDurationMs = nextDuration; changed = true; }
      }
    }
    return { cue, changed };
  }
  function migrateCuesLowerThirdFields(cues) {
    let changed = false;
    (Array.isArray(cues) ? cues : []).forEach((c) => { if (migrateCueLowerThirdFields(c).changed) changed = true; });
    return { cues, changed };
  }

  return { migrateLowerThirdLibrary, migrateCueLowerThirdFields, migrateCuesLowerThirdFields };
});
