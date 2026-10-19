# Skyler's Miniplayer — Performance Audit & Change Log (19 Oct 2026)

Semua temuan di bawah diverifikasi langsung dari source + runtime (bukan tebakan). Ukuran source: 5.674 baris
(`src/renderer.js` 1542, `src/style.css` 2123, `lyrics_manager.js` 802, `main.js` 457, `smtc_bridge.ps1` 273,
`src/index.html` 307, `AppVolumeHelper.cs` 153, `preload.js` 17).

---

## A. BUG / MASALAH NYATA

### A1. Bridge spamm cover 190 KB tiap 150 ms — 1 MB/s ke stdout main process (TERUKUR)
Capture bridge 8 detik sambil `Worth It (feat. Kid Ink)` playing:
- 37 baris output, total **7.065.706 byte** → rata-rata **190.722 byte/baris**
- `cover` field = **190.515 karakter** (base64 data-URI), dikirim di **37/37 baris (100%)**
- Metadata asli cuma ~207 byte/baris → **99,9% payload adalah gambar yang sama diulang**

Alurnya: `smtc_bridge.ps1:203` `$coverUrl = $lastCoverPath` (reuse data-URI) → `:244 cover = $coverUrl` tiap tick
→ Node `readline` + `JSON.parse` 190KB → `webContents.send` 190KB → renderer. ~6,7×/detik saat playing
≈ **1,27 MB/s**. Efeknya: CPU main+renderer, GC churn, dan `js-flags --max-old-space-size=128` (package.json)
bikin GC makin agresif.

**Fix:** kirim `cover` hanya saat `trackChanged` (tick lain `cover=""`; renderer sudah punya guard
`if (data.cover)`), atau tulis file sekali ke
`$env:TEMP\apple_music_miniplayer_cover.jpg`. Jalur file itu **sudah diharapkan main.js:78-82** tapi
**tidak pernah ditulis bridge** (`$coverFilePath` di `smtc_bridge.ps1:10` didefinisikan, 0 ref lain, dan ps1
tidak punya satu pun `Out-File`/`Set-Content`/`WriteAllBytes`). Jadi saat ini main.js:78-86 = dead path.

### A2. History membengkak 14,7 MB di localStorage (TERUKUR)
`Local Storage/leveldb` = **35 MB**. Satu value `miniplayer_playback_history` panjangnya **14.691.297 byte**
(UTF-16) — dari 40 cover × ~190 KB base64 yang ikut disimpan. Tiap start app: baca string ~7,3 juta karakter
lalu `JSON.parse` (≈15 MB). Ini sumber "berat pas buka" yang tidak kelihatan. Chromium juga punya kuota per
origin, jadi makin lama makin dekat ke `QuotaExceededError` (write-nya di dalam `try/catch` → history diam-diam
berhenti kesimpan, no error muncul).

**Fix:** simpan thumbnail 48–64 px (hasil dithered canvas yang sudah ada) sebagai cover history, bukan
data-URI original; atau cover history = `null` dan render placeholder. Potongan 15 MB → ~100 KB.

### A3. `main.js` punya 3 fungsi mati + 1 map tak terpakai (~114 baris, 25% file)
- `findLocalLrc()` L115-177 (63 baris) — 0 pemanggil. Versi hidupnya ada di `lyrics_manager.js`.
- `stringSimilarity()` L180-203, `scoreCandidate()` L205-230 — hanya saling memanggil satu sama lain, tidak
  dipakai jalur mana pun (lagi-lagi duplikat `lyrics_manager.js`).
- `const lyricsCache = new Map()` L20 — dideklarasikan, 0 pemakaian.

### A4. IPC mati
`'window-resize'` di main.js + `resizeWindow()` di `preload.js` tidak dipanggil renderer mana pun. Hapus
atau pakai.

### A5. `currentVolume = data.volume` di `src/renderer.js:840` → variabel undeclared
Tidak ada `let currentVolume` di file itu (cuma 1 kemunculan, di L840). Tanpa `'use strict'` ini jadi
implicit global; begitu renderer diubah ke module/strict → `ReferenceError`. Fitur volume sendiri sudah
setengah dibuang: `smtc_bridge.ps1:144` & `:232` panggil COM `AppVolumeController.GetVolume("AppleMusic")`
(pakai `AppVolumeHelper.cs`, enumerasi audio session) **tiap 150 ms** untuk nilai yang tidak dipakai UI mana pun.

### A6. 11 class CSS tak terpakai sama sekali di html/js
`volume-hud-overlay`, `volume-hud-card`, `volume-icon`, `volume-bar-track`, `volume-bar-fill`,
`volume-percent` (blok volume HUD, `style.css` ~1325-1382), `lyrics-collapsed` (+ turunannya
`body.lyrics-collapsed .app-header/.art-thumb-box/.content-view-area`), `badge-local`, `badge-lrclib`,
`badge-musixmatch`, `badge-qq`. Sisa fitur yang sudah dihapus tapi CSS-nya ketinggalan.

