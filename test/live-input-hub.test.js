'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const compositor = require('../src/compositor/model');

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}

function harness(options = {}) {
  const signals = [];
  const statuses = [];
  const pcs = [];
  const timers = new Map();
  let timerId = 0;
  let command;
  let starts = 0;
  const track = {
    kind: 'video', readyState: 'live', label: 'Test camera',
    getSettings: () => ({ width: 1920, height: 1080, frameRate: 30 }),
    addEventListener() {}, stop() { this.readyState = 'ended'; }
  };
  const stream = { getTracks: () => [track], getVideoTracks: () => [track], getAudioTracks: () => [] };
  class Peer {
    constructor() { this.index = pcs.length; this.connectionState = 'new'; pcs.push(this); }
    addTrack() { return {}; }
    getTransceivers() { return []; }
    async createOffer() {
      if (options.offers && options.offers[this.index]) await options.offers[this.index].promise;
      return { type: 'offer', sdp: 'offer-' + this.index };
    }
    async setLocalDescription(description) { this.localDescription = description; }
    async setRemoteDescription(description) {
      if (options.remote) await options.remote.promise;
      if (this.connectionState === 'closed') throw new Error('Peer was closed.');
      this.remoteDescription = description;
    }
    async addIceCandidate() {}
    close() { this.connectionState = 'closed'; }
  }
  const api = {
    liveHubStatus(payload) { statuses.push(payload); }, liveHubSignal(payload) { signals.push(payload); },
    onLiveHubCommand(fn) { command = fn; }, liveHubReady() {}
  };
  const context = vm.createContext({
    window: { pt: api, ShowSlateCompositor: compositor }, URLSearchParams,
    location: { search: '' }, RTCPeerConnection: Peer,
    navigator: { mediaDevices: { getUserMedia() { starts++; return options.capture ? options.capture.promise : Promise.resolve(stream); } } },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/live-input/hub.js'), 'utf8'), context);
  return { hub: context.window.liveCapture, command: payload => command(payload), signals, statuses, pcs, stream, starts: () => starts };
}

const definition = { id: 'camera', type: 'device', videoDeviceId: 'selected-device', active: true };
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(name); }

async function main() {
  for (const type of ['unsubscribe', 'release-consumer']) {
    await check('LIVE_HUB_CANCEL_' + type.toUpperCase().replace('-', '_') + '_DURING_CAPTURE_OK', async () => {
      const capture = deferred();
      const h = harness({ capture });
      await h.hub.configure([definition]);
      const offering = h.hub.createOffer(1, 'camera');
      await h.command({ type, consumerId: 1, inputId: 'camera' });
      capture.resolve(h.stream);
      await offering;
      assert.equal(h.starts(), 1, 'Capture remains owned by one hub request.');
      assert.equal(h.hub.peers.size, 0, 'A departed consumer must not acquire a late peer.');
      assert.equal(h.signals.filter(row => row.type === 'offer').length, 0);
      h.hub.closeInput('camera');
    });
  }

  await check('LIVE_HUB_REPLACED_OFFER_CANNOT_SIGNAL_OK', async () => {
    const first = deferred();
    const h = harness({ offers: [first] });
    await h.hub.configure([definition]);
    await flush();
    const oldOffer = h.hub.createOffer(1, 'camera', true);
    await flush();
    assert.equal(h.pcs.length, 1);
    await h.hub.createOffer(1, 'camera', true);
    first.resolve();
    await oldOffer;
    assert.equal(h.hub.peers.size, 1);
    assert.deepEqual(h.signals.filter(row => row.type === 'offer').map(row => row.description.sdp), ['offer-1']);
    h.pcs[0].onicecandidate?.({ candidate: { candidate: 'obsolete' } });
    assert.equal(h.signals.filter(row => row.type === 'candidate').length, 0);
    h.hub.closeInput('camera');
  });

  await check('LIVE_HUB_UNCHANGED_CONFIGURATION_PRESERVES_SUBSCRIPTION_OK', async () => {
    const capture = deferred();
    const h = harness({ capture });
    await h.hub.configure([definition]);
    const offering = h.hub.createOffer(1, 'camera');
    await h.hub.configure([definition, { id: 'unused', type: 'device', active: false }]);
    capture.resolve(h.stream);
    await offering;
    assert.equal(h.starts(), 1);
    assert.equal(h.hub.peers.size, 1);
    assert.equal(h.signals.filter(row => row.type === 'offer').length, 1);
    h.hub.closeInput('camera');
  });

  await check('LIVE_HUB_CANCELED_ANSWER_CANNOT_REPORT_CAPTURE_ERROR_OK', async () => {
    const remote = deferred();
    const h = harness({ remote });
    await h.hub.configure([definition]);
    await h.hub.createOffer(1, 'camera');
    const answering = h.command({ type: 'signal', inputId: 'camera', payload: {
      consumerId: 1, inputId: 'camera', type: 'answer', description: { type: 'answer', sdp: 'answer' }
    } });
    await h.command({ type: 'unsubscribe', consumerId: 1, inputId: 'camera' });
    remote.resolve();
    await answering;
    assert.equal(h.statuses.filter(row => row.state === 'error').length, 0);
    assert.equal(h.hub.inputs.get('camera').stream, h.stream);
    h.hub.closeInput('camera');
  });

  console.log('LIVE_INPUT_HUB_TESTS_OK count=' + passed);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
