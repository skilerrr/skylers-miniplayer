// ==========================================================================
// APPLE MUSIC OG HIERARCHY, ULTRA-SMOOTH 60FPS ENGINE - RENDERER
// ==========================================================================

const THEMES = [
  { id: 'theme-appleglass', label: 'Apple Music OG', isPixel: false },
  { id: 'theme-gameboy', label: 'GameBoy', isPixel: true },
  { id: 'theme-pastel', label: 'Pastel Pop', isPixel: true },
  { id: 'theme-cyber', label: 'Cyber Lo-Fi', isPixel: true },
  { id: 'theme-win95', label: 'Win95 Retro', isPixel: true },
  { id: 'theme-oled', label: 'OLED Emerald', isPixel: true }
];

// App State
let currentThemeIndex = 0;
let is8BitDither = false;
let isCrtEnabled = false;
let isPinned = true;
let currentContentView = 'lyrics'; // 'lyrics' | 'queue' | 'none'
let currentQueueTab = 'playingNext'; // 'playingNext' | 'history'

let currentTrackKey = '';
let currentPosition = 0;
let currentDuration = 0;
let isPlaying = false;
let lastTickTime = performance.now();

// Dragging Seekbar & Cooldown State
let isScrubbing = false;
let scrubPosition = 0;
let seekCooldownUntil = 0;

// User Manual Scroll Guard for Lyrics
let userScrollUntil = 0;

// Fine-tuned Lyric Timing Offset (Seconds) - compensated for user's half-second delay
const LYRIC_TIMING_OFFSET = 0.55;

// Parsed Lyrics array [{ time: 12.5, text: "...", isDots: false, endTime: 16.0 }]
let parsedLyrics = [];
let activeLyricIndex = -1;
let currentLyricsTrackKey = '';
let hasSyncedLyrics = false;
let lyricsFetchCounter = 0;

// Queue & History State
let playbackHistory = [];
let upcomingQueue = [];
let currentAlbumName = '';
let currentTrackCover = '';

try {
  const savedHistory = localStorage.getItem('miniplayer_playback_history');
  if (savedHistory) {
    playbackHistory = JSON.parse(savedHistory);
  }
} catch (e) {}

function saveHistoryToStorage() {
  try {
    localStorage.setItem('miniplayer_playback_history', JSON.stringify(playbackHistory.slice(0, 40)));
  } catch (e) {}
}

// Cached Formatted Strings (Avoids unnecessary DOM text mutations in RAF loop)
let lastCurrentTimeStr = '';
let lastRemainingTimeStr = '';
let lastPercent = -1;

// DOM Elements
const bodyEl = document.body;
const miniplayerContainer = document.getElementById('miniplayerContainer');
const pixelCanvas = document.getElementById('pixelCanvas');
const rawCoverImg = document.getElementById('rawCoverImg');
const ctx = pixelCanvas.getContext('2d');

const trackTitleEl = document.getElementById('trackTitle');
const trackSubtitleEl = document.getElementById('trackSubtitle');
const explicitBadge = document.getElementById('explicitBadge');
const timeCurrentEl = document.getElementById('timeCurrent');
const timeRemainingEl = document.getElementById('timeRemaining');
const progressBarFill = document.getElementById('progressBarFill');
const progressBarThumb = document.getElementById('progressBarThumb');
const progressBarContainer = document.getElementById('progressBarContainer');

const btnPlayPause = document.getElementById('btnPlayPause');
const svgPlay = document.getElementById('svgPlay');
const svgPause = document.getElementById('svgPause');
const btnPrev = document.getElementById('btnPrev');
const btnNext = document.getElementById('btnNext');

const btnPin = document.getElementById('btnPin');
const btnMin = document.getElementById('btnMin');
const btnClose = document.getElementById('btnClose');

const badgeRow = document.getElementById('badgeRow');
const badgeIcon = document.getElementById('badgeIcon');
const badgeLabel = document.getElementById('badgeLabel');
const crtOverlay = document.getElementById('crtOverlay');

const lyricsViewArea = document.getElementById('lyricsViewArea');
const lyricsContainer = document.getElementById('lyricsContainer');
const lyricsList = document.getElementById('lyricsList');
const lyricsPlaceholder = document.getElementById('lyricsPlaceholder');

const historyViewArea = document.getElementById('historyViewArea');
const historyScrollContainer = document.getElementById('historyScrollContainer');
const historyItemsList = document.getElementById('historyItemsList');
const historyPlaceholder = document.getElementById('historyPlaceholder');
const btnClearHistory = document.getElementById('btnClearHistory');

