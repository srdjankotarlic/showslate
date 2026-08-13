const assert = require('assert');
const { evaluatePreflight } = require('../src/show-storage/preflight.js');

function showDocument() {
  return {
    schemaVersion: 1,
    show: {
      id: 'show-preflight', name: 'Preflight Demo', details: {},
      rundown: [{ id: 'cue-1', name: 'Opening', durationMs: 60000 }],
      selectedCue: 0, liveCue: -1,
      timer: { mode: 'countdown', durationMs: 60000, remainingMs: 60000, elapsedMs: 0, wasRunning: false },
      actualTimes: [], message: { text: '', flash: false },
      lowerThird: { library: { activeTemplateId: '', templates: [] }, activeTemplateId: '' },
      screenContent: {}, branding: {}, outputs: { configs: [] }, preferences: { soundZero: false, chimes: false }
    }
  };
}

const readyFacts = {
  lastSaveOk: true, autosaveWritable: true, missingAssets: [], speakerScreenReady: true,
  programBrowserReady: true, backstageReady: true, remoteReady: true, apiReady: true,
  displays: [{ id: 7, label: 'PHL 243V7', width: 1920, height: 1080 }], selectedDisplayId: 7,
  recoveryAvailable: false
};

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(name + '=true'); }

check('PREFLIGHT_READY_WITH_NON_BLOCKING_WARNINGS_OK', () => {
  const result = evaluatePreflight(showDocument(), readyFacts);
  assert.strictEqual(result.overall, 'warning');
  assert.strictEqual(result.counts.blocking, 0);
  assert(result.checks.find(row => row.id === 'soundChime').status === 'warn');
});

check('PREFLIGHT_BLOCKS_UNSAVED_INVALID_SHOW_OK', () => {
  const document = showDocument();
  document.show.rundown = [];
  const result = evaluatePreflight(document, { ...readyFacts, lastSaveOk: false, autosaveWritable: false });
  assert.strictEqual(result.overall, 'blocking');
  assert(result.checks.find(row => row.id === 'showSaved').status === 'block');
  assert(result.checks.find(row => row.id === 'rundownValid').status === 'block');
});

check('PREFLIGHT_BLOCKS_MISSING_ASSET_DISPLAY_RECOVERY_OK', () => {
  const result = evaluatePreflight(showDocument(), {
    ...readyFacts, missingAssets: ['missing.png'], displays: [], selectedDisplayId: null, recoveryAvailable: true
  });
  assert.strictEqual(result.overall, 'blocking');
  assert(result.checks.find(row => row.id === 'missingAssets').status === 'block');
  assert(result.checks.find(row => row.id === 'displayAssignment').status === 'block');
  assert(result.checks.find(row => row.id === 'recoveryStatus').status === 'block');
});

check('PREFLIGHT_AUTO_LT_REQUIRES_REAL_TEMPLATE_OK', () => {
  const document = showDocument();
  document.show.rundown[0].lowerThirdAuto = true;
  document.show.rundown[0].lowerThirdTemplateId = 'missing-template';
  const result = evaluatePreflight(document, readyFacts);
  assert(result.checks.find(row => row.id === 'lowerThirdTemplate').status === 'block');
});

check('PREFLIGHT_CONFERENCE_DESK_REQUIRES_AUDIENCE_ROUTE_OK', () => {
  const document = showDocument();
  document.show.details.productMode = 'conference-desk';
  const result = evaluatePreflight(document, readyFacts);
  assert.strictEqual(result.overall, 'blocking');
  assert.strictEqual(result.checks.find(row => row.id === 'conferenceAudienceRoute').status, 'block');
});

check('PREFLIGHT_CONFERENCE_DESK_ACCEPTS_ACKED_ROLE_OUTPUTS_OK', () => {
  const document = showDocument();
  document.show.details.productMode = 'conference-desk';
  document.show.outputs.configs = [{ id: 'audience', name: 'Audience', role: 'audience', enabled: true, displayId: 7 }];
  const result = evaluatePreflight(document, {
    ...readyFacts,
    outputRuntime: { revision: 9, routes: [{ id: 'audience', enabled: true, open: true, ackRevision: 9 }] }
  });
  assert.notStrictEqual(result.overall, 'blocking');
  assert.strictEqual(result.checks.find(row => row.id === 'conferenceOutputDelivery').status, 'ok');
});

check('PREFLIGHT_BLOCKS_MISSING_LIVE_INPUT_DEFINITION_OK', () => {
  const document = showDocument();
  document.show.screenContent = {
    activeSceneId: 'live-scene',
    scenes: [{ id: 'live-scene', layers: [{ id: 'camera', type: 'capture', inputId: 'missing-card' }] }],
    liveInputs: []
  };
  const result = evaluatePreflight(document, readyFacts);
  assert.strictEqual(result.checks.find(row => row.id === 'liveInputSources').status, 'block');
});

check('PREFLIGHT_LIVE_INPUT_STATUS_AND_AUDIO_ROUTE_OK', () => {
  const document = showDocument();
  document.show.screenContent = {
    activeSceneId: 'live-scene',
    scenes: [{ id: 'live-scene', layers: [{ id: 'camera', type: 'capture', inputId: 'card-1' }] }],
    liveInputs: [{ id: 'card-1', type: 'device', videoDeviceId: 'video-1' }]
  };
  document.show.outputs = { primaryLiveAudio: true, configs: [{ id: 'aux', name: 'Recorder', enabled: true, liveAudio: true }] };
  const result = evaluatePreflight(document, { ...readyFacts, liveInputStatuses: [{ inputId: 'card-1', state: 'live' }] });
  assert.strictEqual(result.checks.find(row => row.id === 'liveInputSources').status, 'ok');
  assert.strictEqual(result.checks.find(row => row.id === 'liveInputAudio').status, 'block');
});

check('PREFLIGHT_WARNS_WHEN_LIVE_INPUT_FALLS_BACK_FROM_REQUESTED_FORMAT_OK', () => {
  const document = showDocument();
  document.show.screenContent = {
    activeSceneId: 'live-scene',
    scenes: [{ id: 'live-scene', layers: [{ id: 'camera', type: 'capture', inputId: 'card-4k' }] }],
    liveInputs: [{ id: 'card-4k', type: 'device', videoDeviceId: 'video-4k', width: 3840, height: 2160, fps: 60 }]
  };
  const result = evaluatePreflight(document, {
    ...readyFacts,
    liveInputStatuses: [{
      inputId: 'card-4k', state: 'live', formatMatched: false, formatFallback: true,
      width: 1920, height: 1080, frameRate: 30
    }]
  });
  const source = result.checks.find(row => row.id === 'liveInputSources');
  assert.strictEqual(source.status, 'warn');
  assert(source.detail.includes('format-fallback:card-4k=1920x1080@30'));
});

check('PREFLIGHT_WARNS_ON_CANVAS_OUTPUT_ASPECT_MISMATCH_OK', () => {
  const document = showDocument();
  document.show.screenContent = { canvas: { width: 1000, height: 1000, fps: 30 }, scenes: [], liveInputs: [] };
  document.show.outputs.configs = [{ id: 'wide', name: 'Wide wall', enabled: true, mode: 'custom', width: 1920, height: 1080 }];
  const result = evaluatePreflight(document, readyFacts);
  const aspect = result.checks.find(row => row.id === 'outputAspect');
  assert.strictEqual(aspect.status, 'warn');
  assert(aspect.detail.includes('Wide wall:1920x1080'));
});

console.log('SHOW_PREFLIGHT_TESTS_OK count=' + passed);