### A7. Badge kualitas audio itu dekoratif, bukan fakta
`fetchTrackAudioQuality()` menembak iTunes Search API — API itu **tidak** mengembalikan tier Apple Music
(Lossless/Hi-Res/Dolby butuh MusicKit + developer token). Logikanya: nama lagu/artis/album dicocokkan ke
array keyword hardcoded (Coldplay, Eagles, Beatles, ...) → "Hi-Res Lossless"; `item.isStreamable` (hampir
selalu `true`) → "Lossless". Jadi lagu AAC-only bisa dicap "Lossless", dan Coldplay apa pun dicap "Hi-Res".
**Pilihan:** (a) hapus badge, (b) turunkan jadi label "estimasi" + hapus klaim Hi-Res/Dolby, (c) biarkan
(tapi itu klaim yang salah). Rekomendasi: (b).

### A8. README bohong soal fitur
README menyebut siklus view mode `Split View → Lyrics Focus → Mini Compact` (hotkey `V`) — tidak ada di
kode (`isCrtEnabled`/theme/menu saja yang ada; `lyrics-collapsed` malah class mati). Dokumentasi menyebut
angka ukuran/rincian lain yang sudah tidak cocok → perbaiki README atau implementasi fiturnya.

---

## B. RINGAN (PERFORMA & UKURAN)

- **Font Google Fonts runtime** (5 keluarga: Press Start 2P, Silkscreen, VT323, DotGothic16, Plus Jakarta
  Sans): butuh internet, ada flash font-swap, dan offline langsung jatuh ke fallback. Bundle `.woff2` lokal
  (subset latin saja) → hilangkan request jaringan + FOUT.
- **`webSecurity: false`** di `webPreferences` — tidak perlu untuk data-URI (data: URI tidak kena CORS).
  Sudah ada `contextIsolation: true` + `nodeIntegration: false`, tapi `webSecurity:false` membuka
  same-origin protection. Tambah CSP meta juga belum ada.
- **Animasi `infinite` + `backdrop-filter` ×8 + `filter: blur` ×9** di window `transparent: true`: blur di
  atas window transparan itu jalur compositing paling mahal di Windows. Blob mesh bisa di-pause saat
  `status !== 'Playing'`.
- **`--max-old-space-size=128`** cuma kena main process; setelah A1 beres, cap ini malah bikin GC jalan
  lebih sering. Cabut atau naikkan.
- **Electron ^31.3.1** (sekarang 38.x). `dist/` = 406 MB installer lama (gitignored tapi masih makan disk),
  `node_modules` 349 MB, `cover_temp.jpg` 308 KB nyangkut di root.
- **Posisi & ukuran window tidak dipersist** — selalu `workAreaSize` primary display, bottom-right. Multi
  monitor bakal selalu balik ke monitor utama. Theme/CRT/8-bit/typewriter/mesh juga tidak dipersist (hanya
  lyric offset + sumber lirik yang disimpan) → inkonsisten.
- **`alwaysOnTop('screen-saver')`** di game fullscreen eksklusif bisa flicker; bikin `'floating'` atau
  configurable.
- **Tidak ada lint/typecheck/test script.** `test_*.ps1` cuma probe ad-hoc. Minimal: `eslint` +
  `node --check` di CI lokal, dan smoke test renderer.

---

## C. YANG KURANG (FITUR / POLISH)

1. **Tray icon + global media hotkey** — miniplayer tanpa tray sekarang harus dicari di taskbar kalau
   ketutup window lain; hotkey show/hide = UX paling murah dengan nilai paling besar.
2. **Click-through / lock mode** — window selalu di atas tapi nangkep klik di area kosong; toggle
   `setIgnoreMouseEvents(true, {forward:true})` = mode overlay proper.
3. **Persist layout** (posisi, ukuran, opacity, semua toggle) → 1 tempat config, bukan localStorage campur.
4. **View mode ringkas/expanded** — kalau README tetap mau `V`, implementasikan (compact = art + title +
   progress 1 baris; expanded = lirik penuh; fokus lirik = sembunyikan header/art).
5. **Cache lirik di disk** (JSON per track hash) — sekarang `lyricsCache` cuma di memori; restart = fetch
   ulang ke lrclib/musixmatch/QQ.
6. **Arkitektur 1 file 1542 baris** — pecah `renderer.js` (state / media-control / lyrics-view / theme /
   colors) dan `style.css` 2123 baris per komponen. Tanpa ini tiap perubahan kecil makin rawan regresi.