const btnThemeSelector = document.getElementById('btnThemeSelector');
const btnToggleLyrics = document.getElementById('btnToggleLyrics');
const btnToggleHistory = document.getElementById('btnToggleHistory');
const themePopupMenu = document.getElementById('themePopupMenu');
const btnCloseMenu = document.getElementById('btnCloseMenu');
const menuTogglePixel = document.getElementById('menuTogglePixel');
const menuToggleCrt = document.getElementById('menuToggleCrt');
const menuToggleMesh = document.getElementById('menuToggleMesh');
const ambientGlowLayer = document.getElementById('ambientGlowLayer');

let isLiquidMeshEnabled = true;

// --- Helper: Format seconds to M:SS ---
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// --- Reusable Offscreen Canvases (Memory & GC Optimization) ---
let colorCanvas = null;
let colorCtx = null;
let ditherCanvas = null;
let ditherCtx = null;

function getColorCanvas() {
  if (!colorCanvas) {
    colorCanvas = document.createElement('canvas');
    colorCanvas.width = 16;
    colorCanvas.height = 16;
    colorCtx = colorCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: colorCanvas, ctx: colorCtx };
}

function getDitherCanvas() {
  if (!ditherCanvas) {
    ditherCanvas = document.createElement('canvas');
    ditherCanvas.width = 58;
    ditherCanvas.height = 58;
    ditherCtx = ditherCanvas.getContext('2d', { willReadFrequently: true });
  }
  return { canvas: ditherCanvas, ctx: ditherCtx };
}

// --- True Dynamic 4-Tone Album Color Palette Extraction (Apple Music Liquid Mesh) ---
function extractTrueAlbumColors(img) {
  try {
    const { ctx: cCtx } = getColorCanvas();
    cCtx.clearRect(0, 0, 32, 32);
    cCtx.drawImage(img, 0, 0, 32, 32);
    const data = cCtx.getImageData(0, 0, 32, 32).data;

    const samples = [];
    let avgR = 0, avgG = 0, avgB = 0, validCount = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const delta = max - min;
      const sat = max === 0 ? 0 : delta / max;
      const bri = max / 255;

      if (bri > 0.05 && bri < 0.96) {
        samples.push({ r, g, b, sat, bri, score: sat * 1.8 + (0.5 - Math.abs(bri - 0.5)) });
        avgR += r; avgG += g; avgB += b;
        validCount++;
      }
    }

    if (validCount === 0) return;

    avgR = Math.round(avgR / validCount);
    avgG = Math.round(avgG / validCount);
    avgB = Math.round(avgB / validCount);

    // Sort by vibrance score to prioritize vivid accents
    samples.sort((a, b) => b.score - a.score);

    // Pick 4 distinct color poles from the cover art
    const palette = [];
    for (const s of samples) {
      const isDistinct = palette.every(p => {
        const dist = Math.sqrt((p.r - s.r)**2 + (p.g - s.g)**2 + (p.b - s.b)**2);
        return dist > 60;
      });
      if (isDistinct) {
        palette.push(s);
        if (palette.length === 4) break;
      }
    }

    const c1 = palette[0] || { r: avgR, g: avgG, b: avgB };
    const c2 = palette[1] || { r: Math.round(c1.r * 0.7), g: Math.round(c1.g * 1.1), b: Math.round(c1.b * 1.3) };
    const c3 = palette[2] || { r: Math.round(c1.r * 1.2), g: Math.round(c1.g * 0.7), b: Math.round(c1.b * 0.9) };
    const c4 = palette[3] || { r: Math.round(avgR * 0.6), g: Math.round(avgG * 0.6), b: Math.round(avgB * 0.6) };

    const primary = `rgb(${c1.r}, ${c1.g}, ${c1.b})`;
    const secondary = `rgb(${c2.r}, ${c2.g}, ${c2.b})`;
    const accent1 = `rgb(${c3.r}, ${c3.g}, ${c3.b})`;
    const accent2 = `rgb(${c4.r}, ${c4.g}, ${c4.b})`;

    const baseR = Math.max(8, Math.min(22, Math.round(avgR * 0.15)));
    const baseG = Math.max(8, Math.min(24, Math.round(avgG * 0.15)));
    const baseB = Math.max(10, Math.min(28, Math.round(avgB * 0.15)));
    const darkBg = `rgb(${baseR}, ${baseG}, ${baseB})`;
    const glow = `rgba(${c1.r}, ${c1.g}, ${c1.b}, 0.55)`;

    document.documentElement.style.setProperty('--primary-rgb', `${c1.r}, ${c1.g}, ${c1.b}`);
    document.documentElement.style.setProperty('--secondary-rgb', `${c2.r}, ${c2.g}, ${c2.b}`);
    document.documentElement.style.setProperty('--accent1-rgb', `${c3.r}, ${c3.g}, ${c3.b}`);
    document.documentElement.style.setProperty('--accent2-rgb', `${c4.r}, ${c4.g}, ${c4.b}`);
    document.documentElement.style.setProperty('--color-primary', primary);
    document.documentElement.style.setProperty('--color-secondary', secondary);
    document.documentElement.style.setProperty('--color-accent1', accent1);
    document.documentElement.style.setProperty('--color-accent2', accent2);
    document.documentElement.style.setProperty('--color-dark', darkBg);
    document.documentElement.style.setProperty('--color-glow', glow);
  } catch (e) {
    document.documentElement.style.setProperty('--primary-rgb', '29, 78, 104');
    document.documentElement.style.setProperty('--secondary-rgb', '207, 53, 62');
    document.documentElement.style.setProperty('--accent1-rgb', '58, 125, 153');
    document.documentElement.style.setProperty('--accent2-rgb', '140, 37, 54');
    document.documentElement.style.setProperty('--color-primary', '#1d4e68');
    document.documentElement.style.setProperty('--color-secondary', '#cf353e');
    document.documentElement.style.setProperty('--color-accent1', '#3a7d99');
    document.documentElement.style.setProperty('--color-accent2', '#8c2536');
    document.documentElement.style.setProperty('--color-dark', '#121d24');
    document.documentElement.style.setProperty('--color-glow', 'rgba(29, 78, 104, 0.45)');
  }
}

