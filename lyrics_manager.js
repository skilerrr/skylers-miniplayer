const path = require('path');
const fs = require('fs');

// Decode HTML entities (especially important for QQ Music & XML-like responses)
function decodeEntities(str) {
  if (!str) return '';
  return str
    .replace(/&#(\d+);/g, (_m, dec) => String.fromCharCode(dec))
    .replace(/&amp;/g, '&')
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

// Dice Bigram String Similarity for Candidate Verification
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

// Candidate scoring algorithm
function scoreCandidate(candidate, targetTrack, targetArtist, targetDuration) {
  if (!candidate) return -999;
  if (candidate.instrumental) return -999;
  if (!candidate.hasSynced && !candidate.hasPlain && !candidate.syncedLyrics && !candidate.plainLyrics) return -999;

  let score = 0;
  const isSynced = candidate.hasSynced ?? !!candidate.syncedLyrics;
  if (isSynced) score += 60;
  else score += 15;

  const candTitle = candidate.trackName || candidate.name || candidate.songname || candidate.title || '';
  const candArtist = candidate.artistName || candidate.singername || candidate.artist || '';

  const trackSim = stringSimilarity(candTitle, targetTrack);
  const artistSim = stringSimilarity(candArtist, targetArtist);

  if (trackSim < 0.25) return -999;

  score += trackSim * 60;
  score += artistSim * 40;

  const candDur = candidate.duration || 0;
  if (targetDuration > 0 && candDur > 0) {
    const diff = Math.abs(candDur - targetDuration);
    if (diff <= 3) score += 30;
    else if (diff <= 8) score += 20;
    else if (diff <= 25) score += 10;
    // We do NOT penalize heavily for duration diff if title & artist match,
    // because many database entries have incorrect metadata duration (e.g. LRCLIB 180s for 320s song)
  }

  const candNameLow = (candTitle + ' ' + candArtist).toLowerCase();
  if (candNameLow.includes('official video') || candNameLow.includes('music video') || candNameLow.includes('video version')) {
    score -= 40;
  }

  return score;
}

// Fetch helper with AbortController timeout
async function fetchWithTimeout(url, options = {}, timeoutMs = 4500) {
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

// Musixmatch Subtitles JSON to standard LRC converter
function mxmSubtitlesToLRC(subtitlesJson) {
  try {
    const list = typeof subtitlesJson === 'string' ? JSON.parse(subtitlesJson) : subtitlesJson;
    if (!Array.isArray(list)) return '';
    return list.map(item => {
      const min = String(item.time.minutes).padStart(2, '0');
      const sec = String(item.time.seconds).padStart(2, '0');
      const hun = String(item.time.hundredths).padStart(2, '0');
      return `[${min}:${sec}.${hun}]${item.text || ''}`;
    }).join('\n');
  } catch (e) {
    return '';
  }
}

// Budget total buat satu pencarian mode 'auto'. Dulu worst case-nya ~45 detik
// (LRCLIB 4 strategi + QQ search & 5 lagu + Musixmatch, semua berurutan).
const AUTO_BUDGET_MS = 12000;

// Batas entri cache lirik; Map jaga urutan insert jadi yang paling lama bisa dibuang
const LYRICS_CACHE_MAX = 80;

class LyricsManager {
  constructor(app) {
    this.app = app;
    this.lyricsCache = new Map();
    this._deadline = 0;
    this.configPath = null;
    this.musixmatchToken = '';
    this.initToken();
  }

  // Sisa waktu budget buat pencarian yang sedang jalan (Infinity = tanpa batas)
  _sisaWaktu() {
    return this._deadline ? this._deadline - Date.now() : Infinity;
  }

  // Timeout per request dibatasi sisa budget biar nggak lewat dari deadline
  _budget(ms) {
    if (!this._deadline) return ms;
    return Math.max(600, Math.min(ms, this._deadline - Date.now()));
  }

  // Cache dengan batas ukuran: buang entri paling lama pas udah penuh
  _cacheHasil(key, value) {
    this.lyricsCache.set(key, value);
    while (this.lyricsCache.size > LYRICS_CACHE_MAX) {
      this.lyricsCache.delete(this.lyricsCache.keys().next().value);
    }
  }

  initToken() {
    try {
      if (this.app) {
        this.configPath = path.join(this.app.getPath('userData'), 'miniplayer_config.json');
        if (fs.existsSync(this.configPath)) {
          const cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8'));
          if (cfg && cfg.musixmatchToken) {
            this.musixmatchToken = cfg.musixmatchToken.trim();
          }
        }
      }
    } catch (e) {
      console.error('Error reading miniplayer config:', e);
    }
  }

  setMusixmatchToken(token) {
    this.musixmatchToken = (token || '').trim();
    try {
      if (this.configPath) {
        let cfg = {};
        if (fs.existsSync(this.configPath)) {
          try { cfg = JSON.parse(fs.readFileSync(this.configPath, 'utf8')); } catch {}
        }
        cfg.musixmatchToken = this.musixmatchToken;
        fs.writeFileSync(this.configPath, JSON.stringify(cfg, null, 2), 'utf8');
      }
    } catch (e) {
      console.error('Error saving miniplayer config:', e);
    }
    return this.musixmatchToken;
  }

  getMusixmatchToken() {
    return this.musixmatchToken;
  }

  // 1. Local LRC files provider
  findLocalLrc(track, artist) {
    try {
      const candidateDirs = [
        path.join(__dirname, 'lyrics'),
        path.join(path.dirname(process.execPath), 'lyrics'),
        this.app ? path.join(this.app.getPath('userData'), 'lyrics') : null
      ].filter(Boolean);

      const cleanT = (track || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const cleanA = (artist || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const lyricsDir of candidateDirs) {
        if (!fs.existsSync(lyricsDir)) continue;
        const files = fs.readdirSync(lyricsDir);
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.lrc')) continue;
          const fBase = f.replace(/\.lrc$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
          if (fBase === cleanT || fBase === `${cleanA}${cleanT}` || fBase === `${cleanT}${cleanA}` || fBase.includes(cleanT)) {
            const fullPath = path.join(lyricsDir, f);
            const content = fs.readFileSync(fullPath, 'utf-8');
            return {
              syncedLyrics: content,
              plainLyrics: null,
              trackName: f.replace(/\.lrc$/i, ''),
              artistName: artist || 'Local File',
              source: 'Local',
              sourceKey: 'local',
              filePath: fullPath
            };
          }
        }
      }
    } catch (err) {
      console.error('Error reading local lyrics:', err);
    }
    return null;
  }

  searchLocalLrc(query) {
    const results = [];
    try {
      const candidateDirs = [
        path.join(__dirname, 'lyrics'),
        path.join(path.dirname(process.execPath), 'lyrics'),
        this.app ? path.join(this.app.getPath('userData'), 'lyrics') : null
      ].filter(Boolean);

      const qLow = (query || '').toLowerCase().replace(/[^a-z0-9]/g, '');

      for (const lyricsDir of candidateDirs) {
        if (!fs.existsSync(lyricsDir)) continue;
        const files = fs.readdirSync(lyricsDir);
        for (const f of files) {
          if (!f.toLowerCase().endsWith('.lrc')) continue;
          const fClean = f.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!qLow || fClean.includes(qLow)) {
            const fullPath = path.join(lyricsDir, f);
            results.push({
              id: `local_${fClean}`,
              source: 'Local',
              sourceKey: 'local',
              trackName: f.replace(/\.lrc$/i, ''),
              artistName: 'Custom Local File',
              albumName: 'Local Folder',
              duration: 0,
              isSynced: true,
              hasSynced: true,
              hasPlain: false,
              preview: 'Custom .lrc file from lyrics/ folder',
              payload: { filePath: fullPath }
            });
          }
        }
      }
    } catch (e) {}
    return results;
  }

  // Ambil hasil search LRCLIB terbaik: utamakan yang punya syncedLyrics,
  // sisanya baru plain. Dipakai Strategi C & D (dulu logikanya diduplikat).
  _pickFromSearch(results, track, artist, durRound) {
    if (!Array.isArray(results) || results.length === 0) return null;
    const scored = results
      .map(r => ({ r, score: scoreCandidate(r, track, artist, durRound) }))
      .filter(item => item.score >= 30)
      .sort((a, b) => b.score - a.score);

    const best = scored.find(item => item.r.syncedLyrics) || (scored[0] && scored[0].r.plainLyrics ? scored[0] : null);
    if (!best) return null;
    return {
      syncedLyrics: best.r.syncedLyrics || null,
      plainLyrics: best.r.plainLyrics || null,
      trackName: best.r.trackName,
      artistName: best.r.artistName,
      source: 'LRCLIB',
      sourceKey: 'lrclib'
    };
  }

  // 2. LRCLIB Provider
  async fetchFromLrclib(track, artist, duration) {
    const headers = { 'User-Agent': 'AppleMusicPixelMiniplayer/1.2 (https://github.com)' };
    const durRound = duration && duration > 0 ? Math.round(duration) : 0;

    // Strategy A: Direct /api/get with exact duration
    if (durRound > 0) {
      try {
        const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}&duration=${durRound}`;
        const res = await fetchWithTimeout(url, { headers }, this._budget(4000));
        if (res.ok) {
          const data = await res.json();
          if (data && data.syncedLyrics) {
            return {
              syncedLyrics: data.syncedLyrics,
              plainLyrics: data.plainLyrics || null,
              trackName: data.trackName,
              artistName: data.artistName,
              source: 'LRCLIB',
              sourceKey: 'lrclib'
            };
          }
        }
      } catch (e) {}
    }

    // Strategy B: Direct /api/get without duration
    try {
      const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
      const res = await fetchWithTimeout(url, { headers }, this._budget(4000));
      if (res.ok) {
        const data = await res.json();
        if (data && data.syncedLyrics) {
          return {
            syncedLyrics: data.syncedLyrics,
            plainLyrics: data.plainLyrics || null,
            trackName: data.trackName,
            artistName: data.artistName,
            source: 'LRCLIB',
            sourceKey: 'lrclib'
          };
        }
      }
    } catch (e) {}

    // Strategy C: Search with track_name & candidate scoring
    try {
      const url = `https://lrclib.net/api/search?track_name=${encodeURIComponent(track)}`;
      const res = await fetchWithTimeout(url, { headers }, this._budget(4500));
      if (res.ok) {
        const results = await res.json();
        const picked = this._pickFromSearch(results, track, artist, durRound);
        if (picked) return picked;
      }
    } catch (e) {}

    // Strategy D: Broad search ?q=track artist
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(`${track} ${artist}`.trim())}`;
      const res = await fetchWithTimeout(url, { headers }, this._budget(4500));
      if (res.ok) {
        const results = await res.json();
        const picked = this._pickFromSearch(results, track, artist, durRound);
        if (picked) return picked;
      }
    } catch (e) {}

    return null;
  }

  async searchLrclibCandidates(query) {
    const headers = { 'User-Agent': 'AppleMusicPixelMiniplayer/1.2 (https://github.com)' };
    const candidates = [];
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      const res = await fetchWithTimeout(url, { headers }, this._budget(4500));
      if (res.ok) {
        const list = await res.json();
        if (Array.isArray(list)) {
          for (const item of list) {
            const isSynced = !!item.syncedLyrics;
            let preview = '';
            if (isSynced) {
              const lines = item.syncedLyrics.split('\n').filter(l => l.trim().length > 0);
              preview = lines.slice(0, 2).map(l => l.replace(/\[\d{2}:\d{2}(?:\.\d{2,3})?\]/g, '').trim()).filter(Boolean).join(' / ');
            } else if (item.plainLyrics) {
              preview = item.plainLyrics.split('\n').filter(l => l.trim().length > 0).slice(0, 2).join(' / ');
            }
            candidates.push({
              id: `lrclib_${item.id}`,
              source: 'LRCLIB',
              sourceKey: 'lrclib',
              trackName: item.trackName || item.name || query,
              artistName: item.artistName || 'Unknown Artist',
              albumName: item.albumName || '',
              duration: item.duration || 0,
              isSynced,
              hasSynced: isSynced,
              hasPlain: !!item.plainLyrics,
              preview: preview || 'Lyrics available',
              payload: {
                syncedLyrics: item.syncedLyrics,
                plainLyrics: item.plainLyrics,
                trackName: item.trackName,
                artistName: item.artistName
              }
            });
          }
        }
      }
    } catch (e) {}
    return candidates;
  }

  // 3. QQ Music Provider (Tencent)
  async fetchFromQQ(track, artist, duration) {
    const durRound = duration && duration > 0 ? Math.round(duration) : 0;
    try {
      const q = `${track} ${artist}`.trim();
      const sUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=8&w=${encodeURIComponent(q)}&format=json`;
      const sRes = await fetchWithTimeout(sUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, this._budget(4500));
      if (!sRes.ok) return null;
      const data = await sRes.json();
      if (!data.data || !data.data.song || !Array.isArray(data.data.song.list) || data.data.song.list.length === 0) {
        return null;
      }

      const songList = data.data.song.list;
      let fallbackPlain = null;

      // Check first 5 candidates for synced lyrics
      for (const s of songList.slice(0, 5)) {
        if (this._sisaWaktu() <= 600) break;
        try {
          const lUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${s.songmid}&format=json&nobase64=1`;
          const lRes = await fetchWithTimeout(lUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, this._budget(2500));
          if (lRes.ok) {
            const lData = await lRes.json();
            const decoded = decodeEntities(lData.lyric || '');
            const hasTimestamps = /\[\d{2}:\d{2}/.test(decoded);
            const artistStr = (s.singer && Array.isArray(s.singer)) ? s.singer.map(x => x.name).join('/') : artist;

            if (hasTimestamps) {
              return {
                syncedLyrics: decoded,
                plainLyrics: null,
                trackName: s.songname || track,
                artistName: artistStr,
                source: 'QQ Music',
                sourceKey: 'qq'
              };
            } else if (decoded && !fallbackPlain) {
              fallbackPlain = {
                syncedLyrics: null,
                plainLyrics: decoded,
                trackName: s.songname || track,
                artistName: artistStr,
                source: 'QQ Music',
                sourceKey: 'qq'
              };
            }
          }
        } catch (e) {}
      }

      return fallbackPlain;
    } catch (e) {
      return null;
    }
  }

  async searchQQCandidates(query) {
    const candidates = [];
    try {
      const sUrl = `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=8&w=${encodeURIComponent(query)}&format=json`;
      const sRes = await fetchWithTimeout(sUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, this._budget(4500));
      if (!sRes.ok) return candidates;
      const data = await sRes.json();
      if (data.data && data.data.song && Array.isArray(data.data.song.list)) {
        for (const s of data.data.song.list) {
          const artistStr = (s.singer && Array.isArray(s.singer)) ? s.singer.map(x => x.name).join('/') : '';
          candidates.push({
            id: `qq_${s.songmid}`,
            source: 'QQ Music',
            sourceKey: 'qq',
            trackName: s.songname,
            artistName: artistStr,
            albumName: s.albumname || '',
            duration: s.interval || 0,
            isSynced: true, // Will be verified upon fetch
            hasSynced: true,
            hasPlain: true,
            preview: `QQ Music Catalog • ${s.songname} (${artistStr})`,
            payload: {
              songmid: s.songmid,
              trackName: s.songname,
              artistName: artistStr
            }
          });
        }
      }
    } catch (e) {}
    return candidates;
  }

  // 4. Musixmatch Provider
  async fetchFromMusixmatch(track, artist) {
    const token = this.musixmatchToken;
    if (!token) return null;

    try {
      const url = `https://apic-desktop.musixmatch.com/ws/1.1/matcher.subtitle.get?app_id=web-desktop-app-v1.0&usertoken=${encodeURIComponent(token)}&q_track=${encodeURIComponent(track)}&q_artist=${encodeURIComponent(artist)}`;
      const res = await fetchWithTimeout(url, {}, this._budget(4500));
      if (res.ok) {
        const data = await res.json();
        if (data.message && data.message.body && data.message.body.subtitle) {
          const subBody = data.message.body.subtitle.subtitle_body;
          const lrc = mxmSubtitlesToLRC(subBody);
          if (lrc) {
            return {
              syncedLyrics: lrc,
              plainLyrics: null,
              trackName: track,
              artistName: artist,
              source: 'Musixmatch',
              sourceKey: 'musixmatch'
            };
          }
        }
      }
    } catch (e) {}

    // Fallback: Musixmatch matcher.lyrics.get (plain text)
    try {
      const url = `https://apic-desktop.musixmatch.com/ws/1.1/matcher.lyrics.get?app_id=web-desktop-app-v1.0&usertoken=${encodeURIComponent(token)}&q_track=${encodeURIComponent(track)}&q_artist=${encodeURIComponent(artist)}`;
      const res = await fetchWithTimeout(url, {}, this._budget(4500));
      if (res.ok) {
        const data = await res.json();
        if (data.message && data.message.body && data.message.body.lyrics) {
          let plain = data.message.body.lyrics.lyrics_body || '';
          // Strip disclaimer
          plain = plain.replace(/\*\*\*\*\*\*\* This Lyrics is NOT for Commercial use \*\*\*\*\*\*\*/gi, '').trim();
          if (plain) {
            return {
              syncedLyrics: null,
              plainLyrics: plain,
              trackName: track,
              artistName: artist,
              source: 'Musixmatch',
              sourceKey: 'musixmatch'
            };
          }
        }
      }
    } catch (e) {}

    return null;
  }

  async searchMusixmatchCandidates(query) {
    const candidates = [];
    const token = this.musixmatchToken;
    if (!token) {
      candidates.push({
        id: 'mxm_token_hint',
        source: 'Musixmatch',
        sourceKey: 'musixmatch',
        trackName: 'Musixmatch User Token Required',
        artistName: 'Configure in Settings (•••)',
        albumName: 'Token needed for Musixmatch API',
        duration: 0,
        isSynced: false,
        hasSynced: false,
        hasPlain: false,
        preview: 'Enter your personal musixmatchUserToken in Settings menu to enable Musixmatch sync!',
        payload: { isHint: true }
      });
      return candidates;
    }

    try {
      const url = `https://apic-desktop.musixmatch.com/ws/1.1/track.search?app_id=web-desktop-app-v1.0&usertoken=${encodeURIComponent(token)}&q=${encodeURIComponent(query)}&page_size=8`;
      const res = await fetchWithTimeout(url, {}, this._budget(4500));
      if (res.ok) {
        const data = await res.json();
        if (data.message && data.message.body && Array.isArray(data.message.body.track_list)) {
          for (const item of data.message.body.track_list) {
            const t = item.track;
            candidates.push({
              id: `mxm_${t.track_id}`,
              source: 'Musixmatch',
              sourceKey: 'musixmatch',
              trackName: t.track_name,
              artistName: t.artist_name,
              albumName: t.album_name || '',
              duration: t.track_length || 0,
              isSynced: t.has_subtitles === 1,
              hasSynced: t.has_subtitles === 1,
              hasPlain: t.has_lyrics === 1,
              preview: `Musixmatch Catalog • ${t.has_subtitles ? 'Synced Subtitle Available' : 'Plain Text'}`,
              payload: {
                track_id: t.track_id,
                track_name: t.track_name,
                artist_name: t.artist_name
              }
            });
          }
        }
      }
    } catch (e) {}

    return candidates;
  }

  // Multi-source Search Aggregator (Used by Candidate Selector Modal)
  async searchCandidates(query, track, artist, sourceFilter = 'all') {
    const q = (query || `${track || ''} ${artist || ''}`).trim();
    if (!q) return [];

    const tasks = [];
    const shouldRun = (src) => sourceFilter === 'all' || sourceFilter === 'auto' || sourceFilter === src;

    if (shouldRun('local')) {
      tasks.push(Promise.resolve(this.searchLocalLrc(q)));
    }
    if (shouldRun('lrclib')) {
      tasks.push(this.searchLrclibCandidates(q));
    }
    if (shouldRun('qq')) {
      tasks.push(this.searchQQCandidates(q));
    }
    if (shouldRun('musixmatch')) {
      tasks.push(this.searchMusixmatchCandidates(q));
    }

    const settled = await Promise.allSettled(tasks);
    const combined = [];
    for (const res of settled) {
      if (res.status === 'fulfilled' && Array.isArray(res.value)) {
        combined.push(...res.value);
      }
    }

    // Sort: Synced dulu, terus paling mirip sama target.
    // Skor kemiripan dihitung sekali per kandidat (dulu O(n log n) tiap pembanding).
    const target = track || q;
    const ranked = combined.map((c, i) => ({ c, i, sim: stringSimilarity(c.trackName, target) }));
    ranked.sort((a, b) => {
      if (a.c.isSynced !== b.c.isSynced) return a.c.isSynced ? -1 : 1;
      if (b.sim !== a.sim) return b.sim - a.sim;
      return a.i - b.i;
    });

    return ranked.map((x) => x.c);
  }

  // Fetch full lyrics for a selected candidate
  async fetchCandidateLyrics(candidate) {
    if (!candidate || !candidate.sourceKey) return null;

    if (candidate.sourceKey === 'local') {
      if (candidate.payload && candidate.payload.filePath && fs.existsSync(candidate.payload.filePath)) {
        const content = fs.readFileSync(candidate.payload.filePath, 'utf-8');
        return {
          syncedLyrics: content,
          plainLyrics: null,
          trackName: candidate.trackName,
          artistName: candidate.artistName,
          source: 'Local',
          sourceKey: 'local'
        };
      }
    } else if (candidate.sourceKey === 'lrclib') {
      if (candidate.payload && (candidate.payload.syncedLyrics || candidate.payload.plainLyrics)) {
        return {
          syncedLyrics: candidate.payload.syncedLyrics || null,
          plainLyrics: candidate.payload.plainLyrics || null,
          trackName: candidate.payload.trackName || candidate.trackName,
          artistName: candidate.payload.artistName || candidate.artistName,
          source: 'LRCLIB',
          sourceKey: 'lrclib'
        };
      }
    } else if (candidate.sourceKey === 'qq') {
      const mid = candidate.payload ? candidate.payload.songmid : null;
      if (mid) {
        try {
          const lUrl = `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${mid}&format=json&nobase64=1`;
          const lRes = await fetchWithTimeout(lUrl, { headers: { 'Referer': 'https://y.qq.com/' } }, this._budget(4500));
          if (lRes.ok) {
            const lData = await lRes.json();
            const decoded = decodeEntities(lData.lyric || '');
            const hasTimestamps = /\[\d{2}:\d{2}/.test(decoded);
            return {
              syncedLyrics: hasTimestamps ? decoded : null,
              plainLyrics: !hasTimestamps ? decoded : null,
              trackName: candidate.trackName,
              artistName: candidate.artistName,
              source: 'QQ Music',
              sourceKey: 'qq'
            };
          }
        } catch (e) {}
      }
    } else if (candidate.sourceKey === 'musixmatch') {
      const token = this.musixmatchToken;
      const trackId = candidate.payload ? candidate.payload.track_id : null;
      if (token && trackId) {
        try {
          const url = `https://apic-desktop.musixmatch.com/ws/1.1/track.subtitle.get?app_id=web-desktop-app-v1.0&usertoken=${encodeURIComponent(token)}&track_id=${trackId}`;
          const res = await fetchWithTimeout(url, {}, this._budget(4500));
          if (res.ok) {
            const data = await res.json();
            if (data.message && data.message.body && data.message.body.subtitle) {
              const lrc = mxmSubtitlesToLRC(data.message.body.subtitle.subtitle_body);
              if (lrc) {
                return {
                  syncedLyrics: lrc,
                  plainLyrics: null,
                  trackName: candidate.trackName,
                  artistName: candidate.artistName,
                  source: 'Musixmatch',
                  sourceKey: 'musixmatch'
                };
              }
            }
          }
        } catch (e) {}

        // Fallback plain
        try {
          const url = `https://apic-desktop.musixmatch.com/ws/1.1/track.lyrics.get?app_id=web-desktop-app-v1.0&usertoken=${encodeURIComponent(token)}&track_id=${trackId}`;
          const res = await fetchWithTimeout(url, {}, this._budget(4500));
          if (res.ok) {
            const data = await res.json();
            if (data.message && data.message.body && data.message.body.lyrics) {
              let plain = data.message.body.lyrics.lyrics_body || '';
              plain = plain.replace(/\*\*\*\*\*\*\* This Lyrics is NOT for Commercial use \*\*\*\*\*\*\*/gi, '').trim();
              return {
                syncedLyrics: null,
                plainLyrics: plain,
                trackName: candidate.trackName,
                artistName: candidate.artistName,
                source: 'Musixmatch',
                sourceKey: 'musixmatch'
              };
            }
          }
        } catch (e) {}
      }
    }

    return null;
  }

  // Unified Fetch Lyrics (Auto Fallback or Single Source)
  async fetchLyrics(track, artist, duration, preferredSource = 'auto') {
    if (!track) return null;

    const durRound = duration && duration > 0 ? Math.round(duration) : 0;
    const cacheKey = `${track.toLowerCase()}|${artist.toLowerCase()}|${durRound}|${preferredSource}`;

    if (this.lyricsCache.has(cacheKey)) {
      return this.lyricsCache.get(cacheKey);
    }

    let result = null;

    // Single source requested
    if (preferredSource === 'local') {
      result = this.findLocalLrc(track, artist);
    } else if (preferredSource === 'lrclib') {
      result = await this.fetchFromLrclib(track, artist, durRound);
    } else if (preferredSource === 'qq') {
      result = await this.fetchFromQQ(track, artist, durRound);
    } else if (preferredSource === 'musixmatch') {
      result = await this.fetchFromMusixmatch(track, artist);
    } else {
      // 'auto' mode: Smart Fallback (Local -> LRCLIB -> QQ Music -> Musixmatch)
      // Deadline dipasang biar track tanpa lirik nggak nyiksa 4 sumber sampai ~45 detik.
      const prevDeadline = this._deadline;
      this._deadline = Date.now() + AUTO_BUDGET_MS;
      try {
        // 1. Check local
        result = this.findLocalLrc(track, artist);

        // Sumber berikutnya cuma jalan kalau belum dapet lirik sinkron DAN budget masih ada
        const lanjut = () => (!result || !result.syncedLyrics) && this._sisaWaktu() > 800;

        // 2. Check LRCLIB
        if (lanjut()) {
          const lrclibRes = await this.fetchFromLrclib(track, artist, durRound);
          if (lrclibRes && lrclibRes.syncedLyrics) {
            result = lrclibRes;
          } else if (lrclibRes && !result) {
            result = lrclibRes; // save plain fallback
          }
        }

        // 3. Check QQ Music (Outstanding for Asian & Western music synced lyrics)
        if (lanjut()) {
          const qqRes = await this.fetchFromQQ(track, artist, durRound);
          if (qqRes && qqRes.syncedLyrics) {
            result = qqRes;
          } else if (qqRes && !result) {
            result = qqRes;
          }
        }

        // 4. Check Musixmatch (if configured)
        if (lanjut()) {
          const mxmRes = await this.fetchFromMusixmatch(track, artist);
          if (mxmRes && mxmRes.syncedLyrics) {
            result = mxmRes;
          } else if (mxmRes && !result) {
            result = mxmRes;
          }
        }
      } finally {
        this._deadline = prevDeadline;
      }
    }

    if (result) {
      this._cacheHasil(cacheKey, result);
    }

    return result;
  }
}

module.exports = {
  LyricsManager,
  decodeEntities,
  stringSimilarity,
  scoreCandidate
};
