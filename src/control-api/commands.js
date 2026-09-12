'use strict';

const CANONICAL_COMMANDS = Object.freeze([
  'startPause',
  'reset',
  'adjust',
  'go',
  'goNext',
  'goSelected',
  'blackout',
  'setDuration',
  'mode',
  'messageSend',
  'messageClear',
  'ltTake',
  'ltHide',
  'ltReplay',
  'ltSelectTemplate',
  'ltAuto',
  'contentTake',
  'contentClear',
  // Existing screen-text API remains supported for backwards compatibility.
  'text',
  'clearText',
  'textOnly'
]);

function commandKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
}

const ALIASES = new Map();
function alias(type, ...names) {
  [type, ...names].forEach(name => ALIASES.set(commandKey(name), type));
}

alias('startPause', 'start', 'start/pause', 'timer/start-pause', 'timer/toggle');
alias('reset', 'timer/reset');
alias('adjust', 'time/adjust', 'timer/adjust');
alias('go', 'go/current');
alias('goNext', 'next', 'go/next');
alias('goSelected', 'go/selected', 'take-selected-cue');
alias('blackout', 'output/blackout');
alias('setDuration', 'duration', 'timer/duration', 'set-duration');
alias('mode', 'timer/mode');
alias('messageSend', 'message', 'message/send', 'send-message');
alias('messageClear', 'clearMessage', 'message/clear', 'clear-message');
alias('ltTake', 'lt/take', 'lower-third/take', 'lowerThirdTake');
alias('ltHide', 'lt/hide', 'lower-third/hide', 'lowerThirdHide');
alias('ltReplay', 'lt/replay', 'lower-third/replay', 'lowerThirdReplay');
alias('ltSelectTemplate', 'lt/select-template', 'lower-third/select-template', 'lowerThirdSelectTemplate');
alias('ltAuto', 'lt/auto', 'lower-third/auto', 'lowerThirdAuto');
alias('contentTake', 'content/take', 'slides/take', 'slideTake');
alias('contentClear', 'content/clear', 'slides/clear', 'slideClear');
alias('text', 'screen/text');
alias('clearText', 'screen/clear-text');
alias('textOnly', 'screen/text-only');

function normalizeCommandType(type) {
  return ALIASES.get(commandKey(type)) || null;
}

function booleanValue(value, { optional = false } = {}) {
  if (value === undefined || value === null || value === '') {
    return optional ? { ok: true, value: undefined } : { ok: false };
  }
  if (typeof value === 'boolean') return { ok: true, value };
  if (typeof value === 'number') {
    if (value === 1) return { ok: true, value: true };
    if (value === 0) return { ok: true, value: false };
  }
  const clean = String(value).trim().toLowerCase();
  if (['1', 'true', 'on', 'yes'].includes(clean)) return { ok: true, value: true };
  if (['0', 'false', 'off', 'no'].includes(clean)) return { ok: true, value: false };
  if (optional && clean === 'toggle') return { ok: true, value: undefined };
  return { ok: false };
}

function finiteNumber(value, min, max) {
  const number = Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function normalizeCommand(raw) {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'invalid command' };
  const type = normalizeCommandType(raw.type);
  if (!type) return { ok: false, error: 'unknown type' };
  let value = raw.value;

  if (type === 'adjust') {
    value = finiteNumber(value, -86400, 86400);
    if (value === null) return { ok: false, error: 'adjust requires seconds between -86400 and 86400' };
  } else if (type === 'setDuration') {
    value = finiteNumber(value, 1000, 604800000);
    if (value === null) return { ok: false, error: 'setDuration requires milliseconds between 1000 and 604800000' };
  } else if (type === 'mode') {
    value = String(value || '').trim().toLowerCase();
    if (!['countdown', 'countup', 'clock'].includes(value)) return { ok: false, error: 'invalid timer mode' };
  } else if (type === 'blackout') {
    const parsed = booleanValue(value, { optional: true });
    if (!parsed.ok) return { ok: false, error: 'blackout value must be on, off, or toggle' };
    value = parsed.value;
  } else if (type === 'ltAuto' || type === 'textOnly') {
    const parsed = booleanValue(value);
    if (!parsed.ok) return { ok: false, error: type + ' requires on or off' };
    value = parsed.value;
  } else if (type === 'ltSelectTemplate') {
    value = String(raw.templateId ?? raw.template ?? value ?? '').trim().slice(0, 200);
    if (!value) return { ok: false, error: 'ltSelectTemplate requires a template id or exact name' };
  } else if (type === 'contentTake') {
    value = String(value || 'transition').trim().toLowerCase();
    if (!['cut', 'transition'].includes(value)) return { ok: false, error: 'contentTake value must be cut or transition' };
  } else if (type === 'messageSend') {
    value = String(value ?? raw.message ?? '').slice(0, 1000);
  } else if (type === 'text') {
    value = String(value ?? '').slice(0, 4000);
  } else if (['startPause', 'reset', 'go', 'goNext', 'goSelected', 'messageClear', 'ltTake', 'ltHide', 'ltReplay', 'contentClear', 'clearText'].includes(type)) {
    value = undefined;
  }

  return { ok: true, command: value === undefined ? { type } : { type, value } };
}