// --- Default Retro Fallback Cassette ---
function drawDefaultPixelArt() {
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, 128, 128);

  ctx.fillStyle = '#444';
  ctx.fillRect(16, 28, 96, 68);
  ctx.fillStyle = '#222';
  ctx.fillRect(24, 36, 80, 52);
  
  ctx.fillStyle = '#eee';
  ctx.fillRect(36, 52, 16, 16);
  ctx.fillRect(76, 52, 16, 16);
  ctx.fillStyle = '#000';
  ctx.fillRect(40, 56, 8, 8);
  ctx.fillRect(80, 56, 8, 8);

  ctx.fillStyle = '#fa243c';
  ctx.fillRect(30, 40, 68, 8);
}

// --- Cover Art & Dither Canvas Renderer ---
function renderCoverArt() {
  const currentTheme = THEMES[currentThemeIndex];
  const usePixelArt = is8BitDither || currentTheme.isPixel;

  if (usePixelArt) {
    rawCoverImg.classList.add('hidden-cover');
    pixelCanvas.classList.add('active-canvas');

    if (!rawCoverImg.src || rawCoverImg.src === window.location.href || rawCoverImg.naturalWidth === 0) {
      drawDefaultPixelArt();
      return;
    }

    const targetSize = 58;
    const { canvas: tempCanvas, ctx: tempCtx } = getDitherCanvas();

    tempCtx.imageSmoothingEnabled = false;
    tempCtx.clearRect(0, 0, targetSize, targetSize);
    tempCtx.drawImage(rawCoverImg, 0, 0, targetSize, targetSize);

    const imgData = tempCtx.getImageData(0, 0, targetSize, targetSize);
    const data = imgData.data;
    const factor = 4;

    for (let i = 0; i < data.length; i += 4) {
      data[i] = Math.floor(data[i] / (256 / factor)) * (256 / (factor - 1));
      data[i + 1] = Math.floor(data[i + 1] / (256 / factor)) * (256 / (factor - 1));
      data[i + 2] = Math.floor(data[i + 2] / (256 / factor)) * (256 / (factor - 1));
    }
    tempCtx.putImageData(imgData, 0, 0);

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, 128, 128);
    ctx.drawImage(tempCanvas, 0, 0, 128, 128);
  } else {
    rawCoverImg.classList.remove('hidden-cover');
    pixelCanvas.classList.remove('active-canvas');
  }

  if (rawCoverImg.src && rawCoverImg.naturalWidth > 0) {
    extractTrueAlbumColors(rawCoverImg);
  }
}

rawCoverImg.onload = () => renderCoverArt();

