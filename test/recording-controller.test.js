'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const recording = require('../src/recording/model.js');

const source = fs.readFileSync(path.join(__dirname, '../src/recording/controller.js'), 'utf8');
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

class Events {
  constructor() { this.listeners = new Map(); }
  addEventListener(name, fn, options = {}) {
    const rows = this.listeners.get(name) || [];
    rows.push({ fn, once: !!options.once });
    this.listeners.set(name, rows);
  }
  emit(name, data = {}) {
    const rows = this.listeners.get(name) || [];
    this.listeners.set(name, rows.filter(row => !row.once));
    rows.forEach(row => row.fn(data));
  }
}

function harness(overrides = {}) {
  const calls = [];
  const elements = new Map();
  const element = id => {
    if (!elements.has(id)) {
      elements.set(id, Object.assign(new Events(), {
        value: '', checked: false, disabled: false, hidden: false,
        dataset: {}, options: [], attributes: {}, textContent: '',
        classList: { toggle() {} }, matches() { return false; },
        setAttribute(name, value) { this.attributes[name] = value; }
      }));
    }
    return elements.get(id);
  };
  const settings = recording.normalizeSettings({ directory: '/test/recordings', includeAudio: overrides.includeAudio === true });
  const prepared = {
    ok: true, sessionId: 'session-1', mediaSourceId: 'source-1', chromeMediaSource: 'desktop',
    renderReady: true, dimensions: { width: 1920, height: 1080 }, settings,
    mimeType: 'video/webm;codecs=vp9', videoBitsPerSecond: 10000000,
    filePath: '/test/recordings/program.webm'
  };
  const track = Object.assign(new Events(), {
    kind: 'video', readyState: 'live', stopCalls: 0,
    getSettings() { return { width: 1920, height: 1080 }; },
    stop() { this.stopCalls++; this.readyState = 'ended'; }
  });
  class Stream {
    constructor(tracks) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(row => row.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(row => row.kind === 'audio'); }
  }
  const captureStream = new Stream([track]);
  const silentAudioTrack = { kind:'audio', readyState:'live', stop() { calls.push('audio-track-stop'); } };
  const audioDestination = { stream:new Stream([silentAudioTrack]) };
  const audioContext = {
    createMediaStreamDestination() { return audioDestination; },
    createConstantSource() {
      return {
        offset:{ value:1 },
        connect(destination) { assert.equal(destination,audioDestination);calls.push('silence-connect'); },
        start() { assert.equal(this.offset.value,0);calls.push('silence-start'); },
        stop() { calls.push('silence-stop'); },
        disconnect() { calls.push('silence-disconnect'); }
      };
    }
  };
  const recorders = [];
  class Recorder extends Events {
    static isTypeSupported() { return true; }
    constructor() { super(); this.state = 'inactive'; this.stopCalls = 0; recorders.push(this); }
    start() { this.state = 'recording'; calls.push('start'); }
    chunk(text) { this.emit('dataavailable', { data: new Blob([text]) }); }
    stop() {
      this.state = 'inactive'; this.stopCalls++; calls.push('stop');
      queueMicrotask(() => { this.chunk('final'); this.emit('stop'); });
    }
  }
  const writes = [];
  const aborts = [];
  let bytes = 0;
  const api = {
    async recordingSettings() { return { ok: true, settings, active: false }; },
    async recordingSaveSettings() { return { ok: true, settings }; },
    async recordingPrepare() { calls.push('prepare'); return prepared; },
    async recordingWriteChunk(payload) {
      writes.push(payload); calls.push(`write:${payload.sequence}`);
      if (overrides.write) return overrides.write(payload);
      bytes += payload.data.byteLength;
      return { ok: true, bytes };
    },
    async recordingFinish(payload) {
      calls.push('finish');
      if (overrides.finish) return overrides.finish(payload);
      return { ok: true, path: prepared.filePath, durationMs: 1000, bytes };
    },
    async recordingAbort(payload) {
      calls.push('abort'); aborts.push(payload);
      return overrides.abort ? overrides.abort(payload) : { ok: true };
    },
    ...overrides.api
  };
  const sandbox = {
    document: {
      getElementById: element,
      querySelector: () => element('panel'),
      body: { classList: { toggle() {} } }
    },
    console: { error() {} }, api,
    MediaRecorder: Recorder, MediaStream: Stream,
    navigator: { mediaDevices: { async getUserMedia() {
      calls.push('capture');
      return overrides.capture ? overrides.capture() : captureStream;
    } } },
    ensureProgramState: () => ({ canvas: { width: 1920, height: 1080 } }),
    activeScene: () => ({layers:[]}),
    programAudioContext: audioContext,
    resumeProgramAudioContext: () => audioContext,
    syncProgramVideoAudio() {},
    PTCOMP: { normalizeCanvas: value => value },
    clearInterval, clearTimeout, setTimeout,
    setInterval: () => 1
  };
  sandbox.window = sandbox;
  vm.runInNewContext(source, sandbox, { filename: 'src/recording/controller.js' });
  return {
    calls, writes, aborts, recorders, prepared, track, captureStream, element,
    start: sandbox.__ptStartProgramRecording,
    stop: sandbox.__ptStopProgramRecording
  };
}

