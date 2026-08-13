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
  outputCanvas: { width: 1920, height: 1080, fps: 50, fit: 'contain' },
  projection: {
    id: 'mapping-left', name: 'Left projector', compositionId: 'composition-led', x: 0, y: 0, width: 2688, height: 768,
    canvasWidth: 5376, canvasHeight: 768, blend: { right: 96 },
    warp: {
      enabled: true,
      corners: { topLeft: { x: 3, y: 5 }, topRight: { x: 98, y: 1 }, bottomRight: { x: 94, y: 96 }, bottomLeft: { x: 7, y: 99 } },
      grid: { visible: true, columns: 10, rows: 8 }
    }
  }
}, 1, { displays, controlDisplayId: 1 });
check('OUTPUT_MODEL_PROJECTOR_MAPPING_PRESERVED_OK', projected.compositionId === 'composition-led' && projected.mappingId === 'mapping-left' && projected.projection.width === 2688 && projected.projection.canvasWidth === 5376 && projected.projection.blend.right === 96 && projected.projection.warp.enabled && projected.projection.warp.grid.columns === 10);

const square = routing.normalizeConfig({
  id: 'route-square', displayId: 3, mode: 'window', outputCanvas: { width: 1000, height: 1000, fps: 30, fit: 'cover' }
}, 2, { displays, controlDisplayId: 1 });
check('OUTPUT_MODEL_INDEPENDENT_DESTINATION_CANVASES_OK', projected.outputCanvas.width === 1920 && projected.outputCanvas.height === 1080 && projected.outputCanvas.fit === 'contain' && square.outputCanvas.width === 1000 && square.outputCanvas.height === 1000 && square.outputCanvas.fit === 'cover');

const multiSurface = routing.normalizeConfig({
  id: 'route-multi', displayId: 3, projection: {
    id: 'surface-a', compositionId: 'composition-main', canvasWidth: 1920, canvasHeight: 1080,
    input: { x: 0, y: 0, width: 960, height: 1080 }, output: { x: 0, y: 0, width: 50, height: 100 },
    surfaces: [
      { id: 'surface-a', compositionId: 'composition-main', canvasWidth: 1920, canvasHeight: 1080, input: {x:0,y:0,width:960,height:1080}, output: {x:0,y:0,width:50,height:100} },
      { id: 'surface-b', compositionId: 'composition-main', canvasWidth: 1920, canvasHeight: 1080, input: {x:960,y:0,width:960,height:1080}, output: {x:50,y:0,width:50,height:100}, warp: {enabled:true,mode:'mesh',mesh:{columns:2,rows:1}} }
    ]
  }
}, 3, { displays, controlDisplayId: 1 });
check('OUTPUT_MODEL_MULTI_SURFACE_ROUTE_PRESERVED_OK', multiSurface.projection.surfaces.length === 2 && multiSurface.projection.surfaces[1].input.x === 960 && multiSurface.projection.surfaces[1].output.x === 50 && multiSurface.projection.surfaces[1].warp.mode === 'mesh');

console.log(`OUTPUT_ROUTING_MODEL_TESTS_OK count=${checks}`);
