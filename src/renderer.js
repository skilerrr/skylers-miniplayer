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
let isLyricsVisible = true;

let currentTrackKey = '';
let currentPosition = 0;
let currentDuration = 0;
let isPlaying = false;
let lastTickTime = performance.now();

// Dragging Seekbar & Cooldown State
let isScrubbing = false;
let scrubPosition = 0;
let seekCooldownUntil = 0;

// Parsed Lyrics array [{ time: 12.5, text: "...", isDots: false, endTime: 16.0 }]
let parsedLyrics = [];
let activeLyricIndex = -1;

// DOM Elements
const bodyEl = document.body;
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

const badgeLabel = document.getElementById('badgeLabel');
const crtOverlay = document.getElementById('crtOverlay');

const lyricsViewArea = document.getElementById('lyricsViewArea');
const lyricsContainer = document.getElementById('lyricsContainer');
const lyricsList = document.getElementById('lyricsList');
const lyricsPlaceholder = document.getElementById('lyricsPlaceholder');

const btnToggleLyrics = document.getElementById('btnToggleLyrics');
const btnEngineMenu = document.getElementById('btnEngineMenu');
const themePopupMenu = document.getElementById('themePopupMenu');
const btnCloseMenu = document.getElementById('btnCloseMenu');
const menuTogglePixel = document.getElementById('menuTogglePixel');
const menuToggleCrt = document.getElementById('menuToggleCrt');

// --- Helper: Format seconds to M:SS ---
function formatTime(seconds) {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// --- True Dynamic Album Color Extraction (Ultra-Lightweight 16x16) ---
function extractTrueAlbumColors(img) {
  try {
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const cCtx = c.getContext('2d');
    cCtx.drawImage(img, 0, 0, 16, 16);
    const data = cCtx.getImageData(0, 0, 16, 16).data;

    let dominantR = 0, dominantG = 0, dominantB = 0, totalCount = 0;
    let accentColor = null;
    let maxSaturation = -1;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];

      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const delta = max - min;
      const saturation = max === 0 ? 0 : delta / max;
      const brightness = max / 255;

      if (brightness > 0.08 && brightness < 0.96) {
        dominantR += r;
        dominantG += g;
        dominantB += b;
        totalCount++;

        if (saturation > maxSaturation && saturation > 0.22) {
          maxSaturation = saturation;
          accentColor = { r, g, b };
        }
      }
    }

    if (totalCount > 0) {
      dominantR = Math.round(dominantR / totalCount);
      dominantG = Math.round(dominantG / totalCount);
      dominantB = Math.round(dominantB / totalCount);

      const baseR = Math.max(14, Math.min(38, Math.round(dominantR * 0.26)));
      const baseG = Math.max(14, Math.min(42, Math.round(dominantG * 0.26)));
      const baseB = Math.max(16, Math.min(46, Math.round(dominantB * 0.26)));
      const darkBg = `rgb(${baseR}, ${baseG}, ${baseB})`;

      const primary = accentColor ? `rgb(${accentColor.r}, ${accentColor.g}, ${accentColor.b})` : `rgb(${dominantR}, ${dominantG}, ${dominantB})`;
      const secondary = `rgb(${dominantR}, ${dominantG}, ${dominantB})`;
      const glow = accentColor ? `rgba(${accentColor.r}, ${accentColor.g}, ${accentColor.b}, 0.38)` : `rgba(${dominantR}, ${dominantG}, ${dominantB}, 0.32)`;

      document.documentElement.style.setProperty('--color-primary', primary);
      document.documentElement.style.setProperty('--color-secondary', secondary);
      document.documentElement.style.setProperty('--color-dark', darkBg);
      document.documentElement.style.setProperty('--color-glow', glow);
    }
  } catch (e) {
    document.documentElement.style.setProperty('--color-primary', '#1d4e68');
    document.documentElement.style.setProperty('--color-secondary', '#cf353e');
    document.documentElement.style.setProperty('--color-dark', '#121d24');
    document.documentElement.style.setProperty('--color-glow', 'rgba(29, 78, 104, 0.4)');
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
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = targetSize;
    tempCanvas.height = targetSize;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.imageSmoothingEnabled = false;
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

  // Extract true album color palette
  if (rawCoverImg.src && rawCoverImg.naturalWidth > 0) {
    extractTrueAlbumColors(rawCoverImg);
  }
}

