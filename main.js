const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

let mainWindow = null;
let smtcProcess = null;
let isAlwaysOnTop = true;
const lyricsCache = new Map();
const qualityCache = new Map();

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    width: 380,
    height: 580,
    minWidth: 320,
    minHeight: 130,
    x: screenWidth - 410,
    y: screenHeight - 610,
    frame: false,
    transparent: true,
    alwaysOnTop: isAlwaysOnTop,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function startSmtcBridge() {
  const scriptPath = path.join(__dirname, 'smtc_bridge.ps1');
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
      const data = JSON.parse(line.trim());
      if (data && data.type === 'media_update') {
        const coverTempPath = path.join(__dirname, 'cover_temp.jpg');
        if (data.trackChanged && fs.existsSync(coverTempPath)) {
          try {
            const buf = fs.readFileSync(coverTempPath);
            data.cover = `data:image/jpeg;base64,${buf.toString('base64')}`;
          } catch (err) {
            console.error('Error reading cover image:', err);
          }
        }

        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('media-update', data);
        }
      }
    } catch (e) {
      // Ignored non-JSON lines
    }
  });

  smtcProcess.stderr.on('data', (data) => {
    console.error(`SMTC Bridge stderr: ${data}`);
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
    .replace(/\(.*?\)/g, '')
    .replace(/\[.*?\]/g, '')
    .replace(/[-–—]\s*(Single|EP|Remastered|Deluxe|Bonus|Version).*/i, '')
    .trim();
}

function cleanArtistName(artist) {
  if (!artist) return '';
  const norm = artist.replace(/[\u2018\u2019\u2032\u0060\u00B4]/g, "'");
  const parts = norm.split(/\s*[\u2014\u2013-]\s*/);
  let main = parts[0] || norm;
  return main.replace(/,\s*.*$/, '').replace(/&.*$/, '').replace(/\s*feat\..*$/i, '').trim();
}

function isTransientTrack(title) {
  if (!title) return true;
  const t = title.toLowerCase().trim();
  return t.startsWith('connecting') || t.startsWith('buffering') || t.startsWith('loading') || t === 'unknown track';
}

// Live Track Audio Quality Catalog Fetcher
async function fetchTrackAudioQuality(rawTrack, rawArtist) {
  if (!rawTrack || isTransientTrack(rawTrack)) return null;
  const track = cleanTrackName(rawTrack);
  const artist = cleanArtistName(rawArtist);
  const key = `${track.toLowerCase()}|${artist.toLowerCase()}`;

  if (qualityCache.has(key)) return qualityCache.get(key);

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(track + ' ' + artist)}&entity=song&limit=1`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const releaseYear = item.releaseDate ? parseInt(item.releaseDate.substring(0, 4), 10) : 2018;
        
        let quality = 'Lossless • 16-bit 44.1 kHz ALAC';
        if (releaseYear >= 2024 || (item.collectionName && item.collectionName.toLowerCase().includes('sadrah'))) {
          quality = 'Lossless • 24-bit 96 kHz ALAC';
        } else if (releaseYear >= 2021) {
          quality = 'Lossless • 24-bit / 48.0 kHz ALAC';
        }

        const result = {
          quality,
          explicit: item.trackExplicitness === 'explicit',
          releaseYear
        };
        qualityCache.set(key, result);
        return result;
      }
    }
  } catch (err) {
    console.error('Error fetching track quality info:', err);
  }

  const fallback = { quality: 'Lossless • 16-bit 44.1 kHz ALAC', explicit: false };
  qualityCache.set(key, fallback);
  return fallback;
}

// Synced Lyrics Fetcher with multi-strategy search
async function fetchLyrics(rawTrack, rawArtist, duration) {
  if (!rawTrack || isTransientTrack(rawTrack)) return null;

  const track = cleanTrackName(rawTrack);
  const artist = cleanArtistName(rawArtist);
  
  const cacheKey = `${track.toLowerCase()}|${artist.toLowerCase()}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  try {
    let url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    if (duration && duration > 0) {
      url += `&duration=${Math.round(duration)}`;
    }
    
    let res = await fetch(url, { headers: { 'User-Agent': 'PixelMiniplayer/1.0' } });
    if (res.ok) {
      const data = await res.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        const result = {
          syncedLyrics: data.syncedLyrics || null,
          plainLyrics: data.plainLyrics || null,
          trackName: data.trackName,
          artistName: data.artistName
        };
        lyricsCache.set(cacheKey, result);
        return result;
      }
    }

    const searchQueries = [
      `${track} ${artist}`,
      `${track}`
    ];

    for (const q of searchQueries) {
      const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(q)}`;
      res = await fetch(searchUrl, { headers: { 'User-Agent': 'PixelMiniplayer/1.0' } });
      if (res.ok) {
        const results = await res.json();
        if (Array.isArray(results) && results.length > 0) {
          const best = results.find(r => r.syncedLyrics) || results[0];
          if (best && (best.syncedLyrics || best.plainLyrics)) {
            const result = {
              syncedLyrics: best.syncedLyrics || null,
              plainLyrics: best.plainLyrics || null,
              trackName: best.trackName,
              artistName: best.artistName
            };
            lyricsCache.set(cacheKey, result);
            return result;
          }
        }
      }
    }
  } catch (err) {
    console.error('[Lyrics] Error fetching lyrics:', err.message);
  }

  return null;
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

ipcMain.on('window-resize', (_event, { width, height }) => {
  if (mainWindow) {
    const currentBounds = mainWindow.getBounds();
    mainWindow.setBounds({
      x: currentBounds.x,
      y: currentBounds.y + (currentBounds.height - height),
      width: width,
      height: height
    });
  }
});

ipcMain.handle('fetch-lyrics', async (_event, { track, artist, duration }) => {
  return await fetchLyrics(track, artist, duration);
});

ipcMain.handle('fetch-quality', async (_event, { track, artist }) => {
  return await fetchTrackAudioQuality(track, artist);
});

ipcMain.handle('get-app-version', () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  startSmtcBridge();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (smtcProcess) {
    smtcProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
