(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateCompositor = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const SCHEMA_VERSION = 1;
  const LAYER_TYPES = new Set(['color', 'image', 'video', 'pdf', 'text', 'timer', 'lowerThird', 'window', 'capture', 'audio']);
  const LIVE_INPUT_TYPES = new Set(['window', 'device', 'audio']);
  const CAPTURE_MODES = new Set(['low-latency', 'compatible']);
  const SOURCE_QUALITY_PROFILES = new Set(['auto', 'quality', 'realtime']);
  const AUDIO_MONITORING_MODES = new Set(['off', 'monitor-only', 'monitor-and-output']);
  const MEDIA_PLAYBACK_STATES = new Set(['playing', 'paused', 'stopped']);
  const MEDIA_END_BEHAVIORS = new Set(['stop', 'hold', 'loop']);
  const FITS = new Set(['cover', 'contain', 'fill']);
  const BLEND_MODES = new Set(['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'difference']);
  const TRANSFORM_ORIGINS = new Set(['top-left', 'top-center', 'top-right', 'center-left', 'center', 'center-right', 'bottom-left', 'bottom-center', 'bottom-right']);
  const FONT_FAMILIES = new Set(['system', 'mono', 'serif', 'display']);
  const TEXT_ALIGNS = new Set(['left', 'center', 'right']);
  const VERTICAL_ALIGNS = new Set(['top', 'center', 'bottom']);
  const COLOR_FILL_TYPES = new Set(['solid', 'linear', 'radial']);
  const IMAGE_SAMPLING_MODES = new Set(['smooth', 'pixelated']);
  const TEXT_TRANSFORMS = new Set(['none', 'uppercase', 'lowercase']);
  const WARP_CORNERS = Object.freeze(['topLeft', 'topRight', 'bottomRight', 'bottomLeft']);
  const WARP_MODES = new Set(['perspective', 'mesh']);
  const TEST_PATTERNS = new Set(['grid', 'checker', 'crosshair']);
  const CANVAS_PRESETS = Object.freeze([
    { id: '1080p', label: 'HD 1080p', width: 1920, height: 1080 },
    { id: '720p', label: 'HD 720p', width: 1280, height: 720 },
    { id: 'ultrawide', label: 'Ultrawide 2560', width: 2560, height: 1080 },
    { id: 'dual-1080p', label: 'Dual wide 3840', width: 3840, height: 1080 },
    { id: 'led-wide', label: 'LED wide 3840 x 960', width: 3840, height: 960 },
    { id: 'vertical', label: 'Vertical 1080', width: 1080, height: 1920 },
    { id: 'square', label: 'Square 1080', width: 1080, height: 1080 },
    { id: 'uhd', label: 'UHD 4K', width: 3840, height: 2160 },
    { id: 'dci-4k', label: 'DCI 4K', width: 4096, height: 2160 }
  ]);

  function finite(value, fallback, min, max) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  }

  function integer(value, fallback, min, max) {
    return Math.round(finite(value, fallback, min, max));
  }

  function frameRate(value, fallback = 30) {
    return Math.round(finite(value, fallback, 1, 60) * 1000) / 1000;
  }

  function id(value, fallback) {
    const clean = String(value || '').replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 160);
    return clean || fallback;
  }

  function cleanName(value, fallback) {
    const clean = String(value || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 160);
    return clean || fallback;
  }

  function cleanColor(value, fallback = '#000000') {
    const color = String(value || '').trim();
    return /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|hsla?\([\d\s.,%deg]+\)|transparent)$/i.test(color)
      ? color : fallback;
  }

  function normalizeCrop(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      top: finite(source.top, 0, 0, 49),
      right: finite(source.right, 0, 0, 49),
      bottom: finite(source.bottom, 0, 0, 49),
      left: finite(source.left, 0, 0, 49)
    };
  }

  function normalizeMediaTransport(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const inPoint = finite(source.inPoint, 0, 0, 31536000);
    const requestedOut = finite(source.outPoint, 0, 0, 31536000);
    const outPoint = requestedOut > inPoint + 0.01 ? requestedOut : 0;
    const endBehavior = MEDIA_END_BEHAVIORS.has(source.endBehavior)
      ? source.endBehavior
      : (source.loop === false ? 'hold' : 'loop');
    return {
      playbackState: MEDIA_PLAYBACK_STATES.has(source.playbackState) ? source.playbackState : 'playing',
      playbackPosition: finite(source.playbackPosition, inPoint, 0, 31536000),
      playbackUpdatedAt: finite(source.playbackUpdatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      playbackRate: finite(source.playbackRate, 1, 0.25, 4),
      inPoint,
      outPoint,
      endBehavior,
      restartOnTake: source.restartOnTake !== false
    };
  }

  function mediaPlaybackBounds(raw = {}, duration = 0) {
    const transport = normalizeMediaTransport(raw);
    const mediaDuration = Number(duration);
    const hasDuration = Number.isFinite(mediaDuration) && mediaDuration > 0;
    const start = hasDuration ? Math.min(transport.inPoint, Math.max(0, mediaDuration - 0.01)) : transport.inPoint;
    let end = transport.outPoint > start + 0.01 ? transport.outPoint : (hasDuration ? mediaDuration : 0);
    if (hasDuration) end = Math.min(end, mediaDuration);
    if (end > 0 && end <= start + 0.01) end = hasDuration ? mediaDuration : 0;
    return { start, end, duration: hasDuration ? mediaDuration : 0 };
  }

  function resolveMediaPlayback(raw = {}, now = Date.now(), duration = 0) {
    const transport = normalizeMediaTransport(raw);
    const bounds = mediaPlaybackBounds(transport, duration);
    let state = transport.playbackState;
    let position = Math.max(bounds.start, transport.playbackPosition);
    if (state === 'playing' && transport.playbackUpdatedAt > 0) {
      position += Math.max(0, Number(now) - transport.playbackUpdatedAt) / 1000 * transport.playbackRate;
    }
    if (bounds.end > bounds.start && position >= bounds.end) {
      if (transport.endBehavior === 'loop') {
        position = bounds.start + ((position - bounds.start) % (bounds.end - bounds.start));
      } else if (transport.endBehavior === 'hold') {
        position = Math.max(bounds.start, bounds.end - 0.04);
        state = 'paused';
      } else {
        position = bounds.start;
        state = 'stopped';
      }
    }
    if (bounds.end > bounds.start) position = Math.min(position, Math.max(bounds.start, bounds.end - 0.001));
    return { ...transport, ...bounds, state, position };
  }

  function mediaTransportCommand(raw = {}, action, options = {}) {
    const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
    const resolved = resolveMediaPlayback(raw, now, options.duration);
    const requestedPosition = Number(options.position);
    let position = Number.isFinite(requestedPosition) ? requestedPosition : resolved.position;
    if (resolved.end > resolved.start) position = Math.min(Math.max(resolved.start, position), Math.max(resolved.start, resolved.end - 0.001));
    else position = Math.max(resolved.start, position);
    let playbackState = resolved.state;
    if (action === 'play') {
      playbackState = 'playing';
      if (resolved.end > resolved.start && position >= resolved.end - 0.05) position = resolved.start;
    } else if (action === 'pause') {
      playbackState = 'paused';
    } else if (action === 'stop') {
      playbackState = 'stopped';
      position = resolved.start;
    } else if (action === 'restart') {
      playbackState = 'playing';
      position = resolved.start;
    } else if (action === 'seek') {
      playbackState = normalizeMediaTransport(raw).playbackState;
    }
    return { playbackState, playbackPosition: position, playbackUpdatedAt: now };
  }

  function normalizeCanvas(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const width = integer(source.width, 1920, 320, 8192);
    const height = integer(source.height, 1080, 180, 8192);
    return {
      schemaVersion: SCHEMA_VERSION,
      width,
      height,
      fps: frameRate(source.fps, 30),
      background: cleanColor(source.background, '#000000'),
      transparent: source.transparent === true
    };
  }

  function canvasPreset(canvas) {
    const clean = normalizeCanvas(canvas);
    const preset = CANVAS_PRESETS.find(row => row.width === clean.width && row.height === clean.height);
    return preset ? preset.id : 'custom';
  }

  function canvasAspect(canvas) {
    const clean = normalizeCanvas(canvas);
    return `${clean.width} / ${clean.height}`;
  }

  function normalizeWarpPoint(raw, fallback) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      x: finite(source.x, fallback.x, -25, 125),
      y: finite(source.y, fallback.y, -25, 125)
    };
  }

  function defaultMeshPoints(columns, rows, corners) {
    const points = [];
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      for (let column = 0; column <= columns; column++) {
        const u = column / columns;
        const topX = corners.topLeft.x + (corners.topRight.x - corners.topLeft.x) * u;
        const topY = corners.topLeft.y + (corners.topRight.y - corners.topLeft.y) * u;
        const bottomX = corners.bottomLeft.x + (corners.bottomRight.x - corners.bottomLeft.x) * u;
        const bottomY = corners.bottomLeft.y + (corners.bottomRight.y - corners.bottomLeft.y) * u;
        points.push({ x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v });
      }
    }
    return points;
  }

  function normalizeWarpMesh(raw = {}, corners) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const columns = integer(source.columns, 1, 1, 4);
    const rows = integer(source.rows, 1, 1, 4);
    const defaults = defaultMeshPoints(columns, rows, corners);
    const supplied = Array.isArray(source.points) ? source.points : [];
    const points = defaults.map((fallback, index) => normalizeWarpPoint(supplied[index], fallback));

    // Keep every point inside its own half-cell neighborhood. This still gives
    // the operator useful curved/linear correction while preventing inverted
    // mesh cells that would create undefined pixels during a live show.
    points.forEach((point, index) => {
      const column = index % (columns + 1);
      const row = Math.floor(index / (columns + 1));
      const halfX = 45 / columns;
      const halfY = 45 / rows;
      const centerX = column / columns * 100;
      const centerY = row / rows * 100;
      point.x = finite(point.x, defaults[index].x, centerX - halfX, centerX + halfX);
      point.y = finite(point.y, defaults[index].y, centerY - halfY, centerY + halfY);
    });
    return { columns, rows, points };
  }

  function normalizeProjectorWarp(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const corners = source.corners && typeof source.corners === 'object' ? source.corners : {};
    const defaults = {
      topLeft: { x: 0, y: 0 },
      topRight: { x: 100, y: 0 },
      bottomRight: { x: 100, y: 100 },
      bottomLeft: { x: 0, y: 100 }
    };
    const clean = {};
    WARP_CORNERS.forEach(name => { clean[name] = normalizeWarpPoint(corners[name], defaults[name]); });

    // Keep the four points in a predictable clockwise order. This prevents a
    // crossed surface from turning the live renderer inside out while still
    // allowing generous keystone and overscan adjustment.
    const gap = 1;
    const leftLimit = Math.min(clean.topRight.x, clean.bottomRight.x) - gap;
    clean.topLeft.x = Math.min(clean.topLeft.x, leftLimit);
    clean.bottomLeft.x = Math.min(clean.bottomLeft.x, leftLimit);
    const rightLimit = Math.max(clean.topLeft.x, clean.bottomLeft.x) + gap;
    clean.topRight.x = Math.max(clean.topRight.x, rightLimit);
    clean.bottomRight.x = Math.max(clean.bottomRight.x, rightLimit);
    const topLimit = Math.min(clean.bottomLeft.y, clean.bottomRight.y) - gap;
    clean.topLeft.y = Math.min(clean.topLeft.y, topLimit);
    clean.topRight.y = Math.min(clean.topRight.y, topLimit);
    const bottomLimit = Math.max(clean.topLeft.y, clean.topRight.y) + gap;
    clean.bottomLeft.y = Math.max(clean.bottomLeft.y, bottomLimit);
    clean.bottomRight.y = Math.max(clean.bottomRight.y, bottomLimit);
    WARP_CORNERS.forEach(name => {
      clean[name].x = finite(clean[name].x, defaults[name].x, -25, 125);
      clean[name].y = finite(clean[name].y, defaults[name].y, -25, 125);
    });

    const grid = source.grid && typeof source.grid === 'object' ? source.grid : {};
    const mode = WARP_MODES.has(source.mode) ? source.mode : 'perspective';
    return {
      enabled: source.enabled === true,
      mode,
      corners: clean,
      mesh: normalizeWarpMesh(source.mesh, clean),
      grid: {
        visible: grid.visible === true,
        columns: integer(grid.columns, 8, 2, 32),
        rows: integer(grid.rows, 6, 2, 32),
        opacity: finite(grid.opacity, 0.72, 0.1, 1),
        pattern: TEST_PATTERNS.has(grid.pattern) ? grid.pattern : 'grid',
        labels: grid.labels !== false
      }
    };
  }

  function projectorWarpIsValid(raw = {}) {
    const warp = normalizeProjectorWarp(raw);
    const points = WARP_CORNERS.map(name => warp.corners[name]);
    const crosses = points.map((point, index) => {
      const next = points[(index + 1) % points.length];
      const after = points[(index + 2) % points.length];
      return (next.x - point.x) * (after.y - next.y) - (next.y - point.y) * (after.x - next.x);
    });
    const area = Math.abs(points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point.x * next.y - next.x * point.y;
    }, 0) / 2);
    const clockwise = crosses.every(value => value > 0.01);
    const counterClockwise = crosses.every(value => value < -0.01);
    if (!(area >= 100 && (clockwise || counterClockwise))) return false;
    if (warp.mode !== 'mesh') return true;
    const { columns, rows, points: meshPoints } = warp.mesh;
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const stride = columns + 1;
        const cell = [meshPoints[row * stride + column], meshPoints[row * stride + column + 1], meshPoints[(row + 1) * stride + column + 1], meshPoints[(row + 1) * stride + column]];
        const cellArea = Math.abs(cell.reduce((sum, point, index) => {
          const next = cell[(index + 1) % cell.length];
          return sum + point.x * next.y - next.x * point.y;
        }, 0) / 2);
        if (cellArea < 0.1) return false;
      }
    }
    return true;
  }

  function normalizeMappingInput(raw = {}, canvas = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const cleanCanvas = normalizeCanvas(canvas);
    const x = integer(source.x, 0, 0, Math.max(0, cleanCanvas.width - 1));
    const y = integer(source.y, 0, 0, Math.max(0, cleanCanvas.height - 1));
    return {
      x,
      y,
      width: integer(source.width, cleanCanvas.width - x, 1, Math.max(1, cleanCanvas.width - x)),
      height: integer(source.height, cleanCanvas.height - y, 1, Math.max(1, cleanCanvas.height - y)),
      flipX: source.flipX === true,
      flipY: source.flipY === true
    };
  }

  function normalizeMappingOutput(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      x: finite(source.x, 0, -25, 125),
      y: finite(source.y, 0, -25, 125),
      width: finite(source.width, 100, 1, 150),
      height: finite(source.height, 100, 1, 150),
      rotation: finite(source.rotation, 0, -180, 180)
    };
  }

  function normalizeMappingMask(raw = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const fallback = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
    const points = (Array.isArray(source.points) && source.points.length >= 3 ? source.points : fallback)
      .slice(0, 16).map((point, index) => ({
        x: finite(point && point.x, fallback[index % fallback.length].x, -25, 125),
        y: finite(point && point.y, fallback[index % fallback.length].y, -25, 125)
      }));
    return { enabled: source.enabled === true, points, feather: finite(source.feather, 0, 0, 25) };
  }

  function normalizeProjectorMapping(raw = {}, index = 0, rawCanvas = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const canvas = normalizeCanvas(rawCanvas);
    const input = normalizeMappingInput(source.input || source, canvas);
    const output = normalizeMappingOutput(source.output);
    const blend = source.blend && typeof source.blend === 'object' ? source.blend : {};
    const outputIds = [...new Set([
      ...(Array.isArray(source.outputIds) ? source.outputIds : []),
      source.outputId
    ].map(value => id(value, '')).filter(Boolean))];
    return {
      schemaVersion: SCHEMA_VERSION,
      mappingVersion: 2,
      id: id(source.id, `mapping-${index + 1}`),
      name: cleanName(source.name, `Projector ${index + 1}`),
      enabled: source.enabled !== false,
      solo: source.solo === true,
      outputId: outputIds[0] || '',
      outputIds,
      input,
      output,
      // Legacy aliases remain in saved shows and API payloads during the beta.
      x: input.x,
      y: input.y,
      width: input.width,
      height: input.height,
      opacity: finite(source.opacity, 1, 0, 1),
      mask: normalizeMappingMask(source.mask),
      blend: {
        left: integer(blend.left, 0, 0, Math.min(2048, Math.floor(input.width / 2))),
        right: integer(blend.right, 0, 0, Math.min(2048, Math.floor(input.width / 2))),
        top: integer(blend.top, 0, 0, Math.min(2048, Math.floor(input.height / 2))),
        bottom: integer(blend.bottom, 0, 0, Math.min(2048, Math.floor(input.height / 2))),
        gamma: finite(blend.gamma, 1, 0.1, 3),
        blackLevel: finite(blend.blackLevel, 0, 0, 1)
      },
      warp: normalizeProjectorWarp(source.warp)
    };
  }

  function normalizeComposition(raw = {}, index = 0, fallbackCanvas = {}) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const canvas = normalizeCanvas(source.canvas || fallbackCanvas);
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `composition-${index + 1}`),
      name: cleanName(source.name, index === 0 ? 'Main Composition' : `Composition ${index + 1}`),
      canvas,
      mappings: (Array.isArray(source.mappings) ? source.mappings : []).map((mapping, mappingIndex) => normalizeProjectorMapping(mapping, mappingIndex, canvas))
    };
  }

  function normalizeCompositions(raw, fallbackCanvas = {}) {
    const rows = Array.isArray(raw) && raw.length ? raw : [{ id: 'composition-main', name: 'Main Composition', canvas: fallbackCanvas }];
    const seen = new Set();
    return rows.map((row, index) => normalizeComposition(row, index, fallbackCanvas)).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  function captureQuality(rawStatus = {}, rawCanvas = {}, fit = 'contain') {
    const canvas = normalizeCanvas(rawCanvas);
    const sourceWidth = Math.max(0, Math.round(Number(rawStatus.width) || 0));
    const sourceHeight = Math.max(0, Math.round(Number(rawStatus.height) || 0));
    if (!sourceWidth || !sourceHeight) {
      return {
        ready: false,
        sourceWidth,
        sourceHeight,
        canvasWidth: canvas.width,
        canvasHeight: canvas.height,
        scale: 1,
        needsUpscale: false,
        aspectMismatch: false,
        crops: false
      };
    }
    const sourceAspect = sourceWidth / sourceHeight;
    const canvasRatio = canvas.width / canvas.height;
    const containScale = Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const coverScale = Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const mode = FITS.has(fit) ? fit : 'contain';
    const scale = mode === 'contain' ? containScale : coverScale;
    const aspectMismatch = Math.abs(sourceAspect - canvasRatio) / canvasRatio > 0.01;
    return {
      ready: true,
      sourceWidth,
      sourceHeight,
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      scale,
      needsUpscale: scale > 1.01,
      aspectMismatch,
      crops: mode === 'cover' && aspectMismatch
    };
  }

  function sourceQualityTier(width, height) {
    const w = Math.max(0, Number(width) || 0);
    const h = Math.max(0, Number(height) || 0);
    if (w >= 7680 || h >= 4320) return '8K';
    if (w >= 3840 || h >= 2160) return 'UHD';
    if (w >= 2560 || h >= 1440) return 'QHD';
    if (w >= 1920 || h >= 1080) return 'FHD';
    if (w >= 1280 || h >= 720) return 'HD';
    return w && h ? 'SD' : '';
  }

  function liveTransportProfile(rawDefinition = {}, rawSettings = {}, requestedProfile = 'program') {
    const definition = normalizeLiveInput(rawDefinition);
    const settings = rawSettings && typeof rawSettings === 'object' ? rawSettings : {};
    const width = integer(settings.width, definition.width, 160, 8192);
    const height = integer(settings.height, definition.height, 120, 8192);
    const fps = frameRate(settings.frameRate, definition.fps);
    const consumer = requestedProfile === 'operator' ? 'operator' : 'program';
    const qualityProfile = SOURCE_QUALITY_PROFILES.has(definition.qualityProfile) ? definition.qualityProfile : 'auto';
    const realtimeSource = definition.type === 'device';
    let scaleResolutionDownBy = 1;
    let maxFramerate = fps;
    let bitrateFactor = qualityProfile === 'quality' ? 0.28 : qualityProfile === 'realtime' ? 0.12 : 0.18;
    let minimumBitrate = 12000000;
    let maximumBitrate = qualityProfile === 'quality' ? 120000000 : qualityProfile === 'realtime' ? 60000000 : 80000000;

    if (consumer === 'operator') {
      scaleResolutionDownBy = Math.max(1, width / 1280, height / 720);
      maxFramerate = qualityProfile === 'realtime' ? fps : Math.min(fps, 30);
      bitrateFactor = qualityProfile === 'realtime' ? 0.24 : 0.21;
      minimumBitrate = 3500000;
      maximumBitrate = qualityProfile === 'realtime' ? 14000000 : 12000000;
    }

    const targetWidth = Math.max(1, Math.round(width / scaleResolutionDownBy));
    const targetHeight = Math.max(1, Math.round(height / scaleResolutionDownBy));
    const pixelsPerSecond = targetWidth * targetHeight * maxFramerate;
    const maxBitrate = Math.max(minimumBitrate, Math.min(maximumBitrate, Math.round(pixelsPerSecond * bitrateFactor)));
    const degradationPreference = qualityProfile === 'realtime' || (consumer === 'program' && qualityProfile === 'auto' && realtimeSource)
      ? 'maintain-framerate'
      : 'maintain-resolution';

    return {
      consumer,
      qualityProfile,
      sourceWidth: width,
      sourceHeight: height,
      sourceFrameRate: fps,
      sourceTier: sourceQualityTier(width, height),
      targetWidth,
      targetHeight,
      targetFrameRate: maxFramerate,
      scaleResolutionDownBy,
      maxBitrate,
      degradationPreference
    };
  }

  function normalizeLiveInput(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = LIVE_INPUT_TYPES.has(source.type) ? source.type : 'device';
    const fallbackName = type === 'window' ? `Window ${index + 1}` : type === 'audio' ? `Audio input ${index + 1}` : `Video input ${index + 1}`;
    return {
      schemaVersion: SCHEMA_VERSION,
      id: id(source.id, `input-${index + 1}`),
      type,
      name: cleanName(source.name, fallbackName),
      desktopSourceId: type === 'window' ? String(source.desktopSourceId || '').slice(0, 512) : '',
      desktopSourceName: type === 'window' ? cleanName(source.desktopSourceName, '') : '',
      videoDeviceId: type === 'device' ? String(source.videoDeviceId || '').slice(0, 1024) : '',
      videoDeviceLabel: type === 'device' ? cleanName(source.videoDeviceLabel, '') : '',
      audioDeviceId: type === 'device' || type === 'audio' ? String(source.audioDeviceId || '').slice(0, 1024) : '',
      audioDeviceLabel: type === 'device' || type === 'audio' ? cleanName(source.audioDeviceLabel, '') : '',
      withAudio: type === 'window'
        ? source.withAudio === true
        : (type === 'device' || type === 'audio') && source.withAudio !== false && !!String(source.audioDeviceId || ''),
      width: integer(source.width, 1920, 160, 7680),
      height: integer(source.height, 1080, 120, 4320),
      fps: frameRate(source.fps, 30),
      captureMode: type === 'device' && CAPTURE_MODES.has(source.captureMode) ? source.captureMode : 'low-latency',
      qualityProfile: SOURCE_QUALITY_PROFILES.has(source.qualityProfile) ? source.qualityProfile : 'auto',
      autoReconnect: source.autoReconnect !== false,
      active: source.active !== false
    };
  }

  function normalizeLiveInputs(raw) {
    const rows = Array.isArray(raw) ? raw : [];
    const seen = new Set();
    return rows.map(normalizeLiveInput).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
  }

  function layerType(raw) {
    const requested = String(raw && raw.type || '').toLowerCase();
    if (requested === 'device' || requested === 'camera' || requested === 'capture-card') return 'capture';
    if (requested === 'window-capture' || requested === 'screen') return 'window';
    if (requested === 'lowerthird' || requested === 'lower-third') return 'lowerThird';
    return LAYER_TYPES.has(requested) ? requested : 'image';
  }

  function normalizeLayer(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const type = layerType(source);
    const isLive = type === 'window' || type === 'capture' || type === 'audio';
    const isColor = type === 'color';
    const layer = {
      ...source,
      id: id(source.id, `layer-${index + 1}`),
      type,
      name: cleanName(source.name || source.sourceName, type === 'capture' ? 'Video input' : type === 'audio' ? 'Audio input' : type === 'window' ? 'Window capture' : type[0].toUpperCase() + type.slice(1)),
      visible: source.visible !== false,
      locked: source.locked === true,
      livePersistent: source.livePersistent === true,
      liveSlot: cleanName(source.liveSlot, '').slice(0, 80),
      x: finite(source.x, 0, -100, 200),
      y: finite(source.y, 0, -100, 200),
      w: finite(source.w, 100, 1, 300),
      h: finite(source.h, 100, 1, 300),
      rotation: finite(source.rotation, 0, -360, 360),
      opacity: finite(source.opacity, 1, 0, 1),
      fit: FITS.has(source.fit) ? source.fit : (type === 'pdf' || type === 'window' ? 'contain' : 'cover'),
      lockAspect: source.lockAspect === true,
      flipX: source.flipX === true,
      flipY: source.flipY === true,
      transformOrigin: TRANSFORM_ORIGINS.has(source.transformOrigin) ? source.transformOrigin : 'center',
      crop: normalizeCrop(source.crop),
      objectPositionX: finite(source.objectPositionX, 50, 0, 100),
      objectPositionY: finite(source.objectPositionY, 50, 0, 100),
      blendMode: BLEND_MODES.has(source.blendMode) ? source.blendMode : 'normal',
      cornerRadius: finite(source.cornerRadius, 0, 0, 50),
      brightness: finite(source.brightness, 1, 0, 2),
      contrast: finite(source.contrast, 1, 0, 2),
      saturation: finite(source.saturation, 1, 0, 3),
      hue: finite(source.hue, 0, -180, 180),
      blur: finite(source.blur, 0, 0, 40)
    };
    if (isColor) {
      layer.color = cleanColor(source.color || source.bg, '#20242c');
      layer.fillType = COLOR_FILL_TYPES.has(source.fillType) ? source.fillType : 'solid';
      layer.color2 = cleanColor(source.color2, '#4f6f8f');
      layer.gradientAngle = finite(source.gradientAngle, 90, -360, 360);
      layer.gradientCenterX = finite(source.gradientCenterX, 50, 0, 100);
      layer.gradientCenterY = finite(source.gradientCenterY, 50, 0, 100);
      layer.bg = layer.color;
    }
    if (isLive) {
      layer.inputId = id(source.inputId || source.sourceId, '');
      layer.audioEnabled = source.audioEnabled !== false;
      layer.volume = finite(source.volume, 1, 0, 1);
      layer.audioMonitoring = AUDIO_MONITORING_MODES.has(source.audioMonitoring) ? source.audioMonitoring : 'off';
    }
    if (type === 'video') {
      const transport = normalizeMediaTransport(source);
      Object.assign(layer, transport);
      layer.sourceWidth = integer(source.sourceWidth, 0, 0, 16384);
      layer.sourceHeight = integer(source.sourceHeight, 0, 0, 16384);
      layer.sourceDuration = finite(source.sourceDuration, 0, 0, 31536000);
      layer.loop = transport.endBehavior === 'loop';
      layer.videoAudioConfigured = source.videoAudioConfigured === true;
      layer.audioEnabled = layer.videoAudioConfigured ? source.audioEnabled !== false : true;
      layer.muted = layer.videoAudioConfigured ? source.muted === true : false;
      layer.volume = finite(source.volume, 1, 0, 1);
      layer.audioMonitoring = AUDIO_MONITORING_MODES.has(source.audioMonitoring) ? source.audioMonitoring : 'off';
    }
    if (type === 'pdf') {
      layer.page = integer(source.page, 1, 1, 999);
    }
    if (type === 'image') {
      layer.sourceWidth = integer(source.sourceWidth, 0, 0, 16384);
      layer.sourceHeight = integer(source.sourceHeight, 0, 0, 16384);
      layer.imageSampling = IMAGE_SAMPLING_MODES.has(source.imageSampling) ? source.imageSampling : 'smooth';
    }
    if (type === 'text') {
      layer.text = String(source.text ?? source.name ?? '').slice(0, 4000);
      layer.color = cleanColor(source.color, '#ffffff');
      layer.bg = cleanColor(source.bg, 'transparent');
      layer.fontSize = finite(source.fontSize, 8, 1, 100);
      layer.fontFamily = FONT_FAMILIES.has(source.fontFamily) ? source.fontFamily : 'system';
      layer.fontWeight = integer(source.fontWeight, 700, 100, 900);
      layer.textAlign = TEXT_ALIGNS.has(source.textAlign) ? source.textAlign : 'center';
      layer.verticalAlign = VERTICAL_ALIGNS.has(source.verticalAlign) ? source.verticalAlign : 'center';
      layer.italic = source.italic === true;
      layer.underline = source.underline === true;
      layer.lineHeight = finite(source.lineHeight, 1.05, 0.7, 3);
      layer.letterSpacing = finite(source.letterSpacing, 0, 0, 1);
      layer.textTransform = TEXT_TRANSFORMS.has(source.textTransform) ? source.textTransform : 'none';
      layer.textPadding = finite(source.textPadding, 1.5, 0, 20);
      layer.strokeWidth = finite(source.strokeWidth, 0, 0, 10);
      layer.strokeColor = cleanColor(source.strokeColor, '#000000');
      layer.shadowEnabled = source.shadowEnabled === true;
      layer.shadowColor = cleanColor(source.shadowColor, '#000000');
      layer.shadowBlur = finite(source.shadowBlur, 8, 0, 40);
      layer.shadowX = finite(source.shadowX, 0, -40, 40);
      layer.shadowY = finite(source.shadowY, 2, -40, 40);
    }
    if (type === 'lowerThird') {
      const cleanText = (value, limit = 240) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, limit);
      layer.templateId = cleanText(source.templateId, 200);
      layer.dataMode = source.dataMode === 'liveCue' ? 'liveCue' : 'custom';
      layer.speakerName = cleanText(source.speakerName);
      layer.speakerTitle = cleanText(source.speakerTitle);
      layer.speakerMeta = cleanText(source.speakerMeta);
      layer.durationSec = finite(source.durationSec, 8, 0, 600);
    }
    return layer;
  }

  const ORIGIN_CSS = Object.freeze({
    'top-left': '0% 0%', 'top-center': '50% 0%', 'top-right': '100% 0%',
    'center-left': '0% 50%', center: '50% 50%', 'center-right': '100% 50%',
    'bottom-left': '0% 100%', 'bottom-center': '50% 100%', 'bottom-right': '100% 100%'
  });

  function layerVisualStyle(raw = {}) {
    const layer = normalizeLayer(raw);
    const crop = layer.crop;
    return {
      transform: `rotate(${layer.rotation}deg) scale(${layer.flipX ? -1 : 1}, ${layer.flipY ? -1 : 1})`,
      transformOrigin: ORIGIN_CSS[layer.transformOrigin] || ORIGIN_CSS.center,
      filter: `brightness(${layer.brightness}) contrast(${layer.contrast}) saturate(${layer.saturation}) hue-rotate(${layer.hue}deg) blur(${layer.blur}px)`,
      mixBlendMode: layer.blendMode,
      clipPath: `inset(${crop.top}% ${crop.right}% ${crop.bottom}% ${crop.left}%)`,
      borderRadius: `${layer.cornerRadius}%`,
      objectPosition: `${layer.objectPositionX}% ${layer.objectPositionY}%`
    };
  }

  function layerFillStyle(raw = {}) {
    const layer = normalizeLayer({ ...raw, type: 'color' });
    if (layer.fillType === 'linear') {
      return `linear-gradient(${layer.gradientAngle}deg, ${layer.color} 0%, ${layer.color2} 100%)`;
    }
    if (layer.fillType === 'radial') {
      return `radial-gradient(circle at ${layer.gradientCenterX}% ${layer.gradientCenterY}%, ${layer.color} 0%, ${layer.color2} 100%)`;
    }
    return layer.color;
  }

  function layerTextVisualStyle(raw = {}) {
    const layer = normalizeLayer({ ...raw, type: 'text' });
    return {
      lineHeight: String(layer.lineHeight),
      letterSpacing: `${layer.letterSpacing}em`,
      textTransform: layer.textTransform,
      padding: `${layer.textPadding}%`,
      WebkitTextStroke: layer.strokeWidth > 0 ? `${layer.strokeWidth}px ${layer.strokeColor}` : '0px transparent',
      textShadow: layer.shadowEnabled
        ? `${layer.shadowX}px ${layer.shadowY}px ${layer.shadowBlur}px ${layer.shadowColor}`
        : 'none'
    };
  }

  function normalizeScene(raw = {}, index = 0) {
    const source = raw && typeof raw === 'object' ? raw : {};
    return {
      ...source,
      id: id(source.id, `scene-${index + 1}`),
      name: cleanName(source.name, `Scene ${index + 1}`),
      layers: (Array.isArray(source.layers) ? source.layers : []).map(normalizeLayer)
    };
  }

  function liveInputIds(scenes, visibleOnly) {
    const ids = new Set();
    (Array.isArray(scenes) ? scenes : []).forEach(scene => {
      (Array.isArray(scene && scene.layers) ? scene.layers : []).forEach(layer => {
        const type = layerType(layer);
        if ((type === 'window' || type === 'capture' || type === 'audio') && (!visibleOnly || layer.visible !== false) && layer.inputId) ids.add(String(layer.inputId));
      });
    });
    return [...ids];
  }

  function referencedLiveInputIds(scenes) {
    return liveInputIds(scenes, false);
  }

  function activeLiveInputIds(scenes) {
    return liveInputIds(scenes, true);
  }

  function liveLayersForState(state) {
    const scenes = Array.isArray(state && state.scenes) ? state.scenes : [];
    const scene = scenes.find(row => row && row.id === state.activeSceneId) || scenes[0];
    return (scene && Array.isArray(scene.layers) ? scene.layers : []).filter(layer => {
      const type = layerType(layer);
      return layer && layer.visible !== false && (type === 'window' || type === 'capture' || type === 'audio') && layer.inputId;
    }).map(normalizeLayer);
  }

  function activateReferencedInputs(inputs, scenes) {
    const references = new Set(activeLiveInputIds(scenes));
    return normalizeLiveInputs(inputs).map(input => ({ ...input, active: references.has(input.id) }));
  }

  function outputAudioConflicts(configs) {
    const enabled = (Array.isArray(configs) ? configs : []).filter(config => config && config.enabled !== false && config.liveAudio === true);
    return enabled.length > 1 ? enabled.map(config => String(config.name || config.id || 'Output')) : [];
  }

  return {
    SCHEMA_VERSION,
    LAYER_TYPES: [...LAYER_TYPES],
    LIVE_INPUT_TYPES: [...LIVE_INPUT_TYPES],
    SOURCE_QUALITY_PROFILES: [...SOURCE_QUALITY_PROFILES],
    AUDIO_MONITORING_MODES: [...AUDIO_MONITORING_MODES],
    MEDIA_PLAYBACK_STATES: [...MEDIA_PLAYBACK_STATES],
    MEDIA_END_BEHAVIORS: [...MEDIA_END_BEHAVIORS],
    BLEND_MODES: [...BLEND_MODES],
    TRANSFORM_ORIGINS: [...TRANSFORM_ORIGINS],
    CANVAS_PRESETS,
    normalizeCanvas,
    canvasPreset,
    canvasAspect,
    normalizeProjectorWarp,
    normalizeWarpMesh,
    projectorWarpIsValid,
    normalizeMappingInput,
    normalizeMappingOutput,
    normalizeMappingMask,
    normalizeProjectorMapping,
    normalizeComposition,
    normalizeCompositions,
    captureQuality,
    sourceQualityTier,
    liveTransportProfile,
    normalizeLiveInput,
    normalizeLiveInputs,
    normalizeLayer,
    normalizeMediaTransport,
    mediaPlaybackBounds,
    resolveMediaPlayback,
    mediaTransportCommand,
    normalizeCrop,
    layerVisualStyle,
    layerFillStyle,
    layerTextVisualStyle,
    normalizeScene,
    referencedLiveInputIds,
    activeLiveInputIds,
    liveLayersForState,
    activateReferencedInputs,
    outputAudioConflicts
  };
});
