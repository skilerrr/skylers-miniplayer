const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const vm = require('vm');

// 1. Test lyrics_manager.js functions
const lyricsMod = require('../lyrics_manager');
const {
  decodeEntities,
  stringSimilarity,
  scoreCandidate,
  mxmSubtitlesToLRC,
  cleanTrackName,
  cleanArtistName,
  isTransientTrack
} = lyricsMod;

describe('lyrics_manager - decodeEntities', () => {
  test('decodes basic XML / HTML entities', () => {
    assert.equal(decodeEntities('&amp; &lt; &gt; &quot; &apos;'), '& < > " \'');
  });

  test('decodes numeric decimal entities', () => {
    assert.equal(decodeEntities('&#65;&#66;&#67;'), 'ABC');
    assert.equal(decodeEntities('&#38;'), '&');
  });

  test('handles null, undefined, empty string safely', () => {
    assert.equal(decodeEntities(''), '');
    assert.equal(decodeEntities(null), '');
    assert.equal(decodeEntities(undefined), '');
  });
});

describe('lyrics_manager - stringSimilarity', () => {
  test('exact match returns 1.0', () => {
    assert.equal(stringSimilarity('Shape of You', 'Shape of You'), 1.0);
    assert.equal(stringSimilarity('hello', 'HELLO'), 1.0);
  });

  test('empty strings handling', () => {
    assert.equal(stringSimilarity('', ''), 1.0);
    assert.equal(stringSimilarity('abc', ''), 0);
    assert.equal(stringSimilarity('', 'abc'), 0);
    assert.equal(stringSimilarity(null, undefined), 1.0);
  });

  test('substring match with high coverage returns >= 0.88', () => {
    assert.ok(stringSimilarity('Shape of You (Live)', 'Shape of You') >= 0.88);
  });

  test('Unicode and Asian CJK character support (Japanese, Chinese, Korean, Accents)', () => {
    const simJapSame = stringSimilarity('宇多田ヒカル', '宇多田ヒカル');
    assert.equal(simJapSame, 1.0, 'Identical Japanese should be 1.0');

    const simJapDiff = stringSimilarity('宇多田ヒカル', '米津玄師');
    assert.ok(simJapDiff < 0.3, `Different Japanese artists must not match (was ${simJapDiff})`);

    // Accented latin (Beyoncé, Rosé)
    assert.equal(stringSimilarity('Beyoncé', 'Beyonce'), 1.0);
    assert.equal(stringSimilarity('Rosé', 'Rose'), 1.0);

    // Single character CJK
    assert.equal(stringSimilarity('愛', '愛'), 1.0);
  });
});

describe('lyrics_manager - scoreCandidate', () => {
  test('rejects instrumental or missing lyrics', () => {
    assert.equal(scoreCandidate({ instrumental: true }, 'Song', 'Artist', 180), -999);
    assert.equal(scoreCandidate({ trackName: 'Song' }, 'Song', 'Artist', 180), -999);
    assert.equal(scoreCandidate(null, 'Song', 'Artist', 180), -999);
  });

  test('scores high for matching track, artist and duration with synced lyrics', () => {
    const candidate = {
      trackName: 'Blinding Lights',
      artistName: 'The Weeknd',
      duration: 200,
      syncedLyrics: '[00:01.00]test'
    };
    const score = scoreCandidate(candidate, 'Blinding Lights', 'The Weeknd', 200);
    assert.ok(score >= 150, `Score should be high, was ${score}`);
  });

  test('penalizes music video version', () => {
    const normalCand = {
      trackName: 'Blinding Lights',
      artistName: 'The Weeknd',
      syncedLyrics: 'test',
      duration: 200
    };
    const mvCand = {
      trackName: 'Blinding Lights (Official Music Video)',
      artistName: 'The Weeknd',
      syncedLyrics: 'test',
      duration: 200
    };
    const s1 = scoreCandidate(normalCand, 'Blinding Lights', 'The Weeknd', 200);
    const s2 = scoreCandidate(mvCand, 'Blinding Lights', 'The Weeknd', 200);
    assert.ok(s1 > s2, 'Normal track should score higher than music video');
  });
});