// --- Robust LRC Synced Lyrics Engine with Apple Music Synced Three-Dots ---
function parseLRC(lrcText) {
  if (!lrcText) return [];
  const rawLines = lrcText.split(/\r?\n/);
  const parsed = [];
  const tagRegex = /\[(\d{1,2}):(\d{2})(?:\.(\d{1,3}))?\]/g;

  for (const line of rawLines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    
    // Ignore header tags like [ar: ...], [ti: ...], [al: ...]
    if (/^\[(ti|ar|al|by|offset|length|re|ve):/i.test(trimmed)) continue;

    let match;
    const timestamps = [];
    tagRegex.lastIndex = 0;
    
    while ((match = tagRegex.exec(trimmed)) !== null) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      let ms = 0;
      if (match[3]) {
        ms = parseFloat('0.' + match[3]);
      }
      timestamps.push(min * 60 + sec + ms);
    }

    const text = trimmed.replace(tagRegex, '').trim();
    if (timestamps.length > 0 && text) {
      for (const t of timestamps) {
        parsed.push({ time: t, text, isDots: false });
      }
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  if (parsed.length === 0) return [];

  const resultWithDots = [];

  // 1. Intro Instrumental Gap (only if opening intro is substantial > 6.0s)
  if (parsed[0].time > 6.0) {
    const introStart = Math.max(0, parsed[0].time - 3.5);
    resultWithDots.push({
      time: introStart,
      endTime: parsed[0].time,
      text: '•••',
      isDots: true
    });
  }

  // 2. Interlude Gaps between lines (only for true instrumental breaks / solos >= 8.5s)
  for (let i = 0; i < parsed.length; i++) {
    resultWithDots.push(parsed[i]);

    if (i < parsed.length - 1) {
      const gap = parsed[i + 1].time - parsed[i].time;
      if (gap >= 8.5) {
        // Capped countdown: only activate 3.5 seconds before the next vocal begins
        const dotsStart = parsed[i + 1].time - 3.5;
        resultWithDots.push({
          time: dotsStart,
          endTime: parsed[i + 1].time,
          text: '•••',
          isDots: true
        });
      }
    }
  }

  return resultWithDots;
}

function renderLyricsList() {
  lyricsList.innerHTML = '';
  activeLyricIndex = -1;

  if (parsedLyrics.length === 0) {
    lyricsPlaceholder.style.display = 'flex';
    lyricsList.style.display = 'none';
    return;
  }

  lyricsPlaceholder.style.display = 'none';
  lyricsList.style.display = 'flex';

  const frag = document.createDocumentFragment();

  parsedLyrics.forEach((lyric, index) => {
    const lineEl = document.createElement('div');
    lineEl.dataset.index = index;

    if (lyric.isDots) {
      lineEl.className = 'lyric-line lyric-dots';
      lineEl.innerHTML = '<span class="dot dot-1"></span><span class="dot dot-2"></span><span class="dot dot-3"></span>';
    } else {
      lineEl.className = 'lyric-line';
      lineEl.textContent = lyric.text;
    }

    // Click lyric line to focus/scroll to that line and send seek
    lineEl.addEventListener('click', () => {
      userScrollUntil = Date.now() + 3500;
      const containerHeight = lyricsContainer.clientHeight;
      const targetTop = lineEl.offsetTop - (containerHeight / 2) + (lineEl.clientHeight / 2);
      lyricsContainer.scrollTo({
        top: Math.max(0, targetTop),
        behavior: 'smooth'
      });
      if (lyric.time >= 0) {
        window.miniplayerAPI.sendMediaCommand('seek', lyric.time);
      }
    });

    frag.appendChild(lineEl);
  });

  lyricsList.appendChild(frag);
}

// User scroll detection to avoid fighting manual scroll
lyricsContainer.addEventListener('wheel', () => {
  userScrollUntil = Date.now() + 2500;
}, { passive: true });

lyricsContainer.addEventListener('touchstart', () => {
  userScrollUntil = Date.now() + 2500;
}, { passive: true });

function updateActiveLyric(rawTime) {
  if (parsedLyrics.length === 0) return;

  const time = rawTime + LYRIC_TIMING_OFFSET;

  let activeIdx = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    const lyric = parsedLyrics[i];
    const nextTime = (i < parsedLyrics.length - 1) ? parsedLyrics[i + 1].time : (lyric.endTime || lyric.time + 9999);

    if (time >= lyric.time && time < nextTime) {
      activeIdx = i;
      break;
    } else if (time >= lyric.time) {
      activeIdx = i;
    }
  }

  if (activeIdx !== activeLyricIndex) {
    activeLyricIndex = activeIdx;
    
    const prev = lyricsList.querySelector('.lyric-line.active');
    if (prev) prev.classList.remove('active');

    if (activeIdx >= 0) {
      const activeEl = lyricsList.querySelector(`.lyric-line[data-index="${activeIdx}"]`);
      if (activeEl) {
        activeEl.classList.add('active');

        // Smooth auto-scroll only if user is not actively scrolling manually
        if (Date.now() > userScrollUntil) {
          const containerHeight = lyricsContainer.clientHeight;
          const targetTop = activeEl.offsetTop - (containerHeight / 2) + (activeEl.clientHeight / 2);
          lyricsContainer.scrollTo({
            top: Math.max(0, targetTop),
            behavior: 'smooth'
          });
        }
      }
    }
  }

  // Real-time 3-dot countdown sync leading into vocals
  if (activeLyricIndex >= 0 && parsedLyrics[activeLyricIndex] && parsedLyrics[activeLyricIndex].isDots) {
    const activeEl = lyricsList.querySelector(`.lyric-line[data-index="${activeLyricIndex}"]`);
    if (activeEl) {
      const dots = activeEl.querySelectorAll('.dot');
      if (dots.length === 3) {
        const remaining = parsedLyrics[activeLyricIndex].endTime - time;
        dots[0].classList.toggle('filled', remaining <= 3.05);
        dots[1].classList.toggle('filled', remaining <= 2.05);
        dots[2].classList.toggle('filled', remaining <= 1.05);
      }
    }
  }
}

// --- SMTC Media Update Receiver with Jitter Filter ---
window.miniplayerAPI.onMediaUpdate((data) => {
  if (!data) return;

  const trackKey = `${data.title}|${data.artist}|${data.album}`;
  const isNewTrack = trackKey !== currentTrackKey && data.title;

  if (isNewTrack || (data.title && trackTitleEl.textContent === 'No Music Playing')) {
    // Record previously played track into history with its own immutable cover snapshot
    const oldTitle = trackTitleEl.textContent;
    if (oldTitle && oldTitle !== 'No Music Playing' && oldTitle !== data.title) {
      const historyEntry = {
        title: oldTitle,
        artist: trackSubtitleEl.textContent,
        album: currentAlbumName,
        cover: currentTrackCover || rawCoverImg.src,
        duration: currentDuration,
        playedAt: Date.now()
      };
      if (!playbackHistory.length || playbackHistory[0].title !== historyEntry.title) {
        playbackHistory.unshift(historyEntry);
        if (playbackHistory.length > 40) playbackHistory.pop();
        saveHistoryToStorage();
      }
    }

    currentTrackKey = trackKey;
    currentAlbumName = data.album || '';
    trackTitleEl.textContent = data.title || 'Unknown Track';
    
    const subtitle = data.album ? `${data.artist || ''} — ${data.album}` : (data.artist || 'Apple Music');
    trackSubtitleEl.textContent = subtitle;

    if (currentContentView === 'history') {
      renderHistoryView();
    }
    
    // Fetch live audio quality (1:1 Apple Music badge display)
    window.miniplayerAPI.fetchQuality(data.title, data.artist)
      .then((q) => {
        if (q) {
          const isLossless = q.isLossless !== false;
          if (badgeRow) {
            badgeRow.style.display = isLossless ? 'inline-flex' : 'none';
          }
          if (badgeLabel) {
            badgeLabel.textContent = q.quality || 'Lossless';
          }
          if (badgeIcon) {
            badgeIcon.textContent = q.quality === 'Dolby Atmos' ? '∿' : '≋';
          }
          explicitBadge.style.display = q.explicit ? 'inline-block' : 'none';
        }
      })
      .catch(() => {});

    // Fetch lyrics for new track
    const fetchId = ++lyricsFetchCounter;
    currentLyricsTrackKey = trackKey;
    hasSyncedLyrics = false;

    window.miniplayerAPI.fetchLyrics(data.title, data.artist, data.duration)
      .then((res) => {
        if (fetchId !== lyricsFetchCounter) return;
        if (res && res.syncedLyrics) {
          parsedLyrics = parseLRC(res.syncedLyrics);
          hasSyncedLyrics = true;
          renderLyricsList();
        } else if (res && res.plainLyrics) {
          parsedLyrics = res.plainLyrics
            .split(/\r?\n/)
            .filter(t => t.trim())
            .map(t => ({ time: -1, text: t.trim(), isDots: false }));
          hasSyncedLyrics = false;
          renderLyricsList();
        } else {
          parsedLyrics = [];
          hasSyncedLyrics = false;
          renderLyricsList();
        }
      })
      .catch(() => {
        if (fetchId !== lyricsFetchCounter) return;
        parsedLyrics = [];
        hasSyncedLyrics = false;
        renderLyricsList();
      });
  } else if (!hasSyncedLyrics && data.duration > 0 && currentDuration === 0 && data.title) {
    // If lyrics failed or loaded plain because duration was 0 initially, re-fetch once duration is known
    const fetchId = ++lyricsFetchCounter;
    window.miniplayerAPI.fetchLyrics(data.title, data.artist, data.duration)
      .then((res) => {
        if (fetchId !== lyricsFetchCounter) return;
        if (res && res.syncedLyrics) {
          parsedLyrics = parseLRC(res.syncedLyrics);
          hasSyncedLyrics = true;
          renderLyricsList();
        }
      })
      .catch(() => {});
  }

  // Update Cover Art
  if (data.cover) {
    currentTrackCover = data.cover;
    if (rawCoverImg.src !== data.cover) {
      rawCoverImg.src = data.cover;
    }
  } else if (!data.title) {
    currentTrackCover = '';
    drawDefaultPixelArt();
  }

  // Playback Status & Timeline Synchronization with Jitter Filter
  const prevPlaying = isPlaying;
  isPlaying = data.status === 'Playing';
  currentDuration = data.duration || 0;

  const now = performance.now();

  if (!isScrubbing && now > seekCooldownUntil) {
    if (isNewTrack || !prevPlaying && isPlaying || prevPlaying && !isPlaying) {
      // Direct sync on state transition
      currentPosition = data.position || 0;
      lastTickTime = now;
    } else if (isPlaying) {
      const elapsed = (now - lastTickTime) / 1000;
      const currentEstimated = currentPosition + elapsed;
      const reportedPos = data.position || 0;
      const diff = reportedPos - currentEstimated;

      // If large jump (seek or track jump), sync instantly
      if (Math.abs(diff) > 1.2) {
        currentPosition = reportedPos;
        lastTickTime = now;
      } else {
        // Continuous soft clock lock: pull estimated position toward reported position
        currentPosition = currentEstimated + (diff * 0.35);
        lastTickTime = now;
      }
    } else {
      currentPosition = data.position || 0;
      lastTickTime = now;
    }
  }

  // Volume sync from SMTC
  if (typeof data.volume === 'number') {
    currentVolume = data.volume;
  }

  if (isPlaying) {
    bodyEl.classList.add('playing');
    bodyEl.classList.remove('paused');
    svgPlay.classList.add('hidden');
    svgPause.classList.remove('hidden');
  } else {
    bodyEl.classList.remove('playing');
    bodyEl.classList.add('paused');
    svgPlay.classList.remove('hidden');
    svgPause.classList.add('hidden');
    if (!data.title) {
      trackTitleEl.textContent = 'No Music Playing';
      trackSubtitleEl.textContent = 'Open Apple Music to play';
    }
  }

  updateProgressBar();
});

// --- Butter-Smooth 60FPS Animation Loop with DOM Throttling ---
function updateProgressBar() {
  let displayPos = currentPosition;
  if (isScrubbing) {
    displayPos = scrubPosition;
  } else if (isPlaying) {
    const elapsed = (performance.now() - lastTickTime) / 1000;
    displayPos = Math.min(currentPosition + elapsed, currentDuration > 0 ? currentDuration : 99999);
  }

  const remaining = Math.max(0, currentDuration - displayPos);
  
  // Throttle DOM text mutations (only when the formatted second string changes)
  const curStr = formatTime(displayPos);
  if (curStr !== lastCurrentTimeStr) {
    lastCurrentTimeStr = curStr;
    timeCurrentEl.textContent = curStr;
  }

  const remStr = `-${formatTime(remaining)}`;
  if (remStr !== lastRemainingTimeStr) {
    lastRemainingTimeStr = remStr;
    timeRemainingEl.textContent = remStr;
  }

  const percent = currentDuration > 0 ? (displayPos / currentDuration) * 100 : 0;
  if (Math.abs(percent - lastPercent) > 0.01) {
    lastPercent = percent;
    progressBarFill.style.width = `${percent}%`;
    progressBarThumb.style.left = `${percent}%`;
  }

  if (!isScrubbing) {
    updateActiveLyric(displayPos);
  }
}

// 60FPS requestAnimationFrame tick loop
function animationLoop() {
  if (isPlaying && currentDuration > 0 && !isScrubbing) {
    updateProgressBar();
  }
  requestAnimationFrame(animationLoop);
}
requestAnimationFrame(animationLoop);

// --- User Interaction Events ---

// Play/Pause
btnPlayPause.addEventListener('click', () => {
  window.miniplayerAPI.sendMediaCommand('toggle');
});

// Skip Next
btnNext.addEventListener('click', () => {
  window.miniplayerAPI.sendMediaCommand('next');
});

// Skip Prev
btnPrev.addEventListener('click', () => {
  window.miniplayerAPI.sendMediaCommand('prev');
});

// --- Draggable & Scrubbable Timeline Engine ---
function calculateSeekTime(e) {
  if (currentDuration <= 0) return 0;
  const rect = progressBarContainer.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const ratio = Math.max(0, Math.min(1, clickX / rect.width));
  return ratio * currentDuration;
}

progressBarContainer.addEventListener('mousedown', (e) => {
  if (currentDuration <= 0) return;
  isScrubbing = true;
  progressBarContainer.classList.add('dragging');
  scrubPosition = calculateSeekTime(e);
  updateProgressBar();

  const onMouseMove = (moveEvent) => {
    if (!isScrubbing) return;
    scrubPosition = calculateSeekTime(moveEvent);
    updateProgressBar();
  };

  const onMouseUp = (upEvent) => {
    if (!isScrubbing) return;
    isScrubbing = false;
    progressBarContainer.classList.remove('dragging');
    const finalSeekTime = calculateSeekTime(upEvent);
    seekCooldownUntil = performance.now() + 1400;
    currentPosition = finalSeekTime;
    lastTickTime = performance.now();
    window.miniplayerAPI.sendMediaCommand('seek', finalSeekTime);
    updateProgressBar();
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
  };

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
});

// Theme Selection
function applyTheme(index) {
  THEMES.forEach(t => bodyEl.classList.remove(t.id));
  currentThemeIndex = index;
  const selected = THEMES[currentThemeIndex];
  bodyEl.classList.add(selected.id);

  // Update active state in popup menu
  document.querySelectorAll('.theme-option-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.theme, 10) === currentThemeIndex);
  });

  if (selected.isPixel && isCrtEnabled) {
    crtOverlay.classList.remove('disabled');
  } else {
    crtOverlay.classList.add('disabled');
  }

  renderCoverArt();
}

