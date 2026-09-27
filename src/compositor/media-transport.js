(function (root, factory) {
  const api = factory(root && root.ShowSlateCompositor);
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateMediaTransport = api;
})(typeof window !== 'undefined' ? window : globalThis, function (compositor) {
  'use strict';

  function finite(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function mediaDuration(element) {
    return Number.isFinite(element && element.duration) && element.duration > 0 ? element.duration : 0;
  }

  function seek(element, position) {
    const duration = mediaDuration(element);
    const maximum = duration > 0 ? Math.max(0, duration - 0.001) : Math.max(0, finite(position));
    const target = Math.max(0, Math.min(maximum, finite(position)));
    try {
      if (Math.abs(finite(element.currentTime) - target) > 0.035) element.currentTime = target;
    } catch (_) {}
    return target;
  }

  function play(element) {
    const request = element.play();
    if (request && request.catch) request.catch(() => { element.dataset.playBlocked = 'true'; });
  }

  function bind(element, rawLayer = {}, options = {}) {
    if (!element || !compositor) return () => {};
    const layer = compositor.normalizeLayer(rawLayer);
    const signature = JSON.stringify([element.getAttribute ? element.getAttribute('src') : element.src,
      layer.id, layer.playbackState, layer.playbackPosition, layer.playbackUpdatedAt,
      layer.playbackRate, layer.inPoint, layer.outPoint, layer.endBehavior]);
    const unchanged = element.__showSlateTransportSignature === signature;
    if (typeof element.__showSlateTransportCleanup === 'function') element.__showSlateTransportCleanup();
    element.__showSlateTransportSignature = signature;
    const cleanups = [];
    let settling = false;

    element.controls = false;
    element.disablePictureInPicture = true;
    element.playsInline = true;
    element.preload = options.preload || 'auto';
    element.loop = false;
    element.playbackRate = layer.playbackRate;
    element.volume = Math.max(0, Math.min(1, finite(options.volume, layer.volume)));
    element.muted = options.muted === true;
    element.defaultMuted = element.muted;
    element.dataset.transportLayerId = String(layer.id || '');

    const sinkId = String(options.sinkId || '');
    if (!element.muted && typeof element.setSinkId === 'function' && String(element.sinkId || '') !== sinkId) {
      try { Promise.resolve(element.setSinkId(sinkId)).catch(() => {}); } catch (_) {}
    }

    function resolved(now = Date.now()) {
      return compositor.resolveMediaPlayback(layer, now, mediaDuration(element));
    }

    function mark(state) {
      element.dataset.playbackState = state;
      if (typeof options.onState === 'function') options.onState(state, element);
    }

    function apply() {
      const runtime = resolved();
      element.playbackRate = runtime.playbackRate;
      seek(element, runtime.position);
      if (runtime.state === 'playing') {
        mark('playing');
        play(element);
      } else {
        element.pause();
        mark(runtime.state);
      }
    }

    function atOut() {
      if (settling || layer.playbackState !== 'playing') return;
      const bounds = compositor.mediaPlaybackBounds(layer, mediaDuration(element));
      if (!(bounds.end > bounds.start) || finite(element.currentTime) < bounds.end - 0.035) return;
      settling = true;
      if (layer.endBehavior === 'loop') {
        seek(element, bounds.start);
        mark('playing');
        play(element);
      } else if (layer.endBehavior === 'hold') {
        seek(element, Math.max(bounds.start, bounds.end - 0.04));
        element.pause();
        mark('paused');
      } else {
        seek(element, bounds.start);
        element.pause();
        mark('stopped');
      }
      queueMicrotask(() => { settling = false; });
    }

    function listen(name, handler, settings) {
      element.addEventListener(name, handler, settings);
      cleanups.push(() => element.removeEventListener(name, handler, settings));
    }

    listen('loadedmetadata', apply, { once: true });
    listen('durationchange', apply, { once: true });
    listen('timeupdate', atOut);
    listen('ended', atOut);
    // timeupdate may be hundreds of milliseconds apart. Check each decoded
    // frame too so a trimmed OUT point does not wait for the next coarse event.
    if (typeof element.requestVideoFrameCallback === 'function' && layer.playbackState === 'playing') {
      let frameRequest;
      let disposed = false;
      const frame = () => {
        if (disposed) return;
        atOut();
        frameRequest = element.requestVideoFrameCallback(frame);
      };
      frameRequest = element.requestVideoFrameCallback(frame);
      cleanups.push(() => {
        disposed = true;
        if (typeof element.cancelVideoFrameCallback === 'function') element.cancelVideoFrameCallback(frameRequest);
      });
    }
    listen('playing', () => { delete element.dataset.playBlocked; mark('playing'); });
    listen('pause', () => {
      if (!settling && element.dataset.playbackState === 'playing') mark('paused');
    });
    // Audio routing and faders may rebind while playing. Only a transport
    // command should seek; rebinding the same clock must preserve the decoder.
    if (element.readyState >= 1 && !unchanged) apply();

    const cleanup = () => {
      cleanups.splice(0).forEach(remove => remove());
      if (element.__showSlateTransportCleanup === cleanup) {
        delete element.__showSlateTransportCleanup;
        delete element.__showSlateTransportSignature;
      }
    };
    element.__showSlateTransportCleanup = cleanup;
    return cleanup;
  }

  return { bind, mediaDuration, seek };
});
