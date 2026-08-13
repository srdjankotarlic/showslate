'use strict';

const conference = require('../conference-desk/model.js');
const compositor = require('../compositor/model.js');

const OUTPUT_MODES = new Set(['fullscreen', 'window', 'custom', 'grid']);
const PLACEMENTS = new Set(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'custom']);
const CANVAS_FITS = new Set(['contain', 'cover', 'fill']);

function numberInRange(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, resolved));
}

function normalizeProjection(raw) {
  if (!raw || typeof raw !== 'object' || raw.enabled === false) return null;
  const canvasWidth = numberInRange(raw.canvasWidth, 1920, 1, 8192);
  const canvasHeight = numberInRange(raw.canvasHeight, 1080, 1, 8192);
  const x = numberInRange(raw.x, 0, 0, Math.max(0, canvasWidth - 1));
  const y = numberInRange(raw.y, 0, 0, Math.max(0, canvasHeight - 1));
  const width = numberInRange(raw.width, canvasWidth - x, 1, Math.max(1, canvasWidth - x));
  const height = numberInRange(raw.height, canvasHeight - y, 1, Math.max(1, canvasHeight - y));
  const blend = raw.blend && typeof raw.blend === 'object' ? raw.blend : {};
  const primary = {
    id: String(raw.id || ''),
    name: String(raw.name || 'Projector surface').slice(0, 160),
    compositionId: String(raw.compositionId || ''),
    enabled: true,
    x,
    y,
    width,
    height,
    canvasWidth,
    canvasHeight,
    input: compositor.normalizeMappingInput(raw.input || { x, y, width, height }, { width: canvasWidth, height: canvasHeight }),
    output: compositor.normalizeMappingOutput(raw.output),
    opacity: Math.max(0, Math.min(1, Number(raw.opacity ?? 1))),
    solo: raw.solo === true,
    mask: compositor.normalizeMappingMask(raw.mask),
    blend: {
      left: numberInRange(blend.left, 0, 0, Math.min(2048, Math.floor(width / 2))),
      right: numberInRange(blend.right, 0, 0, Math.min(2048, Math.floor(width / 2))),
      top: numberInRange(blend.top, 0, 0, Math.min(2048, Math.floor(height / 2))),
      bottom: numberInRange(blend.bottom, 0, 0, Math.min(2048, Math.floor(height / 2))),
      gamma: Math.max(0.1, Math.min(3, Number(blend.gamma) || 1)),
      blackLevel: Math.max(0, Math.min(1, Number(blend.blackLevel) || 0))
    },
    warp: compositor.normalizeProjectorWarp(raw.warp)
  };
  if (Array.isArray(raw.surfaces)) {
    primary.surfaces = raw.surfaces
      .map(surface => normalizeProjection({ ...surface, surfaces: undefined }))
      .filter(Boolean);
  }
  return primary;
}

function normalizeOutputCanvas(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const canvas = compositor.normalizeCanvas({
    width: source.width,
    height: source.height,
    fps: source.fps,
    background: source.background,
    transparent: source.transparent
  });
  return {
    ...canvas,
    preset: compositor.canvasPreset(canvas),
    fit: CANVAS_FITS.has(source.fit) ? source.fit : 'contain'
  };
}

function rememberDisplay(config, display) {
  if (!config || !display || !display.bounds) return config;
  config.displayId = display.id;
  config.displayLabel = String(display.label || '');
  config.displayWidth = display.bounds.width;
  config.displayHeight = display.bounds.height;
  return config;
}