// --- Content View Switcher: 'lyrics' | 'history' (Preserves User Window Size, NO Auto-Resize) ---
function setContentView(view) {
  currentContentView = view;

  if (view === 'lyrics') {
    lyricsViewArea.classList.remove('hidden');
    historyViewArea.classList.add('hidden');
    btnToggleLyrics.classList.add('active');
    btnToggleHistory.classList.remove('active');
    if (activeLyricIndex >= 0) {
      setTimeout(() => {
        const activeEl = lyricsList.querySelector(`.lyric-line[data-index="${activeLyricIndex}"]`);
        if (activeEl) {
          const containerHeight = lyricsContainer.clientHeight;
          const targetTop = activeEl.offsetTop - (containerHeight / 2) + (activeEl.clientHeight / 2);
          lyricsContainer.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' });
        }
      }, 100);
    }
  } else {
    // History View
    lyricsViewArea.classList.add('hidden');
    historyViewArea.classList.remove('hidden');
    btnToggleLyrics.classList.remove('active');
    btnToggleHistory.classList.add('active');
    renderHistoryView();
  }
}

function renderHistoryView() {
  if (!historyItemsList) return;
  historyItemsList.innerHTML = '';

  if (!playbackHistory || playbackHistory.length === 0) {
    historyPlaceholder.style.display = 'flex';
    historyItemsList.style.display = 'none';
    return;
  }

  historyPlaceholder.style.display = 'none';
  historyItemsList.style.display = 'flex';

  const frag = document.createDocumentFragment();

  playbackHistory.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'history-item-card';

    const img = document.createElement('img');
    img.className = 'history-item-thumb';
    img.src = item.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="38" height="38" fill="%23333"><rect width="38" height="38"/></svg>';
    img.alt = item.title;

    const info = document.createElement('div');
    info.className = 'history-item-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'history-item-title';
    titleEl.textContent = item.title;

    const artistEl = document.createElement('div');
    artistEl.className = 'history-item-artist';
    artistEl.textContent = item.artist || 'Apple Music';

    info.appendChild(titleEl);
    info.appendChild(artistEl);

    const durEl = document.createElement('div');
    durEl.className = 'history-item-dur';
    durEl.textContent = item.duration ? formatTime(item.duration) : '';

    card.appendChild(img);
    card.appendChild(info);
    card.appendChild(durEl);

    frag.appendChild(card);
  });

  historyItemsList.appendChild(frag);
}

