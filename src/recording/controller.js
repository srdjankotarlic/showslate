'use strict';

(() => {
  const byId = id => document.getElementById(id);
  const topButton = byId('btnRecordProgram');
  const settingsPanel = document.querySelector('.recording-settings');
  if (!topButton || !settingsPanel) return;

  const state = {
    phase: 'idle',
    sessionId: '',
    recorder: null,
    captureStream: null,
    mixedStream: null,
    writeChain: Promise.resolve(),
    writeError: null,
    nextSequence: 0,
    bytes: 0,
    startedAt: 0,
    elapsedTimer: 0,
    stopPromise: null,
    lastPath: '',
    cancelRequested: false
  };

  let recordingAudioDestination = null;
  let recordingAudioActive = false;
  const recordingAudioNodes = new Map();
  let settingsSaveTimer = 0;

  const settingIds = [
    'recordingFilePrefix', 'recordingResolution', 'recordingWidth', 'recordingHeight',
    'recordingFps', 'recordingFormat', 'recordingQuality', 'recordingVideoBitrate',
    'recordingIncludeAudio', 'recordingAudioBitrate'
  ];

  function translated(key, fallback) {
    try { return typeof t === 'function' ? t(key) : fallback; }
    catch (_) { return fallback; }
  }

  function formatElapsed(milliseconds) {
    const total = Math.max(0, Math.floor(Number(milliseconds || 0) / 1000));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
  }

  function formatBytes(bytes) {
    const value = Math.max(0, Number(bytes) || 0);
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    const amount = value / Math.pow(1024, index);
    return `${amount.toLocaleString(undefined, { maximumFractionDigits: index ? 1 : 0 })} ${units[index]}`;
  }

  function fileNameFromPath(value) {
    return String(value || '').split(/[\\/]/).filter(Boolean).pop() || '';
  }

  function setStatus(kind, message) {
    const chip = byId('recordingStatusChip');
    const text = byId('recordingStatusText');
    if (chip) {
      chip.dataset.state = kind;
      chip.textContent = kind === 'recording'
        ? translated('recordingActive', 'RECORDING')
        : kind === 'saving'
          ? translated('recordingSaving', 'Saving recording...')
          : kind === 'complete'
            ? translated('recordingCompleted', 'Recording saved.')
            : kind === 'error'
              ? translated('recordingError', 'Recording failed.')
              : translated('recordingReady', 'Ready');
    }
    if (text) text.textContent = message || chip?.textContent || '';
  }

  function updateElapsed() {
    const elapsed = byId('recordElapsed');
    if (!elapsed) return;
    elapsed.textContent = formatElapsed(Date.now() - state.startedAt);
  }

  function setUiRecording(active, busy = false) {
    document.body.classList.toggle('program-recording', active);
    topButton.setAttribute('aria-pressed', active ? 'true' : 'false');
    const elapsed = byId('recordElapsed');
    if (elapsed) elapsed.hidden = !active;
    const start = byId('btnRecordingStart');
    if (start) start.textContent = active
      ? translated('recordingStop', 'Stop recording')
      : translated('recordingStart', 'Start recording');
    settingsPanel.classList.toggle('is-busy', busy);
    settingIds.forEach(id => { const control = byId(id); if (control) control.disabled = busy; });
    ['btnRecordingBrowse'].forEach(id => { const control = byId(id); if (control) control.disabled = busy; });
    if (active) {
      clearInterval(state.elapsedTimer);
      updateElapsed();
      state.elapsedTimer = window.setInterval(updateElapsed, 500);
    } else {
      clearInterval(state.elapsedTimer);
      state.elapsedTimer = 0;
    }
  }

  function refreshDependentFields() {
    const custom = byId('recordingCustomSize');
    const bitrate = byId('recordingBitrateField');
    const audioBitrate = byId('recordingAudioBitrateField');
    if (custom) custom.hidden = byId('recordingResolution')?.value !== 'custom';
    if (bitrate) bitrate.hidden = byId('recordingQuality')?.value !== 'custom';
    if (audioBitrate) audioBitrate.hidden = !byId('recordingIncludeAudio')?.checked;
    refreshFormatAvailability();
  }

  function readSettings() {
    return {
      directory: byId('recordingDirectory')?.value || '',
      filePrefix: byId('recordingFilePrefix')?.value || 'ShowSlate Recording',
      resolution: byId('recordingResolution')?.value || 'program',
      width: Number(byId('recordingWidth')?.value || 1920),
      height: Number(byId('recordingHeight')?.value || 1080),
      fps: Number(byId('recordingFps')?.value || 30),
      format: byId('recordingFormat')?.value || 'auto',
      quality: byId('recordingQuality')?.value || 'high',
      videoBitrateMbps: Number(byId('recordingVideoBitrate')?.value || 16),
      includeAudio: byId('recordingIncludeAudio')?.checked !== false,
      audioBitrateKbps: Number(byId('recordingAudioBitrate')?.value || 192)
    };
  }

  function applySettings(settings = {}) {
    const setValue = (id, value) => { const control = byId(id); if (control && value !== undefined && value !== null) control.value = String(value); };
    setValue('recordingDirectory', settings.directory || '');
    setValue('recordingFilePrefix', settings.filePrefix || 'ShowSlate Recording');
    setValue('recordingResolution', settings.resolution || 'program');
    setValue('recordingWidth', settings.width || 1920);
    setValue('recordingHeight', settings.height || 1080);
    setValue('recordingFps', settings.fps || 30);
    setValue('recordingFormat', settings.format || 'auto');
    setValue('recordingQuality', settings.quality || 'high');
    setValue('recordingVideoBitrate', settings.videoBitrateMbps || 16);
    setValue('recordingAudioBitrate', settings.audioBitrateKbps || 192);
    const includeAudio = byId('recordingIncludeAudio');
    if (includeAudio) includeAudio.checked = settings.includeAudio !== false;
    if (byId('recordingFreeSpace')) byId('recordingFreeSpace').textContent = settings.freeBytes ? formatBytes(settings.freeBytes) : '—';
    refreshDependentFields();
  }

  function updateLastFile(pathValue) {
    state.lastPath = String(pathValue || '');
    const label = byId('recordingLastFile');
    const reveal = byId('btnRecordingReveal');
    if (label) {
      label.textContent = state.lastPath ? fileNameFromPath(state.lastPath) : translated('recordingNoLastFile', 'None yet');
      label.title = state.lastPath;
    }
    if (reveal) reveal.disabled = !state.lastPath;
  }

  function mimeCandidates(format, includeAudio) {
    const audio = includeAudio ? ',opus' : '';
    const table = {
      'webm-vp9': [`video/webm;codecs=vp9${audio}`, 'video/webm;codecs=vp9', 'video/webm'],
      'webm-vp8': [`video/webm;codecs=vp8${audio}`, 'video/webm;codecs=vp8', 'video/webm'],
      'mp4-h264': includeAudio
        ? ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4;codecs=avc1.42E01E', 'video/mp4']
        : ['video/mp4;codecs=avc1.42E01E', 'video/mp4']
    };
    return format === 'auto'
      ? [...table['mp4-h264'], ...table['webm-vp9'], ...table['webm-vp8']]
      : (table[format] || table['webm-vp9']);
  }

  function mimeSupported(mimeType) {
    return typeof MediaRecorder !== 'undefined'
      && (typeof MediaRecorder.isTypeSupported !== 'function' || MediaRecorder.isTypeSupported(mimeType));
  }

  function selectMimeType(settings) {
    const selected = mimeCandidates(settings.format, settings.includeAudio).find(mimeSupported);
    if (!selected) throw new Error(translated('recordingUnsupported', 'The selected format is not supported on this computer.'));
    return selected;
  }

  function refreshFormatAvailability() {
    const format = byId('recordingFormat');
    if (!format || typeof MediaRecorder === 'undefined') return;
    const includeAudio = byId('recordingIncludeAudio')?.checked !== false;
    [...format.options].forEach(option => {
      option.disabled = option.value !== 'auto' && !mimeCandidates(option.value, includeAudio).some(mimeSupported);
    });
  }

  function scheduleSettingsSave() {
    if (state.phase !== 'idle') return;
    clearTimeout(settingsSaveTimer);
    settingsSaveTimer = window.setTimeout(async () => {
      try {
        const result = await api.recordingSaveSettings(readSettings());
        if (result?.ok && result.settings) applySettings(result.settings);
      } catch (_) {}
    }, 180);
  }

  function programCanvas() {
    try {
      const program = ensureProgramState();
      return PTCOMP.normalizeCanvas(program?.canvas || activeComposition()?.canvas || S.canvas);
    } catch (_) {
      return { width: 1920, height: 1080, fps: 30 };
    }
  }

  function disconnectRecordingAudioNode(record) {
    if (!record) return;
    try {
      if (record.kind === 'video' && record.owner?.analyser && record.gain) record.owner.analyser.disconnect(record.gain);
      else record.source?.disconnect();
    } catch (_) {}
    try { record.gain?.disconnect(); } catch (_) {}
  }

  function syncRecordingAudioGraph() {
    if (!recordingAudioActive || !recordingAudioDestination) return;
    const context = programAudioContext;
    const scene = activeScene(ensureProgramState());
    if (!context || !scene) return;
    const wanted = new Set();

    (scene.layers || []).filter(layer => layer && layer.visible !== false).forEach(layer => {
      if (!['video', 'window', 'capture', 'audio'].includes(layer.type)) return;
      if (!mediaProgramAudioEnabled(layer) || layer.muted === true) return;
      const id = `${layer.type === 'video' ? 'video' : 'live'}:${String(layer.id || '')}`;
      const volume = Math.max(0, Math.min(1, Number(layer.volume ?? 1)));

      if (layer.type === 'video') {
        const owner = programAudioNodes.get(String(layer.id || ''));
        if (!owner?.analyser) return;
        wanted.add(id);
        let record = recordingAudioNodes.get(id);
        if (!record || record.owner !== owner) {
          disconnectRecordingAudioNode(record);
          const gain = context.createGain();
          owner.analyser.connect(gain);
          gain.connect(recordingAudioDestination);
          record = { kind: 'video', owner, gain };
          recordingAudioNodes.set(id, record);
        }
        record.gain.gain.value = volume;
        return;
      }

      const stream = liveInputConsumer?.streams?.get(String(layer.inputId || ''));
      const audioTracks = stream?.getAudioTracks?.().filter(track => track.readyState === 'live') || [];
      if (!audioTracks.length) return;
      wanted.add(id);
      let record = recordingAudioNodes.get(id);
      if (!record || record.stream !== stream) {
        disconnectRecordingAudioNode(record);
        const source = context.createMediaStreamSource(new MediaStream(audioTracks));
        const gain = context.createGain();
        source.connect(gain);
        gain.connect(recordingAudioDestination);
        record = { kind: 'live', stream, source, gain };
        recordingAudioNodes.set(id, record);
      }
      record.gain.gain.value = volume;
    });

    [...recordingAudioNodes.entries()].forEach(([id, record]) => {
      if (wanted.has(id)) return;
      disconnectRecordingAudioNode(record);
      recordingAudioNodes.delete(id);
    });
  }

  function startRecordingAudioGraph() {
    const context = resumeProgramAudioContext();
    if (!context || typeof context.createMediaStreamDestination !== 'function') {
      throw new Error('Program audio recording is not available on this computer.');
    }
    recordingAudioDestination = context.createMediaStreamDestination();
    recordingAudioActive = true;
    syncProgramVideoAudio();
    syncRecordingAudioGraph();
    return recordingAudioDestination.stream;
  }

  function stopRecordingAudioGraph() {
    recordingAudioActive = false;
    recordingAudioNodes.forEach(disconnectRecordingAudioNode);
    recordingAudioNodes.clear();
    if (recordingAudioDestination) {
      try { recordingAudioDestination.stream.getTracks().forEach(track => track.stop()); } catch (_) {}
    }
    recordingAudioDestination = null;
  }

  window.__ptSyncRecordingAudioGraph = syncRecordingAudioGraph;

  function stopMediaStreams() {
    const tracks = new Set([
      ...(state.captureStream?.getTracks?.() || []),
      ...(state.mixedStream?.getTracks?.() || [])
    ]);
    tracks.forEach(track => { try { track.stop(); } catch (_) {} });
    state.captureStream = null;
    state.mixedStream = null;
    stopRecordingAudioGraph();
  }

  function queueChunk(blob) {
    if (!blob || !blob.size || !state.sessionId) return;
    const sequence = state.nextSequence++;
    state.writeChain = state.writeChain.then(async () => {
      const data = await blob.arrayBuffer();
      const result = await api.recordingWriteChunk({ sessionId: state.sessionId, sequence, data });
      if (!result?.ok) throw new Error(result?.error || 'Could not write recording data.');
      state.bytes = Number(result.bytes) || state.bytes + data.byteLength;
    }).catch(error => {
      if (!state.writeError) state.writeError = error;
    });
  }

  function resetRuntime() {
    state.sessionId = '';
    state.recorder = null;
    state.writeChain = Promise.resolve();
    state.writeError = null;
    state.nextSequence = 0;
    state.bytes = 0;
    state.stopPromise = null;
    state.cancelRequested = false;
  }

  async function startProgramRecording() {
    if (state.phase === 'recording') return stopProgramRecording();
    if (state.phase !== 'idle') return { ok: false, busy: true };
    if (typeof MediaRecorder === 'undefined') {
      setStatus('error', translated('recordingUnsupported', 'Program recording is not supported on this computer.'));
      return { ok: false, error: 'MediaRecorder unavailable' };
    }

    state.phase = 'preparing';
    state.cancelRequested = false;
    setUiRecording(false, true);
    setStatus('saving', 'Preparing Program recorder...');
    let prepared = null;

    try {
      let settings = readSettings();
      const mimeType = selectMimeType(settings);
      const saved = await api.recordingSaveSettings(settings);
      if (!saved?.ok) throw new Error(saved?.error || 'Could not save recording settings.');
      settings = saved.settings;
      applySettings(settings);
      if (state.cancelRequested) throw new Error('Recording start was cancelled.');

      prepared = await api.recordingPrepare({ settings, mimeType, programCanvas: programCanvas() });
      if (!prepared?.ok) throw new Error(prepared?.error || 'Could not prepare Program recording.');
      state.sessionId = prepared.sessionId;
      if (!prepared.renderReady) throw new Error('Program renderer did not become ready for recording.');

      const mandatory = {
        chromeMediaSource: prepared.chromeMediaSource || 'tab',
        chromeMediaSourceId: prepared.mediaSourceId
      };
      if (mandatory.chromeMediaSource === 'desktop') {
        Object.assign(mandatory, {
          minWidth: prepared.dimensions.width,
          maxWidth: prepared.dimensions.width,
          minHeight: prepared.dimensions.height,
          maxHeight: prepared.dimensions.height,
          minFrameRate: prepared.settings.fps,
          maxFrameRate: prepared.settings.fps
        });
      }
      state.captureStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { mandatory } });
      const videoTrack = state.captureStream.getVideoTracks()[0];
      if (!videoTrack || videoTrack.readyState !== 'live') throw new Error('Program video capture did not start.');
      const captureSettings = videoTrack.getSettings ? videoTrack.getSettings() : {};
      const capturedWidth = Math.round(Number(captureSettings.width) || 0);
      const capturedHeight = Math.round(Number(captureSettings.height) || 0);
      if (capturedWidth && capturedHeight
        && (capturedWidth !== prepared.dimensions.width || capturedHeight !== prepared.dimensions.height)) {
        throw new Error(`Program capture is ${capturedWidth}×${capturedHeight}; expected ${prepared.dimensions.width}×${prepared.dimensions.height}.`);
      }

      const tracks = [videoTrack];
      if (prepared.settings.includeAudio) {
        const audioStream = startRecordingAudioGraph();
        const audioTrack = audioStream.getAudioTracks()[0];
        if (!audioTrack) throw new Error('Program audio track did not start.');
        tracks.push(audioTrack);
      }
      state.mixedStream = new MediaStream(tracks);

      state.recorder = new MediaRecorder(state.mixedStream, {
        mimeType: prepared.mimeType,
        videoBitsPerSecond: prepared.videoBitsPerSecond,
        ...(prepared.settings.includeAudio ? { audioBitsPerSecond: prepared.audioBitsPerSecond } : {})
      });
      state.writeChain = Promise.resolve();
      state.writeError = null;
      state.nextSequence = 0;
      state.bytes = 0;
      state.stopPromise = new Promise(resolve => state.recorder.addEventListener('stop', resolve, { once: true }));
      state.recorder.addEventListener('dataavailable', event => queueChunk(event.data));
      state.recorder.addEventListener('error', event => {
        state.writeError = event.error || new Error('Media recorder failed.');
        if (state.phase === 'recording') window.setTimeout(() => stopProgramRecording({ preserve: true }), 0);
      });
      videoTrack.addEventListener('ended', () => {
        if (state.phase === 'recording') {
          state.writeError = new Error('Program video capture stopped unexpectedly.');
          stopProgramRecording({ preserve: true });
        }
      }, { once: true });

      state.recorder.start(1000);
      state.startedAt = Date.now();
      state.phase = 'recording';
      setUiRecording(true, true);
      setStatus('recording', `${prepared.dimensions.width}×${prepared.dimensions.height} · ${prepared.settings.fps} fps · ${prepared.mimeType.split(';')[0]}`);
      return { ok: true, path: prepared.filePath, dimensions: prepared.dimensions, mimeType: prepared.mimeType };
    } catch (error) {
      console.error('SHOWSLATE_RECORDING_START_FAILED', error?.name || 'Error', error?.message || error);
      stopMediaStreams();
      if (state.sessionId || prepared?.sessionId) {
        try { await api.recordingAbort({ sessionId: state.sessionId || prepared.sessionId, preserve: false }); } catch (_) {}
      }
      resetRuntime();
      state.phase = 'idle';
      setUiRecording(false, false);
      const detail = `${error?.name && error.name !== 'Error' ? `${error.name}: ` : ''}${String(error?.message || error)}`;
      setStatus('error', detail);
      return { ok: false, error: detail };
    }
  }

  async function stopProgramRecording(options = {}) {
    if (state.phase === 'preparing') {
      state.cancelRequested = true;
      return { ok: false, canceled: true };
    }
    if (state.phase === 'stopping') return state.stopOperation || { ok: false, busy: true };
    if (state.phase !== 'recording' || !state.recorder) return { ok: false, inactive: true };

    state.phase = 'stopping';
    setUiRecording(true, true);
    setStatus('saving', translated('recordingSaving', 'Saving recording...'));

    state.stopOperation = (async () => {
      const recorder = state.recorder;
      const sessionId = state.sessionId;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        if (state.stopPromise) await state.stopPromise;
        await state.writeChain;
        if (state.writeError) throw state.writeError;
        stopMediaStreams();
        const result = await api.recordingFinish({ sessionId });
        if (!result?.ok) throw new Error(result?.error || 'Could not finalize recording.');
        updateLastFile(result.path);
        const duration = formatElapsed(result.durationMs);
        const message = `${translated('recordingCompleted', 'Recording saved.')} ${fileNameFromPath(result.path)} · ${duration} · ${formatBytes(result.bytes)}`;
        resetRuntime();
        state.phase = 'idle';
        setUiRecording(false, false);
        setStatus('complete', message);
        try {
          const refreshed = await api.recordingSettings();
          if (refreshed?.ok && refreshed.settings) applySettings(refreshed.settings);
        } catch (_) {}
        return { ...result, ok: true };
      } catch (error) {
        stopMediaStreams();
        try { await api.recordingAbort({ sessionId, preserve: options.preserve !== false }); } catch (_) {}
        resetRuntime();
        state.phase = 'idle';
        setUiRecording(false, false);
        setStatus('error', String(error?.message || error));
        return { ok: false, error: String(error?.message || error) };
      } finally {
        state.stopOperation = null;
      }
    })();
    return state.stopOperation;
  }

  window.__ptStopProgramRecording = stopProgramRecording;
  window.__ptStartProgramRecording = startProgramRecording;

  topButton.addEventListener('click', () => {
    if (state.phase === 'recording') stopProgramRecording();
    else if (state.phase === 'idle') startProgramRecording();
  });
  byId('btnRecordingStart')?.addEventListener('click', () => {
    if (state.phase === 'recording') stopProgramRecording();
    else if (state.phase === 'idle') startProgramRecording();
  });
  byId('btnRecordingBrowse')?.addEventListener('click', async () => {
    try {
      const result = await api.recordingChooseDirectory();
      if (result?.ok && result.settings) {
        applySettings(result.settings);
        setStatus('idle', translated('recordingReady', 'Ready'));
      }
    } catch (error) { setStatus('error', String(error?.message || error)); }
  });
  byId('btnRecordingOpenFolder')?.addEventListener('click', () => api.recordingOpenDirectory());
  byId('btnRecordingReveal')?.addEventListener('click', () => api.recordingRevealLast());
  settingIds.forEach(id => {
    const control = byId(id);
    if (!control) return;
    control.addEventListener('change', () => { refreshDependentFields(); scheduleSettingsSave(); });
    if (control.matches('input[type="text"],input[type="number"]')) control.addEventListener('input', scheduleSettingsSave);
  });

  (async () => {
    refreshDependentFields();
    setUiRecording(false, false);
    try {
      let result = await api.recordingSettings();
      if (result?.active) {
        await api.recordingAbort({ preserve: true });
        result = await api.recordingSettings();
      }
      if (result?.ok) {
        applySettings(result.settings || {});
        updateLastFile(result.lastPath || '');
      }
    } catch (_) {}
    if (typeof MediaRecorder === 'undefined') {
      topButton.disabled = true;
      byId('btnRecordingStart').disabled = true;
      setStatus('error', translated('recordingUnsupported', 'Program recording is not supported on this computer.'));
    } else {
      setStatus('idle', translated('recordingReady', 'Ready'));
    }
  })();
})();
