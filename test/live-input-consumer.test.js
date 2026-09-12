'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(options = {}) {
  const timers = new Map();
  const pcs = [];
  const signals = [];
  let timerId = 0;
  class Stream {
    constructor() { this.tracks = []; }
    getTracks() { return this.tracks; }
    getVideoTracks() { return this.tracks.filter(track => track.kind === 'video'); }
    getAudioTracks() { return this.tracks.filter(track => track.kind === 'audio'); }
    addTrack(track) { this.tracks.push(track); }
  }
  class Peer {
    constructor() { this.candidates = []; this.connectionState = 'new'; pcs.push(this); }
    async setRemoteDescription(description) {
      if (options.remote) await options.remote.promise;
      this.remoteDescription = description;
    }
    async addIceCandidate(candidate) { this.candidates.push(candidate); }
    async createAnswer() { return { type: 'answer', sdp: 'answer' }; }
    async setLocalDescription(description) { this.localDescription = description; }
    close() { this.connectionState = 'closed'; }
  }
  const context = vm.createContext({
    module: { exports: {} }, RTCPeerConnection: Peer, MediaStream: Stream, queueMicrotask,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/live-input/consumer.js'), 'utf8'), context);
  const subscriptions = [];
  const api = {
    async liveInputSubscribe(id) {
      subscriptions.push(id);
      return options.subscribe ? options.subscribe(id) : { ok: true };
    },
    liveInputUnsubscribe() {},
    async liveInputSignalToHub(payload) { signals.push(payload); }
  };
  const consumer = new context.module.exports.LiveInputConsumer(api);
  return { consumer, pcs, signals, timers, subscriptions };
}

const offer = { inputId: 'camera', type: 'offer', description: { type: 'offer', sdp: 'offer' } };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let passed = 0;
async function check(name, fn) { await fn(); passed++; console.log(name); }

async function main() {
  await check('LIVE_CONSUMER_ICE_DURING_REMOTE_DESCRIPTION_OK', async () => {
    const remote = deferred();
    const { consumer, pcs } = harness({ remote });
    consumer.desired.add('camera');
    await consumer.handleSignal({ inputId: 'camera', type: 'candidate', candidate: { candidate: 'before-offer' } });
    const connecting = consumer.handleSignal(offer);
    await consumer.handleSignal({ inputId: 'camera', type: 'candidate', candidate: { candidate: 'during-description' } });
    remote.resolve();
    await connecting;
    assert.deepEqual(pcs[0].candidates.map(row => row.candidate), ['before-offer', 'during-description']);
    consumer.dispose();
  });

  await check('LIVE_CONSUMER_TRANSIENT_SUBSCRIBE_RETRIES_OK', async () => {
    let attempts = 0;
    const { consumer, timers, subscriptions } = harness({ subscribe: async () => ({ ok: ++attempts > 1 }) });
    consumer.sync(['camera']);
    await flush();
    assert.equal(timers.size, 1, 'A temporarily unavailable hub must schedule a retry.');
    const [id, timer] = timers.entries().next().value;
    timers.delete(id); timer.fn();
    await flush();
    assert.equal(subscriptions.length, 2);
    consumer.dispose();
    assert.equal(timers.size, 0);
  });

  await check('LIVE_CONSUMER_CAPTURE_ERROR_REQUIRES_RECOVERY_OK', async () => {
    const { consumer, timers, subscriptions } = harness();
    consumer.sync(['camera']);
    await flush();
    consumer.handleStatus({ inputId: 'camera', state: 'error', error: 'Permission denied.' });
    consumer.sync(['camera']);
    await flush();
    assert.equal(timers.size, 0);
    assert.equal(subscriptions.length, 1);
    consumer.handleStatus({ inputId: 'camera', state: 'restarting' });
    await flush();
    assert.equal(subscriptions.length, 2);
    consumer.dispose();
  });

  await check('LIVE_CONSUMER_CANCEL_PENDING_SUBSCRIPTION_OK', async () => {
    const subscription = deferred();
    const { consumer, timers } = harness({ subscribe: () => subscription.promise });
    consumer.sync(['camera']);
    consumer.sync([]);
    subscription.resolve({ ok: true });
    await flush();
    assert.equal(consumer.peers.size, 0);
    assert.equal(timers.size, 0, 'A completed obsolete subscribe must not leave an offer timeout.');
  });

  await check('LIVE_CONSUMER_CANCEL_PENDING_OFFER_OK', async () => {
    const remote = deferred();
    const { consumer, signals } = harness({ remote });
    consumer.desired.add('camera');
    const connecting = consumer.handleSignal(offer);
    consumer.sync([]);
    remote.resolve();
    await connecting;
    assert.equal(signals.length, 0, 'A removed source must not send an obsolete answer.');
    assert.equal(consumer.streams.size, 0);
  });

  await check('LIVE_CONSUMER_NEGOTIATION_FAILURE_RETRIES_OK', async () => {
    const remote = deferred();
    const { consumer, timers, pcs } = harness({ remote });
    consumer.desired.add('camera');
    const connecting = consumer.handleSignal(offer);
    remote.reject(new Error('Temporary negotiation failure.'));
    await connecting;
    assert.equal(pcs[0].connectionState, 'closed');
    assert.equal(consumer.peers.get('camera').blockedByError, false);
    assert.equal(timers.size, 1);
    consumer.dispose();
    assert.equal(timers.size, 0);
  });

  await check('LIVE_CONSUMER_RECOVERY_CLEARS_OLD_ERROR_OK', async () => {
    const { consumer, pcs } = harness();
    consumer.desired.add('camera');
    consumer.handleStatus({ inputId: 'camera', state: 'error', error: 'Old transport error.' });
    await consumer.handleSignal(offer);
    pcs[0].ontrack({ track: { id: 'video', kind: 'video', stop() {} } });
    assert.equal(consumer.statusSnapshot()[0].state, 'live');
    assert.equal(consumer.statusSnapshot()[0].error, '');
    consumer.dispose();
  });

  await check('LIVE_CONSUMER_REMOVAL_CANCELS_QUEUED_RECOVERY_OK', async () => {
    const { consumer, subscriptions } = harness();
    consumer.sync(['camera']);
    await flush();
    consumer.handleStatus({ inputId: 'camera', state: 'error' });
    consumer.handleStatus({ inputId: 'camera', state: 'restarting' });
    consumer.sync([]);
    await flush();
    assert.equal(subscriptions.length, 1, 'A queued recovery must not resubscribe after scene removal.');
    assert.equal(consumer.peers.size, 0);
  });

  console.log('LIVE_INPUT_CONSUMER_TESTS_OK count=' + passed);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