// Clear History Button
if (btnClearHistory) {
  btnClearHistory.addEventListener('click', (e) => {
    e.stopPropagation();
    playbackHistory = [];
    saveHistoryToStorage();
    renderHistoryView();
  });
}

// Toggle Lyrics View Button
btnToggleLyrics.addEventListener('click', () => {
  setContentView('lyrics');
});

// Toggle History View Button
btnToggleHistory.addEventListener('click', () => {
  setContentView('history');
});

// --- Settings & Theme Pop-up Menu Handlers (Triggered by Left ••• Button) ---
btnThemeSelector.addEventListener('click', (e) => {
  e.stopPropagation();
  themePopupMenu.classList.toggle('hidden');
});

btnCloseMenu.addEventListener('click', () => {
  themePopupMenu.classList.add('hidden');
});

// Close popups when clicking outside
document.addEventListener('click', (e) => {
  if (!themePopupMenu.contains(e.target) && e.target !== btnThemeSelector && !btnThemeSelector.contains(e.target)) {
    themePopupMenu.classList.add('hidden');
  }
});

// Theme Option Clicks in Popup
document.querySelectorAll('.theme-option-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const idx = parseInt(btn.dataset.theme, 10);
    applyTheme(idx);
  });
});



// Liquid Mesh Aura Toggle
if (menuToggleMesh) {
  menuToggleMesh.addEventListener('click', () => {
    isLiquidMeshEnabled = !isLiquidMeshEnabled;
    menuToggleMesh.classList.toggle('active', isLiquidMeshEnabled);
    menuToggleMesh.textContent = isLiquidMeshEnabled ? '🌊 Fluid Aura: ON' : '🌊 Fluid Aura: OFF';
    if (ambientGlowLayer) {
      ambientGlowLayer.classList.toggle('disabled', !isLiquidMeshEnabled);
    }
  });
}

