const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('miniplayerAPI', {
  onMediaUpdate: (callback) => ipcRenderer.on('media-update', (_event, value) => callback(value)),
  sendMediaCommand: (command, args) => ipcRenderer.send('media-command', { command, args }),
  toggleAlwaysOnTop: () => ipcRenderer.invoke('toggle-always-on-top'),
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  closeWindow: () => ipcRenderer.send('window-close'),
  fetchLyrics: (track, artist, duration, preferredSource) => ipcRenderer.invoke('fetch-lyrics', { track, artist, duration, preferredSource }),
  searchLyricsCandidates: (query, track, artist, sourceFilter) => ipcRenderer.invoke('search-lyrics-candidates', { query, track, artist, sourceFilter }),
  fetchLyricCandidate: (candidate) => ipcRenderer.invoke('fetch-lyric-candidate', { candidate }),
  getMusixmatchToken: () => ipcRenderer.invoke('get-musixmatch-token'),
  setMusixmatchToken: (token) => ipcRenderer.invoke('set-musixmatch-token', { token })
});