function safeText(value, max = 240) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
}

function safeNumber(value, fallback = 0, min = -Number.MAX_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function safeCue(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    index: Math.max(-1, Math.trunc(safeNumber(value.index, -1, -1, 100000))),
    id: safeText(value.id, 160),
    name: safeText(value.name, 240),
    speakerName: safeText(value.speakerName, 240),
    speakerTitle: safeText(value.speakerTitle, 240),
    status: safeText(value.status, 40)
  };
}

function safeContent(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: safeText(value.id, 160),
    name: safeText(value.name, 240),
    type: safeText(value.type, 40),
    sceneId: safeText(value.sceneId, 160),
    page: Math.max(1, Math.trunc(safeNumber(value.page, 1, 1, 999)))
  };
}

function sanitizeControlStatus(raw) {
  const value = raw && typeof raw === 'object' ? raw : {};
  const timer = value.timer && typeof value.timer === 'object' ? value.timer : {};
  const cue = value.cue && typeof value.cue === 'object' ? value.cue : {};
  const lowerThird = value.lowerThird && typeof value.lowerThird === 'object' ? value.lowerThird : {};
  const content = value.content && typeof value.content === 'object' ? value.content : {};
  const output = value.output && typeof value.output === 'object' ? value.output : {};
  const message = value.message && typeof value.message === 'object' ? value.message : {};
  const now = Date.now();
  const mode = ['countdown', 'countup', 'clock'].includes(timer.mode) ? timer.mode : 'countdown';
  return {
    schemaVersion: 1,
    ready: value.ready === true,
    updatedAt: safeNumber(value.updatedAt, now, 0, Number.MAX_SAFE_INTEGER),
    show: {
      id: safeText(value.show && value.show.id, 160),
      name: safeText(value.show && value.show.name, 240) || 'Untitled show'
    },
    timer: {
      mode,
      running: !!timer.running,
      durationMs: safeNumber(timer.durationMs, 0, 0, 604800000),
      remainingMs: safeNumber(timer.remainingMs, 0, -604800000, 604800000),
      elapsedMs: safeNumber(timer.elapsedMs, 0, 0, 604800000),
      endAt: safeNumber(timer.endAt, 0, 0, Number.MAX_SAFE_INTEGER),
      startAt: safeNumber(timer.startAt, 0, 0, Number.MAX_SAFE_INTEGER),
      capturedAt: safeNumber(timer.capturedAt, now, 0, Number.MAX_SAFE_INTEGER)
    },
    cue: {
      total: Math.max(0, Math.trunc(safeNumber(cue.total, 0, 0, 100000))),
      live: safeCue(cue.live),
      selected: safeCue(cue.selected),
      next: safeCue(cue.next)
    },
    lowerThird: {
      visible: !!lowerThird.visible,
      auto: !!lowerThird.auto,
      canReplay: !!lowerThird.canReplay,
      templateId: safeText(lowerThird.templateId, 200),
      templateName: safeText(lowerThird.templateName, 240),
      instanceId: safeText(lowerThird.instanceId, 200),
      cueId: safeText(lowerThird.cueId, 160),
      phase: safeText(lowerThird.phase, 40),
      speakerName: safeText(lowerThird.speakerName, 240),
      speakerTitle: safeText(lowerThird.speakerTitle, 240)
    },
    content: {
      selected: safeContent(content.selected),
      live: safeContent(content.live)
    },
    output: {
      open: !!output.open,
      blackout: !!output.blackout
    },
    message: {
      visible: message.visible === undefined ? !!safeText(message.text, 1000) : !!message.visible,
      text: safeText(message.text, 1000),
      flash: !!message.flash
    }
  };
}

function materializeControlStatus(raw, now = Date.now()) {
  const status = sanitizeControlStatus(raw);
  const timer = status.timer;
  if (timer.running && timer.mode === 'countdown' && timer.endAt) {
    timer.remainingMs = Math.max(-604800000, Math.min(604800000, timer.endAt - now));
  }
  if (timer.running && timer.mode === 'countup' && timer.startAt) {
    // elapsedMs already includes the running interval through capturedAt.
    timer.elapsedMs = Math.min(604800000, timer.elapsedMs + Math.max(0, now - timer.capturedAt));
  }
  status.queriedAt = now;
  return status;
}

function selectStatusSection(raw, section = 'all', now = Date.now()) {
  const status = materializeControlStatus(raw, now);
  const common = {
    schemaVersion: status.schemaVersion,
    ready: status.ready,
    updatedAt: status.updatedAt,
    queriedAt: status.queriedAt
  };
  if (section === 'show') return { ...common, show: status.show, timer: status.timer, output: status.output, message: status.message };
  if (section === 'cue') return { ...common, cue: status.cue, timer: status.timer };
  if (section === 'lowerThird') return { ...common, lowerThird: status.lowerThird };
  if (section === 'content') return { ...common, content: status.content };
  return status;
}

module.exports = {
  CANONICAL_COMMANDS,
  normalizeCommandType,
  normalizeCommand,
  sanitizeControlStatus,
  materializeControlStatus,
  selectStatusSection
};
