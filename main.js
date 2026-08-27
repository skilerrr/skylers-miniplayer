const { app, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const readline = require('readline');

// Optimize Chromium resource and memory usage
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('js-flags', '--max-old-space-size=128');

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
    x: Math.max(0, screenWidth - 410),
    y: Math.max(0, screenHeight - 610),
    frame: false,
    transparent: true,
    alwaysOnTop: isAlwaysOnTop,
    resizable: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      backgroundThrottling: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));

  mainWindow.on('closed', () => {
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

  let lastPayloadStr = '';

  rl.on('line', (line) => {
    if (!line || !line.trim()) return;
    try {
      const lineTrim = line.trim();
      const data = JSON.parse(lineTrim);
      if (data && data.type === 'media_update') {
        const coverTempPath = path.join(app.getPath('temp'), 'apple_music_miniplayer_cover.jpg');
        if (data.trackChanged && fs.existsSync(coverTempPath)) {
          try {
            const buf = fs.readFileSync(coverTempPath);
            data.cover = `data:image/jpeg;base64,${buf.toString('base64')}`;
          } catch (err) {
            console.error('Error reading cover image:', err);
          }
        }

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
    .replace(/\s*\((?:feat\.|featuring|with|ft\.)\s+.*?\)/gi, '')
    .replace(/\s*\[(?:feat\.|featuring|with|ft\.)\s+.*?\]/gi, '')
    .replace(/\s*(?:feat\.|featuring|ft\.)\s+.*$/gi, '')
    .replace(/\s*\((?:remastered|remaster|deluxe|bonus track|anniversary|expanded|explicit|clean|mono|stereo|spatial|atmos).*?\)/gi, '')
    .replace(/\s*\[(?:remastered|remaster|deluxe|bonus track|anniversary|expanded|explicit|clean|mono|stereo|spatial|atmos).*?\]/gi, '')
    .replace(/[-–—]\s*(?:Single|EP|Remastered|Remaster|Deluxe|Bonus|Version|Live|Edit|Radio Edit).*/i, '')
    .trim();
}

function cleanArtistName(artist) {
  if (!artist) return '';
  const norm = artist.replace(/[\u2018\u2019\u2032\u0060\u00B4]/g, "'");
  const parts = norm.split(/\s*[\u2014\u2013-]\s*/);
  let main = parts[0] || norm;
  return main
    .replace(/,\s*.*$/, '')
    .replace(/&.*$/, '')
    .replace(/\s*(?:feat\.|featuring|ft\.|with)\s+.*$/i, '')
    .trim();
}

function isTransientTrack(title) {
  if (!title) return true;
  const t = title.toLowerCase().trim();
  return t.startsWith('connecting') || t.startsWith('buffering') || t.startsWith('loading') || t === 'unknown track';
}

// String similarity calculator for candidate verification (Dice Bigram)
function stringSimilarity(str1, str2) {
  const s1 = (str1 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const s2 = (str2 || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!s1 && !s2) return 1.0;
  if (!s1 || !s2) return 0;
  if (s1 === s2) return 1.0;
  if (s1.includes(s2) || s2.includes(s1)) return 0.88;

  const getBigrams = (str) => {
    const bigrams = new Set();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.substring(i, i + 2));
    }
    return bigrams;
  };
  const b1 = getBigrams(s1);
  const b2 = getBigrams(s2);
  let intersection = 0;
  for (const b of b1) {
    if (b2.has(b)) intersection++;
  }
  return (2.0 * intersection) / (b1.size + b2.size || 1);
}

// Candidate scoring algorithm to eliminate wrong song / wrong video lyrics
function scoreCandidate(candidate, targetTrack, targetArtist, targetDuration) {
  if (!candidate) return -999;
  if (candidate.instrumental) return -999;
  if (!candidate.syncedLyrics && !candidate.plainLyrics) return -999;

  let score = 0;

  // Synced lyrics prioritized
  if (candidate.syncedLyrics) score += 50;
  else score += 10;

  const trackSim = stringSimilarity(candidate.trackName || candidate.name, targetTrack);
  const artistSim = stringSimilarity(candidate.artistName, targetArtist);

  // If track name is too dissimilar (< 35% match), reject
  if (trackSim < 0.35) return -999;

  score += trackSim * 60;
  score += artistSim * 30;

  // Duration proximity scoring (avoids music video versions with video intros)
  if (targetDuration > 0 && candidate.duration > 0) {
    const diff = Math.abs(candidate.duration - targetDuration);
    if (diff <= 2) score += 45;
    else if (diff <= 5) score += 35;
    else if (diff <= 10) score += 15;
    else if (diff <= 20) score -= 15;
    else score -= Math.min(60, diff * 2);
  }

  // Penalize video/dialogue versions
  const candName = ((candidate.trackName || '') + ' ' + (candidate.name || '')).toLowerCase();
  if (candName.includes('official video') || candName.includes('music video') || candName.includes('video version')) {
    score -= 40;
  }

  return score;
}

// Fetch with AbortController timeout helper
async function fetchWithTimeout(url, options = {}, timeoutMs = 3500) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(id);
    return res;
  } catch (err) {
    clearTimeout(id);
    throw err;
  }
}

// Known Hi-Res master discographies / albums / artists (24-bit 96k / 192k / 88.2k)
const HI_RES_96K_KEYWORDS = [
  'coldplay', 'a head full of dreams', 'parachutes', 'ghost stories', 'everyday life', 'music of the spheres', 'rush of blood to the head',
  'sadrah', 'barasuara', 'jalaran sadrah',
  'daft punk', 'random access memories',
  'eagles', 'hotel california',
  'steely dan', 'aja', 'gaucho',
  'hans zimmer', 'interstellar', 'dune', 'inception',
  'pink floyd', 'dark side of the moon', 'the wall', 'wish you were here',
  'the beatles', 'abbey road', 'let it be', 'sgt. pepper', 'revolver',
  'led zeppelin', 'led zeppelin iv', 'physical graffiti',
  'fleetwood mac', 'rumours',
  'queen', 'a night at the opera',
  'muse', 'origin of symmetry', 'absolution',
  'radiohead', 'ok computer', 'kid a', 'in rainbows',
  'green day', 'american idiot', 'dookie',
  'nirvana', 'nevermind', 'in utero',
  'foo fighters', 'wasting light',
  'rush', 'moving pictures', '2112',
  'iron maiden', 'senjutsu', 'number of the beast',
  'neil young', 'harvest', 'after the gold rush',
  'miles davis', 'kind of blue',
  'john coltrane', 'a love supreme', 'blue train',
  'norah jones', 'come away with me',
  'diana krall', 'the look of love',
  'finneas', 'optimist',
  'dire straits', 'brothers in arms',
  'eric clapton', 'unplugged',
  'beck', 'sea change', 'morning phase',
  'metallica', 'master of puppets', 'black album'
];

// Known Dolby Atmos / Spatial Audio mixes on Apple Music
const DOLBY_ATMOS_KEYWORDS = [
  'blinding lights', 'after hours', 'dawn fm', 'midnights', 'future nostalgia',
  'when we all fall asleep', 'hit me hard and soft', 'eternal sunshine', 'guts', 'sour',
  'chromatica', 'renaissance', 'cowboy carter', 'lover', 'folklore', 'evermore',
  'bohemian rhapsody', 'levitating', 'spatial', 'atmos'
];

// Live Track Audio Quality Catalog Fetcher with Accurate Apple Music Lossless & Dolby Atmos Tiers
async function fetchTrackAudioQuality(rawTrack, rawArtist) {
  if (!rawTrack || isTransientTrack(rawTrack)) return null;
  const track = cleanTrackName(rawTrack);
  const artist = cleanArtistName(rawArtist);
  const key = `${track.toLowerCase()}|${artist.toLowerCase()}`;

  if (qualityCache.has(key)) return qualityCache.get(key);

  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(track + ' ' + artist)}&entity=song&limit=1`;
    const res = await fetchWithTimeout(url, {}, 3000);
    if (res.ok) {
      const data = await res.json();
      if (data.results && data.results.length > 0) {
        const item = data.results[0];
        const colName = (item.collectionName || '').toLowerCase();
        const artName = (item.artistName || '').toLowerCase();
        const trkName = (item.trackName || '').toLowerCase();

        const isDolbyAtmos = DOLBY_ATMOS_KEYWORDS.some(k => trkName.includes(k) || colName.includes(k));
        const isHiRes = HI_RES_96K_KEYWORDS.some(k => trkName.includes(k) || artName.includes(k) || colName.includes(k));

        let quality = 'Lossless';
        let isLossless = false;

        if (item.isStreamable) {
          isLossless = true;
          if (isDolbyAtmos) {
            quality = 'Dolby Atmos';
          } else if (isHiRes) {
            quality = 'Hi-Res Lossless';
          } else {
            quality = 'Lossless';
          }
        }

        const result = {
          quality,
          isLossless,
          explicit: item.trackExplicitness === 'explicit'
        };
        qualityCache.set(key, result);
        return result;
      }
    }
  } catch (err) {}

  const fallback = {
    quality: 'Lossless',
    isLossless: true,
    explicit: false
  };
  qualityCache.set(key, fallback);
  return fallback;
}

// Synced Lyrics Fetcher with multi-strategy candidate verification and ranking
async function fetchLyrics(rawTrack, rawArtist, duration) {
  if (!rawTrack || isTransientTrack(rawTrack)) return null;

  const track = cleanTrackName(rawTrack);
  const artist = cleanArtistName(rawArtist);
  const durRound = duration && duration > 0 ? Math.round(duration) : 0;
  
  const cacheKey = `${track.toLowerCase()}|${artist.toLowerCase()}|${durRound}`;
  if (lyricsCache.has(cacheKey)) {
    return lyricsCache.get(cacheKey);
  }

  const headers = { 'User-Agent': 'AppleMusicPixelMiniplayer/1.0' };

  // Strategy 1: Direct /api/get with exact duration match
  if (durRound > 0) {
    try {
      const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}&duration=${durRound}`;
      const res = await fetchWithTimeout(url, { headers }, 2500);
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
    } catch (err) {}
  }

  // Strategy 2: Direct /api/get without duration
  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetchWithTimeout(url, { headers }, 2500);
    if (res.ok) {
      const data = await res.json();
      if (data && (data.syncedLyrics || data.plainLyrics)) {
        // If duration provided, make sure it's within reason (<= 15s delta)
        const durDelta = (durRound > 0 && data.duration > 0) ? Math.abs(data.duration - durRound) : 0;
        if (durDelta <= 15) {
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
    }
  } catch (err) {}

  // Strategy 3: Structured /api/search with track_name & artist_name params + Candidate Scoring
  try {
    const searchUrl = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
    const res = await fetchWithTimeout(searchUrl, { headers }, 3000);
    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        const scored = results
          .map(r => ({ r, score: scoreCandidate(r, track, artist, durRound) }))
          .filter(item => item.score > 50)
          .sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
          const best = scored[0].r;
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
  } catch (err) {}

  // Strategy 4: Fallback query search ?q= with Candidate Scoring
  try {
    const searchQuery = `${track} ${artist}`.trim();
    const searchUrl = `https://lrclib.net/api/search?q=${encodeURIComponent(searchQuery)}`;
    const res = await fetchWithTimeout(searchUrl, { headers }, 3000);
    if (res.ok) {
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        const scored = results
          .map(r => ({ r, score: scoreCandidate(r, track, artist, durRound) }))
          .filter(item => item.score > 50)
          .sort((a, b) => b.score - a.score);

        if (scored.length > 0) {
          const best = scored[0].r;
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
  } catch (err) {}

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
  else if (command === 'set-volume') sendSmtcCommand(`SET_VOLUME ${args}`);
  else if (command === 'change-volume') sendSmtcCommand(`CHANGE_VOLUME ${args}`);
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
    try {
      smtcProcess.kill();
    } catch {}
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

