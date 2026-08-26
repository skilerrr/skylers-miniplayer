const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniplayerAPI', {
  onMediaUpdate: (callback) => ipcRenderer.on('media-update', (_event, value) => callback(value)),
  sendMediaCommand: (command, args) => ipcRenderer.send('media-command', { command, args }),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  onFullscreenChange: (callback) => ipcRenderer.on('fullscreen-change', (_event, isFs) => callback(isFs)),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  resizeWindow: (width, height) => ipcRenderer.send('window-resize', { width, height }),
  fetchLyrics: (track, artist, duration) => ipcRenderer.invoke('fetch-lyrics', { track, artist, duration }),
  fetchQuality: (track, artist) => ipcRenderer.invoke('fetch-quality', { track, artist }),
  getAppVersion: () => ipcRenderer.invoke('get-app-version')
});