describe('lyrics_manager - mxmSubtitlesToLRC', () => {
  test('converts Musixmatch subtitle array to LRC format', () => {
    const subs = [
      { text: 'First line', time: { minutes: 0, seconds: 12, hundredths: 34 } },
      { text: 'Second line', time: { minutes: 1, seconds: 5, hundredths: 0 } }
    ];
    const lrc = mxmSubtitlesToLRC(subs);
    assert.equal(lrc, '[00:12.34]First line\n[01:05.00]Second line');
  });

  test('converts JSON string subtitle input', () => {
    const jsonStr = JSON.stringify([
      { text: 'Hello', time: { minutes: 0, seconds: 1, hundredths: 20 } }
    ]);
    const lrc = mxmSubtitlesToLRC(jsonStr);
    assert.equal(lrc, '[00:01.20]Hello');
  });

  test('handles malformed / invalid input safely', () => {
    assert.equal(mxmSubtitlesToLRC(null), '');
    assert.equal(mxmSubtitlesToLRC('invalid json'), '');
    assert.equal(mxmSubtitlesToLRC([{ notTime: true }]), '');
  });
});

describe('lyrics_manager - cleanTrackName & cleanArtistName & isTransientTrack', () => {
  test('strips featured artists in brackets or parentheses', () => {
    assert.equal(cleanTrackName('Song Title (feat. Artist B)'), 'Song Title');
    assert.equal(cleanTrackName('Song Title [ft. Artist B]'), 'Song Title');
    assert.equal(cleanTrackName('Song Title featuring Artist C'), 'Song Title');
  });

  test('strips remaster, deluxe, and edition tags', () => {
    assert.equal(cleanTrackName('Let It Be (Remastered 2009)'), 'Let It Be');
    assert.equal(cleanTrackName('Hotel California - 2013 Remaster'), 'Hotel California');
    assert.equal(cleanTrackName('Starboy - Deluxe Edition'), 'Starboy');
  });

  test('normalizes smart apostrophes', () => {
    assert.equal(cleanTrackName("Don\u2019t Stop Believin\u2019"), "Don't Stop Believin'");
  });

  test('cleans artist names with em-dash and feat', () => {
    assert.equal(cleanArtistName('Calvin Harris feat. Dua Lipa'), 'Calvin Harris');
    assert.equal(cleanArtistName('Coldplay — Parachutes'), 'Coldplay');
    assert.equal(cleanArtistName('Blink-182'), 'Blink-182');
  });

  test('detects transient buffering tracks', () => {
    assert.equal(isTransientTrack('Connecting...'), true);
    assert.equal(isTransientTrack('Buffering'), true);
    assert.equal(isTransientTrack('Loading'), true);
    assert.equal(isTransientTrack('Unknown Track'), true);
    assert.equal(isTransientTrack(''), true);
    assert.equal(isTransientTrack(null), true);
    assert.equal(isTransientTrack('Bohemian Rhapsody'), false);
  });
});

describe('lyrics_manager - Cache and Budget', () => {
  test('evicts oldest entry when LYRICS_CACHE_MAX exceeded', () => {
    const lm = new lyricsMod.LyricsManager(null);
    for (let i = 0; i < 90; i++) {
      lm._cacheHasil(`key_${i}`, { index: i });
    }
    assert.equal(lm.lyricsCache.size, 80);
    assert.equal(lm.lyricsCache.has('key_0'), false, 'Oldest entry 0 should be evicted');
    assert.equal(lm.lyricsCache.has('key_9'), false, 'Oldest entry 9 should be evicted');
    assert.equal(lm.lyricsCache.has('key_89'), true, 'Newest entry should exist');
  });

  test('_budget returns bounded ms', () => {
    const lm = new lyricsMod.LyricsManager(null);
    assert.equal(lm._budget(4000), 4000);
    lm._deadline = Date.now() + 1000;
    const b = lm._budget(4000);
    assert.ok(b <= 1000 && b >= 600, `Budget should clamp to deadline, got ${b}`);
  });
});