function mainRecordingHarness(options = {}) {
  const main = fs.readFileSync(path.join(__dirname, '../main.js'), 'utf8');
  const section = (start, end) => {
    const from = main.indexOf(start);
    const to = main.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `Recording main section exists: ${start}`);
    return main.slice(from, to);
  };
  const handlers = new Map();
  const renamed = [];
  const unlinked = [];
  const revealed = [];
  const sandbox = {
    recordingSession: {
      id: 'session-1', bytes: options.acknowledgedBytes ?? 8, stream: {},
      finalPath: '/test/recordings/program.webm', tempPath: '/test/recordings/program.webm.part'
    },
    lastRecordingPath: '',
    controlWin: { isDestroyed: () => false, webContents: { id: 7 } },
    closeRecordingOutput() {},
    async destroyRecordingWriter() {},
    async closeRecordingWriter() { throw new Error('Could not finalize file'); },
    fs: {
      renameSync(from, to) {
        renamed.push({ from, to });
        if (options.renameError) throw options.renameError;
      },
      unlinkSync: file => unlinked.push(file),
      statSync() {
        if (options.statError) throw options.statError;
        return { size: options.fileBytes ?? 8 };
      },
      existsSync: () => options.fileExists !== false
    },
    shell: { showItemInFolder: file => revealed.push(file) },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) }
  };
  const code = [
    section('async function abortRecordingSession(', 'function hasActiveRecording('),
    section("ipcMain.handle('recording-finish'", "ipcMain.handle('recording-abort'"),
    section("ipcMain.handle('recording-reveal-last'", "ipcMain.handle('recording-prepare'")
  ].join('\n');
  vm.runInNewContext(code, sandbox, { filename: 'main.js:recording' });
  return {
    sandbox, renamed, unlinked, revealed,
    abort: options => sandbox.abortRecordingSession(options),
    finish: payload => handlers.get('recording-finish')({ sender: { id: 7 } }, payload),
    reveal: () => handlers.get('recording-reveal-last')({ sender: { id: 7 } })
  };
}

async function testNormalFinalization() {
  const pendingWrite = deferred();
  const h = harness({ write: () => pendingWrite.promise });
  await flush();
  assert.equal((await h.start()).ok, true);
  const firstStop = h.stop();
  const secondStop = h.stop();
  await flush();
  assert.equal(h.recorders[0].stopCalls, 1);
  assert.deepEqual(h.writes.map(row => row.sequence), [0]);
  assert.equal(h.calls.includes('finish'), false, 'Finish must wait for the final chunk to reach disk');
  assert.equal((await h.start()).busy, true, 'A second recording cannot start during finalization');
  pendingWrite.resolve({ ok: true, bytes: 5 });
  assert.equal((await firstStop).ok, true);
  assert.equal((await secondStop).ok, true);
  assert.equal(h.calls.filter(call => call === 'finish').length, 1);
  assert.equal(h.track.stopCalls, 1);
  assert.equal(h.element('recordingStatusChip').dataset.state, 'complete');
}

