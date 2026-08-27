# 👾 Apple Music Pixel Retro Miniplayer (Windows)

Aesthetic, cute & retro pixel-art floating desktop miniplayer for **Apple Music** (and other Windows media players) with real-time SMTC sync, live synced karaoke lyrics, pixelated dithering shader, and animated beat mascot.

---

## ✨ Fitur Unggulan

1. **Auto Sync Tanpa Login Apple ID**:
   - Terhubung langsung dengan Windows SMTC (System Media Transport Controls).
   - Otomatis mendeteksi lagu Apple Music yang sedang berputar (Judul, Artis, Album, Durasi, Timeline, Cover Art).
2. **Real-time Synced Karaoke Lyrics**:
   - Lirik bergerak baris demi baris (LRC format) secara otomatis via LRCLIB database.
   - Klik pada baris lirik mana saja untuk langsung seek/lompat ke detik tersebut!
3. **5 Curated Retro Aesthetic Themes**:
   - 🎮 **GameBoy Classic**: Nuansa 4-shade greenish matrix LCD nostalgia.
   - 🌸 **Pastel Tamagotchi**: Cute candy pink & purple kawaii vibe.
   - 🌌 **Cyber Lo-Fi**: Synthwave neon cyan & magenta glow.
   - 🖥️ **Windows 95**: Classic OS beveled UI & retro buttons.
   - 🖤 **OLED CRT Emerald**: Phosphor terminal green on pure black.
4. **8-Bit Canvas Pixel Dither Shader**:
   - Tombol `[👾 8-BIT / 🖼️ CLEAN]` untuk mengubah cover album asli menjadi pixel art retro realtime dengan palette quantizer.
5. **CRT Scanlines Shader**:
   - Tombol `[⚡ CRT]` untuk efek garis tabung kaca retro scanline.
6. **Animated Beat Mascot & Equalizer**:
   - Maskot pixel kucing `(⸝⸝•ᴗ•⸝⸝)♪` bergoyang mengikuti musik saat playing, dan tidur `₍-.-₎zZ` saat paused.
   - Retro Equalizer VU Bars animatif.
7. **Always-On-Top & Draggable**:
   - Bisa dipin di atas game / code editor / browser saat beraktivitas.
   - Window frameless bisa digeser bebas (`drag`).

---

## 🚀 Cara Menjalankan

Buka terminal di folder ini dan jalankan:

```bash
npm start
```

---

## ⌨️ Shortcut Keyboard

- `Space`: Play / Pause toggle
- `Ctrl + Right Arrow`: Next Track
- `Ctrl + Left Arrow`: Previous Track
- `T`: Ganti Theme (Gameboy -> Pastel -> Cyber -> Win95 -> OLED)
- `V`: Ganti View Mode (Split View -> Lyrics Focus -> Mini Compact)

---

## 📁 Struktur File

- `main.js`: Electron main process & IPC listener.
- `preload.js`: Bridge aman antara Node & Webview.
- `smtc_bridge.ps1`: Daemon Windows SMTC background loop.
- `src/index.html`: Retro pixel UI structure.
- `src/style.css`: Pixel typography, CRT shader, dan 5 tema warna.
- `src/renderer.js`: Real-time pixel canvas shader, LRC synced lyrics engine, dan timeline interpolation.