function normalizeConfig(config, index = 0, context = {}) {
  const source = config || {};
  const displays = Array.isArray(context.displays) ? context.displays : [];
  const controlId = Number(context.controlDisplayId);
  const fallback = displays.find(display => display.id !== controlId) || displays[0] || context.primaryDisplay;
  if (!fallback) throw new Error('At least one display is required to normalize an output route.');

  const mode = OUTPUT_MODES.has(source.mode) ? source.mode : 'fullscreen';
  const placement = PLACEMENTS.has(source.placement) ? source.placement : 'center';
  const gridSize = numberInRange(source.gridSize, 3, 1, 12);
  const gridCell = numberInRange(source.gridCell, 0, 0, gridSize * gridSize - 1);
  const displayId = Number(source.displayId || fallback.id);
  const normalized = {
    id: String(source.id || `out-${context.now || Date.now()}-${index}`),
    name: String(source.name || `Output ${index + 1}`),
    role: conference.normalizeOutputRole(source.role),
    enabled: source.enabled !== false,
    liveAudio: source.liveAudio === true,
    audioOutputDeviceId: String(source.audioOutputDeviceId || '').slice(0, 1024),
    displayId,
    displayLabel: String(source.displayLabel || ''),
    displayWidth: Math.max(0, parseInt(source.displayWidth, 10) || 0),
    displayHeight: Math.max(0, parseInt(source.displayHeight, 10) || 0),
    mode,
    width: numberInRange(source.width, 1000, 160, 8192),
    height: numberInRange(source.height, 1000, 120, 8192),
    placement,
    x: Number.isFinite(Number(source.x)) ? Number(source.x) : null,
    y: Number.isFinite(Number(source.y)) ? Number(source.y) : null,
    gridSize,
    gridCell,
    compositionId: String(source.compositionId || ''),
    mappingId: String(source.mappingId || ''),
    projection: normalizeProjection(source.projection),
    outputCanvas: normalizeOutputCanvas(source.outputCanvas),
    frameless: mode === 'fullscreen' || mode === 'custom' || mode === 'grid' || !!source.frameless
  };
  const exact = displays.find(display => display.id === displayId);
  if (exact && !normalized.displayLabel) rememberDisplay(normalized, exact);
  return normalized;
}

function resolveDisplay(config, displays, options = {}) {
  const list = Array.isArray(displays) ? displays : [];
  const requestedId = Number(config && config.displayId);
  const requestedLabel = String(config && config.displayLabel || '').trim();
  const allowedId = options.allowedDisplayId == null ? null : Number(options.allowedDisplayId);
  const allowed = display => allowedId == null || (display && display.id === allowedId);
  const exact = list.find(display => display.id === requestedId);

  if (exact && allowed(exact) && (!requestedLabel || String(exact.label || '') === requestedLabel)) {
    return { display: exact, match: 'id', reason: '' };
  }

  let candidates = [];
  if (requestedLabel) {
    candidates = list.filter(display => String(display.label || '') === requestedLabel && allowed(display));
  } else {
    const width = Math.max(0, Number(config && config.displayWidth) || 0);
    const height = Math.max(0, Number(config && config.displayHeight) || 0);
    if (width && height) {
      candidates = list.filter(display => display.bounds && display.bounds.width === width && display.bounds.height === height && allowed(display));
    }
  }

  if (candidates.length === 1) return { display: candidates[0], match: 'fingerprint', reason: '' };
  return { display: null, match: 'none', reason: candidates.length > 1 ? 'ambiguous-display' : 'missing-display' };
}

function placedBounds(area, width, height, config, margin = 24) {
  const maxX = Math.max(0, area.width - width);
  const maxY = Math.max(0, area.height - height);
  const placement = config.placement || 'center';
  let x = Math.round(maxX / 2);
  let y = Math.round(maxY / 2);
  if (placement === 'top-left') { x = margin; y = margin; }
  if (placement === 'top-right') { x = maxX - margin; y = margin; }
  if (placement === 'bottom-left') { x = margin; y = maxY - margin; }
  if (placement === 'bottom-right') { x = maxX - margin; y = maxY - margin; }
  if (placement === 'custom') {
    if (Number.isFinite(config.x)) x = config.x;
    if (Number.isFinite(config.y)) y = config.y;
  }
  return {
    x: area.x + Math.max(0, Math.min(maxX, x)),
    y: area.y + Math.max(0, Math.min(maxY, y)),
    width,
    height
  };
}

function gridBounds(area, gridSize, gridCell) {
  const size = numberInRange(gridSize, 3, 1, 12);
  const cell = numberInRange(gridCell, 0, 0, size * size - 1);
  const row = Math.floor(cell / size);
  const column = cell % size;
  const width = Math.floor(area.width / size);
  const height = Math.floor(area.height / size);
  return { x: area.x + column * width, y: area.y + row * height, width, height };
}

module.exports = { normalizeConfig, normalizeProjection, normalizeOutputCanvas, rememberDisplay, resolveDisplay, placedBounds, gridBounds };
