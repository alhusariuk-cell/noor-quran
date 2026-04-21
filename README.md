# Noor Quran نور القرآن

An [Even Realities G2](https://www.evenrealities.com/) smart glasses plugin that displays the Holy Quran in the traditional Madani Mushaf layout, rendered in the UthmanicHafs font, directly on the glasses display.

## How It Works

Arabic text cannot be sent directly to the G2 display — the firmware's built-in font does not include Arabic Unicode glyphs. Noor Quran solves this by rendering every line of Arabic text as a greyscale image on the phone using an HTML5 Canvas, then transmitting those image tiles to the glasses via the Even Hub SDK.

```
Phone (companion app)               G2 Glasses
──────────────────────────────────  ──────────────────────────────
Load page JSON from local bundle →
Render Arabic lines on Canvas    →
Slice canvas into image tiles    →
Send tiles via BLE (SDK)         →  Display greyscale PNG tiles
Update header text               →  Show Surah name + page number
```

## Features

- **Full offline operation** — all 604 Madani Mushaf page JSON files are bundled inside the `.ehpk` package. No internet connection required after installation.
- **UthmanicHafs font** — the standard Quranic typeface, bundled locally. No CDN dependency.
- **Surah picker (companion app)** — scrollable list of all 114 surahs with live search; tap any surah to jump directly to it.
- **Surah selector (G2 native)** — swipe up/down on the glasses to highlight a surah, double-tap to confirm and jump.
- **Page-by-page navigation** — swipe down for next page, swipe up for previous page.
- **Multi-screen pages** — pages with more than 5 lines are split into multiple screens automatically.
- **Adjacent page prefetch** — next and previous pages are loaded in the background for instant navigation.

## Display Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Header (text container, 576×24 px)                                     │
│  سورة البقرة  •  p.50  •  screen 1/2                                    │
├──────────────────────────────────────────────────────────────────────────┤
│  col_a (192×88) + col_b (192×88) + col_c (192×88)  — Arabic text strip  │
│                                                                          │
│  ← Arabic line 1 ──────────────────────────────────────────────────── → │
│  ← Arabic line 2 ──────────────────────────────────────────────────── → │
│  ← Arabic line 3 ──────────────────────────────────────────────────── → │
│  ← Arabic line 4 ──────────────────────────────────────────────────── → │
│  ← Arabic line 5 ──────────────────────────────────────────────────── → │
│                                                                          │
├──────────────────────────────────────────────────────────────────────────┤
│  col_d (192×88) — footer: page number + surah name                      │
└─────────────────────────────────────────────────────────────────────────┘
```

| Container | Type  | Size      | Purpose |
|---|---|---|---|
| `header`  | Text  | 576×24 px | Surah name + page/screen indicator |
| `col_a`   | Image | 192×88 px | Left third of text strip |
| `col_b`   | Image | 192×88 px | Centre third of text strip |
| `col_c`   | Image | 192×88 px | Right third of text strip |
| `col_d`   | Image | 192×88 px | Footer: page number + surah name |

## Navigation

| Action | Result |
|---|---|
| Swipe down | Next screen (or next Mushaf page) |
| Swipe up | Previous screen (or previous Mushaf page) |
| Double tap | Open G2 surah selector |
| Swipe up/down in selector | Highlight previous/next surah |
| Double tap in selector | Confirm and jump to highlighted surah |

## Architecture Notes

### Why images instead of text?

The G2 firmware's LVGL font does not include Arabic glyphs. Sending Arabic Unicode via `TextContainerProperty` results in silent character skipping — nothing appears on the display. The only workaround is to render Arabic text as a raster image on the phone and send the pixel data to the glasses.

### Why three side-by-side image containers?

The SDK limits each image container to a maximum of 200 × 100 pixels. A single container cannot cover the full 576 px display width. By placing three 192 × 88 px containers side by side, we achieve a seamless 576 × 88 px rendering area.

### Why 5 lines per screen?

At 88 px strip height with 5 lines, each line gets ~17.6 px of vertical space — enough for 18 px Arabic text to render legibly at a comfortable reading size.

### Caching

The last several fetched pages are cached in memory. Adjacent pages are prefetched in the background after each render, so forward/backward navigation feels instant.

## Tech Stack

- TypeScript + Vite
- Even Realities G2 SDK (`@evenrealities/even_hub_sdk`)
- HTML5 Canvas for Arabic text rendering
- UthmanicHafs font (bundled locally, no CDN)
- Madani Mushaf layout data from [zonetecde/mushaf-layout](https://github.com/zonetecde/mushaf-layout) (MIT)

## Getting Started

```bash
npm install
npm run build
npx evenhub pack app.json dist -o noor-quran.ehpk
```

Sideload `noor-quran.ehpk` via the Even Realities companion app.

## Developer Console

The plugin exposes a `noor` object on `window` for debugging:

```javascript
noor.jumpToPage(50)       // Jump to Mushaf page 50
noor.goNext()             // Next screen/page
noor.goPrev()             // Previous screen/page
noor.getCurrentPage()     // → current page number
noor.getCurrentScreen()   // → current screen index within page
noor.getCache()           // → list of cached page numbers
```

## Project Structure

```
src/
  main.ts           # G2 plugin — rendering, navigation, surah selector
  worker.ts         # Background worker for image processing
index.html          # Companion UI — surah list with search, page jump
public/
  mushaf/           # 604 Madani Mushaf page JSON files (bundled, offline)
  fonts/            # UthmanicHafs.woff2 (bundled, offline)
app.json            # Even Hub manifest
```

## Credits

- **Quran layout data**: [zonetecde/mushaf-layout](https://github.com/zonetecde/mushaf-layout) (MIT)
- **Arabic font**: UthmanicHafs — the standard Quranic typeface
- **SDK**: [Even Realities Even Hub SDK](https://hub.evenrealities.com/docs)

---

## Contributing

Contributions are welcome and appreciated. This project is part of a broader effort to make Quranic tools accessible on wearable devices — any improvement, however small, is meaningful.

### How to contribute

1. **Fork** the repository on GitHub
2. **Create a branch** for your feature or fix: `git checkout -b feature/your-feature-name`
3. **Make your changes** and commit with a clear message
4. **Push** to your fork and open a **Pull Request**

### Ideas for contributions

- Bug fixes and stability improvements
- Better Arabic text rendering or font size tuning
- Support for additional Quran recitation styles or riwayat
- Word-by-word highlighting as you read
- Bookmarking and reading position memory
- Tafsir or translation overlay
- Documentation and translations

### Guidelines

- Keep changes focused — one feature or fix per pull request
- Test on a physical G2 device if possible, or describe your testing approach
- Respect the existing code style (TypeScript, no external runtime dependencies)
- All contributions must be compatible with the **GNU General Public License v3**

### Reporting issues

Please open a [GitHub Issue](../../issues) with a clear description of the problem, steps to reproduce, and your G2 firmware version and Even Hub app version.

---

## License

This project is licensed under the **GNU General Public License v3.0** — see the [LICENSE](LICENSE) file for details.

Any derivative work must also be distributed under GPL v3 and must make its source code available.
