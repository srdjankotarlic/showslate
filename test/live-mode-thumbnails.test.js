'use strict';

const assert = require('assert');
const thumbnails = require('../src/live-mode/thumbnails.js');

const tick = () => new Promise(resolve => setImmediate(resolve));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
async function check(name, fn) {
  await fn();
  passed++;
  console.log(`${name}=true`);
}

function fixtureDocument({ fail = false, stall = false, duration = 10, tainted = false } = {}) {
  const elements = [];
  const drawing = [];
  const document = {
    createElement(type) {
      if (type === 'canvas') {
        const canvas = {
          type, width: 0, height: 0,
          getContext: () => ({
            fillRect: (...args) => drawing.push(['fill', ...args]),
            drawImage: (...args) => drawing.push(['draw', ...args])
          }),
          toDataURL: () => { if (tainted) throw new Error('Tainted canvas'); return 'data:image/jpeg;base64,frame'; }
        };
        elements.push(canvas);
        return canvas;
      }
      const listeners = new Map();
      let source = '';
      let currentTime = 0;
      const element = {
        type, readyState: 0, videoWidth: 1920, videoHeight: 1080, naturalWidth: 400, naturalHeight: 800,
        duration, seeking: false, pauseCount: 0, loadCount: 0, playCount: 0,
        addEventListener(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
        removeEventListener(event, fn) { listeners.get(event)?.delete(fn); },
        emit(event) { [...(listeners.get(event) || [])].forEach(fn => fn()); },
        removeAttribute(name) { if (name === 'src') source = ''; },
        play() { this.playCount++; throw new Error('Thumbnail playback is forbidden.'); },
        pause() { this.pauseCount++; },
        load() { this.loadCount++; },
        listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0)
      };
      Object.defineProperty(element, 'src', {
        get: () => source,
        set(value) {
          source = value;
          if (stall) return;
          queueMicrotask(() => {
            if (fail) { element.emit('error'); return; }
            if (type === 'video') {
              element.readyState = 1;
              element.emit('loadedmetadata');
              element.readyState = 2;
              element.emit('loadeddata');
            } else element.emit('load');
          });
        }
      });
      Object.defineProperty(element, 'currentTime', {
        get: () => currentTime,
        set(value) {
          currentTime = value;
          element.seeking = true;
          queueMicrotask(() => { element.seeking = false; element.readyState = 2; element.emit('seeked'); });
        }
      });
      elements.push(element);
      return element;
    }
  };
  return { document, elements, drawing };
}

function requestResult(queue, descriptor, additional = {}) {
  return new Promise(resolve => queue.request(descriptor, { ...additional, onReady: (poster, detail) => resolve({ poster, ...detail }) }));
}

