'use strict';

const RESOLUTION_PRESETS = Object.freeze({
  '1080p': { width: 1920, height: 1080 },
  '1440p': { width: 2560, height: 1440 },
  '4k': { width: 3840, height: 2160 }
});

const ALLOWED_FPS = Object.freeze([24, 25, 30, 50, 60]);
const ALLOWED_FORMATS = Object.freeze(['auto', 'webm-vp9', 'webm-vp8', 'mp4-h264']);
const ALLOWED_QUALITY = Object.freeze(['standard', 'high', 'master', 'custom']);

function clampInt(value, min, max, fallback) {
  const number = Math.round(Number(value));
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function safeFilePrefix(value) {
  const clean = String(value || 'ShowSlate Recording')
    .normalize('NFKC')
    .replace(/[\x00-\x1f<>:"/\\|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 80);
  return clean || 'ShowSlate Recording';
}

function normalizeSettings(input = {}) {
  const resolution = ['program', '1080p', '1440p', '4k', 'custom'].includes(String(input.resolution))
    ? String(input.resolution)
    : 'program';
  const requestedFps = clampInt(input.fps, 1, 60, 30);
  const fps = ALLOWED_FPS.reduce((closest, candidate) => (
    Math.abs(candidate - requestedFps) < Math.abs(closest - requestedFps) ? candidate : closest
  ), ALLOWED_FPS[0]);
  const format = ALLOWED_FORMATS.includes(String(input.format)) ? String(input.format) : 'auto';
  const quality = ALLOWED_QUALITY.includes(String(input.quality)) ? String(input.quality) : 'high';
  return {
    directory: typeof input.directory === 'string' ? input.directory : '',
    filePrefix: safeFilePrefix(input.filePrefix),
    resolution,
    width: clampInt(input.width, 320, 7680, 1920),
    height: clampInt(input.height, 180, 4320, 1080),
    fps,
    format,
    quality,
    videoBitrateMbps: clampInt(input.videoBitrateMbps, 2, 160, 16),
    includeAudio: input.includeAudio !== false,
    audioBitrateKbps: clampInt(input.audioBitrateKbps, 64, 320, 192)
  };
}

function resolveDimensions(settings, programCanvas = {}) {
  const normalized = normalizeSettings(settings);
  if (RESOLUTION_PRESETS[normalized.resolution]) return { ...RESOLUTION_PRESETS[normalized.resolution] };
  if (normalized.resolution === 'custom') return { width: normalized.width, height: normalized.height };
  return {
    width: clampInt(programCanvas.width, 320, 7680, normalized.width),
    height: clampInt(programCanvas.height, 180, 4320, normalized.height)
  };
}

function computedVideoBitrate(settings, dimensions) {
  const normalized = normalizeSettings(settings);
  if (normalized.quality === 'custom') return normalized.videoBitrateMbps * 1000000;
  const size = dimensions || resolveDimensions(normalized);
  const bitsPerPixel = normalized.quality === 'standard' ? 0.08 : normalized.quality === 'master' ? 0.24 : 0.14;
  const bitsPerSecond = Math.round(size.width * size.height * normalized.fps * bitsPerPixel);
  return Math.max(2000000, Math.min(160000000, bitsPerSecond));
}

function mimeCandidates(format, includeAudio = true) {
  const codecs = includeAudio ? ',opus' : '';
  const table = {
    'webm-vp9': [`video/webm;codecs=vp9${codecs}`, 'video/webm;codecs=vp9', 'video/webm'],
    'webm-vp8': [`video/webm;codecs=vp8${codecs}`, 'video/webm;codecs=vp8', 'video/webm'],
    'mp4-h264': includeAudio
      ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']
      : ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
  };
  if (format === 'auto') return [...table['mp4-h264'], ...table['webm-vp9'], ...table['webm-vp8']];
  return table[format] ? [...table[format]] : [...table['webm-vp9']];
}

function extensionForMime(mimeType) {
  return String(mimeType || '').toLowerCase().startsWith('video/mp4') ? '.mp4' : '.webm';
}

function timestampForFilename(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const pad = number => String(number).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`;
}

function recordingFilename(settings, mimeType, value = new Date()) {
  const normalized = normalizeSettings(settings);
  return `${normalized.filePrefix}_${timestampForFilename(value)}${extensionForMime(mimeType)}`;
}

module.exports = {
  RESOLUTION_PRESETS,
  ALLOWED_FPS,
  ALLOWED_FORMATS,
  ALLOWED_QUALITY,
  normalizeSettings,
  resolveDimensions,
  computedVideoBitrate,
  mimeCandidates,
  extensionForMime,
  safeFilePrefix,
  timestampForFilename,
  recordingFilename
};
