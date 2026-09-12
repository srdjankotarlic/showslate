(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateLiveThumbnails = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  const POSTER_WIDTH = 256;
  const POSTER_HEIGHT = 144;

  function text(value, fallback = '') {
    const clean = String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
    return clean || fallback;
  }

  function bounded(value, fallback, minimum, maximum) {
    return Number.isFinite(Number(value)) ? Math.max(minimum, Math.min(maximum, Number(value))) : fallback;
  }

  // Pure presentation data. Never reads or changes timer, transport, or Program state.
  function describe(layer = {}, options = {}) {
    const type = text(layer.type, 'source').toLowerCase();
    const label = text(layer.name || layer.sourceName, type);
    const source = text(layer.src);
    const poster = text(layer.thumbnail || layer.poster);
    const result = {
      type, label, kind: 'file', src: '', text: '', inputId: text(layer.inputId),
      color: text(layer.color, '#ffffff'), background: text(layer.bg, '#14171b'),
      time: bounded(layer.inPoint, 0, 0, Number.MAX_SAFE_INTEGER),
      page: Math.floor(bounded(layer.page, 1, 1, 100000)), key: ''
    };
    if (type === 'window' || type === 'capture') {
      result.kind = 'live';
      result.text = text(layer.sourceName, label);
    } else if (type === 'audio') {
      result.kind = 'audio';
    } else if (type === 'timer') {
      result.kind = 'timer';
      result.text = text(options.timerText, '00:00').slice(0, 40);
    } else if (type === 'text' || type === 'lowerthird') {
      result.kind = 'text';
      // Explicitly empty text stays empty: do not imply that the layer name is on air.
      result.text = type === 'lowerthird'
        ? text(options.lowerThirdText || layer.text, label).slice(0, 180)
        : String(Object.prototype.hasOwnProperty.call(layer, 'text') ? layer.text || '' : label).slice(0, 180);
    } else if (type === 'color' || type === 'blank') {
      result.kind = type;
      result.background = text(layer.color || layer.bg, '#000000');
    } else if (poster || ((type === 'image' || type === 'logo') && source)) {
      result.kind = 'image';
      result.src = poster || source;
    } else if (type === 'video' && source) {
      result.kind = 'video';
      result.src = source;
    }
    if (result.src && typeof options.resolveSource === 'function') result.src = text(options.resolveSource(result.src));
    if (type === 'pdf') result.text = String(result.page);
    result.key = JSON.stringify([result.kind, type, result.src, result.inputId, result.time, result.page]);
    return result;
  }

  function captureFrame(document, source, width, height) {
    if (!document || !width || !height) throw new Error('Thumbnail frame is unavailable.');
    const canvas = document.createElement('canvas');
    canvas.width = POSTER_WIDTH;
    canvas.height = POSTER_HEIGHT;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('Thumbnail canvas is unavailable.');
      const scale = Math.min(POSTER_WIDTH / width, POSTER_HEIGHT / height);
      const drawWidth = Math.max(1, Math.round(width * scale));
      const drawHeight = Math.max(1, Math.round(height * scale));
      context.fillStyle = '#101216';
      context.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
      context.drawImage(source, Math.round((POSTER_WIDTH - drawWidth) / 2), Math.round((POSTER_HEIGHT - drawHeight) / 2), drawWidth, drawHeight);
      const poster = canvas.toDataURL('image/jpeg', 0.76);
      if (!poster || poster === 'data:,') throw new Error('Thumbnail frame is unavailable.');
      return poster;
    } finally {
      // Release the backing buffer; cached JPEG strings are bounded separately.
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  // A paused, detached decoder extracts one still only. It never calls play(),
  // attaches a MediaStream, or uses the application's playback elements.
  function decodePoster(descriptor, { document, resolveSource, signal }) {
    return new Promise((resolve, reject) => {
      if (!document || !document.createElement) { reject(new Error('Thumbnail document is unavailable.')); return; }
      if (signal.aborted) { reject(new Error('Thumbnail cancelled.')); return; }
      const video = descriptor.kind === 'video';
      const element = document.createElement(video ? 'video' : 'img');
      const listeners = [];
      let settled = false;
      let metadataReady = false;
      let targetTime = descriptor.time || 0;
      const listen = (event, callback) => {
        element.addEventListener(event, callback);
        listeners.push([event, callback]);
      };
      const cleanup = () => {
        listeners.forEach(([event, callback]) => element.removeEventListener(event, callback));
        signal.removeEventListener('abort', abort);
        try {
          if (video) element.pause();
          element.removeAttribute('src');
          if (video) element.load();
        } catch (_) { /* A detached decoder may already have been released. */ }
      };
      const finish = (poster, error) => {
        if (settled) return;
        settled = true;
        cleanup();
        error ? reject(error) : resolve(poster);
      };
      const abort = () => finish('', new Error('Thumbnail cancelled.'));
      signal.addEventListener('abort', abort, { once: true });
      listen('error', () => finish('', new Error('Media could not be decoded for its thumbnail.')));
      const draw = () => {
        if (settled || signal.aborted) return;
        if (video && (!metadataReady || element.readyState < 2 || element.seeking || Math.abs(element.currentTime - targetTime) > 0.075)) return;
        try {
          finish(captureFrame(document, element, video ? element.videoWidth : element.naturalWidth, video ? element.videoHeight : element.naturalHeight));
        } catch (error) { finish('', error); }
      };
      try {
        if (video) {
          element.muted = true;
          element.defaultMuted = true;
          element.volume = 0;
          element.autoplay = false;
          element.controls = false;
          element.playsInline = true;
          element.disablePictureInPicture = true;
          element.disableRemotePlayback = true;
          element.preload = 'auto';
          listen('loadedmetadata', () => {
            if (settled) return;
            metadataReady = true;
            const duration = Number(element.duration);
            if (Number.isFinite(duration)) targetTime = Math.min(targetTime, Math.max(0, duration - 0.05));
            try {
              if (Math.abs(element.currentTime - targetTime) > 0.001) element.currentTime = targetTime;
              draw();
            } catch (error) { finish('', error); }
          });
          listen('loadeddata', draw);
          listen('seeked', draw);
        } else {
          element.decoding = 'async';
          listen('load', draw);
        }
        const source = typeof resolveSource === 'function' ? resolveSource(descriptor.src) : descriptor.src;
        if (!source) { finish('', new Error('Thumbnail source is unavailable.')); return; }
        if (/^https?:/i.test(source)) element.crossOrigin = 'anonymous';
        element.src = source;
      } catch (error) { finish('', error); }
    });
  }

  function createThumbnailQueue(options = {}) {
    const document = options.document || (typeof window !== 'undefined' ? window.document : null);
    const maximumEntries = Math.floor(bounded(options.maxEntries, 96, 1, 256));
    const maximumPending = Math.floor(bounded(options.maxPending, 256, 1, 512));
    const timeoutMs = bounded(options.timeoutMs, 5000, 20, 15000);
    const failureTtlMs = bounded(options.failureTtlMs, 30000, 0, 300000);
    const now = typeof options.now === 'function' ? options.now : Date.now;
    const loader = typeof options.load === 'function' ? options.load : decodePoster;
    const cache = new Map();
    const jobs = new Map();
    const pending = [];
    let active = null;
    let disposed = false;
    let scheduled = false;
    let generation = 0;

    function current(subscriber) {
      if (disposed || subscriber.cancelled || subscriber.generation !== generation) return false;
      try { return !subscriber.isCurrent || subscriber.isCurrent(); }
      catch (_) { return false; }
    }

    function notify(subscriber, poster, detail) {
      queueMicrotask(() => {
        if (!current(subscriber)) return;
        try { if (subscriber.onReady) subscriber.onReady(poster, detail); }
        catch (_) { /* A removed UI consumer must not stall the decoder queue. */ }
      });
    }

    function remember(key, entry) {
      cache.delete(key);
      cache.set(key, { ...entry, at: now() });
      while (cache.size > maximumEntries) cache.delete(cache.keys().next().value);
    }

    function cached(key) {
      const value = cache.get(key);
      if (!value) return null;
      if ((value.status === 'error' && now() - value.at >= failureTtlMs) ||
          (value.live && now() - value.at > 2000)) {
        cache.delete(key);
        return null;
      }
      cache.delete(key);
      cache.set(key, value);
      return value;
    }

    function schedule() {
      if (disposed || scheduled || active) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; pump(); });
    }

    function prune() {
      for (let index = pending.length - 1; index >= 0; index--) {
        const job = pending[index];
        job.subscribers = job.subscribers.filter(current);
        if (!job.subscribers.length) {
          pending.splice(index, 1);
          if (jobs.get(job.key) === job) jobs.delete(job.key);
        }
      }
    }

    function pump() {
      if (disposed || active) return;
      prune();
      const job = pending.shift();
      if (!job) return;
      active = job;
      const controller = new AbortController();
      job.controller = controller;
      let done = false;
      const finish = (poster, error, cancel = false) => {
        if (done) return;
        done = true;
        clearTimeout(job.timer);
        if (jobs.get(job.key) === job) jobs.delete(job.key);
        if (active === job) active = null;
        if (!disposed && !cancel) {
          const status = poster ? 'ready' : 'error';
          const entry = { poster: poster || '', status, error: error ? text(error.message || error).slice(0, 160) : '' };
          // Work whose entire deck disappeared is discarded, including its cache entry.
          if (job.subscribers.some(current)) {
            remember(job.key, entry);
            job.subscribers.forEach(subscriber => notify(subscriber, entry.poster, { status, key: job.key, cached: false, error: entry.error }));
          }
        }
        schedule();
      };
      job.cancel = () => {
        controller.abort();
        finish('', null, true);
      };
      job.timer = setTimeout(() => {
        controller.abort();
        finish('', new Error('Thumbnail timed out.'));
      }, timeoutMs);
      Promise.resolve().then(() => {
        if (controller.signal.aborted || disposed) return '';
        return loader(job.descriptor, { document, resolveSource: options.resolveSource, signal: controller.signal });
      }).then(poster => finish(typeof poster === 'string' ? poster : '', null), error => finish('', error));
    }

    function request(descriptor, callbacks = {}) {
      const subscriber = { isCurrent: callbacks.isCurrent, onReady: callbacks.onReady, cancelled: false, generation };
      let job = null;
      const cancel = () => {
        subscriber.cancelled = true;
        if (job && active === job && !job.subscribers.some(current)) job.cancel();
        else prune();
      };
      if (disposed || !descriptor || !descriptor.key || !current(subscriber)) return cancel;
      const saved = cached(descriptor.key);
      if (saved) {
        notify(subscriber, saved.poster, { key: descriptor.key, status: saved.status, cached: true, error: saved.error || '' });
        return cancel;
      }
      if (!['image', 'video'].includes(descriptor.kind) || !descriptor.src) {
        notify(subscriber, '', { key: descriptor.key, status: 'unavailable', cached: false });
        return cancel;
      }
      job = jobs.get(descriptor.key);
      if (job) {
        job.subscribers = job.subscribers.filter(current);
        // A deck can reuse a source, but repeated consumers must not grow an
        // unbounded callback list while a slow decoder is waiting for data.
        if (job.subscribers.length >= 512) {
          notify(subscriber, '', { key: descriptor.key, status: 'unavailable', cached: false, error: 'Thumbnail consumer limit reached.' });
          job = null;
          return cancel;
        }
        job.subscribers.push(subscriber);
        return cancel;
      }
      prune();
      if (pending.length >= maximumPending) {
        notify(subscriber, '', { key: descriptor.key, status: 'unavailable', cached: false, error: 'Thumbnail queue is full.' });
        return cancel;
      }
      job = { key: descriptor.key, descriptor: { ...descriptor }, subscribers: [subscriber], controller: null, timer: null, cancel: null };
      jobs.set(job.key, job);
      pending.push(job);
      schedule();
      return cancel;
    }

    function snapshot(descriptor, existingVideo) {
      if (disposed || !descriptor || descriptor.kind !== 'live' || !descriptor.inputId || !existingVideo) return '';
      // Only read an already-attached, muted consumer element. In particular, do
      // not attach(), ensure(), clone(), play(), stop(), or acquire anything here.
      if (existingVideo.muted !== true || existingVideo.readyState < 2 || !existingVideo.srcObject ||
          !existingVideo.dataset || String(existingVideo.dataset.liveInputId || '') !== descriptor.inputId) return '';
      const stream = existingVideo.srcObject;
      if (typeof stream.getVideoTracks !== 'function' || !stream.getVideoTracks().some(track => track.readyState === 'live')) return '';
      try {
        const poster = captureFrame(document, existingVideo, existingVideo.videoWidth, existingVideo.videoHeight);
        remember(descriptor.key, { poster, status: 'ready', live: true });
        return poster;
      } catch (_) { return ''; }
    }

    function clearPending() {
      generation++;
      for (const job of pending.splice(0)) {
        job.subscribers.forEach(subscriber => { subscriber.cancelled = true; });
        jobs.delete(job.key);
      }
      if (active) {
        active.subscribers.forEach(subscriber => { subscriber.cancelled = true; });
        active.cancel();
      }
    }

    return {
      request, snapshot,
      peek: key => { const entry = cached(key); return entry ? entry.poster : ''; },
      clearPending,
      dispose: () => { disposed = true; clearPending(); cache.clear(); },
      stats: () => ({ cached: cache.size, pending: pending.length, active: active ? 1 : 0, disposed })
    };
  }

  return { POSTER_WIDTH, POSTER_HEIGHT, describe, createThumbnailQueue };
});
