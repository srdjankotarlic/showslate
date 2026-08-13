const { validateShowDocument } = require('./repository.js');
const conference = require('../conference-desk/model.js');
const compositor = require('../compositor/model.js');

function row(id, status, detail = '') {
  return { id, status, detail: String(detail || '') };
}

function uniqueIds(items) {
  const ids = new Set();
  for (const item of items || []) {
    const id = String(item && item.id || '');
    if (!id || ids.has(id)) return false;
    ids.add(id);
  }
  return true;
}

function evaluatePreflight(input, facts = {}) {
  const validated = validateShowDocument(input);
  const document = validated.value || { show: {} };
  const show = document.show || {};
  const cues = Array.isArray(show.rundown) ? show.rundown : [];
  const checks = [];

  checks.push(row('showSaved', facts.lastSaveOk ? 'ok' : 'block', facts.lastSaveOk ? 'saved' : 'save-required'));
  checks.push(row('autosaveWritable', facts.autosaveWritable ? 'ok' : 'block', facts.autosaveWritable ? 'writable' : 'not-writable'));

  const rundownValid = validated.ok && cues.length > 0 && cues.length <= 5000 && uniqueIds(cues)
    && cues.every(cue => String(cue && cue.name || '').trim() && Number(cue && cue.durationMs) >= 1000);
  checks.push(row('rundownValid', rundownValid ? 'ok' : 'block', rundownValid ? cues.length + '-cues' : 'invalid-or-empty'));

  const missingAssets = Array.isArray(facts.missingAssets) ? facts.missingAssets.filter(Boolean) : [];
  checks.push(row('missingAssets', missingAssets.length ? 'block' : 'ok', missingAssets.length ? missingAssets.join(', ') : 'all-found'));

  const content = show.screenContent || {};
  const scenes = Array.isArray(content.scenes) ? content.scenes : [];
  const liveInputs = compositor.normalizeLiveInputs(content.liveInputs);
  const inputById = new Map(liveInputs.map(input => [input.id, input]));
  const referencedInputIds = compositor.referencedLiveInputIds(scenes);
  const missingInputIds = referencedInputIds.filter(id => !inputById.has(id));
  const activeScene = scenes.find(scene => String(scene && scene.id || '') === String(content.activeSceneId || '')) || scenes[0];
  const activeInputIds = compositor.activeLiveInputIds(activeScene ? [activeScene] : []);
  const statusById = new Map((Array.isArray(facts.liveInputStatuses) ? facts.liveInputStatuses : [])
    .filter(status => status && status.inputId).map(status => [String(status.inputId), status]));
  const unavailableActiveIds = activeInputIds.filter(id => String(statusById.get(id) && statusById.get(id).state || '') !== 'live');
  const fallbackActiveIds = activeInputIds.filter(id => {
    const status = statusById.get(id);
    return status && status.state === 'live' && (status.formatFallback === true || status.formatMatched === false);
  });
  const liveInputStatus = missingInputIds.length ? 'block' : (unavailableActiveIds.length || fallbackActiveIds.length ? 'warn' : 'ok');
  const liveInputDetail = missingInputIds.length ? 'missing:' + missingInputIds.join(',')
    : (unavailableActiveIds.length ? 'not-live:' + unavailableActiveIds.join(',')
      : (fallbackActiveIds.length ? 'format-fallback:' + fallbackActiveIds.map(id => {
        const status = statusById.get(id) || {};
        const actual = status.width && status.height
          ? `${Math.round(status.width)}x${Math.round(status.height)}${status.frameRate ? `@${Math.round(status.frameRate * 100) / 100}` : ''}`
          : 'unknown';
        return `${id}=${actual}`;
      }).join(',') : (referencedInputIds.length ? referencedInputIds.length + '-ready' : 'none-configured')));
  checks.push(row('liveInputSources', liveInputStatus, liveInputDetail));

  checks.push(row('speakerScreen', facts.speakerScreenReady ? 'ok' : 'warn', facts.speakerScreenReady ? 'open' : 'not-open'));
  const browserStatus = facts.programBrowserReady ? 'ok' : (facts.speakerScreenReady ? 'warn' : 'block');
  checks.push(row('programBrowser', browserStatus, facts.programBrowserReady ? 'reachable' : 'not-reachable'));
  checks.push(row('backstage', facts.backstageReady ? 'ok' : 'warn', facts.backstageReady ? 'reachable' : 'not-reachable'));
  checks.push(row('phoneRemote', facts.remoteReady ? 'ok' : 'warn', facts.remoteReady ? 'reachable' : 'not-reachable'));
  checks.push(row('apiCompanion', facts.apiReady ? 'ok' : 'warn', facts.apiReady ? 'ready' : 'not-ready'));

  const preferences = show.preferences || {};
  checks.push(row('soundChime', preferences.soundZero || preferences.chimes ? 'ok' : 'warn', preferences.soundZero || preferences.chimes ? 'enabled' : 'disabled'));

  const lower = show.lowerThird || {};
  const library = lower.library || {};
  const templates = Array.isArray(library.templates) ? library.templates : [];
  const activeId = String(lower.activeTemplateId || library.activeTemplateId || '');
  const templateIds = new Set(templates.map(template => String(template && template.id || '')).filter(Boolean));
  const autoCues = cues.filter(cue => cue && cue.lowerThirdAuto);
  const missingAutoTemplate = autoCues.some(cue => {
    const requested = String(cue.lowerThirdTemplateId || activeId || '');
    return !requested || !templateIds.has(requested);
  });
  const templateReady = !!activeId && templateIds.has(activeId);
  checks.push(row('lowerThirdTemplate', missingAutoTemplate ? 'block' : (templateReady ? 'ok' : 'warn'),
    missingAutoTemplate ? 'auto-cue-template-missing' : (templateReady ? activeId : 'none-selected')));

  const displays = Array.isArray(facts.displays) ? facts.displays : [];
  const selectedDisplayId = Number(facts.selectedDisplayId);
  const selectedDisplay = displays.find(display => Number(display.id) === selectedDisplayId);
  checks.push(row('displayAssignment', selectedDisplay ? 'ok' : 'block', selectedDisplay ? String(selectedDisplay.label || selectedDisplay.id) : 'not-assigned'));

  const configs = show.outputs && Array.isArray(show.outputs.configs) ? show.outputs.configs.filter(config => config && config.enabled !== false) : [];
  const audioRoutes = [
    ...(show.outputs && show.outputs.primaryLiveAudio === true ? ['Primary output'] : []),
    ...configs.filter(config => config.liveAudio === true).map(config => String(config.name || config.id || 'Output'))
  ];
  checks.push(row('liveInputAudio', referencedInputIds.length && audioRoutes.length > 1 ? 'block' : 'ok',
    referencedInputIds.length && audioRoutes.length > 1 ? audioRoutes.join(', ') : (audioRoutes[0] || 'muted')));
  const configResolutionsValid = configs.every(config => {
    const mode = String(config.mode || 'fullscreen');
    if (mode !== 'custom' && mode !== 'window') return true;
    return Number(config.width) >= 160 && Number(config.width) <= 8192 && Number(config.height) >= 120 && Number(config.height) <= 8192;
  });
  const displayResolutionValid = !!selectedDisplay && Number(selectedDisplay.width) >= 320 && Number(selectedDisplay.height) >= 180;
  checks.push(row('outputResolution', displayResolutionValid && configResolutionsValid ? 'ok' : 'block',
    displayResolutionValid && configResolutionsValid ? selectedDisplay.width + 'x' + selectedDisplay.height : 'invalid'));

  const canvas = compositor.normalizeCanvas(content.canvas);
  const canvasAspect = canvas.width / canvas.height;
  const aspectDestinations = [];
  if (selectedDisplay) {
    aspectDestinations.push({ name: 'Primary', width: Number(selectedDisplay.width), height: Number(selectedDisplay.height) });
  }
  for (const config of configs) {
    const mode = String(config.mode || 'fullscreen');
    const assignedDisplay = displays.find(display => Number(display.id) === Number(config.displayId)
      || (config.displayLabel && String(display.label || '') === String(config.displayLabel)));
    const width = mode === 'custom' || mode === 'window' ? Number(config.width) : Number(assignedDisplay && assignedDisplay.width);
    const height = mode === 'custom' || mode === 'window' ? Number(config.height) : Number(assignedDisplay && assignedDisplay.height);
    if (width > 0 && height > 0) aspectDestinations.push({ name: String(config.name || config.id || 'Output'), width, height });
  }
  const aspectMismatches = aspectDestinations.filter(destination => {
    const outputAspect = destination.width / destination.height;
    return Math.abs(outputAspect - canvasAspect) / canvasAspect > 0.015;
  });
  checks.push(row('outputAspect', aspectMismatches.length ? 'warn' : 'ok', aspectMismatches.length
    ? aspectMismatches.map(destination => `${destination.name}:${destination.width}x${destination.height}`).join(', ')
    : `${canvas.width}x${canvas.height}`));

  checks.push(row('recoveryStatus', facts.recoveryAvailable ? 'block' : 'ok', facts.recoveryAvailable ? 'recovery-pending' : 'clear'));

  if (String(show.details && show.details.productMode || '') === 'conference-desk') {
    checks.push(row('conferenceMode', 'ok', 'conference-desk'));
    const enabledConfigs = configs.map((config, index) => ({ ...config, id: String(config.id || `route-${index}`), role: conference.normalizeOutputRole(config.role) }));
    const audienceRoutes = enabledConfigs.filter(config => config.role === 'audience');
    checks.push(row('conferenceAudienceRoute', audienceRoutes.length ? 'ok' : 'block', audienceRoutes.length ? `${audienceRoutes.length}-configured` : 'audience-required'));

    const unavailableRoutes = enabledConfigs.filter(config => {
      const id = Number(config.displayId);
      const label = String(config.displayLabel || '');
      return !displays.some(display => Number(display.id) === id || (label && String(display.label || '') === label));
    });
    checks.push(row('conferenceRouteAssignments', unavailableRoutes.length ? 'block' : 'ok', unavailableRoutes.length ? unavailableRoutes.map(config => config.name || config.id).join(', ') : 'all-assigned'));

    const contentIds = new Set((Array.isArray(content.items) ? content.items : []).map(item => String(item && item.id || '')).filter(Boolean));
    const brokenCueActions = cues.filter(cue => cue && cue.autoTakeContentOnGo && !contentIds.has(String(cue.contentItemId || '')));
    const automatedCues = cues.filter(cue => cue && (cue.autoTakeContentOnGo || cue.lowerThirdAuto));
    checks.push(row('conferenceCueActions', brokenCueActions.length ? 'block' : (automatedCues.length ? 'ok' : 'warn'),
      brokenCueActions.length ? `${brokenCueActions.length}-broken` : `${automatedCues.length}-automated`));

    const importedAssets = Math.max(0, Number(show.details && show.details.importedAssets) || 0);
    const matchedAssets = Math.max(0, Number(show.details && show.details.matchedAssets) || 0);
    checks.push(row('conferenceMediaMapping', importedAssets && !matchedAssets ? 'warn' : 'ok', importedAssets ? `${matchedAssets}/${importedAssets}-matched` : 'manual-content'));

    const runtime = facts.outputRuntime && typeof facts.outputRuntime === 'object' ? facts.outputRuntime : { revision: 0, routes: [] };
    const runtimeById = new Map((Array.isArray(runtime.routes) ? runtime.routes : []).map(route => [String(route && route.id || ''), route]));
    const deliveryRoutes = enabledConfigs.map(config => runtimeById.get(config.id) || { id: config.id, enabled: true, open: false, ackRevision: 0 });
    const delivery = conference.deliverySummary(deliveryRoutes, Number(runtime.revision) || 0);
    const deliveryStatus = delivery.ready ? 'ok' : 'warn';
    const deliveryDetail = delivery.ready ? `${delivery.acknowledged}/${delivery.expected}-confirmed`
      : (!deliveryRoutes.some(route => route.open) ? 'not-tested' : `${delivery.acknowledged}/${delivery.expected}-confirmed`);
    checks.push(row('conferenceOutputDelivery', deliveryStatus, deliveryDetail));
  }

  const overall = checks.some(check => check.status === 'block') ? 'blocking'
    : checks.some(check => check.status === 'warn') ? 'warning' : 'ready';
  return {
    ok: overall !== 'blocking',
    overall,
    checks,
    counts: {
      ok: checks.filter(check => check.status === 'ok').length,
      warning: checks.filter(check => check.status === 'warn').length,
      blocking: checks.filter(check => check.status === 'block').length
    }
  };
}

module.exports = { evaluatePreflight };