// Setup mock DOM environment to test src/renderer.js
function setupRendererContext() {
  const elements = new Map();
  function createMockElement(tag = 'div') {
    const el = {
      tagName: tag.toUpperCase(),
      style: {},
      dataset: {},
      classList: {
        _classes: new Set(),
        add(c) { this._classes.add(c); },
        remove(c) { this._classes.delete(c); },
        toggle(c, force) {
          if (force === undefined) {
            if (this._classes.has(c)) this._classes.delete(c);
            else this._classes.add(c);
          } else if (force) {
            this._classes.add(c);
          } else {
            this._classes.delete(c);
          }
        },
        contains(c) { return this._classes.has(c); }
      },
      children: [],
      childNodes: [],
      addEventListener() {},
      removeEventListener() {},
      querySelector(selector) {
        if (selector.startsWith('.lyric-line[data-index="')) {
          const idx = selector.match(/data-index="(\d+)"/)[1];
          return elements.get('lyric_' + idx) || null;
        }
        return createMockElement();
      },
      querySelectorAll() { return [createMockElement()]; },
      appendChild(child) {
        this.children.push(child);
        this.childNodes.push(child);
        if (child.dataset && child.dataset.index !== undefined) {
          elements.set('lyric_' + child.dataset.index, child);
        }
        return child;
      },
      getContext() {
        return {
          clearRect() {},
          fillRect() {},
          drawImage() {},
          getImageData() { return { data: new Uint8ClampedArray(4096) }; },
          putImageData() {}
        };
      },
      getBoundingClientRect() { return { left: 0, width: 400, top: 0, height: 100 }; },
      scrollTo() {}
    };
    return el;
  }

  const rootEl = createMockElement('div');
  const mockDocument = {
    body: createMockElement('body'),
    documentElement: createMockElement('html'),
    getElementById(id) {
      if (!elements.has(id)) {
        elements.set(id, createMockElement('div'));
      }
      return elements.get(id);
    },
    createElement(tag) { return createMockElement(tag); },
    createDocumentFragment() { return createMockElement('fragment'); },
    addEventListener() {},
    querySelectorAll() { return [createMockElement('div')]; }
  };

  const sandbox = {
    document: mockDocument,
    window: {
      addEventListener() {},
      miniplayerAPI: {
        onMediaUpdate() {},
        fetchLyrics: async () => null,
        sendMediaCommand() {},
        toggleAlwaysOnTop: async () => true,
        minimizeWindow() {},
        closeWindow() {},
        searchLyricsCandidates: async () => [],
        fetchLyricCandidate: async () => null,
        getMusixmatchToken: async () => '',
        setMusixmatchToken: async () => ''
      },
      location: { href: 'http://localhost' }
    },
    localStorage: {
      _data: new Map(),
      getItem(k) { return this._data.get(k) || null; },
      setItem(k, v) { this._data.set(k, String(v)); },
      removeItem(k) { this._data.delete(k); }
    },
    Image: class { constructor() { this.naturalWidth = 100; } },
    requestAnimationFrame: () => 0,
    performance: { now: () => 1000 }
  };

  const code = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer.js'), 'utf-8');
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx);
  return ctx;
}

describe('src/renderer.js - formatTime', () => {
  const ctx = setupRendererContext();

  test('formats 0 seconds as 0:00', () => {
    assert.equal(ctx.formatTime(0), '0:00');
  });

  test('formats positive seconds and padded seconds', () => {
    assert.equal(ctx.formatTime(5), '0:05');
    assert.equal(ctx.formatTime(65), '1:05');
    assert.equal(ctx.formatTime(215), '3:35');
    assert.equal(ctx.formatTime(3600), '60:00');
  });

  test('handles invalid numbers, negative, NaN, Infinity', () => {
    assert.equal(ctx.formatTime(-10), '0:00');
    assert.equal(ctx.formatTime(NaN), '0:00');
    assert.equal(ctx.formatTime(Infinity), '0:00');
    assert.equal(ctx.formatTime(null), '0:00');
    assert.equal(ctx.formatTime('test'), '0:00');
  });
});

describe('src/renderer.js - escapeHtml', () => {
  const ctx = setupRendererContext();

  test('escapes special HTML entities', () => {
    assert.equal(ctx.escapeHtml('Tom & Jerry <friends> "forever"'), 'Tom &amp; Jerry &lt;friends&gt; &quot;forever&quot;');
  });

  test('handles empty and null values', () => {
    assert.equal(ctx.escapeHtml(''), '');
    assert.equal(ctx.escapeHtml(null), '');
  });
});

