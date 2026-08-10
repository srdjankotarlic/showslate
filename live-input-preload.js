const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pt', {
  liveHubReady: () => ipcRenderer.send('live-hub-ready'),
  liveHubStatus: (payload) => ipcRenderer.send('live-hub-status', payload),
  liveHubSignal: (payload) => ipcRenderer.send('live-hub-signal', payload),
  liveHubSelectDesktopSource: (sourceId, sourceName = '', withAudio = false) => ipcRenderer.invoke('live-hub-select-desktop-source', { sourceId, sourceName, withAudio: withAudio === true }),
  onLiveHubCommand: (callback) => ipcRenderer.on('live-hub-command', (event, payload) => callback(payload))
});
