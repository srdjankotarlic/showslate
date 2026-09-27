'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const compositor = require('../src/compositor/model');
const context = vm.createContext({ module: { exports: {} }, ShowSlateCompositor: compositor, queueMicrotask });
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/compositor/media-transport.js'), 'utf8'), context);
const transport = context.module.exports;

class Media extends EventTarget {
  constructor() {
    super();
    this.dataset = {};
    this.currentTime = 0;
    this.duration = 30;
    this.readyState = 1;
    this.paused = true;
    this.playCalls = 0;
    this.sinks = [];
    this.sinkId = '';
  }
  play() { this.playCalls++; this.paused = false; return Promise.resolve(); }
  pause() { this.paused = true; }
  setSinkId(id) { this.sinks.push(id); this.sinkId = id; return Promise.resolve(); }
  emit(name) { this.dispatchEvent(new Event(name)); }
}

let passed = 0;
function check(name, fn) { fn(); passed++; console.log(name); }
const layer = { id: 'clip', type: 'video', inPoint: 10, outPoint: 14, playbackUpdatedAt: 0, endBehavior: 'loop' };

check('MEDIA_PAUSED_SEEK_NEAR_OUT_REMAINS_PAUSED_OK', () => {
  const media = new Media();
  const cleanup = transport.bind(media, { ...layer, playbackState: 'paused', playbackPosition: 13.98 }, { muted: true });
  media.emit('timeupdate');
  assert.equal(media.currentTime, 13.98, 'A paused seek must retain the requested frame.');
  assert.equal(media.playCalls, 0, 'A paused loop must not restart at the OUT threshold.');
  assert.equal(media.dataset.playbackState, 'paused');
  assert.equal(media.muted, true);
  cleanup();
});

for (const endBehavior of ['loop', 'hold', 'stop']) {
  check('MEDIA_PLAYING_OUT_' + endBehavior.toUpperCase() + '_OK', () => {
    const media = new Media();
    const cleanup = transport.bind(media, { ...layer, playbackState: 'playing', playbackPosition: 12, endBehavior });
    media.currentTime = 14;
    media.emit('timeupdate');
    assert.equal(media.dataset.playbackState, endBehavior === 'loop' ? 'playing' : endBehavior === 'hold' ? 'paused' : 'stopped');
    assert.equal(media.paused, endBehavior !== 'loop');
    assert.equal(media.currentTime, endBehavior === 'hold' ? 13.96 : 10);
    cleanup();
  });
}

check('MEDIA_AUDIO_CAN_RETURN_TO_SYSTEM_DEFAULT_OK', () => {
  const media = new Media();
  transport.bind(media, layer, { muted: false, sinkId: 'selected-output' });
  transport.bind(media, layer, { muted: false, sinkId: '' });
  const cleanup = transport.bind(media, layer, { muted: false, sinkId: '' });
  assert.deepEqual(media.sinks, ['selected-output', '']);
  cleanup();
});

check('MEDIA_REBIND_REMOVES_OLD_TRANSPORT_LISTENERS_OK', () => {
  const media = new Media();
  transport.bind(media, { ...layer, playbackState: 'playing', playbackPosition: 12 });
  const cleanup = transport.bind(media, { ...layer, playbackState: 'paused', playbackPosition: 13.98 });
  const playCalls = media.playCalls;
  media.emit('timeupdate');
  assert.equal(media.playCalls, playCalls);
  cleanup();
  assert.equal(media.__showSlateTransportCleanup, undefined);
});

check('MEDIA_AUDIO_ONLY_UPDATE_DOES_NOT_SEEK_OK', () => {
  const media = new Media();
  const playing = { ...layer, playbackState: 'playing', playbackPosition: 10 };
  transport.bind(media, playing, { muted: true, volume: .8 });
  media.currentTime = 12;
  const cleanup = transport.bind(media, playing, { muted: false, volume: .2 });
  assert.equal(media.currentTime, 12, 'Moving a fader must not rewind a playing decoder.');
  assert.equal(media.volume, .2);
  cleanup();
});

check('MEDIA_OUT_CHECKS_DECODED_FRAMES_AND_CANCELS_ON_RELEASE_OK', () => {
  const media = new Media();
  let callback, canceled;
  media.requestVideoFrameCallback = fn => { callback = fn; return 42; };
  media.cancelVideoFrameCallback = id => { canceled = id; };
  const cleanup = transport.bind(media, { ...layer, playbackState: 'playing', playbackPosition: 12, endBehavior: 'hold' });
  media.currentTime = 14;
  callback();
  assert.equal(media.paused, true);
  assert.equal(media.dataset.playbackState, 'paused');
  cleanup();
  assert.equal(canceled, 42);
});

console.log('MEDIA_TRANSPORT_TESTS_OK count=' + passed);
