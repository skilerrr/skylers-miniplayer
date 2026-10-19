const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');
const { LyricsManager } = require('./lyrics_manager');

let lyricsManager = null;

// Optimize Chromium resource and memory usage
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');

let mainWindow = null;
let smtcProcess = null;
let isAlwaysOnTop = true;

// Rebrand: folder userData ngikutin nama package, jadi data lama (config, riwayat lirik,
// posisi window) bakal keliatan 'hilang' kalau nggak dipindah. Sekali migrasi, sebelum app ready.
(() => {
  try {
    const userDataDir = app.getPath('userData');
    const legacyDir = path.join(path.dirname(userDataDir), 'apple-music-pixel-miniplayer');
    const marker = path.join(userDataDir, 'miniplayer_config.json');
    if (fs.existsSync(legacyDir) && !fs.existsSync(marker)) {
      fs.mkdirSync(userDataDir, { recursive: true });
      fs.cpSync(legacyDir, userDataDir, { recursive: true });
      console.log('[migrasi] data lama dipindah dari', legacyDir);
    }
  } catch (err) {
    console.warn('[migrasi] gagal, lanjut pakai data baru:', err.message);
  }
})();

// Cuma boleh satu instance jalan: dua miniplayer sekaligus rebutan folder cache Chromium
// dan bikin error 'Unable to move the cache: Access is denied'.
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) app.quit();

// Posisi, ukuran, dan state pin dipersist ke userData biar nggak balik ke pojok tiap dibuka
const windowStatePath = () => path.join(app.getPath('userData'), 'window_state.json');

function loadWindowState() {
  try {
    const st = JSON.parse(fs.readFileSync(windowStatePath(), 'utf-8'));
    return st && typeof st === 'object' ? st : {};
  } catch (e) {
    return {};
  }
}

let windowStateTimer = null;
function saveWindowState() {
  clearTimeout(windowStateTimer);
  windowStateTimer = setTimeout(() => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    try {
      const bounds = mainWindow.getBounds();
      fs.writeFileSync(windowStatePath(), JSON.stringify({
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        alwaysOnTop: isAlwaysOnTop
      }));
    } catch (e) {}
  }, 400);
}