rawCoverImg.onload = () => renderCoverArt();

// --- LRC Synced Lyrics Engine with Apple Music Synced Three-Dots ---
function parseLRC(lrcText) {
  if (!lrcText) return [];
  const rawLines = lrcText.split('\n');
  const parsed = [];
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2,3})\]/;

  for (const line of rawLines) {
    const match = timeRegex.exec(line);
    if (match) {
      const min = parseInt(match[1], 10);
      const sec = parseInt(match[2], 10);
      const ms = parseFloat('0.' + match[3]);
      const totalSeconds = min * 60 + sec + ms;
      const text = line.replace(timeRegex, '').trim();
      if (text) {
        parsed.push({ time: totalSeconds, text, isDots: false });
      }
    }
  }

  parsed.sort((a, b) => a.time - b.time);
  if (parsed.length === 0) return [];

  const resultWithDots = [];

  // 1. Intro Instrumental Gap (if first vocal starts > 3.2s)
  if (parsed[0].time > 3.2) {
    resultWithDots.push({
      time: 0.5,
      endTime: parsed[0].time,
      text: '•••',
      isDots: true
    });
  }

  // 2. Interlude Gaps between lines
  for (let i = 0; i < parsed.length; i++) {
    resultWithDots.push(parsed[i]);

    if (i < parsed.length - 1) {
      const gap = parsed[i + 1].time - parsed[i].time;
      if (gap >= 6.0) {
        resultWithDots.push({
          time: parsed[i].time + 2.4,
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

    // Click lyric line to instantly jump/seek Apple Music to that exact timestamp!
    lineEl.addEventListener('click', () => {
      seekCooldownUntil = performance.now() + 1400;
      window.miniplayerAPI.sendMediaCommand('seek', lyric.time);
      currentPosition = lyric.time;
      lastTickTime = performance.now();
      updateProgressBar();
    });

    lyricsList.appendChild(lineEl);
  });
}

function updateActiveLyric(time) {
  if (parsedLyrics.length === 0) return;

  let activeIdx = -1;
  for (let i = 0; i < parsedLyrics.length; i++) {
    const lyric = parsedLyrics[i];
    const nextTime = (i < parsedLyrics.length - 1) ? parsedLyrics[i + 1].time : (lyric.endTime || lyric.time + 999);

    if (time >= lyric.time - 0.08 && time < nextTime) {
      activeIdx = i;
      break;
    } else if (time >= lyric.time - 0.08) {
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
        activeEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }
}

// --- SMTC Media Update Receiver ---
window.miniplayerAPI.onMediaUpdate((data) => {
  if (!data) return;

  const trackKey = `${data.title}|${data.artist}|${data.album}`;
  const isNewTrack = trackKey !== currentTrackKey && data.title;

  if (isNewTrack || (data.title && trackTitleEl.textContent === 'No Music Playing')) {
    currentTrackKey = trackKey;
    trackTitleEl.textContent = data.title || 'Unknown Track';
    
    const subtitle = data.album ? `${data.artist || ''} — ${data.album}` : (data.artist || 'Apple Music');
    trackSubtitleEl.textContent = subtitle;
    
    // Fetch live audio quality
    window.miniplayerAPI.fetchQuality(data.title, data.artist)
      .then((q) => {
        if (q && q.quality) {
          badgeLabel.textContent = q.quality;
          explicitBadge.style.display = q.explicit ? 'inline-block' : 'none';
        }
      })
      .catch(() => {});

    // Fetch lyrics for new track
    window.miniplayerAPI.fetchLyrics(data.title, data.artist, data.duration)
      .then((res) => {
        if (res && res.syncedLyrics) {
          parsedLyrics = parseLRC(res.syncedLyrics);
          renderLyricsList();
        } else if (res && res.plainLyrics) {
          parsedLyrics = res.plainLyrics.split('\n').filter(t => t.trim()).map(t => ({ time: -1, text: t.trim(), isDots: false }));
          renderLyricsList();
        } else {
          parsedLyrics = [];
          renderLyricsList();
        }
      })
      .catch(() => {
        parsedLyrics = [];
        renderLyricsList();
      });
  }

  // Update Cover Art
  if (data.cover) {
    if (rawCoverImg.src !== data.cover) {
      rawCoverImg.src = data.cover;
    }
  } else if (!data.title) {
    drawDefaultPixelArt();
  }

  // Playback Status & Timeline
  isPlaying = data.status === 'Playing';
  if (!isScrubbing && performance.now() > seekCooldownUntil) {
    currentPosition = data.position || 0;
  }
  currentDuration = data.duration || 0;
  lastTickTime = performance.now();

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

// --- Butter-Smooth 60FPS Animation Loop ---
function updateProgressBar() {
  let displayPos = currentPosition;
  if (isScrubbing) {
    displayPos = scrubPosition;
  } else if (isPlaying) {
    const elapsed = (performance.now() - lastTickTime) / 1000;
    displayPos = Math.min(currentPosition + elapsed, currentDuration || 9999);
  }

  const remaining = Math.max(0, currentDuration - displayPos);
  timeCurrentEl.textContent = formatTime(displayPos);
  timeRemainingEl.textContent = `-${formatTime(remaining)}`;

  const percent = currentDuration > 0 ? (displayPos / currentDuration) * 100 : 0;
  progressBarFill.style.width = `${percent}%`;
  progressBarThumb.style.left = `${percent}%`;

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

// Toggle Lyrics View Button with Apple Music Compact Auto-Rescale
btnToggleLyrics.addEventListener('click', () => {
  isLyricsVisible = !isLyricsVisible;
  btnToggleLyrics.classList.toggle('active', isLyricsVisible);
  bodyEl.classList.toggle('lyrics-collapsed', !isLyricsVisible);

  if (isLyricsVisible) {
    window.miniplayerAPI.resizeWindow(380, 580);
  } else {
    window.miniplayerAPI.resizeWindow(380, 156);
  }
});

// --- Settings & Theme Pop-up Menu Handlers ---
btnEngineMenu.addEventListener('click', (e) => {
  e.stopPropagation();
  themePopupMenu.classList.toggle('hidden');
});

btnCloseMenu.addEventListener('click', () => {
  themePopupMenu.classList.add('hidden');
});

// Close popups when clicking outside
document.addEventListener('click', (e) => {
  if (!themePopupMenu.contains(e.target) && e.target !== btnEngineMenu && !btnEngineMenu.contains(e.target)) {
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
  if (e.code === 'Space') {
    e.preventDefault();
    window.miniplayerAPI.sendMediaCommand('toggle');
  } else if (e.code === 'ArrowRight' && e.ctrlKey) {
    window.miniplayerAPI.sendMediaCommand('next');
  } else if (e.code === 'ArrowLeft' && e.ctrlKey) {
    window.miniplayerAPI.sendMediaCommand('prev');
  } else if (e.key === 't' || e.key === 'T') {
    const nextIdx = (currentThemeIndex + 1) % THEMES.length;
    applyTheme(nextIdx);
  } else if (e.key === 'm' || e.key === 'M') {
    themePopupMenu.classList.toggle('hidden');
  }
});

// Initialize with Default Apple Music OG theme
applyTheme(0);
drawDefaultPixelArt();
