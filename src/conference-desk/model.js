(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.SHOWSLATE_CONFERENCE = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const OUTPUT_ROLES = ['audience', 'confidence', 'timer', 'stream', 'door'];
  const ROLE_DEFINITIONS = Object.freeze({
    audience: Object.freeze({ label: 'Audience', description: 'Slides, holding screens, timers and full Program content.' }),
    confidence: Object.freeze({ label: 'Confidence', description: 'Current cue, next cue, speaker timer and operator messages.' }),
    timer: Object.freeze({ label: 'Timer', description: 'A clean speaker timer with urgent messages only.' }),
    stream: Object.freeze({ label: 'Stream graphics', description: 'Transparent lower thirds and show graphics for OBS or vMix.' }),
    door: Object.freeze({ label: 'Door agenda', description: 'Room-facing current and next session information.' })
  });

  const HEADER_ALIASES = Object.freeze({
    name: ['name', 'cue', 'cue name', 'item', 'session', 'session name', 'session title', 'title', 'naziv', 'tacka', 'tačka'],
    duration: ['duration', 'length', 'time', 'planned duration', 'trajanje'],
    note: ['note', 'notes', 'description', 'stage note', 'beleška', 'beleska', 'napomena'],
    color: ['color', 'colour', 'boja'],
    speakerName: ['speaker', 'speaker name', 'presenter', 'presenter name', 'guest', 'govornik', 'ime govornika'],
    speakerTitle: ['speaker title', 'presenter title', 'role', 'job title', 'position', 'titula', 'funkcija'],
    company: ['company', 'organization', 'organisation', 'org', 'kompanija', 'organizacija'],
    sessionTitle: ['lower third session', 'lt session', 'session subtitle', 'session label'],
    segmentTitle: ['segment', 'segment title'],
    custom1: ['custom', 'custom 1', 'custom text'],
    assetRef: ['media', 'asset', 'file', 'filename', 'content', 'slide', 'deck', 'presentation', 'grafika', 'fajl'],
    startTime: ['start', 'start time', 'scheduled start', 'početak', 'pocetak'],
    room: ['room', 'stage', 'track', 'sala', 'bina'],
    lowerThirdAuto: ['auto lower third', 'lower third', 'lt auto', 'auto lt', 'potpis'],
    autoTakeContentOnGo: ['auto content', 'take content', 'content on go', 'auto take'],
    lowerThirdHideBeforeNextGo: ['hide lower third', 'hide before next', 'hide lt'],
    lowerThirdNoRepeat: ['skip repeated lower third', 'no repeat', 'lt no repeat']
  });

  const SUPPORTED_MEDIA_EXTENSIONS = Object.freeze({
    '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image', '.svg': 'image',
    '.mp4': 'video', '.webm': 'video', '.mov': 'video', '.m4v': 'video', '.pdf': 'pdf'
  });

  function normalizeHeader(value) {
    return String(value || '')
      .trim()
      .toLocaleLowerCase()
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ');
  }

  function normalizedKey(value) {
    return String(value || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase()
      .replace(/\.[a-z0-9]{1,6}$/i, '')
      .replace(/^\s*\d{1,4}\s*[-_. )]+\s*/, '')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .replace(/\s+/g, '-');
  }

  function parseDuration(value) {
    const original = String(value == null ? '' : value).trim();
    if (/^\d+(?:\.\d+)?$/.test(original)) {
      const minutes = Number(original);
      return Number.isFinite(minutes) && minutes > 0 ? Math.round(minutes * 60000) : null;
    }
    const raw = original.replace(',', ':').replace('.', ':');
    if (!raw) return null;
    const parts = raw.split(':').map(Number);
    if (parts.some(part => !Number.isFinite(part) || part < 0)) return null;
    let seconds = 0;
    if (parts.length === 2) seconds = parts[0] * 60 + parts[1];
    else if (parts.length === 3) seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
    else return null;
    return seconds > 0 ? Math.round(seconds * 1000) : null;
  }

  function parseBoolean(value, fallback = false) {
    const raw = normalizeHeader(value);
    if (!raw) return fallback;
    if (['1', 'true', 'yes', 'y', 'on', 'take', 'auto', 'da'].includes(raw)) return true;
    if (['0', 'false', 'no', 'n', 'off', 'none', 'ne'].includes(raw)) return false;
    return fallback;
  }

  function delimiterScore(line, delimiter) {
    let score = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index++) {
      const character = line[index];
      if (character === '"') {
        if (quoted && line[index + 1] === '"') index++;
        else quoted = !quoted;
      } else if (!quoted && character === delimiter) score++;
    }
    return score;
  }

  function detectDelimiter(text) {
    const sample = String(text || '').split(/\r?\n/).find(line => line.trim()) || '';
    return ['\t', ',', ';']
      .map(delimiter => ({ delimiter, score: delimiterScore(sample, delimiter) }))
      .sort((a, b) => b.score - a.score)[0].delimiter;
  }

  function parseDelimitedRows(text, delimiter = detectDelimiter(text)) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    const source = String(text || '').replace(/^\uFEFF/, '');
    for (let index = 0; index < source.length; index++) {
      const character = source[index];
      if (character === '"') {
        if (quoted && source[index + 1] === '"') {
          cell += '"';
          index++;
        } else quoted = !quoted;
      } else if (!quoted && character === delimiter) {
        row.push(cell.trim());
        cell = '';
      } else if (!quoted && (character === '\n' || character === '\r')) {
        if (character === '\r' && source[index + 1] === '\n') index++;
        row.push(cell.trim());
        cell = '';
        if (row.some(value => String(value).trim())) rows.push(row);
        row = [];
      } else {
        cell += character;
      }
    }
    row.push(cell.trim());
    if (row.some(value => String(value).trim())) rows.push(row);
    return rows;
  }

  function headerField(value) {
    const normalized = normalizeHeader(value);
    for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(normalized)) return field;
    }
    return '';
  }

  function headerMap(row) {
    const map = {};
    row.forEach((value, index) => {
      const field = headerField(value);
      if (field && map[field] == null) map[field] = index;
    });
    return map;
  }

  function cell(row, map, field, fallbackIndex = null) {
    const index = map[field] == null ? fallbackIndex : map[field];
    return index == null ? '' : String(row[index] == null ? '' : row[index]).trim();
  }

  function parseSchedule(text) {
    const delimiter = detectDelimiter(text);
    const rows = parseDelimitedRows(text, delimiter);
    if (!rows.length) return { cues: [], errors: [], warnings: ['empty-schedule'], delimiter, hasHeader: false, headers: [] };
    const firstMap = headerMap(rows[0]);
    const hasHeader = firstMap.name != null || firstMap.duration != null || firstMap.speakerName != null || firstMap.assetRef != null;
    const map = hasHeader ? firstMap : {};
    const sourceRows = hasHeader ? rows.slice(1) : rows;
    const cues = [];
    const errors = [];
    sourceRows.forEach((row, index) => {
      const sourceRow = index + (hasHeader ? 2 : 1);
      const legacy = field => hasHeader ? null : field;
      const name = cell(row, map, 'name', legacy(0));
      const durationMs = parseDuration(cell(row, map, 'duration', legacy(1)));
      if (!name && !row.some(value => String(value).trim())) return;
      if (!durationMs) {
        errors.push({ row: sourceRow, code: 'invalid-duration', value: cell(row, map, 'duration', legacy(1)), name });
        return;
      }
      const color = cell(row, map, 'color', legacy(3));
      const cue = {
        name: name || `Cue ${cues.length + 1}`,
        durationMs,
        note: cell(row, map, 'note', legacy(2)),
        color: /^#[0-9a-f]{6}$/i.test(color) ? color : '',
        speakerName: cell(row, map, 'speakerName', legacy(4)),
        speakerTitle: cell(row, map, 'speakerTitle', legacy(5)),
        company: cell(row, map, 'company'),
        sessionTitle: cell(row, map, 'sessionTitle'),
        segmentTitle: cell(row, map, 'segmentTitle'),
        custom1: cell(row, map, 'custom1'),
        assetRef: cell(row, map, 'assetRef'),
        startTime: cell(row, map, 'startTime'),
        room: cell(row, map, 'room'),
        sourceRow
      };
      const hasSpeaker = !!cue.speakerName;
      cue.lowerThirdAuto = parseBoolean(cell(row, map, 'lowerThirdAuto'), hasSpeaker);
      cue.autoTakeContentOnGo = parseBoolean(cell(row, map, 'autoTakeContentOnGo'), !!cue.assetRef);
      cue.lowerThirdHideBeforeNextGo = parseBoolean(cell(row, map, 'lowerThirdHideBeforeNextGo'), hasSpeaker);
      cue.lowerThirdNoRepeat = parseBoolean(cell(row, map, 'lowerThirdNoRepeat'), true);
      cues.push(cue);
    });
    const warnings = [];
    if (!hasHeader) warnings.push('legacy-columns');
    if (errors.length) warnings.push('rows-skipped');
    return { cues, errors, warnings, delimiter, hasHeader, headers: hasHeader ? rows[0].map(normalizeHeader) : [] };
  }

  function mediaKind(filename) {
    const match = String(filename || '').toLocaleLowerCase().match(/\.[a-z0-9]{1,6}$/);
    return match ? SUPPORTED_MEDIA_EXTENSIONS[match[0]] || '' : '';
  }

  function normalizeAssets(assets) {
    return (Array.isArray(assets) ? assets : [])
      .filter(asset => asset && mediaKind(asset.name || asset.relativePath))
      .map((asset, index) => ({
        ...asset,
        id: String(asset.id || `asset-${index + 1}`),
        name: String(asset.name || asset.relativePath || `Asset ${index + 1}`),
        relativePath: String(asset.relativePath || asset.name || ''),
        src: String(asset.src || ''),
        kind: String(asset.kind || mediaKind(asset.name || asset.relativePath)),
        key: normalizedKey(asset.name || asset.relativePath)
      }));
  }

  function matchScheduleAssets(cues, inputAssets) {
    const assets = normalizeAssets(inputAssets);
    const claimed = new Set();
    const matches = [];
    const unmatchedCues = [];
    const rows = (Array.isArray(cues) ? cues : []).map((cue, index) => {
      const explicit = String(cue && cue.assetRef || '').trim();
      const explicitKey = normalizedKey(explicit);
      const cueKeys = [cue && cue.name, cue && cue.sessionTitle, cue && cue.segmentTitle]
        .map(normalizedKey).filter(Boolean);
      let asset = null;
      let method = '';
      if (explicit) {
        const explicitLower = explicit.toLocaleLowerCase();
        // Explicit references may intentionally reuse one holding slide, deck
        // or video in several cues.
        asset = assets.find(item => (
          item.relativePath.toLocaleLowerCase() === explicitLower ||
          item.name.toLocaleLowerCase() === explicitLower ||
          item.key === explicitKey
        ));
        method = asset ? 'explicit' : '';
      }
      if (!asset) {
        asset = assets.find(item => !claimed.has(item.id) && cueKeys.includes(item.key));
        method = asset ? 'exact-title' : '';
      }
      if (asset) {
        claimed.add(asset.id);
        matches.push({ cueIndex: index, cueName: String(cue && cue.name || ''), assetId: asset.id, assetName: asset.name, method });
      } else if (explicit) {
        unmatchedCues.push({ cueIndex: index, cueName: String(cue && cue.name || ''), assetRef: explicit });
      }
      return { ...(cue || {}), matchedAsset: asset, assetMatchMethod: method };
    });
    return {
      cues: rows,
      assets,
      matches,
      unmatchedCues,
      unmatchedAssets: assets.filter(asset => !claimed.has(asset.id))
    };
  }

  function normalizeOutputRole(value) {
    const role = String(value || '').trim().toLocaleLowerCase();
    if (role === 'program' || role === 'speaker') return 'audience';
    return OUTPUT_ROLES.includes(role) ? role : 'audience';
  }

  function outputRoleDefinition(value) {
    return ROLE_DEFINITIONS[normalizeOutputRole(value)];
  }

  function buildGoTransaction(cue, options = {}) {
    const item = cue || {};
    const contentItemExists = typeof options.contentItemExists === 'function'
      ? options.contentItemExists(String(item.contentItemId || ''))
      : !!item.contentItemId;
    return {
      version: 1,
      id: String(options.id || ''),
      cueId: String(item.id || ''),
      cueName: String(item.name || ''),
      createdAt: Number(options.now) || Date.now(),
      timer: { durationMs: Math.max(1000, Number(item.durationMs) || 600000), start: options.autoStart !== false },
      content: { take: !!(item.autoTakeContentOnGo && contentItemExists), itemId: contentItemExists ? String(item.contentItemId || '') : '' },
      lowerThird: {
        take: !!(item.lowerThirdAuto && String(item.speakerName || item.ltName || '').trim()),
        templateId: String(item.lowerThirdTemplateId || ''),
        delayMs: Math.max(0, Number(item.lowerThirdDelayMs) || 0),
        hidePrevious: !!item.lowerThirdHideBeforeNextGo
      }
    };
  }

  function deliverySummary(routes, revision) {
    const expectedRevision = Math.max(0, Number(revision) || 0);
    const enabled = (Array.isArray(routes) ? routes : []).filter(route => route && route.enabled !== false);
    const missing = enabled.filter(route => !route.open);
    const pending = enabled.filter(route => route.open && expectedRevision > 0 && Number(route.ackRevision) < expectedRevision);
    const acknowledged = enabled.filter(route => route.open && (expectedRevision <= 0 || Number(route.ackRevision) >= expectedRevision));
    return {
      expected: enabled.length,
      acknowledged: acknowledged.length,
      missing: missing.map(route => String(route.id || '')),
      pending: pending.map(route => String(route.id || '')),
      ready: enabled.length > 0 && missing.length === 0 && pending.length === 0
    };
  }

  return {
    OUTPUT_ROLES,
    ROLE_DEFINITIONS,
    SUPPORTED_MEDIA_EXTENSIONS,
    normalizeHeader,
    normalizedKey,
    parseDuration,
    parseDelimitedRows,
    parseSchedule,
    mediaKind,
    normalizeAssets,
    matchScheduleAssets,
    normalizeOutputRole,
    outputRoleDefinition,
    buildGoTransaction,
    deliverySummary
  };
});
