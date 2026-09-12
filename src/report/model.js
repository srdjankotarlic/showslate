(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.PTReport = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  const TERMINAL_STATUSES = new Set(['completed', 'skipped']);

  function finite(value) {
    if (value === null || value === undefined || value === '') return null;
    return Number.isFinite(Number(value)) ? Number(value) : null;
  }

  function nonNegative(value, fallback = 0) {
    const number = finite(value);
    return number === null ? fallback : Math.max(0, number);
  }

  function localAnchor(eventDate, showStart, fallbackDate) {
    const timeMatch = /^(\d{1,2}):(\d{2})$/.exec(String(showStart || '').trim());
    if (!timeMatch) return null;
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(eventDate || '').trim());
    const base = dateMatch
      ? new Date(Number(dateMatch[1]), Number(dateMatch[2]) - 1, Number(dateMatch[3]))
      : new Date(Number.isFinite(fallbackDate) ? fallbackDate : Date.now());
    base.setHours(Number(timeMatch[1]), Number(timeMatch[2]), 0, 0);
    return base.getTime();
  }

  function legacyEntryForCue(entries, cue, index) {
    const list = Array.isArray(entries) ? entries : [];
    const cueId = String(cue && cue.id || '');
    return list.find(entry => entry && cueId && String(entry.cueId || entry.id || '') === cueId)
      || list.find(entry => entry && !String(entry.cueId || entry.id || '') && Number(entry.i) === index)
      || null;
  }

  function reportStatus(cue, actualStart, actualEnd) {
    const requested = String(cue && cue.status || 'pending').toLowerCase();
    if (requested === 'skipped' || requested === 'completed') return requested;
    if (actualEnd !== null) return 'completed';
    if (requested === 'live' || actualStart !== null) return 'live';
    return 'pending';
  }

  function isBreakCue(cue) {
    if (!cue) return false;
    if (cue.isBreak === true) return true;
    const explicit = String(cue.kind || cue.type || cue.category || '').trim().toLowerCase();
    if (['break', 'pause', 'meal'].includes(explicit)) return true;
    return /(^|\b)(break|coffee|lunch|pauza|odmor|ručak|rucak)(\b|$)/iu.test(String(cue.name || ''));
  }

  function buildReport(input = {}) {
    const cues = Array.isArray(input.cues) ? input.cues : [];
    const legacyEntries = Array.isArray(input.legacyActualTimes) ? input.legacyActualTimes : [];
    const now = finite(input.now) ?? Date.now();
    const firstActual = cues.map(cue => finite(cue && cue.actualStart)).find(value => value !== null)
      ?? legacyEntries.map(entry => finite(entry && entry.s)).find(value => value !== null)
      ?? now;
    const show = input.show && typeof input.show === 'object' ? input.show : {};
    const details = show.details && typeof show.details === 'object' ? show.details : {};
    const anchor = localAnchor(details.eventDate, input.showStart, firstActual);
    let plannedCursor = anchor;

    const rows = cues.map((cue, index) => {
      const legacy = legacyEntryForCue(legacyEntries, cue, index);
      const plannedDurationMs = nonNegative(cue && cue.durationMs, nonNegative(legacy && legacy.p));
      const explicitPlanned = finite(cue && cue.plannedStart);
      const plannedStart = explicitPlanned ?? plannedCursor;
      if (plannedStart !== null) plannedCursor = plannedStart + plannedDurationMs;

      const canonicalStart = finite(cue && cue.actualStart);
      const actualStart = canonicalStart ?? finite(legacy && legacy.s);
      // Canonical cues deliberately keep actualEnd null while live. A previous
      // legacy run must not close that interval; legacy e=0 means still open.
      const legacyEnd = finite(legacy && legacy.e);
      const storedActualEnd = finite(cue && cue.actualEnd)
        ?? (canonicalStart === null && legacyEnd > 0 ? legacyEnd : null);
      const status = reportStatus(cue, actualStart, storedActualEnd);
      const actualEnd = storedActualEnd ?? (status === 'live' && actualStart !== null ? now : null);
      const storedDuration = finite(cue && cue.actualDurationMs);
      const actualDurationMs = storedDuration !== null
        ? Math.max(0, storedDuration)
        : (actualStart !== null && actualEnd !== null ? Math.max(0, actualEnd - actualStart) : null);
      const varianceMs = actualDurationMs === null ? null : actualDurationMs - plannedDurationMs;
      return {
        index,
        number: index + 1,
        id: String(cue && cue.id || legacy && (legacy.cueId || legacy.id) || ''),
        name: String(cue && cue.name || legacy && legacy.n || `Cue ${index + 1}`),
        plannedStart,
        actualStart,
        actualEnd,
        plannedDurationMs,
        actualDurationMs,
        varianceMs,
        status,
        notes: String(cue && cue.note || legacy && legacy.note || ''),
        isBreak: isBreakCue(cue),
        overtime: varianceMs !== null && varianceMs > 0
      };
    });

    const totalPlannedMs = rows.reduce((sum, row) => sum + row.plannedDurationMs, 0);
    const totalActualMs = rows.reduce((sum, row) => sum + (row.actualDurationMs ?? 0), 0);
    const overtimeRows = rows.filter(row => row.overtime);
    const allTerminal = rows.length > 0 && rows.every(row => TERMINAL_STATUSES.has(row.status));
    const actualEnds = rows.map(row => row.actualEnd).filter(value => value !== null);
    const plannedEnds = rows.map(row => row.plannedStart === null ? null : row.plannedStart + row.plannedDurationMs).filter(value => value !== null);
    const actualEndAt = actualEnds.length ? Math.max(...actualEnds) : null;
    const plannedEndAt = plannedEnds.length ? Math.max(...plannedEnds) : null;
    const finalDelayMs = allTerminal && actualEndAt !== null && plannedEndAt !== null ? actualEndAt - plannedEndAt : null;

    return {
      schemaVersion: 1,
      generatedAt: now,
      show: {
        id: String(show.id || ''),
        name: String(show.name || 'Untitled show'),
        details: {
          client: String(details.client || ''),
          venue: String(details.venue || ''),
          eventDate: String(details.eventDate || '')
        }
      },
      rows,
      summary: {
        totalPlannedMs,
        totalActualMs,
        finalDelayMs,
        overtimeSegments: overtimeRows.length,
        longestOvertimeMs: overtimeRows.length ? Math.max(...overtimeRows.map(row => row.varianceMs)) : 0,
        breaks: rows.filter(row => row.isBreak).length,
        skippedCues: rows.filter(row => row.status === 'skipped').length,
        completedCues: rows.filter(row => row.status === 'completed').length,
        timedCues: rows.filter(row => row.actualDurationMs !== null).length,
        allTerminal,
        plannedEndAt,
        actualEndAt
      }
    };
  }

  function formatDuration(ms, options = {}) {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '';
    const number = Number(ms);
    const seconds = Math.round(Math.abs(number) / 1000);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const rest = seconds % 60;
    const body = hours > 0
      ? `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
      : `${minutes}:${String(rest).padStart(2, '0')}`;
    if (number < 0) return '-' + body;
    return options.signed && number > 0 ? '+' + body : body;
  }

  function formatTimestamp(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) return '';
    return new Date(Number(ms)).toISOString();
  }

  function csvEscape(value, protectFormula = false) {
    let text = String(value ?? '');
    if (protectFormula && /^[=+\-@]/.test(text)) text = "'" + text;
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  function toCsv(report) {
    const rows = Array.isArray(report && report.rows) ? report.rows : [];
    const summary = report && report.summary || {};
    const lines = [[
      'cue_number', 'cue_id', 'name', 'planned_start', 'actual_start',
      'planned_duration', 'actual_duration', 'variance', 'status', 'notes'
    ].join(',')];
    rows.forEach(row => {
      lines.push([
        row.number,
        csvEscape(row.id, true),
        csvEscape(row.name, true),
        formatTimestamp(row.plannedStart),
        formatTimestamp(row.actualStart),
        formatDuration(row.plannedDurationMs),
        formatDuration(row.actualDurationMs),
        formatDuration(row.varianceMs, { signed: true }),
        csvEscape(row.status),
        csvEscape(row.notes, true)
      ].join(','));
    });
    lines.push('');
    lines.push('summary_metric,value');
    [
      ['show_name', report && report.show && report.show.name || ''],
      ['generated_at', formatTimestamp(report && report.generatedAt)],
      ['total_planned', formatDuration(summary.totalPlannedMs)],
      ['total_actual', formatDuration(summary.totalActualMs)],
      ['final_delay', formatDuration(summary.finalDelayMs, { signed: true })],
      ['overtime_segments', summary.overtimeSegments ?? 0],
      ['longest_overtime', formatDuration(summary.longestOvertimeMs, { signed: true })],
      ['breaks', summary.breaks ?? 0],
      ['skipped_cues', summary.skippedCues ?? 0]
    ].forEach(([label, value]) => lines.push(csvEscape(label) + ',' + csvEscape(value, label === 'show_name')));
    return '\ufeff' + lines.join('\r\n') + '\r\n';
  }

  return { buildReport, formatDuration, formatTimestamp, csvEscape, toCsv, isBreakCue };
});