async function testCancelPreparation() {
  const pendingPrepare = deferred();
  const h = harness({ api: { recordingPrepare: () => pendingPrepare.promise } });
  await flush();
  const started = h.start();
  await flush();
  let settled = false;
  const stopped = h.stop().then(result => { settled = true; return result; });
  await flush();
  assert.equal(settled, false, 'Cancellation must wait for the pending preparation and cleanup');
  assert.equal((await h.start()).busy, true);
  pendingPrepare.resolve(h.prepared);
  assert.equal((await started).canceled, true);
  assert.equal((await stopped).canceled, true);
  assert.equal(h.calls.includes('capture'), false);
  assert.equal(h.recorders.length, 0);
  assert.equal(h.aborts.length, 1);
  assert.equal(h.aborts[0].sessionId, 'session-1');
  assert.equal(h.aborts[0].preserve, false);
  assert.equal(h.element('recordingStatusChip').dataset.state, 'idle');
}

async function testCancelCapture() {
  const pendingCapture = deferred();
  const h = harness({ capture: () => pendingCapture.promise });
  await flush();
  const started = h.start();
  await flush();
  assert.equal(h.calls.includes('capture'), true);
  const stopped = h.stop();
  assert.equal((await h.start()).busy, true);
  pendingCapture.resolve(h.captureStream);
  assert.equal((await started).canceled, true);
  assert.equal((await stopped).canceled, true);
  assert.equal(h.track.stopCalls, 1, 'Capture acquired after cancellation must be released');
  assert.equal(h.recorders.length, 0);
  assert.equal(h.aborts.length, 1);
}

async function testWriteFailure() {
  const pendingWrite = deferred();
  const h = harness({ write: payload => payload.sequence === 0
    ? { ok: true, bytes: payload.data.byteLength }
    : pendingWrite.promise });
  await flush();
  assert.equal((await h.start()).ok, true);
  const recorder = h.recorders[0];
  recorder.chunk('saved');
  await flush();
  recorder.chunk('disk-full');
  recorder.chunk('queued');
  await flush();
  pendingWrite.resolve({ ok: false, error: 'No space left on device' });
  await flush();
  await flush();
  assert.equal(recorder.stopCalls, 1, 'A disk error must stop recording without another operator action');
  assert.deepEqual(h.writes.map(row => row.sequence), [0, 1], 'Do not submit later chunks after a failed write');
  assert.equal(h.calls.includes('finish'), false, 'A failed recording must not be published as completed');
  assert.equal(h.aborts.length, 1);
  assert.equal(h.aborts[0].preserve, true, 'Preserve footage written before the failure');
  assert.equal(h.track.stopCalls, 1);
  assert.equal(h.element('recordingStatusChip').dataset.state, 'error');
  assert.match(h.element('recordingStatusText').textContent, /No space left/);
  assert.equal(h.element('btnRecordProgram').attributes['aria-pressed'], 'false');
}

async function testRecorderFailureFlushesFinalChunk() {
  const h = harness();
  await flush();
  await h.start();
  h.recorders[0].emit('error', { error: new Error('Encoder failed') });
  await new Promise(resolve => setTimeout(resolve, 5));
  await flush();
  assert.deepEqual(h.writes.map(row => row.sequence), [0], 'Recorder errors can still supply a salvageable final chunk');
  assert.equal(h.calls.includes('finish'), false);
  assert.equal(h.aborts[0].preserve, true);
  assert.match(h.element('recordingStatusText').textContent, /Encoder failed/);
}

async function testWriteFailureRevealsPreservedFile() {
  const main = mainRecordingHarness();
  const h = harness({
    write: () => ({ ok: false, error: 'Disk write failed' }),
    abort: options => main.abort(options),
    api: { recordingRevealLast: () => main.reveal() }
  });
  await flush();
  await h.start();
  h.recorders[0].chunk('failed');
  await flush();
  await flush();
  assert.equal(main.renamed.length, 1);
  assert.deepEqual(main.unlinked, []);
  assert.equal(main.sandbox.lastRecordingPath, '/test/recordings/program.incomplete.webm');
  assert.equal(h.element('recordingLastFile').textContent, 'program.incomplete.webm');
  assert.equal(h.element('btnRecordingReveal').disabled, false);
  assert.equal(h.element('recordingStatusChip').dataset.state, 'error');
  assert.match(h.element('recordingStatusText').textContent, /Disk write failed.*program\.incomplete\.webm/);
  h.element('btnRecordingReveal').emit('click');
  assert.deepEqual(main.revealed, ['/test/recordings/program.incomplete.webm']);
}

