const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pt', {
  liveHubReady: () => ipcRenderer.send('live-hub-ready'),
  liveHubStatus: (payload) => ipcRenderer.send('live-hub-status', payload),
  liveHubSignal: (payload) => ipcRenderer.send('live-hub-signal', payload),
  liveHubSelectDesktopSource: (sourceId) => ipcRenderer.invoke('live-hub-select-desktop-source', sourceId),
  onLiveHubCommand: (callback) => ipcRenderer.on('live-hub-command', (event, payload) => callback(payload))
});