// Jangan restore ke koordinat monitor yang udah dicabut
function isBoundsVisible(bounds) {
  if (typeof bounds.x !== 'number' || typeof bounds.y !== 'number') return false;
  return screen.getAllDisplays().some((display) => {
    const a = display.workArea;
    return bounds.x + 80 > a.x && bounds.x < a.x + a.width - 80 &&
           bounds.y >= a.y - 4 && bounds.y < a.y + a.height - 60;
  });
}

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const saved = loadWindowState();
  const restore = isBoundsVisible(saved);

  if (typeof saved.alwaysOnTop === 'boolean') isAlwaysOnTop = saved.alwaysOnTop;

  mainWindow = new BrowserWindow({
    width: saved.width || 380,
    height: saved.height || 580,
    minWidth: 230,
    minHeight: 110,
    x: restore ? saved.x : Math.max(0, screenWidth - 410),
    y: restore ? saved.y : Math.max(0, screenHeight - 610),
    frame: false,
    transparent: true,
    alwaysOnTop: isAlwaysOnTop,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('moved', saveWindowState);
  mainWindow.on('resize', saveWindowState);

  mainWindow.on('closed', () => {
    clearTimeout(windowStateTimer);
    mainWindow = null;
  });
}

function startSmtcBridge() {
  const scriptPath = path.join(__dirname.replace('app.asar', 'app.asar.unpacked'), 'smtc_bridge.ps1');
  smtcProcess = spawn('powershell.exe', [
    '-ExecutionPolicy', 'Bypass',
    '-NoProfile',
    '-File', scriptPath
  ], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const rl = readline.createInterface({
    input: smtcProcess.stdout,
    terminal: false
  });

  rl.on('line', (line) => {
    if (!line || !line.trim()) return;
    try {
      const lineTrim = line.trim();
      const data = JSON.parse(lineTrim);
      if (data && data.type === 'media_update') {
        if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
          try {
            mainWindow.webContents.send('media-update', data);
          } catch (err) {}
        }
      }
    } catch (e) {
      // Ignored non-JSON lines
    }
  });

  smtcProcess.stderr.on('data', (data) => {
    // console.error(`SMTC Bridge stderr: ${data}`);
  });

  smtcProcess.on('exit', (code) => {
    console.log(`SMTC Bridge exited with code ${code}`);
  });
}

function sendSmtcCommand(cmd) {
  if (smtcProcess && smtcProcess.stdin && !smtcProcess.stdin.destroyed) {
    smtcProcess.stdin.write(cmd + '\n');
  }
}

// Clean Track & Artist names helper
function cleanTrackName(track) {
  if (!track) return '';
  return track
    .replace(/[\u2018\u2019\u2032\u0060\u00B4]/g, "'")
    .replace(/^["'\s]+|["'\s]+$/g, '')
    .replace(/\s*\((?:feat\.|featuring|with|ft\.)\s+.*?\)/gi, '')
    .replace(/\s*\[(?:feat\.|featuring|with|ft\.)\s+.*?\]/gi, '')
    .replace(/\s*(?:feat\.|featuring|ft\.)\s+.*$/gi, '')
    .replace(/\s*\((?:remastered|remaster|deluxe|bonus track|anniversary|expanded|explicit|clean|mono|stereo|spatial|atmos).*?\)/gi, '')
    .replace(/\s*\[(?:remastered|remaster|deluxe|bonus track|anniversary|expanded|explicit|clean|mono|stereo|spatial|atmos).*?\]/gi, '')
    .replace(/\s*\(\d{4}\s+(?:remaster|deluxe|edition|anniversary).*?\)/gi, '')
    .replace(/\s*\[\d{4}\s+(?:remaster|deluxe|edition|anniversary).*?\]/gi, '')
    .replace(/\s*\((?:from\s+|ost|soundtrack).*?\)/gi, '')
    .replace(/[-–—]\s*(?:Single|EP|Remastered|Remaster|Deluxe|Bonus|Version|Live|Edit|Radio Edit).*/i, '')
    .trim();
}

function cleanArtistName(artist) {
  if (!artist) return '';
  const norm = artist.replace(/[\u2018\u2019\u2032\u0060\u00B4]/g, "'").trim();
  // Only split on em-dash, en-dash, or hyphen with surrounding spaces (preserves Jay-Z, Blink-182)
  const parts = norm.split(/\s*[\u2014\u2013]\s*|\s+[-–—]\s+/);
  let main = parts[0] || norm;
  return main
    .replace(/\s*(?:feat\.|featuring|ft\.|with)\s+.*$/i, '')
    .trim();
}

function isTransientTrack(title) {
  if (!title) return true;
  const t = title.toLowerCase().trim();
  return t.startsWith('connecting') || t.startsWith('buffering') || t.startsWith('loading') || t === 'unknown track';
}

// Synced & Multi-Source Lyrics Fetcher
async function fetchLyrics(rawTrack, rawArtist, duration, preferredSource = 'auto') {
  if (!rawTrack || isTransientTrack(rawTrack)) return null;
  const track = cleanTrackName(rawTrack);
  const artist = cleanArtistName(rawArtist);
  if (!lyricsManager) lyricsManager = new LyricsManager(app);
  return await lyricsManager.fetchLyrics(track, artist, duration, preferredSource);
}

// IPC Handlers
ipcMain.on('media-command', (_event, { command, args }) => {
  if (command === 'play') sendSmtcCommand('PLAY');
  else if (command === 'pause') sendSmtcCommand('PAUSE');
  else if (command === 'toggle') sendSmtcCommand('TOGGLE');
  else if (command === 'next') sendSmtcCommand('NEXT');
  else if (command === 'prev') sendSmtcCommand('PREV');
  else if (command === 'seek') sendSmtcCommand(`SEEK ${args}`);
});

ipcMain.handle('toggle-always-on-top', () => {
  if (mainWindow) {
    isAlwaysOnTop = !isAlwaysOnTop;
    mainWindow.setAlwaysOnTop(isAlwaysOnTop, 'screen-saver');
    saveWindowState();
    return isAlwaysOnTop;
  }
  return false;
});

ipcMain.on('window-minimize', () => {
  if (mainWindow) mainWindow.minimize();
});

ipcMain.on('window-close', () => {
  if (mainWindow) mainWindow.close();
});

ipcMain.handle('fetch-lyrics', async (_event, { track, artist, duration, preferredSource }) => {
  return await fetchLyrics(track, artist, duration, preferredSource);
});

ipcMain.handle('search-lyrics-candidates', async (_event, { query, track, artist, sourceFilter }) => {
  if (!lyricsManager) lyricsManager = new LyricsManager(app);
  const cleanT = cleanTrackName(track || '');
  const cleanA = cleanArtistName(artist || '');
  return await lyricsManager.searchCandidates(query, cleanT, cleanA, sourceFilter);
});

ipcMain.handle('fetch-lyric-candidate', async (_event, { candidate }) => {
  if (!lyricsManager) lyricsManager = new LyricsManager(app);
  return await lyricsManager.fetchCandidateLyrics(candidate);
});

ipcMain.handle('get-musixmatch-token', () => {
  if (!lyricsManager) lyricsManager = new LyricsManager(app);
  return lyricsManager.getMusixmatchToken();
});

ipcMain.handle('set-musixmatch-token', (_event, { token }) => {
  if (!lyricsManager) lyricsManager = new LyricsManager(app);
  return lyricsManager.setMusixmatchToken(token);
});

app.on('second-instance', () => {
  // User buka app lagi pas udah jalan: fokusin window yang ada, jangan bikin yang baru
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  if (!gotSingleInstanceLock) return;
  lyricsManager = new LyricsManager(app);
  createWindow();
  startSmtcBridge();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (smtcProcess) {
    try {
      smtcProcess.kill();
    } catch {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
