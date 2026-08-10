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
          width: definition.width,
          height: definition.height,
          frameRate: definition.fps
        },
        audio: definition.withAudio === true
      });
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack && typeof videoTrack.applyConstraints === 'function') {
        await videoTrack.applyConstraints({ frameRate: { ideal: definition.fps, max: definition.fps } }).catch(() => {});
      }
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
    const video = definition.type === 'audio' ? false : {
      deviceId: { exact: definition.videoDeviceId },
      width: { ideal: definition.width },
      height: { ideal: definition.height },
      frameRate: { ideal: definition.fps, max: definition.fps }
    };
    const audio = definition.withAudio && definition.audioDeviceId
      ? { deviceId: { exact: definition.audioDeviceId }, echoCancellation: false, noiseSuppression: false, autoGainControl: false }
      : false;
    return navigator.mediaDevices.getUserMedia({ video, audio });
  }

  function syntheticStream() {
    const canvas = document.createElement('canvas');
    canvas.width = 1280; canvas.height = 720;
    const ctx = canvas.getContext('2d');
    let tick = 0;
    const draw = () => {
      ctx.fillStyle = '#12161d'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = '#3aa675'; ctx.fillRect(0, 0, 24 + (tick % 1200), 14);
      ctx.fillStyle = '#f7f8fa'; ctx.font = '700 72px system-ui'; ctx.fillText('ShowSlate Live Input', 80, 340);
      tick += 6;
    };
    draw();
    const timer = setInterval(draw, 33);
    const videoStream = canvas.captureStream(30);
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
          : (TEST_MODE && definition.videoDeviceId === '__showslate_synthetic__' ? syntheticStream() : deviceStream(definition));
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
        status(id, 'live', {
          name: definition.name,
          type: definition.type,
          hasVideo: stream.getVideoTracks().length > 0,
          hasAudio: stream.getAudioTracks().length > 0,
          videoLabel: videoTrack?.label || '',
          audioLabel: audioTrack?.label || '',
          width: Number(settings.width) || 0,
          height: Number(settings.height) || 0,
          frameRate: Number(settings.frameRate) || 0
        });
        for (const peer of [...peers.values()]) if (peer.inputId === id) createOffer(peer.consumerId, id, true).catch(() => {});
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

  async function createOffer(consumerId, inputId, replace = false) {
    const id = String(inputId || '');
    const definition = definitions.get(id);
    if (!definition || !definition.active) throw new Error('Live input is not available.');
    const stream = await startInput(id);
    const key = peerKey(consumerId, id);
    const previous = peers.get(key);
    if (previous && !replace) return;
    if (previous) previous.pc.close();
    const pc = new RTCPeerConnection({ iceServers: [] });
    const peer = { consumerId: Number(consumerId), inputId: id, pc, pendingCandidates: [] };
    peers.set(key, peer);
    const senderSetup = stream.getTracks().map(async track => {
      if (track.kind === 'video' && 'contentHint' in track) track.contentHint = 'detail';
      const sender = pc.addTrack(track, stream);
      if (track.kind !== 'video' || typeof sender.getParameters !== 'function' || typeof sender.setParameters !== 'function') return;
      const parameters = sender.getParameters();
      const pixelsPerSecond = Math.max(1, Number(definition.width) || 1920) * Math.max(1, Number(definition.height) || 1080) * Math.max(1, Number(definition.fps) || 30);
      const maxBitrate = Math.max(4000000, Math.min(24000000, Math.round(pixelsPerSecond * 0.24)));
      parameters.degradationPreference = 'maintain-resolution';
      if (!Array.isArray(parameters.encodings) || !parameters.encodings.length) parameters.encodings = [{}];
      parameters.encodings = parameters.encodings.map(encoding => ({
        ...encoding,
        active: true,
        scaleResolutionDownBy: 1,
        maxBitrate,
        maxFramerate: Math.max(1, Number(definition.fps) || 30)
      }));
      await sender.setParameters(parameters).catch(() => {});
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
      await peer.pc.setRemoteDescription(payload.description);
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
      if (command.type === 'subscribe') await createOffer(command.consumerId, command.inputId, true);
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

  window.liveCapture = { configure, enumerateDevices, startInput, closeInput, createOffer, inputs, definitions, failedStarts };
  api.liveHubReady();
})();