async function testFinalizeFailureRevealsAlreadyPreservedFile() {
  const main = mainRecordingHarness();
  const h = harness({
    finish: payload => main.finish(payload),
    abort: options => main.abort(options),
    api: { recordingRevealLast: () => main.reveal() }
  });
  await flush();
  await h.start();
  const result = await h.stop();
  assert.equal(result.ok, false);
  assert.equal(result.preservedPath, '/test/recordings/program.incomplete.webm');
  assert.equal(main.sandbox.recordingSession, null);
  assert.equal(main.renamed.length, 1, 'A second abort must not overwrite or lose the already preserved file');
  assert.deepEqual(main.unlinked, []);
  assert.equal(h.aborts.length, 1, 'Controller cleanup tolerates an already aborted main session');
  assert.equal(h.element('recordingLastFile').textContent, 'program.incomplete.webm');
  assert.equal(h.element('btnRecordingReveal').disabled, false);
  assert.equal(h.element('recordingStatusChip').dataset.state, 'error');
  assert.match(h.element('recordingStatusText').textContent, /Could not finalize file.*program\.incomplete\.webm/);
  h.element('btnRecordingReveal').emit('click');
  assert.deepEqual(main.revealed, ['/test/recordings/program.incomplete.webm']);
}

async function testAbortRenameFailureRetainsPart() {
  const main = mainRecordingHarness({ renameError: new Error('Rename failed') });
  const result = await main.abort({ preserve: true });
  assert.equal(result.preservedPath, '/test/recordings/program.webm.part');
  assert.equal(main.sandbox.lastRecordingPath, result.preservedPath);
  assert.deepEqual(main.unlinked, [], 'Failure to rename salvageable footage must never delete it');
  main.reveal();
  assert.deepEqual(main.revealed, ['/test/recordings/program.webm.part']);
}

async function testAbortPreservesUnacknowledgedBytes() {
  const main = mainRecordingHarness({ acknowledgedBytes: 0, fileBytes: 3 });
  const result = await main.abort({ preserve: true });
  assert.equal(result.preservedPath, '/test/recordings/program.incomplete.webm');
  assert.deepEqual(main.unlinked, [], 'Partial first-chunk bytes must survive an error before write acknowledgement');
}

async function testAbortPreservesUninspectablePart() {
  const main = mainRecordingHarness({
    acknowledgedBytes: 0, statError: new Error('Cannot inspect file'), renameError: new Error('Cannot rename file')
  });
  const result = await main.abort({ preserve: true });
  assert.equal(result.preservedPath, '/test/recordings/program.webm.part');
  assert.deepEqual(main.unlinked, [], 'Unknown size must not be treated as an empty recording');
}

async function testAbortRemovesEmptyFile() {
  const main = mainRecordingHarness({ acknowledgedBytes: 0, fileBytes: 0 });
  const result = await main.abort({ preserve: true });
  assert.equal(result.ok, true);
  assert.equal(result.preservedPath, undefined);
  assert.deepEqual(main.renamed, []);
  assert.deepEqual(main.unlinked, ['/test/recordings/program.webm.part']);
  assert.equal(main.sandbox.lastRecordingPath, '');
}

async function testSilentSceneHasAudioClockAndReleasesIt() {
  const h = harness({includeAudio:true});
  await flush();
  assert.equal((await h.start()).ok,true);
  assert.ok(h.calls.includes('silence-start'));
  assert.equal((await h.stop()).ok,true);
  assert.ok(h.calls.includes('silence-stop'));
  assert.ok(h.calls.includes('silence-disconnect'));
  assert.ok(h.calls.includes('audio-track-stop'));
}

(async () => {
  const tests = [
    testNormalFinalization, testCancelPreparation, testCancelCapture, testWriteFailure,
    testRecorderFailureFlushesFinalChunk, testWriteFailureRevealsPreservedFile,
    testFinalizeFailureRevealsAlreadyPreservedFile, testAbortRenameFailureRetainsPart,
    testAbortPreservesUnacknowledgedBytes, testAbortPreservesUninspectablePart, testAbortRemovesEmptyFile,
    testSilentSceneHasAudioClockAndReleasesIt
  ];
  for (const test of tests) {
    await test();
    console.log(`${test.name}=true`);
  }
  console.log(`RECORDING_CONTROLLER_TESTS_OK count=${tests.length}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
