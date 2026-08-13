(function () {
  'use strict';

  const api = window.pt;
  const compositor = window.ShowSlateCompositor;
  const definitions = new Map();
  const inputs = new Map();
  const peers = new Map();
  const reconnectTimers = new Map();
  const startTasks = new Map();
  const startGenerations = new Map();
  const failedStarts = new Map();
  const captureMetadata = new WeakMap();
  let desktopCaptureQueue = Promise.resolve();
  const TEST_MODE = new URLSearchParams(location.search).get('test') === '1';
  const CAPTURE_START_TIMEOUT_MS = 10000;

  function status(inputId, state, extra = {}) {
    const payload = { inputId: String(inputId || ''), state, at: Date.now(), ...extra };
    api.liveHubStatus(payload);
    return payload;
  }

  function stopTracks(stream) {
    if (stream && typeof stream.getTracks === 'function') stream.getTracks().forEach(track => track.stop());
  }

  function invalidateStart(inputId) {
    const id = String(inputId || '');
    startGenerations.set(id, (startGenerations.get(id) || 0) + 1);
    startTasks.delete(id);
  }

  function captureWithTimeout(task, timeoutMs = CAPTURE_START_TIMEOUT_MS) {
    let timedOut = false;
    let timer = null;
    return new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error('Capture did not start within 10 seconds. Check permission, cable and device, then choose Restart.'));
      }, timeoutMs);
      Promise.resolve(task).then(stream => {
        if (timedOut) {
          stopTracks(stream);
          return;
        }
        clearTimeout(timer);
        resolve(stream);
      }, error => {
        if (timedOut) return;
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  function closeInput(inputId, reason = 'stopped', extra = {}) {
    const id = String(inputId || '');
    const record = inputs.get(id);
    inputs.delete(id);
    if (record) stopTracks(record.stream);
    const timer = reconnectTimers.get(id);
    if (timer) clearTimeout(timer);
    reconnectTimers.delete(id);
    for (const [key, peer] of [...peers]) {
      if (peer.inputId !== id) continue;
      peer.pc.close();
      peers.delete(key);
      api.liveHubSignal({ consumerId: peer.consumerId, inputId: id, type: 'closed' });
    }
    status(id, reason, extra);
  }

  function scheduleReconnect(inputId) {
    const id = String(inputId || '');
    const definition = definitions.get(id);
    if (!definition || !definition.active || !definition.autoReconnect || reconnectTimers.has(id)) return;
    reconnectTimers.set(id, setTimeout(() => {
      reconnectTimers.delete(id);
      startInput(id).catch(() => {});
    }, 1800));
  }

  function desktopStream(definition) {
    if (!definition.desktopSourceId) return Promise.reject(new Error('Choose a window or screen first.'));
    const capture = async () => {
      const selection = await api.liveHubSelectDesktopSource(definition.desktopSourceId, definition.desktopSourceName || definition.name, definition.withAudio === true);
      if (!selection || selection.ok !== true) throw new Error('The selected window is no longer available.');
      if (selection.sourceId) definition.desktopSourceId = selection.sourceId;
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: definition.fps, max: definition.fps }
        },
        audio: definition.withAudio === true
      });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        await videoTrack.applyConstraints({ frameRate: { ideal: definition.fps, max: definition.fps } }).catch(() => {});
      }
      captureMetadata.set(stream, { captureMode: 'desktop-native', formatFallback: false });
      return stream;
    };
    const result = desktopCaptureQueue.then(capture, capture);
    desktopCaptureQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  function streamReadyForDefinition(stream, definition) {
    if (!stream || typeof stream.getTracks !== 'function') return false;
    const liveVideo = stream.getVideoTracks().some(track => track.readyState === 'live');
    const liveAudio = stream.getAudioTracks().some(track => track.readyState === 'live');
    if (definition.type === 'audio') return liveAudio;
    if (!liveVideo) return false;
    return definition.withAudio !== true || liveAudio;
  }

  async function deviceStream(definition) {
    if (definition.type === 'audio' && !definition.audioDeviceId) throw new Error('Choose an audio input first.');
    if (definition.type !== 'audio' && !definition.videoDeviceId) throw new Error('Choose a video capture device first.');
    const audio = definition.withAudio && definition.audioDeviceId
      ? {
          deviceId: { exact: definition.audioDeviceId },
          sampleRate: { ideal: 48000 },
          sampleSize: { ideal: 24 },
          channelCount: { ideal: 2 },
          latency: { ideal: definition.qualityProfile === 'realtime' ? 0.01 : 0.02 },
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false
        }
      : false;
    if (definition.type === 'audio') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio });
      captureMetadata.set(stream, { captureMode: 'audio', formatFallback: false });
      return stream;
    }
    const compatibleVideo = {
      deviceId: { exact: definition.videoDeviceId },
      width: { ideal: definition.width },
      height: { ideal: definition.height },
      frameRate: { ideal: definition.fps, max: definition.fps }
    };
    if (definition.captureMode === 'compatible') {
      const stream = await navigator.mediaDevices.getUserMedia({ video: compatibleVideo, audio });
      captureMetadata.set(stream, { captureMode: 'compatible', formatFallback: false });
      return stream;
    }
    const exactVideo = {
      deviceId: { exact: definition.videoDeviceId },
      width: { exact: definition.width },
      height: { exact: definition.height },
      frameRate: { exact: definition.fps }
    };
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: exactVideo, audio });
      captureMetadata.set(stream, { captureMode: 'low-latency', formatFallback: false });
      return stream;
    } catch (error) {
      const constraintError = ['OverconstrainedError', 'ConstraintNotSatisfiedError'].includes(String(error && error.name || ''));
      if (!constraintError) throw error;
      const stream = await navigator.mediaDevices.getUserMedia({ video: compatibleVideo, audio });
      captureMetadata.set(stream, {
        captureMode: 'low-latency',
        formatFallback: true,
        fallbackReason: String(error && (error.constraint || error.message) || 'unsupported-format')
      });
      return stream;
    }
  }

  function syntheticStream(definition = {}) {
    const canvas = document.createElement('canvas');
    const width = Math.max(160, Math.min(3840, Number(definition.width) || 1920));
    const height = Math.max(120, Math.min(2160, Number(definition.height) || 1080));
    const fps = Math.max(1, Math.min(60, Number(definition.fps) || 30));
    canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false });
    const base = document.createElement('canvas');
    base.width = width; base.height = height;
    const baseCtx = base.getContext('2d', { alpha: false });
    let tick = 0;
    const scale = Math.max(0.5, Math.min(width / 1920, height / 1080));
    const inset = Math.round(52 * scale);
    const stripeHeight = Math.max(12, Math.round(24 * scale));
    const markerWidth = Math.max(80, Math.round(width * 0.12));
    const markerTravel = Math.max(1, width - markerWidth - inset * 2);
    const markerY = height - inset - stripeHeight * 2;
    baseCtx.fillStyle = '#12161d'; baseCtx.fillRect(0, 0, width, height);
    baseCtx.fillStyle = '#172b42'; baseCtx.fillRect(0, 0, width, Math.round(height * 0.25));
    baseCtx.fillStyle = '#23435f'; baseCtx.fillRect(0, Math.round(height * 0.25), width, Math.round(height * 0.25));
    baseCtx.fillStyle = '#2f725b'; baseCtx.fillRect(0, Math.round(height * 0.5), width, Math.round(height * 0.25));
    baseCtx.fillStyle = '#b88a32'; baseCtx.fillRect(0, Math.round(height * 0.75), width, Math.round(height * 0.25));
    baseCtx.strokeStyle = '#f7f8fa'; baseCtx.lineWidth = Math.max(3, Math.round(5 * scale));
    baseCtx.strokeRect(inset, inset, width - inset * 2, height - inset * 2);
    baseCtx.fillStyle = '#f7f8fa';
    baseCtx.font = `700 ${Math.round(84 * scale)}px system-ui`;
    baseCtx.fillText('ShowSlate Live Input', Math.round(92 * scale), Math.round(220 * scale));
    baseCtx.font = `600 ${Math.round(42 * scale)}px ui-monospace, monospace`;
    baseCtx.fillText(`${width} x ${height} @ ${fps} fps`, Math.round(96 * scale), Math.round(310 * scale));
    baseCtx.fillRect(inset, height - inset - stripeHeight, width - inset * 2, stripeHeight);
    ctx.drawImage(base, 0, 0);
    let previousMarkerX = null;
    const draw = () => {
      const markerX = inset + (tick % markerTravel);
      if (previousMarkerX != null) {
        ctx.drawImage(base, previousMarkerX, markerY, markerWidth, stripeHeight,
          previousMarkerX, markerY, markerWidth, stripeHeight);
      }
      ctx.fillStyle = '#45d889';
      ctx.fillRect(markerX, markerY, markerWidth, stripeHeight);
      previousMarkerX = markerX;
      tick += Math.max(8, Math.round(width / Math.max(1, fps * 1.5)));
    };
    draw();
    const timer = setInterval(draw, Math.max(16, Math.round(1000 / fps)));
    const videoStream = canvas.captureStream(fps);
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const audioContext = AudioContextClass ? new AudioContextClass() : null;
    let oscillator = null;
    let audioTracks = [];
    if (audioContext) {
      const destination = audioContext.createMediaStreamDestination();
      const gain = audioContext.createGain();
      gain.gain.value = 0;
      oscillator = audioContext.createOscillator();
      oscillator.frequency.value = 440;
      oscillator.connect(gain).connect(destination);
      oscillator.start();
      audioTracks = destination.stream.getAudioTracks();
    }
    const stream = new MediaStream([...videoStream.getVideoTracks(), ...audioTracks]);
    captureMetadata.set(stream, { captureMode: 'synthetic', formatFallback: false });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      clearInterval(timer);
      try { if (oscillator) oscillator.stop(); } catch (_) {}
      try { if (audioContext) audioContext.close(); } catch (_) {}
    };
    stream.getTracks().forEach(track => track.addEventListener('ended', cleanup, { once: true }));
    return stream;
  }

  async function startInput(inputId) {
    const id = String(inputId || '');
    const definition = definitions.get(id);
    if (!definition || !definition.active) return null;
    const existing = inputs.get(id);
    if (existing && streamReadyForDefinition(existing.stream, definition)) return existing.stream;
    const pending = startTasks.get(id);
    if (pending) return pending;
    const previousFailure = failedStarts.get(id);
    if (previousFailure) throw previousFailure;

    const generation = (startGenerations.get(id) || 0) + 1;
    startGenerations.set(id, generation);
    const task = (async () => {
      closeInput(id, 'starting');
      status(id, 'starting', { name: definition.name, type: definition.type });
      try {
        const captureTask = definition.type === 'window'
          ? desktopStream(definition)
          : (TEST_MODE && definition.videoDeviceId === '__showslate_synthetic__' ? syntheticStream(definition) : deviceStream(definition));
        const stream = await captureWithTimeout(captureTask);
        if (!streamReadyForDefinition(stream, definition)) {
          stopTracks(stream);
          throw new Error(definition.withAudio ? 'The selected source did not provide the requested video and system audio.' : 'The selected source did not provide a live video track.');
        }
        if (startGenerations.get(id) !== generation) {
          stopTracks(stream);
          throw new Error('Capture start was replaced by a newer request.');
        }
        const record = { definition, stream, startedAt: Date.now() };
        inputs.set(id, record);
        failedStarts.delete(id);
        stream.getTracks().forEach(track => track.addEventListener('ended', () => {
          if (inputs.get(id) !== record) return;
          closeInput(id, 'ended', { kind: track.kind, label: track.label || '' });
          scheduleReconnect(id);
        }));
        const videoTrack = stream.getVideoTracks()[0];
        const audioTrack = stream.getAudioTracks()[0];
        const settings = videoTrack && typeof videoTrack.getSettings === 'function' ? videoTrack.getSettings() : {};
        const audioSettings = audioTrack && typeof audioTrack.getSettings === 'function' ? audioTrack.getSettings() : {};
        const metadata = captureMetadata.get(stream) || {};
        const actualWidth = Number(settings.width) || 0;
        const actualHeight = Number(settings.height) || 0;
        const actualFrameRate = Number(settings.frameRate) || 0;
        const formatMatched = definition.type === 'audio' ? true : !!(
          actualWidth === Number(definition.width)
          && actualHeight === Number(definition.height)
          && (!actualFrameRate || Math.abs(actualFrameRate - Number(definition.fps)) <= 0.75)
        );
        status(id, 'live', {
          name: definition.name,
          type: definition.type,
          hasVideo: stream.getVideoTracks().length > 0,
          hasAudio: stream.getAudioTracks().length > 0,
          videoLabel: videoTrack?.label || '',
          audioLabel: audioTrack?.label || '',
          audioSampleRate: Number(audioSettings.sampleRate) || 0,
          audioSampleSize: Number(audioSettings.sampleSize) || 0,
          audioChannels: Number(audioSettings.channelCount) || 0,
          audioLatency: Number(audioSettings.latency) || 0,
          width: actualWidth,
          height: actualHeight,
          frameRate: actualFrameRate,
          requestedWidth: Number(definition.width) || 0,
          requestedHeight: Number(definition.height) || 0,
          requestedFrameRate: Number(definition.fps) || 0,
          captureMode: String(metadata.captureMode || definition.captureMode || ''),
          qualityProfile: String(definition.qualityProfile || 'auto'),
          qualityTier: compositor.sourceQualityTier(actualWidth, actualHeight),
          formatMatched,
          formatFallback: metadata.formatFallback === true || !formatMatched,
          fallbackReason: String(metadata.fallbackReason || '')
        });
        for (const peer of [...peers.values()]) if (peer.inputId === id) createOffer(peer.consumerId, id, true, peer.profile).catch(() => {});
        return stream;
      } catch (error) {
        if (startGenerations.get(id) === generation) {
          const failure = error instanceof Error ? error : new Error(String(error || 'Capture failed.'));
          failedStarts.set(id, failure);
          status(id, 'error', { name: definition.name, type: definition.type, error: failure.message });
        }
        throw error;
      }
    })();
    startTasks.set(id, task);
    try {
      return await task;
    } finally {
      if (startTasks.get(id) === task) startTasks.delete(id);
    }
  }

  async function configure(rawDefinitions) {
    const clean = compositor.normalizeLiveInputs(rawDefinitions);
    const next = new Map(clean.map(row => [row.id, row]));
    for (const id of definitions.keys()) if (!next.has(id)) {
      invalidateStart(id);
      failedStarts.delete(id);
      closeInput(id, 'removed');
    }
    for (const [id, definition] of next) {
      const old = definitions.get(id);
      const changed = JSON.stringify(old || null) !== JSON.stringify(definition);
      definitions.set(id, definition);
      if (!definition.active || changed) {
        invalidateStart(id);
        failedStarts.delete(id);
        if (inputs.has(id)) closeInput(id, definition.active ? 'restarting' : 'idle');
      }
      if (definition.active) startInput(id).catch(() => {});
    }
    for (const id of [...definitions.keys()]) if (!next.has(id)) definitions.delete(id);
    return clean;
  }

  function peerKey(consumerId, inputId) { return `${consumerId}:${inputId}`; }

  function preferProgramVideoCodec(pc, sender, definition, profile) {
    if (profile !== 'program' || definition.type !== 'device') return '';
    const transceiver = pc.getTransceivers().find(row => row.sender === sender);
    const capabilities = typeof RTCRtpSender !== 'undefined' && typeof RTCRtpSender.getCapabilities === 'function'
      ? RTCRtpSender.getCapabilities('video')
      : null;
    if (!transceiver || typeof transceiver.setCodecPreferences !== 'function' || !capabilities || !Array.isArray(capabilities.codecs)) return '';
    // Chromium currently advertises the realtime H.264 baseline profile at
    // level 3.1 first. That profile silently caps a 1080p/4K local Program
    // feed at 720p, so keep VP8 first for full-resolution production inputs.
    const needsFullResolutionCodec = Number(definition.width) >= 1920 || Number(definition.height) >= 1080;
    const h264 = capabilities.codecs.filter(codec => String(codec.mimeType || '').toLowerCase() === 'video/h264');
    const h264Realtime = h264.filter(codec => /packetization-mode=1/i.test(String(codec.sdpFmtpLine || '')) && /profile-level-id=42(?:00|e0)/i.test(String(codec.sdpFmtpLine || '')));
    const vp8 = capabilities.codecs.filter(codec => String(codec.mimeType || '').toLowerCase() === 'video/vp8');
    const preferred = needsFullResolutionCodec && vp8.length ? vp8 : (h264Realtime.length ? h264Realtime : h264);
    if (!preferred.length) return '';
    const selected = new Set(preferred);
    const remaining = capabilities.codecs.filter(codec => !selected.has(codec));
    try {
      transceiver.setCodecPreferences([...preferred, ...remaining]);
      return needsFullResolutionCodec && vp8.length ? 'video/VP8' : 'video/H264';
    } catch (error) {
      return '';
    }
  }

  function withProgramBitrateHints(description, transport, preferredCodec) {
    if (!description || !description.sdp || !transport || transport.consumer !== 'program') return description;
    if (transport.sourceTier !== 'FHD' && transport.sourceTier !== 'UHD' && transport.sourceTier !== '8K') return description;
    const codecName = String(preferredCodec || '').split('/')[1] || '';
    if (!codecName) return description;
    const maxKbps = Math.max(12000, Math.round(Number(transport.maxBitrate || 0) / 1000));
    const startKbps = Math.min(maxKbps, Math.max(30000, Math.round(maxKbps * 0.25)));
    const minKbps = Math.min(startKbps, Math.max(12000, Math.round(startKbps * 0.4)));
    const lines = String(description.sdp).split('\r\n');
    const videoStart = lines.findIndex(line => line.startsWith('m=video '));
    if (videoStart < 0) return description;
    let videoEnd = lines.length;
    for (let index = videoStart + 1; index < lines.length; index++) {
      if (lines[index].startsWith('m=')) { videoEnd = index; break; }
    }
    const codecPattern = new RegExp(`^a=rtpmap:(\\d+) ${codecName}/`, 'i');
    let payload = '';
    for (let index = videoStart; index < videoEnd; index++) {
      const match = lines[index].match(codecPattern);
      if (match) { payload = match[1]; break; }
    }
    if (!payload) return description;

    for (let index = videoEnd - 1; index > videoStart; index--) {
      if (lines[index].startsWith('b=AS:') || lines[index].startsWith('b=TIAS:')) {
        lines.splice(index, 1);
        videoEnd--;
      }
    }
    let bandwidthAt = videoStart + 1;
    while (bandwidthAt < videoEnd && (lines[bandwidthAt].startsWith('i=') || lines[bandwidthAt].startsWith('c='))) bandwidthAt++;
    lines.splice(bandwidthAt, 0, `b=AS:${maxKbps}`, `b=TIAS:${maxKbps * 1000}`);
    videoEnd += 2;

    const fmtpPrefix = `a=fmtp:${payload}`;
    const hints = `x-google-start-bitrate=${startKbps};x-google-min-bitrate=${minKbps};x-google-max-bitrate=${maxKbps}`;
    let fmtpAt = -1;
    for (let index = videoStart; index < videoEnd; index++) {
      if (lines[index].startsWith(fmtpPrefix)) { fmtpAt = index; break; }
    }
    if (fmtpAt >= 0) {
      lines[fmtpAt] = lines[fmtpAt].replace(/;?x-google-(?:start|min|max)-bitrate=\d+/gi, '') + `;${hints}`;
    } else {
      const rtpAt = lines.findIndex((line, index) => index >= videoStart && index < videoEnd && codecPattern.test(line));
      lines.splice(rtpAt >= 0 ? rtpAt + 1 : videoStart + 1, 0, `${fmtpPrefix} ${hints}`);
    }
    return { type: description.type, sdp: lines.join('\r\n') };
  }

  async function createOffer(consumerId, inputId, replace = false, requestedProfile = 'program') {
    const id = String(inputId || '');
    const definition = definitions.get(id);
    if (!definition || !definition.active) throw new Error('Live input is not available.');
    const stream = await startInput(id);
    const key = peerKey(consumerId, id);
    const previous = peers.get(key);
    const profile = requestedProfile === 'operator' ? 'operator' : (previous && previous.profile === 'operator' ? 'operator' : 'program');
    if (previous && !replace) return;
    if (previous) previous.pc.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { consumerId: Number(consumerId), inputId: id, profile, pc, pendingCandidates: [] };
    peers.set(key, peer);
    const senderSetup = stream.getTracks().map(async track => {
      if (track.kind === 'video' && 'contentHint' in track) track.contentHint = definition.type === 'device' ? 'motion' : 'detail';
      if (track.kind === 'audio' && 'contentHint' in track) track.contentHint = 'music';
      const sender = pc.addTrack(track, stream);
      const preferredCodec = track.kind === 'video' ? preferProgramVideoCodec(pc, sender, definition, profile) : '';
      if (typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;
      const parameters = sender.getParameters();
      if (track.kind === 'audio') {
        if (!Array.isArray(parameters.encodings) || !parameters.encodings.length) parameters.encodings = [{}];
        parameters.encodings = parameters.encodings.map(encoding => ({
          ...encoding,
          active: true,
          maxBitrate: definition.qualityProfile === 'realtime' ? 192000 : 320000
        }));
        const applied = await sender.setParameters(parameters).then(() => true, () => false);
        peer.audioTransport = { sampleRate: 48000, channels: 2, maxBitrate: definition.qualityProfile === 'realtime' ? 192000 : 320000, applied };
        return;
      }
      const settings = typeof track.getSettings === 'function' ? track.getSettings() : {};
      const transport = compositor.liveTransportProfile(definition, settings, profile);
      parameters.degradationPreference = transport.degradationPreference;
      if (!Array.isArray(parameters.encodings) || !parameters.encodings.length) parameters.encodings = [{}];
      parameters.encodings = parameters.encodings.map(encoding => ({
        ...encoding,
        active: true,
        priority: profile === 'program' ? 'high' : 'low',
        networkPriority: profile === 'program' ? 'high' : 'low',
        scaleResolutionDownBy: transport.scaleResolutionDownBy,
        maxBitrate: transport.maxBitrate,
        maxFramerate: transport.targetFrameRate
      }));
      const applied = await sender.setParameters(parameters).then(() => true, () => false);
      peer.transport = { ...transport, preferredCodec, applied };
    });
    await Promise.all(senderSetup);
    pc.onicecandidate = event => {
      if (event.candidate) api.liveHubSignal({
        consumerId: peer.consumerId,
        inputId: id,
        type: 'candidate',
        candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate
      });
    };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed'].includes(pc.connectionState) && peers.get(key) === peer) {
        peers.delete(key);
        pc.close();
      }
    };
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    api.liveHubSignal({
      consumerId: peer.consumerId,
      inputId: id,
      type: 'offer',
      description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription
    });
  }

  async function handleConsumerSignal(payload) {
    const consumerId = Number(payload && payload.consumerId);
    const inputId = String(payload && payload.inputId || '');
    const peer = peers.get(peerKey(consumerId, inputId));
    if (!peer) return;
    if (payload.type === 'answer' && payload.description) {
      await peer.pc.setRemoteDescription(withProgramBitrateHints(payload.description, peer.transport, peer.transport && peer.transport.preferredCodec));
      for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(candidate).catch(() => {});
    } else if (payload.type === 'candidate' && payload.candidate) {
      if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(payload.candidate).catch(() => {});
      else peer.pendingCandidates.push(payload.candidate);
    }
  }

  function unsubscribe(consumerId, inputId) {
    const key = peerKey(Number(consumerId), String(inputId || ''));
    const peer = peers.get(key);
    if (peer) peer.pc.close();
    peers.delete(key);
  }

  function releaseConsumer(consumerId) {
    for (const [key, peer] of [...peers]) {
      if (peer.consumerId !== Number(consumerId)) continue;
      peer.pc.close(); peers.delete(key);
    }
  }

  async function enumerateDevices(requestPermission = false) {
    if (requestPermission) {
      for (const constraints of [{ video: true, audio: false }, { video: false, audio: true }]) {
        try { const stream = await navigator.mediaDevices.getUserMedia(constraints); stopTracks(stream); }
        catch (_) {}
      }
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => device.kind === 'videoinput' || device.kind === 'audioinput' || device.kind === 'audiooutput').map(device => ({
      deviceId: device.deviceId,
      groupId: device.groupId,
      kind: device.kind,
      label: device.label || (device.kind === 'videoinput' ? 'Video input' : device.kind === 'audiooutput' ? 'Audio output' : 'Audio input')
    }));
  }

  api.onLiveHubCommand(async command => {
    try {
      if (command.type === 'configure') await configure(command.definitions);
      if (command.type === 'subscribe') await createOffer(command.consumerId, command.inputId, true, command.profile);
      if (command.type === 'unsubscribe') unsubscribe(command.consumerId, command.inputId);
      if (command.type === 'release-consumer') releaseConsumer(command.consumerId);
      if (command.type === 'signal') await handleConsumerSignal(command.payload);
      if (command.type === 'restart') {
        invalidateStart(command.inputId);
        failedStarts.delete(String(command.inputId || ''));
        closeInput(command.inputId, 'restarting');
        await startInput(command.inputId);
      }
    } catch (error) {
      status(command.inputId, 'error', { error: String(error && error.message || error) });
    }
  });

  window.liveCapture = { configure, enumerateDevices, startInput, closeInput, createOffer, inputs, definitions, peers, failedStarts };
  api.liveHubReady();
})();