---

## D. URUTAN KERJA YANG DISARANKAN

- **Batch 1 (aman, dampak paling besar):** A1 (payload cover) + A2 (history) + A3/A4/A6 (hapus kode & CSS
  mati) + A5 (fix undeclared) + cabut volume COM per-tick. Net: ~-120 baris, trafik IPC ~-99%, history
  15 MB → ~0,1 MB, CPU turun saat playing.
- **Batch 2:** persistensi layout+semua toggle, posisi window, tray + hotkey, click-through mode.
- **Batch 3:** pecah renderer.css/js, bundle font lokal, CSP, upgrade Electron, lint/test script.
- **Keputusan pemilik:** A7 (badge kualitas) dan A8 (README vs implementasi view mode).

---

## STATUS: SUDAH DIBERESIN (Batch 1 + ekstra)

Semua angka di bawah hasil ukur runtime di app yang beneran jalan (CDP probe ke renderer + sampling CPU proses bridge), bukan tebakan.

### 1. Bridge spam cover - BERES
- `smtc_bridge.ps1`: cover sekarang cuma dikirim pas `trackChanged`, dan thumbnail-nya di-downscale pakai `System.Drawing` (100x100 JPEG, ~5,6 KB) sebelum nyebrang stdout.
- Trafik IPC di app live: **12096 byte / 10 detik = ~1,2 KB/s** (sebelumnya ~7.065.706 byte / 8 detik = ~883 KB/s).
- Reduksi **-99,86%**. Baris terbesar 192 byte (sebelumnya 190.722 byte). Cover cuma di 1 dari ~6 baris/detik pas ganti lagu.
- CPU proses bridge: **0,25 detik per 12 detik = 2,1% satu core**.
- Ikut dibuang: compile `AppVolumeHelper.cs` tiap start, branch `SET_VOLUME`/`CHANGE_VOLUME` (nggak ada pemanggil), `$coverFilePath` (dead), dan COM `GetVolume` tiap 150 ms.

### 2. History bengkak 14,7 MB - BERES
- Cover di sejarah playback sekarang dikecilin ke thumbnail 64px JPEG (helper `shrinkCover`) + hard cap 20 KB/entry di `saveHistoryToStorage`.
- Migrasi sekali jalan (`shrinkHistoryCovers()`) ngerapiin entry lama pas startup.
- Terukur di localStorage app yang jalan: **114.168 byte, 40 entry, 0 entry dengan cover >6 KB** (sebelumnya 14.691.297 byte).
- Reduksi **-99,2%**, dan thumbnail di panel History tetap ada.

### 3. Kode mati - BERES
- `main.js`: 457 -> 263 baris (buang `findLocalLrc`, `stringSimilarity`, `scoreCandidate`, `fetchTrackAudioQuality` + array keyword Lossless/Atmos/Hi-Res, `fetchWithTimeout`, `lyricsCache`, `qualityCache`, `lastPayloadStr`, jalur cover temp-file, `fs` require yang nggak kepake, 4 flag Chromium gimmick).
- `smtc_bridge.ps1`: 273 -> 260 baris. `src/style.css`: 2123 -> 1984 (blok volume HUD, `lyrics-collapsed`, badge lama, `explicit-badge`). `src/index.html`: 307 -> 300.
- Hapus file: `AppVolumeHelper.cs` (153 baris) dan `cover_temp.jpg` (314 KB, nggak pernah ditulis ulang sama script mana pun). Dua-duanya masih ada di git history kalau butuh.
- Total baris source: 5674 -> 4390 (-23%).

### 4. Badge "Lossless/Hi-Res" palsu - DIBUANG
Klaim tebakan keyword dihapus total: markup badge, CSS, handler `fetch-quality`, `fetchQuality` di preload, dan `qualityCache`. Diverifikasi di renderer: `typeof window.miniplayerAPI.fetchQuality === "undefined"`, `document.querySelectorAll('.audio-badge-row, #badgeRow, #explicitBadge').length === 0`. Yang tetap ada: badge sumber lirik (`badge-lrclib`/`badge-musixmatch`/`badge-qq`) karena itu beneran dipakai.

### 5. Bug & sisa kekotoran lain - BERES
- `currentVolume = data.volume` (implicit global di renderer) hilang bareng blok sinkronisasi volume yang UI-nya udah nggak ada.
- IPC `window-resize` + `resizeWindow` di preload dihapus (nggak pernah dipanggil).
- `webSecurity: false` dihapus (renderer nggak butuh; app jalan normal sesudahnya).
- Handler `get-app-version` dihapus (nggak ada pemanggil).