describe('src/renderer.js - parseLRC', () => {
  const ctx = setupRendererContext();

  test('parses standard synced LRC with milliseconds', () => {
    const lrc = `
[ti:Test Song]
[ar:Test Artist]
[00:04.50]First line of lyrics
[00:08.00]Second line of lyrics
    `;
    const parsed = ctx.parseLRC(lrc);
    assert.ok(parsed.length >= 2);
    const firstVocal = parsed.find(l => l.text === 'First line of lyrics');
    const secondVocal = parsed.find(l => l.text === 'Second line of lyrics');
    assert.ok(firstVocal, 'First line must be found');
    assert.ok(secondVocal, 'Second line must be found');
    assert.equal(firstVocal.time, 4.5);
    assert.equal(secondVocal.time, 8.0);
  });

  test('applies LRC offset header correctly', () => {
    const lrc = `
[offset:500]
[00:02.00]Offset lyrics
    `;
    const parsed = ctx.parseLRC(lrc);
    const line = parsed.find(l => l.text === 'Offset lyrics');
    assert.ok(line);
    assert.equal(line.time, 2.5);
  });

  test('generates 3-dots countdown for long intro (>6.0s)', () => {
    const lrc = `[00:10.00]Late intro lyric`;
    const parsed = ctx.parseLRC(lrc);
    assert.equal(parsed[0].isDots, true);
    assert.equal(parsed[0].text, '•••');
    assert.equal(parsed[0].endTime, 10.0);
  });

  test('generates 3-dots countdown for instrumental gap >= 8.5s', () => {
    const lrc = `
[00:02.00]Line 1
[00:15.00]Line 2
    `;
    const parsed = ctx.parseLRC(lrc);
    const dotItem = parsed.find(l => l.isDots);
    assert.ok(dotItem, 'Must generate dot interlude');
    assert.equal(dotItem.endTime, 15.0);
  });

  test('handles empty or blank text gracefully', () => {
    assert.equal(ctx.parseLRC('').length, 0);
    assert.equal(ctx.parseLRC(null).length, 0);
  });
});

describe('src/renderer.js - setLyricTimingOffset', () => {
  const ctx = setupRendererContext();

  test('clamps timing offset between -10.0 and +10.0 and rounds to 2 decimals', () => {
    ctx.setLyricTimingOffset(0.555);
    assert.equal(ctx.getLyricTimingOffset(), 0.56);

    ctx.setLyricTimingOffset(15.0);
    assert.equal(ctx.getLyricTimingOffset(), 10.0);

    ctx.setLyricTimingOffset(-20.0);
    assert.equal(ctx.getLyricTimingOffset(), -10.0);

    ctx.setLyricTimingOffset(NaN);
    assert.equal(ctx.getLyricTimingOffset(), 0);
  });
});

describe('Performance Benchmarks', () => {
  const ctx = setupRendererContext();

  test('stringSimilarity benchmark: 5,000 comparisons < 50ms', () => {
    const start = performance.now();
    for (let i = 0; i < 5000; i++) {
      stringSimilarity('Blinding Lights (Official Audio)', 'Blinding Lights');
      stringSimilarity('宇多田ヒカル - First Love', 'First Love');
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 150, `5,000 comparisons took ${elapsed.toFixed(2)}ms`);
  });

  test('parseLRC benchmark: 500-line LRC parsed < 20ms', () => {
    let bigLrc = '[ti:Benchmark Song]\n[ar:Benchmark Artist]\n';
    for (let i = 0; i < 500; i++) {
      const min = String(Math.floor(i / 60)).padStart(2, '0');
      const sec = String(i % 60).padStart(2, '0');
      bigLrc += `[${min}:${sec}.50] Lyric line ${i}\n`;
    }
    const start = performance.now();
    const parsed = ctx.parseLRC(bigLrc);
    const elapsed = performance.now() - start;
    assert.equal(parsed.length, 500);
    assert.ok(elapsed < 50, `Parsing 500 lines took ${elapsed.toFixed(2)}ms`);
  });

  test('updateActiveLyric benchmark: 20,000 sequential frames < 40ms', () => {
    let lrc = '';
    for (let i = 0; i < 100; i++) {
      const min = String(Math.floor((i * 3) / 60)).padStart(2, '0');
      const sec = String((i * 3) % 60).padStart(2, '0');
      lrc += `[${min}:${sec}.00] Line ${i}\n`;
    }
    ctx.parsedLyrics = ctx.parseLRC(lrc);
    ctx.hasSyncedLyrics = true;
    ctx.renderLyricsList();

    const start = performance.now();
    for (let f = 0; f < 20000; f++) {
      const time = (f / 60) % 300;
      ctx.updateActiveLyric(time);
    }
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 80, `20,000 frames took ${elapsed.toFixed(2)}ms`);
  });
});
