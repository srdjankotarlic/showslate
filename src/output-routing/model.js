'use strict';

const conference = require('../conference-desk/model.js');

const OUTPUT_MODES = new Set(['fullscreen', 'window', 'custom', 'grid']);
const PLACEMENTS = new Set(['center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'custom']);

function numberInRange(value, fallback, min, max) {
  const parsed = parseInt(value, 10);
  const resolved = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, resolved));
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
    frameless: mode === 'grid' || !!source.frameless
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

module.exports = { normalizeConfig, rememberDisplay, resolveDisplay, placedBounds, gridBounds };