// 8-Bit Pixel Dither Toggle
menuTogglePixel.addEventListener('click', () => {
  is8BitDither = !is8BitDither;
  menuTogglePixel.classList.toggle('active', is8BitDither);
  menuTogglePixel.textContent = is8BitDither ? '👾 8-Bit Art: ON' : '👾 8-Bit Art: OFF';
  renderCoverArt();
});

// CRT Scanlines Toggle
menuToggleCrt.addEventListener('click', () => {
  isCrtEnabled = !isCrtEnabled;
  menuToggleCrt.classList.toggle('active', isCrtEnabled);
  menuToggleCrt.textContent = isCrtEnabled ? '⚡ CRT FX: ON' : '⚡ CRT FX: OFF';
  crtOverlay.classList.toggle('disabled', !isCrtEnabled);
});

// Pin / Always-On-Top
btnPin.addEventListener('click', async () => {
  isPinned = await window.miniplayerAPI.toggleAlwaysOnTop();
  btnPin.classList.toggle('win-btn-danger', !isPinned);
  btnPin.title = isPinned ? 'Always on Top: ON' : 'Always on Top: OFF';
});

// Window Controls
btnMin.addEventListener('click', () => {
  window.miniplayerAPI.minimizeWindow();
});

btnClose.addEventListener('click', () => {
  window.miniplayerAPI.closeWindow();
});

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (!themePopupMenu.classList.contains('hidden')) {
      themePopupMenu.classList.add('hidden');
      return;
    }
  }

  if (e.code === 'Space' && !e.target.closest('input, textarea')) {
    e.preventDefault();
    window.miniplayerAPI.sendMediaCommand('toggle');
  } else if (e.code === 'ArrowRight' && e.ctrlKey) {
    window.miniplayerAPI.sendMediaCommand('next');
  } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
    window.miniplayerAPI.sendMediaCommand('prev');
  } else if (e.key === 't' || e.key === 'T') {
    if (!e.ctrlKey && !e.metaKey) {
      const nextIdx = (currentThemeIndex + 1) % THEMES.length;
      applyTheme(nextIdx);
    }
  } else if (e.key === 'm' || e.key === 'M') {
    if (!e.ctrlKey && !e.metaKey) {
      themePopupMenu.classList.toggle('hidden');
    }
  }
});

// Initialize with Default Apple Music OG theme
applyTheme(0);
drawDefaultPixelArt();


