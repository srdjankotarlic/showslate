(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.ShowSlateLiveInput = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';

  class LiveInputConsumer {
    constructor(api, options = {}) {
      this.api = api || {};
      this.label = String(options.label || 'renderer');
      this.peers = new Map();
      this.streams = new Map();
      this.elements = new Map();
      this.desired = new Set();
      this.statuses = new Map();
      this.onStatus = typeof options.onStatus === 'function' ? options.onStatus : null;
      if (typeof this.api.onLiveInputSignal === 'function') this.api.onLiveInputSignal(payload => this.handleSignal(payload).catch(error => {
        this.handleStatus({ inputId: String(payload && payload.inputId || ''), state: 'error', error: String(error && error.message || error) });
      }));
      if (typeof this.api.onLiveInputStatus === 'function') this.api.onLiveInputStatus(payload => this.handleStatus(payload));
    }

    peerRecord() {
      return {
        pc: null,
        stream: null,
        pendingCandidates: [],
        subscribing: false,
        awaitingOffer: false,
        retryTimer: null,
        disconnectTimer: null,
        retryCount: 0,
        blockedByError: false
      };
    }

    handleStatus(payload) {
      const rows = Array.isArray(payload) ? payload : [payload];
      rows.forEach(row => {
        if (!row || !row.inputId) return;
        const id = String(row.inputId);
        this.statuses.set(id, { ...(this.statuses.get(id) || {}), ...row, inputId: id });
        const record = this.peers.get(id);
        if (!record) return;
        const state = String(row.state || '');
        if (state === 'error') {
          record.blockedByError = true;
          record.awaitingOffer = false;
          if (record.retryTimer) clearTimeout(record.retryTimer);
          record.retryTimer = null;
        } else if (['starting', 'restarting', 'live'].includes(state)) {
          const wasBlocked = record.blockedByError;
          record.blockedByError = false;
          if (wasBlocked && this.desired.has(id) && !record.pc && !record.subscribing && !record.awaitingOffer) {
            queueMicrotask(() => this.ensure(id));
          }
        }
      });
      if (this.onStatus) this.onStatus(this.statusSnapshot());
    }

    statusSnapshot() {
      return [...this.statuses.values()].map(row => ({ ...row }));
    }

    async ensure(inputId) {
      const id = String(inputId || '');
      if (!id || typeof this.api.liveInputSubscribe !== 'function') return;
      let record = this.peers.get(id);
      if (!record) {
        record = this.peerRecord();
        this.peers.set(id, record);
      }
      if (record.pc || record.subscribing || record.awaitingOffer || record.blockedByError) return;
      record.subscribing = true;
      try {
        const result = await this.api.liveInputSubscribe(id);
        if (!result || result.ok !== true) throw new Error(result && result.error || 'Live input service is not ready.');
        if (record.pc) return;
        record.awaitingOffer = true;
        record.retryTimer = setTimeout(() => {
          record.retryTimer = null;
          if (this.peers.get(id) !== record || record.pc) return;
          record.awaitingOffer = false;
          this.scheduleRetry(id, record);
        }, 2500);
      }
      catch (error) {
        this.handleStatus({ inputId: id, state: 'error', error: String(error && error.message || error) });
        this.scheduleRetry(id, record);
      } finally {
        record.subscribing = false;
      }
    }

    scheduleRetry(inputId, record) {
      const id = String(inputId || '');
      if (!record || this.peers.get(id) !== record || !this.desired.has(id) || record.retryTimer || record.blockedByError) return;
      const delay = Math.min(2000, 200 + record.retryCount * 250);
      record.retryCount += 1;
      record.retryTimer = setTimeout(() => {
        record.retryTimer = null;
        if (this.desired.has(id)) this.ensure(id);
      }, delay);
    }

    async handleSignal(payload) {
      const inputId = String(payload && payload.inputId || '');
      if (!inputId || !this.desired.has(inputId)) return;
      let record = this.peers.get(inputId);
      if (!record) {
        record = this.peerRecord();
        this.peers.set(inputId, record);
      }
      if (payload.type === 'offer' && payload.description) {
        if (record.retryTimer) clearTimeout(record.retryTimer);
        if (record.disconnectTimer) clearTimeout(record.disconnectTimer);
        record.retryTimer = null;
        record.disconnectTimer = null;
        record.awaitingOffer = false;
        record.retryCount = 0;
        record.blockedByError = false;
        const queuedCandidates = record.pendingCandidates.splice(0);
        if (record.pc) record.pc.close();
        const pc = new RTCPeerConnection({ iceServers: [] });
        record.pc = pc;
        record.stream = new MediaStream();
        this.streams.set(inputId, record.stream);
        this.refreshElements(inputId);
        record.pendingCandidates = [];
        pc.ontrack = event => {
          if (this.peers.get(inputId) !== record || record.pc !== pc) return;
          const incoming = event.streams && event.streams[0];
          const tracks = incoming && typeof incoming.getTracks === 'function' ? incoming.getTracks() : [event.track];
          tracks.forEach(track => {
            if (!record.stream.getTracks().some(existing => existing.id === track.id)) record.stream.addTrack(track);
          });
          const stream = record.stream;
          this.refreshElements(inputId);
          this.handleStatus({ inputId, state: 'live', hasVideo: stream.getVideoTracks().length > 0, hasAudio: stream.getAudioTracks().length > 0 });
        };
        pc.onicecandidate = event => {
          if (event.candidate && typeof this.api.liveInputSignalToHub === 'function') {
            this.api.liveInputSignalToHub({ inputId, type: 'candidate', candidate: event.candidate.toJSON ? event.candidate.toJSON() : event.candidate });
          }
        };
        pc.onconnectionstatechange = () => {
          if (this.peers.get(inputId) !== record || record.pc !== pc) return;
          if (pc.connectionState === 'connected') {
            if (record.disconnectTimer) clearTimeout(record.disconnectTimer);
            record.disconnectTimer = null;
            this.refreshElements(inputId);
            return;
          }
          if (pc.connectionState === 'disconnected') {
            this.handleStatus({ inputId, state: 'disconnected' });
            if (!record.disconnectTimer) record.disconnectTimer = setTimeout(() => {
              record.disconnectTimer = null;
              if (this.peers.get(inputId) === record && record.pc === pc && pc.connectionState === 'disconnected') {
                this.closePeer(inputId, true);
                if (this.desired.has(inputId)) this.ensure(inputId);
              }
            }, 1500);
            return;
          }
          if (['failed', 'closed'].includes(pc.connectionState)) {
            this.handleStatus({ inputId, state: pc.connectionState });
            if (this.peers.get(inputId) === record && record.pc === pc) {
              this.closePeer(inputId, true);
              if (this.desired.has(inputId)) this.ensure(inputId);
            }
          }
        };
        await pc.setRemoteDescription(payload.description);
        for (const candidate of queuedCandidates) await pc.addIceCandidate(candidate).catch(() => {});
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        if (typeof this.api.liveInputSignalToHub === 'function') {
          await this.api.liveInputSignalToHub({ inputId, type: 'answer', description: pc.localDescription.toJSON ? pc.localDescription.toJSON() : pc.localDescription });
        }
      } else if (payload.type === 'candidate' && payload.candidate) {
        if (record.pc && record.pc.remoteDescription) await record.pc.addIceCandidate(payload.candidate).catch(() => {});
        else record.pendingCandidates.push(payload.candidate);
      } else if (payload.type === 'closed') {
        this.closePeer(inputId, false);
        if (this.desired.has(inputId)) this.ensure(inputId);
      }
    }

    attach(element, inputId, options = {}) {
      const id = String(inputId || '');
      if (!element || !id) return;
      element.dataset.liveInputId = id;
      element.autoplay = true;
      element.playsInline = true;
      element.controls = false;
      element.disablePictureInPicture = true;
      element.disableRemotePlayback = true;
      element.muted = options.muted !== false;
      element.defaultMuted = element.muted;
      element.volume = Math.max(0, Math.min(1, Number(options.volume ?? 1)));
      if (!this.elements.has(id)) this.elements.set(id, new Set());
      this.elements.get(id).add(element);
      const stream = this.streams.get(id);
      if (stream) this.assign(element, stream);
      this.desired.add(id);
      this.ensure(id);
    }

    assign(element, stream) {
      if (!element || !element.isConnected) return;
      if (element.srcObject !== stream) element.srcObject = stream;
      const played = element.play();
      if (played && played.catch) played.catch(() => {});
    }

    refreshElements(inputId) {
      const stream = this.streams.get(inputId);
      const elements = this.elements.get(inputId);
      if (!stream || !elements) return;
      for (const element of [...elements]) {
        if (!element.isConnected) elements.delete(element);
        else this.assign(element, stream);
      }
    }

    sync(inputIds) {
      const next = new Set((Array.isArray(inputIds) ? inputIds : []).map(String).filter(Boolean));
      this.desired = next;
      next.forEach(id => this.ensure(id));
      for (const id of [...this.peers.keys()]) if (!next.has(id)) this.closePeer(id, true);
      for (const [id, elements] of this.elements) {
        const stream = this.streams.get(id);
        for (const element of [...elements]) {
          if (!element.isConnected) elements.delete(element);
          else if (stream && element.srcObject !== stream) this.assign(element, stream);
        }
        if (!elements.size && !next.has(id)) this.elements.delete(id);
      }
    }

    closePeer(inputId, notify = true) {
      const id = String(inputId || '');
      const record = this.peers.get(id);
      if (record && record.retryTimer) clearTimeout(record.retryTimer);
      if (record && record.disconnectTimer) clearTimeout(record.disconnectTimer);
      if (record && record.pc) record.pc.close();
      this.peers.delete(id);
      const stream = this.streams.get(id);
      if (stream) stream.getTracks().forEach(track => track.stop());
      const elements = this.elements.get(id);
      if (stream && elements) for (const element of elements) if (element.srcObject === stream) element.srcObject = null;
      this.streams.delete(id);
      if (notify && typeof this.api.liveInputUnsubscribe === 'function') this.api.liveInputUnsubscribe(id);
    }

    dispose() {
      for (const id of [...this.peers.keys()]) this.closePeer(id, true);
      this.elements.clear();
      this.desired.clear();
    }
  }

  return { LiveInputConsumer };
});
