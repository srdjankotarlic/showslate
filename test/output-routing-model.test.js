'use strict';

const assert = require('assert');
const routing = require('../src/output-routing/model.js');

let checks = 0;
function check(name, condition) {
  console.log(`${name}=${!!condition}`);
  assert.ok(condition, name);
  checks++;
}

const control = { id: 1, label: 'Built-in Retina Display', bounds: { x: 0, y: 0, width: 1728, height: 1117 } };
const philips = { id: 3, label: 'PHL 243V7', bounds: { x: -1920, y: 0, width: 1920, height: 1080 } };
const displays = [control, philips];

const normalized = routing.normalizeConfig({ id: 'route-a', mode: 'custom', displayId: 3, width: 1000, height: 1000, placement: 'custom', x: 40, y: 30, audioOutputDeviceId: 'speaker-main' }, 0, { displays, controlDisplayId: 1 });
check('OUTPUT_MODEL_NORMALIZES_AND_FINGERPRINTS_OK', normalized.displayId === 3 && normalized.displayLabel === 'PHL 243V7' && normalized.displayWidth === 1920 && normalized.gridSize === 3 && normalized.audioOutputDeviceId === 'speaker-main');

const exact = routing.resolveDisplay(normalized, displays);
check('OUTPUT_MODEL_EXACT_DISPLAY_OK', exact.display === philips && exact.match === 'id');

const reconnect = routing.resolveDisplay({ ...normalized, displayId: 999 }, displays);
check('OUTPUT_MODEL_UNIQUE_FINGERPRINT_RECONNECT_OK', reconnect.display === philips && reconnect.match === 'fingerprint');

const duplicateDisplays = [philips, { ...philips, id: 4 }];
const ambiguous = routing.resolveDisplay({ ...normalized, displayId: 999 }, duplicateDisplays);
check('OUTPUT_MODEL_AMBIGUOUS_DISPLAY_BLOCKED_OK', ambiguous.display === null && ambiguous.reason === 'ambiguous-display');

const missing = routing.resolveDisplay({ ...normalized, displayId: 999, displayLabel: 'Missing Display' }, displays);
check('OUTPUT_MODEL_MISSING_DISPLAY_NO_FALLBACK_OK', missing.display === null && missing.reason === 'missing-display');

const smokeBlocked = routing.resolveDisplay(normalized, displays, { allowedDisplayId: 1 });
check('OUTPUT_MODEL_TEST_DISPLAY_GUARD_OK', smokeBlocked.display === null && smokeBlocked.reason === 'missing-display');

const custom = routing.placedBounds(philips.bounds, 320, 180, { placement: 'custom', x: 40, y: 30 }, 0);
check('OUTPUT_MODEL_CUSTOM_BOUNDS_OK', custom.x === -1880 && custom.y === 30 && custom.width === 320 && custom.height === 180);

const clamped = routing.placedBounds(philips.bounds, 320, 180, { placement: 'custom', x: 9999, y: -50 }, 0);
check('OUTPUT_MODEL_CUSTOM_BOUNDS_CLAMPED_OK', clamped.x === -320 && clamped.y === 0);

const grid = routing.gridBounds(philips.bounds, 3, 8);
check('OUTPUT_MODEL_GRID_BOUNDS_OK', grid.x === -640 && grid.y === 720 && grid.width === 640 && grid.height === 360);

const projected = routing.normalizeConfig({
  id: 'route-projected', displayId: 3, mode: 'fullscreen', compositionId: 'composition-led', mappingId: 'mapping-left',
  projection: { id: 'mapping-left', name: 'Left projector', compositionId: 'composition-led', x: 0, y: 0, width: 2688, height: 768, canvasWidth: 5376, canvasHeight: 768, blend: { right: 96 } }
}, 1, { displays, controlDisplayId: 1 });
check('OUTPUT_MODEL_PROJECTOR_MAPPING_PRESERVED_OK', projected.compositionId === 'composition-led' && projected.mappingId === 'mapping-left' && projected.projection.width === 2688 && projected.projection.canvasWidth === 5376 && projected.projection.blend.right === 96);

console.log(`OUTPUT_ROUTING_MODEL_TESTS_OK count=${checks}`);