async function run() {
  await check('LIVE_THUMBNAILS_DESCRIBE_MEDIA_AND_TRIM_CACHE_KEYS_OK', () => {
    const layer = { id: 'a', name: 'Film', type: 'video', src: 'clip.mp4', inPoint: 2.4, muted: false, playback: 'playing' };
    const before = JSON.stringify(layer);
    const video = thumbnails.describe(layer, { resolveSource: src => `file:///${src}` });
    assert.strictEqual(video.kind, 'video');
    assert.strictEqual(video.src, 'file:///clip.mp4');
    assert.strictEqual(video.time, 2.4);
    assert.notStrictEqual(video.key, thumbnails.describe({ ...layer, inPoint: 5 }).key);
    assert.strictEqual(thumbnails.describe({ ...layer, thumbnail: 'poster.png' }).kind, 'image');
    assert.strictEqual(thumbnails.describe({ type: 'logo', src: 'logo.png' }).kind, 'image');
    assert.strictEqual(JSON.stringify(layer), before);
  });

  await check('LIVE_THUMBNAILS_DESCRIBE_READ_ONLY_TEXT_TIMER_AND_LIVE_OK', () => {
    assert.strictEqual(thumbnails.describe({ type: 'text', text: 'Next speaker' }).text, 'Next speaker');
    assert.strictEqual(thumbnails.describe({ type: 'text', text: '', name: 'Not the content' }).text, '');
    assert.strictEqual(thumbnails.describe({ type: 'timer' }, { timerText: '09:23' }).text, '09:23');
    assert.strictEqual(thumbnails.describe({ type: 'lowerThird' }, { lowerThirdText: 'Alex · Host' }).text, 'Alex · Host');
    assert.strictEqual(thumbnails.describe({ type: 'audio' }).kind, 'audio');
    assert.strictEqual(thumbnails.describe({ type: 'blank' }).kind, 'blank');
    assert.strictEqual(thumbnails.describe({ type: 'pdf', src: 'slides.pdf', page: 4 }).text, '4');
    assert.strictEqual(thumbnails.describe({ type: 'pdf', src: 'slides.pdf', thumbnail: 'page.png' }).kind, 'image');
    const live = thumbnails.describe({ type: 'capture', inputId: 'camera-1' });
    assert.strictEqual(live.kind, 'live');
    assert.notStrictEqual(live.key, thumbnails.describe({ type: 'capture', inputId: 'camera-2' }).key);
    assert.strictEqual(thumbnails.describe({ type: 'video', src: 'a', inPoint: Infinity }).time, 0);
  });

  await check('LIVE_THUMBNAILS_DECODE_SEQUENTIALLY_AND_DEDUPLICATE_OK', async () => {
    let inFlight = 0, maximum = 0, loads = 0;
    const queue = thumbnails.createThumbnailQueue({ load: async descriptor => {
      loads++;
      maximum = Math.max(maximum, ++inFlight);
      await tick();
      inFlight--;
      return `poster:${descriptor.src}`;
    } });
    const a = thumbnails.describe({ type: 'image', src: 'a' });
    const b = thumbnails.describe({ type: 'video', src: 'b' });
    const results = await Promise.all([requestResult(queue, a), requestResult(queue, a), requestResult(queue, b)]);
    assert.deepStrictEqual(results.map(result => result.poster), ['poster:a', 'poster:a', 'poster:b']);
    assert.strictEqual(loads, 2);
    assert.strictEqual(maximum, 1);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_CACHE_IS_LRU_BOUNDED_AND_CALLBACKS_ASYNC_OK', async () => {
    let loads = 0;
    const queue = thumbnails.createThumbnailQueue({ maxEntries: 2, load: async descriptor => { loads++; return descriptor.src; } });
    const [a, b, c] = ['a', 'b', 'c'].map(src => thumbnails.describe({ type: 'image', src }));
    await requestResult(queue, a);
    await requestResult(queue, b);
    assert.strictEqual(queue.peek(a.key), 'a');
    await requestResult(queue, c);
    assert.strictEqual(queue.peek(b.key), '');
    let synchronous = true, called = false;
    queue.request(a, { onReady: (poster, detail) => { called = true; assert.strictEqual(synchronous, false); assert.strictEqual(detail.cached, true); } });
    synchronous = false;
    await tick();
    assert.strictEqual(called, true);
    assert.strictEqual(loads, 3);
    assert.strictEqual(queue.stats().cached, 2);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_FAILURES_BACK_OFF_AND_CAN_RETRY_OK', async () => {
    let clock = 0, loads = 0;
    const queue = thumbnails.createThumbnailQueue({ now: () => clock, failureTtlMs: 50, load: async () => { if (++loads === 1) throw new Error('Decode failed'); return 'recovered'; } });
    const descriptor = thumbnails.describe({ type: 'video', src: 'offline.mp4' });
    assert.strictEqual((await requestResult(queue, descriptor)).status, 'error');
    assert.strictEqual((await requestResult(queue, descriptor)).cached, true);
    assert.strictEqual(loads, 1);
    clock = 51;
    assert.strictEqual((await requestResult(queue, descriptor)).poster, 'recovered');
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_DROP_STALE_QUEUED_AND_ACTIVE_UI_WORK_OK', async () => {
    let release, loaded = [], connected = true, called = 0;
    const queue = thumbnails.createThumbnailQueue({ load: descriptor => { loaded.push(descriptor.src); return new Promise(resolve => { release = resolve; }); } });
    const a = thumbnails.describe({ type: 'image', src: 'a' });
    const b = thumbnails.describe({ type: 'image', src: 'b' });
    queue.request(a, { isCurrent: () => connected, onReady: () => called++ });
    queue.request(b, { isCurrent: () => connected, onReady: () => called++ });
    await tick();
    connected = false;
    release('stale');
    await tick();
    assert.deepStrictEqual(loaded, ['a']);
    assert.strictEqual(called, 0);
    assert.strictEqual(queue.stats().cached, 0);
    assert.strictEqual(queue.stats().pending, 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_CANCEL_ONLY_RELEASES_UNSHARED_DECODER_OK', async () => {
    let release, signal;
    const queue = thumbnails.createThumbnailQueue({ load: (_, options) => { signal = options.signal; return new Promise(resolve => { release = resolve; }); } });
    const descriptor = thumbnails.describe({ type: 'image', src: 'a' });
    const cancelA = queue.request(descriptor, { onReady: () => assert.fail('Cancelled subscriber called') });
    const second = requestResult(queue, descriptor);
    await tick();
    cancelA();
    assert.strictEqual(signal.aborted, false);
    release('kept');
    assert.strictEqual((await second).poster, 'kept');
    const cancelC = queue.request(thumbnails.describe({ type: 'video', src: 'c' }));
    await tick();
    cancelC();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(queue.stats().active, 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_PENDING_WORK_IS_BOUNDED_OK', async () => {
    let loads = 0;
    const queue = thumbnails.createThumbnailQueue({ maxPending: 2, load: async descriptor => { loads++; return descriptor.src; } });
    const results = await Promise.all(['a', 'b', 'c'].map(src => requestResult(queue, thumbnails.describe({ type: 'image', src }))));
    assert.strictEqual(results[2].status, 'unavailable');
    assert.strictEqual(loads, 2);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_CLEAR_PENDING_AND_DISPOSE_SUPPRESS_CALLBACKS_OK', async () => {
    let calls = 0, signal;
    const queue = thumbnails.createThumbnailQueue({ load: (_, options) => { signal = options.signal; return new Promise(() => {}); } });
    queue.request(thumbnails.describe({ type: 'image', src: 'a' }), { onReady: () => calls++ });
    queue.request(thumbnails.describe({ type: 'image', src: 'b' }), { onReady: () => calls++ });
    await tick();
    queue.clearPending();
    assert.strictEqual(signal.aborted, true);
    assert.strictEqual(queue.stats().pending, 0);
    assert.strictEqual(queue.stats().active, 0);
    queue.dispose();
    await tick();
    assert.strictEqual(calls, 0);
    assert.deepStrictEqual(queue.stats(), { pending: 0, active: 0, cached: 0, disposed: true });
  });

  await check('LIVE_THUMBNAILS_CLEAR_PENDING_INVALIDATES_CACHED_CALLBACKS_OK', async () => {
    const queue = thumbnails.createThumbnailQueue({ load: async () => 'cached' });
    const descriptor = thumbnails.describe({ type: 'image', src: 'a' });
    await requestResult(queue, descriptor);
    queue.request(descriptor, { onReady: () => assert.fail('Cleared cached consumer called') });
    queue.clearPending();
    await tick();
    assert.strictEqual((await requestResult(queue, descriptor)).poster, 'cached');
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_SHARED_SOURCE_CONSUMERS_ARE_BOUNDED_OK', async () => {
    const queue = thumbnails.createThumbnailQueue({ load: async () => 'shared' });
    const descriptor = thumbnails.describe({ type: 'image', src: 'shared' });
    const results = await Promise.all(Array.from({ length: 513 }, () => requestResult(queue, descriptor)));
    assert.strictEqual(results.filter(result => result.status === 'ready').length, 512);
    assert.strictEqual(results.at(-1).status, 'unavailable');
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_IMAGE_POSTER_FITS_AND_RELEASES_RESOURCES_OK', async () => {
    const fixture = fixtureDocument();
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document, resolveSource: src => `file:///${src}` });
    const result = await requestResult(queue, thumbnails.describe({ type: 'image', src: 'portrait.png' }));
    assert.strictEqual(result.status, 'ready');
    const image = fixture.elements.find(element => element.type === 'img');
    const canvas = fixture.elements.find(element => element.type === 'canvas');
    assert.strictEqual(image.src, '');
    assert.strictEqual(image.listenerCount(), 0);
    assert.strictEqual(canvas.width, 0);
    assert.strictEqual(canvas.height, 0);
    assert.deepStrictEqual(fixture.drawing.find(row => row[0] === 'draw').slice(2), [92, 0, 72, 144]);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_VIDEO_SEEKS_IN_POINT_WITHOUT_PLAYBACK_OR_AUDIO_OK', async () => {
    const fixture = fixtureDocument();
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document });
    const descriptor = thumbnails.describe({ type: 'video', src: 'clip.mp4', inPoint: 3 });
    assert.strictEqual((await requestResult(queue, descriptor)).status, 'ready');
    const video = fixture.elements.find(element => element.type === 'video');
    assert.strictEqual(video.currentTime, 3);
    assert.strictEqual(video.playCount, 0);
    assert.strictEqual(video.muted, true);
    assert.strictEqual(video.defaultMuted, true);
    assert.strictEqual(video.volume, 0);
    assert.strictEqual(video.autoplay, false);
    assert.strictEqual(video.src, '');
    assert.strictEqual(video.pauseCount, 1);
    assert.strictEqual(video.loadCount, 1);
    assert.strictEqual(video.listenerCount(), 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_VIDEO_ZERO_AND_END_IN_POINTS_DO_NOT_STALL_OK', async () => {
    for (const inPoint of [0, 500]) {
      const fixture = fixtureDocument({ duration: 5 });
      const queue = thumbnails.createThumbnailQueue({ document: fixture.document });
      assert.strictEqual((await requestResult(queue, thumbnails.describe({ type: 'video', src: 'clip.mp4', inPoint }))).status, 'ready');
      const video = fixture.elements.find(element => element.type === 'video');
      assert.strictEqual(video.currentTime, inPoint ? 4.95 : 0);
      queue.dispose();
    }
  });

  await check('LIVE_THUMBNAILS_DECODE_ERRORS_AND_TAINT_RELEASE_DECODERS_OK', async () => {
    for (const options of [{ fail: true }, { tainted: true }]) {
      const fixture = fixtureDocument(options);
      const queue = thumbnails.createThumbnailQueue({ document: fixture.document });
      const result = await requestResult(queue, thumbnails.describe({ type: 'video', src: 'clip.mp4' }));
      assert.strictEqual(result.status, 'error');
      assert.strictEqual(result.poster, '');
      const video = fixture.elements.find(element => element.type === 'video');
      assert.strictEqual(video.src, '');
      assert.strictEqual(video.listenerCount(), 0);
      assert.strictEqual(video.playCount, 0);
      queue.dispose();
    }
  });

  await check('LIVE_THUMBNAILS_TIMEOUT_RELEASES_DECODER_AND_CONTINUES_QUEUE_OK', async () => {
    const fixture = fixtureDocument({ stall: true });
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document, timeoutMs: 20 });
    const result = await requestResult(queue, thumbnails.describe({ type: 'video', src: 'stalled.mp4' }));
    assert.strictEqual(result.status, 'error');
    assert.match(result.error, /timed out/i);
    const video = fixture.elements.find(element => element.type === 'video');
    assert.strictEqual(video.src, '');
    assert.strictEqual(video.listenerCount(), 0);
    assert.strictEqual(queue.stats().active, 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_ABORT_RELEASES_DEFAULT_DECODER_OK', async () => {
    const fixture = fixtureDocument({ stall: true });
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document });
    const cancel = queue.request(thumbnails.describe({ type: 'video', src: 'stalled.mp4' }), { onReady: () => assert.fail('Aborted UI consumer called') });
    await tick();
    cancel();
    const video = fixture.elements.find(element => element.type === 'video');
    assert.strictEqual(video.src, '');
    assert.strictEqual(video.listenerCount(), 0);
    assert.strictEqual(video.pauseCount, 1);
    await tick();
    assert.strictEqual(queue.stats().cached, 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_LIVE_SNAPSHOT_ONLY_READS_EXISTING_MUTED_STREAM_OK', () => {
    const fixture = fixtureDocument();
    let clock = 0;
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document, now: () => clock });
    const descriptor = thumbnails.describe({ type: 'capture', inputId: 'camera' });
    const track = { readyState: 'live', stop: () => assert.fail('Shared capture track stopped') };
    const source = { getVideoTracks: () => [track] };
    const video = {
      muted: true, readyState: 2, srcObject: source, dataset: { liveInputId: 'camera' }, videoWidth: 1920, videoHeight: 1080,
      play: () => assert.fail('Shared video played'), pause: () => assert.fail('Shared video paused')
    };
    assert.strictEqual(queue.snapshot(descriptor, video), 'data:image/jpeg;base64,frame');
    assert.strictEqual(queue.peek(descriptor.key), 'data:image/jpeg;base64,frame');
    assert.strictEqual(video.srcObject, source);
    assert.deepStrictEqual(fixture.elements.map(element => element.type), ['canvas']);
    clock = 2001;
    assert.strictEqual(queue.peek(descriptor.key), '');
    queue.dispose();
    assert.strictEqual(video.srcObject, source);
  });

  await check('LIVE_THUMBNAILS_LIVE_UNAVAILABLE_OR_WRONG_SOURCE_NEVER_ACQUIRES_OK', async () => {
    const fixture = fixtureDocument();
    let loads = 0;
    const queue = thumbnails.createThumbnailQueue({ document: fixture.document, load: async () => { loads++; return ''; } });
    const descriptor = thumbnails.describe({ type: 'window', inputId: 'window-1' });
    const base = { muted: true, readyState: 2, srcObject: { getVideoTracks: () => [{ readyState: 'live' }] }, dataset: { liveInputId: 'window-1' }, videoWidth: 200, videoHeight: 100 };
    for (const video of [null, { ...base, muted: false }, { ...base, readyState: 1 }, { ...base, srcObject: null }, { ...base, dataset: { liveInputId: 'other' } }, { ...base, srcObject: { getVideoTracks: () => [{ readyState: 'ended' }] } }]) {
      assert.strictEqual(queue.snapshot(descriptor, video), '');
    }
    assert.strictEqual((await requestResult(queue, descriptor)).status, 'unavailable');
    assert.strictEqual(loads, 0);
    assert.strictEqual(fixture.elements.length, 0);
    queue.dispose();
  });

  await check('LIVE_THUMBNAILS_CALLBACK_ERRORS_DO_NOT_STALL_FOLLOWING_WORK_OK', async () => {
    const queue = thumbnails.createThumbnailQueue({ load: async descriptor => descriptor.src });
    queue.request(thumbnails.describe({ type: 'image', src: 'a' }), { onReady: () => { throw new Error('Detached UI'); } });
    assert.strictEqual((await requestResult(queue, thumbnails.describe({ type: 'image', src: 'b' }))).poster, 'b');
    queue.dispose();
    await wait(1);
  });

  console.log(`LIVE_MODE_THUMBNAILS_TESTS_OK count=${passed}`);
}

run().catch(error => { console.error(error); process.exitCode = 1; });
