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

console.log('SHOW_PREFLIGHT_TESTS_OK count=' + passed);