### 6. Yang DITAMBAH (bukan cuma dipotong)
- **Posisi + ukuran window + state Always-on-Top dipersist** ke `%APPDATA%\apple-music-pixel-miniplayer\window_state.json` (debounce 400 ms, plus guard kalau koordinat lamanya di monitor yang udah dicabut). Diverifikasi: restore 200,150 / 400x600 pas tes, dan toggle pin nulis ulang state.
- **`npm run check`**: syntax-check `main.js`, `preload.js`, `lyrics_manager.js`, `src/renderer.js`.
- **README diperbaiki**: klaim view mode `V` yang nggak ada di kode diganti daftar shortcut asli (Space, Ctrl+Arrow, T, M, `[`/`]`, Esc).

### Sisa yang BELUM disentuh (kandidat batch berikutnya)
- Font masih ngambil dari Google Fonts (`src/index.html:8-10`) - offline jatuh ke fallback. Bundle lokal = full offline + nggak ada request render-blocking.
- Warning CSP dari Electron sendiri (renderer belum set Content-Security-Policy).
- `lyrics_manager.js` (802 baris) belum diaudit dalam-dalam — kandidat batch berikutnya.

---

## STATUS: BATCH 2

### 7. UI sekarang 100% offline - BERES
- Font dipindah dari Google Fonts ke `src/fonts/` + `src/fonts.css`: 5 file woff2 Latin (183 KB) buat Plus Jakarta Sans (variable, 400-800), Press Start 2P, Silkscreen (400/700), VT323, plus `DotGothic16-Regular.ttf` (2,0 MB) biar kanji/kana lirik Jepang tetap pixel walau offline.
- Kenapa DotGothic16 pakai TTF full: Google mecah font Jepang jadi **123 subset woff2** - nggak masuk akal dibundle satu-satu. Satu TTF 2 MB cuma dimuat kalau ada glyph CJK yang dipakai.
- Font stack `--font-cjk` dikasih fallback sistem: `'DotGothic16', 'Yu Gothic UI', Meiryo, 'MS Gothic', 'Malgun Gothic', 'Noto Sans CJK JP', sans-serif`.
- Terukur di app yang jalan (CDP): 5/5 family ke-load dari file lokal, termasuk cek glyph kanji (`document.fonts.check("14px 'DotGothic16'", "流星")` = true), computed font tema pixel = `Silkscreen`, **0 request ke fonts.googleapis/gstatic**, 0 error.

### 8. Content-Security-Policy - DIPASANG
- `src/index.html` sekarang punya meta CSP: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; media-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`.
- Renderer emang nol network call (semua lewat IPC), jadi `connect-src 'none'` aman - dibuktikan di runtime: request keluar folder app = **0**, dan console bersih (warning "Insecure Content-Security-Policy" bawaan Electron hilang).

### 9. lyrics_manager.js - 3 masalah nyata, diberesin
1. **Cache lirik nggak berbatas.** `lyricsCache` Map nampung semua track yang pernah dibuka beserta teks lirik penuhnya, nggak pernah dibuang. Sekarang dibatasi `LYRICS_CACHE_MAX = 80` entri, yang paling lama dibuang otomatis (Map jaga urutan insert). Diuji: 95 entri masuk, ukuran mentok di 80.
2. **Worst case ~45 detik buat track yang nggak punya lirik.** Mode auto nyoba 4 sumber berurutan tanpa total budget: LRCLIB 4 strategi (4+4+4,5+4,5 detik), QQ 1 search + 5 lagu x 3,5 detik, Musixmatch 2 x 4,5 detik. Sekarang ada `AUTO_BUDGET_MS = 12000` + deadline per panggilan: tiap timeout per-request dipangkas sisa budget, dan sumber berikutnya di-skip kalau sisa < 800 ms. Timeout QQ per lagu 3500 -> 2500 ms, plus break di tengah loop kalau budget abis.
   - Ukur langsung modulnya di Node: track asli **588 ms** (49 baris lirik sinkron dari LRCLIB), track ngawur **3.033 ms** (dulu bisa puluhan detik tanpa hasil), mode satu-sumber 338 ms.
3. **Skoring hasil search diduplikat + boros CPU.** Blok scoring yang sama persis ada di Strategi C dan D LRCLIB (~48 baris) - disatukan jadi `_pickFromSearch()`. Sort kandidat di `searchCandidates()` dulu manggil `stringSimilarity` di dalam comparator (O(n log n) hitungan bigram berulang) - sekarang skor dihitung sekali per kandidat (decorate-sort-undecorate), hasil urutan tetap sama.

Catatan: bug "respons lirik nyasar ke track lain" **tidak ada** - renderer udah punya guard `lyricsFetchCounter`. Yang gw perbaiki cuma latency, memori, dan duplikasi.
