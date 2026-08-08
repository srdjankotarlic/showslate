// ShowSlate — Lower Third Studio: pure resolvers (LT-1).
// template + cue + mediaResolver + now → deterministički, JSON-serializable runtime.
// LIVE resolver dobija ISKLJUČIVO liveCue (selected cue se nikad ne prosleđuje ovde);
// preview resolver je odvojen, ne zove send() niti dira bilo kakav state (pure funkcija).
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory(require('./model.js'), require('./validate.js'));
  } else {
    root.PTLT = Object.assign(root.PTLT || {}, factory(root.PTLT, root.PTLT));
  }
})(typeof self !== 'undefined' ? self : this, function (M, V) {
  function fieldFromCue(field, cue) {
    if (!cue) return '';
    switch (field) {
      case 'speakerName':  return String(Object.prototype.hasOwnProperty.call(cue, 'speakerName') ? cue.speakerName : (cue.ltName || '')).trim();
      case 'speakerTitle': return String(cue.speakerTitle || cue.ltTitle || '').trim();
      case 'company':      return String(cue.company || '').trim();
      case 'sessionTitle': return String(cue.sessionTitle || '').trim();
      case 'segmentTitle': return String(cue.segmentTitle || cue.name || '').trim();
      case 'custom1':      return String(cue.custom1 || '').trim();
      default: return '';
    }
  }
  function stripTags(s) { return String(s || '').replace(/</g, '‹').replace(/>/g, '›'); }  // tekst ide kroz textContent; ovo je defense-in-depth
  function clonePhase(p) {
    return p ? JSON.parse(JSON.stringify(p)) : null;
  }
  function phaseEnabled(p) {
    return !!(p && p.enabled !== false && p.mode !== 'none');
  }
  function phaseDuration(name, p) {
    if (!p) return null;
    if (p.durationMs != null) return Math.max(0, Number(p.durationMs) || 0);
    if (name === 'intro') return 900;
    if (name === 'outro') return 700;
    return null;
  }

  function resolveMediaSrc(layer, mediaResolver, errors) {
    if (layer.sourceType === 'legacyDataUrl') return layer.dataUrl || '';
    if (!layer.assetId) { errors.push('layer ' + layer.id + ': empty assetId'); return ''; }
    try {
      const src = mediaResolver ? mediaResolver(layer.assetId) : layer.assetId;
      if (V._isUnsafeUrlText(src)) { errors.push('layer ' + layer.id + ': resolver returned unsafe src'); return ''; }
      return String(src || '');
    } catch (e) { errors.push('layer ' + layer.id + ': mediaResolver failed: ' + e.message); return ''; }
  }

  function resolveCore(kind, template, cue, mediaResolver, now, assetBase) {
    const errors = [];
    const vr = V.validateLowerThirdTemplate(template);
    if (!vr.ok) errors.push.apply(errors, vr.errors);
    const t = vr.value || template;
    const resolvedLayers = [];
    (t && Array.isArray(t.layers) ? t.layers : []).forEach((l) => {
      if (!l.visible) return;
      const out = JSON.parse(JSON.stringify(l));
      if (l.type === 'dynamicText') {
        const raw = fieldFromCue(l.field, cue);
        out.sourceField = l.field;
        out.resolvedText = stripTags(raw || l.fallback || '');
        delete out.field; delete out.fallback;
      } else if (l.type === 'staticText') {
        out.resolvedText = stripTags(l.text || '');
      } else if (l.type === 'media' || l.type === 'logo') {
        out.src = resolveMediaSrc(l, mediaResolver, errors);
        delete out.dataUrl;                             // runtime nosi samo finalni src
      }
      resolvedLayers.push(out);
    });
    const nowMs = Number.isFinite(now) ? now : 0;      // determinističnost: isti now ⇒ isti izlaz
    const phasePlan = {
      intro: clonePhase(t && t.phases && t.phases.intro),
      hold: clonePhase((t && t.phases && t.phases.hold) || M.defaultPhase()),
      outro: clonePhase(t && t.phases && t.phases.outro)
    };
    const firstPhase = phaseEnabled(phasePlan.intro) ? 'intro' : 'hold';
    const firstPhaseCfg = phasePlan[firstPhase] || null;
    const firstDuration = phaseDuration(firstPhase, firstPhaseCfg);
    const hold = phasePlan.hold;
    const auto = (t && t.auto) || {};
    return {
      version: 1,
      // instanceId MORA biti determinističан za isti input (spec: isti input ⇒ isti rezultat)
      instanceId: kind + '-' + (t ? t.id : 'none') + '-' + (cue && cue.id ? cue.id : 'nocue') + '-' + nowMs,
      templateId: t ? t.id : '',
      cueId: cue && cue.id != null ? String(cue.id) : null,
      phase: firstPhase,
      visible: true,
      canvas: Object.assign({ width: 1920, height: 1080, safeMarginPercent: 5 }, (t && t.canvas) || {}),
      startedAt: nowMs,
      phaseStartedAt: nowMs,
      phaseDurationMs: firstDuration,
      textRevealAt: firstPhase === 'intro'
        ? nowMs + Math.max(0, Number((firstPhaseCfg && firstPhaseCfg.textRevealDelayMs) || 0))
        : nowMs,
      hideAt: auto.onScreenMs != null ? nowMs + auto.onScreenMs : (hold && hold.durationMs != null ? nowMs + hold.durationMs : null),
      phasePlan,
      resolvedLayers,
      assetBase: assetBase == null ? null : String(assetBase),
      errors,
      preview: kind === 'preview'                       // preview je jasno označen i nikad live
    };
  }

  // LIVE: poziva se na TAKE/AUTO sa liveCue — NIKAD sa selected cue (ugovor iz audita §11)
  function resolveLowerThirdTemplate(args) {
    args = args || {};
    return resolveCore('live', args.template, args.liveCue, args.mediaResolver, args.now, args.assetBase);
  }
  // PREVIEW: editor pregled sa previewCue (npr. selected) — pure; ne dira state, ne šalje ništa
  function resolveLowerThirdPreview(args) {
    args = args || {};
    return resolveCore('preview', args.template, args.previewCue, args.mediaResolver, args.now, args.assetBase);
  }

  return { resolveLowerThirdTemplate, resolveLowerThirdPreview, _fieldFromCue: fieldFromCue };
});
