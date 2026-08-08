'use strict';

const assert = require('assert');
const conference = require('../src/conference-desk/model.js');

let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`${name}=true`);
}

check('CONFERENCE_SCHEDULE_HEADER_IMPORT_OK', () => {
  const result = conference.parseSchedule([
    'session,duration,speaker,speaker title,company,media,auto content',
    'Opening,10:00,Ana Markovic,Host,Example Events,opening.png,yes',
    'Keynote,30:00,Dr Maya Chen,Keynote Speaker,Northstar,keynote.pdf,true'
  ].join('\n'));
  assert.strictEqual(result.errors.length, 0);
  assert.strictEqual(result.cues.length, 2);
  assert.strictEqual(result.cues[1].durationMs, 1800000);
  assert.strictEqual(result.cues[1].speakerName, 'Dr Maya Chen');
  assert.strictEqual(result.cues[1].assetRef, 'keynote.pdf');
  assert.strictEqual(result.cues[1].lowerThirdAuto, true);
});

check('CONFERENCE_SCHEDULE_QUOTED_CELLS_OK', () => {
  const result = conference.parseSchedule('name,duration,note\n"Panel, Q&A",45:00,"Line one\nLine two"');
  assert.strictEqual(result.cues.length, 1);
  assert.strictEqual(result.cues[0].name, 'Panel, Q&A');
  assert.strictEqual(result.cues[0].note, 'Line one\nLine two');
});

check('CONFERENCE_SCHEDULE_LEGACY_COLUMNS_OK', () => {
  const result = conference.parseSchedule('Coffee Break;15:00;Lobby');
  assert.strictEqual(result.cues.length, 1);
  assert.strictEqual(result.cues[0].note, 'Lobby');
  assert(result.warnings.includes('legacy-columns'));
});

check('CONFERENCE_MEDIA_MATCHING_IS_CONSERVATIVE_OK', () => {
  const result = conference.matchScheduleAssets([
    { name: 'Opening', assetRef: '01-opening.png' },
    { name: 'Keynote' },
    { name: 'Panel discussion', assetRef: 'missing.pdf' },
    { name: 'Closing', assetRef: '01-opening.png' }
  ], [
    { id: 'asset-open', name: '01-opening.png', src: 'media://open.png' },
    { id: 'asset-keynote', name: '002_keynote.pdf', src: 'media://keynote.pdf' },
    { id: 'asset-other', name: 'sponsor-loop.mp4', src: 'media://sponsor.mp4' }
  ]);
  assert.strictEqual(result.matches.length, 3);
  assert.strictEqual(result.unmatchedCues.length, 1);
  assert.strictEqual(result.unmatchedAssets.length, 1);
  assert.strictEqual(result.cues[1].matchedAsset.id, 'asset-keynote');
  assert.strictEqual(result.cues[3].matchedAsset.id, 'asset-open');
});

check('CONFERENCE_OUTPUT_ROLES_NORMALIZE_OK', () => {
  assert.strictEqual(conference.normalizeOutputRole('program'), 'audience');
  assert.strictEqual(conference.normalizeOutputRole('confidence'), 'confidence');
  assert.strictEqual(conference.normalizeOutputRole('unknown'), 'audience');
  assert.strictEqual(conference.outputRoleDefinition('stream').label, 'Stream graphics');
});

check('CONFERENCE_GO_TRANSACTION_PLANS_CUE_ACTIONS_OK', () => {
  const plan = conference.buildGoTransaction({
    id: 'cue-keynote', name: 'Keynote', durationMs: 1800000,
    contentItemId: 'content-keynote', autoTakeContentOnGo: true,
    speakerName: 'Maya Chen', lowerThirdAuto: true, lowerThirdTemplateId: 'clean'
  }, { id: 'go-1', now: 1000, autoStart: true, contentItemExists: id => id === 'content-keynote' });
  assert.strictEqual(plan.id, 'go-1');
  assert.strictEqual(plan.timer.start, true);
  assert.strictEqual(plan.content.take, true);
  assert.strictEqual(plan.lowerThird.take, true);
});

check('CONFERENCE_DELIVERY_REQUIRES_OPEN_ACKED_ROUTES_OK', () => {
  const ready = conference.deliverySummary([
    { id: 'audience', enabled: true, open: true, ackRevision: 7 },
    { id: 'confidence', enabled: true, open: true, ackRevision: 7 }
  ], 7);
  assert.strictEqual(ready.ready, true);
  const pending = conference.deliverySummary([
    { id: 'audience', enabled: true, open: true, ackRevision: 6 },
    { id: 'door', enabled: true, open: false, ackRevision: 0 }
  ], 7);
  assert.strictEqual(pending.ready, false);
  assert.deepStrictEqual(pending.pending, ['audience']);
  assert.deepStrictEqual(pending.missing, ['door']);
});

console.log(`CONFERENCE_DESK_MODEL_TESTS_OK count=${passed}`);
