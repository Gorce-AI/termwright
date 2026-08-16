# @termwright/screenshot

Terminal screenshots for [termwright](https://github.com/gorce-ai/termwright), without a browser.

A cell grid becomes an SVG with the **glyph outlines embedded**, and
[resvg](https://github.com/yisibl/resvg-js) turns that into a PNG. No Chromium,
no headless browser starting up in the middle of a test run, and no dependency
on the viewer having the right font installed — which is the whole point when
the screen is full of Nerd Font icons.

## Install

```sh
pnpm add @termwright/screenshot
```

Requires Node >= 22. ESM only.

## Usage

```ts
import { writeFile } from 'node:fs/promises';
import { renderPng, renderSvg } from '@termwright/screenshot';
import { frameAt, openTrace } from '@termwright/trace';

// A live session: the driver's screen snapshot is already a valid frame.
const shot = renderSvg(harness.screen(), { fontSize: 16 });
await writeFile('now.svg', shot.svg);
if (!shot.selfContained) {
  console.warn('no outline for', shot.fallbackCharacters.join(''));
}

// A recorded one: reconstruct the moment a step failed, then rasterise it.
// The frame measures characters with the profile the recording was made with,
// so the screenshot matches the screen the test saw.
const trace = await openTrace('out/login.twtrace');
const steps = await trace.steps();
const failing = steps.find((step) => step.status === 'failed');
const frame = await frameAt(trace, failing?.castEndOffset ?? 0);
await writeFile('failure.png', renderPng(frame, { scale: 2 }).png);
await trace.close();
```

## What it renders

Layout comes from the grid — cell `(row, column)` is drawn at
`padding + column × cellWidth` — so a double-width cell occupies exactly two
columns because the emulator said so, not because a font did. Emoji, CJK and box
drawing all stay on the grid.

Colours (256-colour palette and 24-bit), `inverse`, `dim`, `underline`,
`strikethrough` and the cursor (block, bar, underline) are all drawn. `bold` and
`italic` use the real faces when the system has them — a font collection like
`Menlo.ttc` carries all four — and fall back to stroking and shearing the
regular face only when it does not.

Colour emoji are embedded as images lifted straight out of the font's bitmap
strike (`sbix`/`CBDT`), and `COLR`/`CPAL` fonts as their coloured layers, so a
screen full of emoji still reports `selfContained: true`. Cells holding several
code points — a variation selector, a ZWJ family — are shaped through the font
rather than looked up by first code point.

## What you get back

```ts
const shot = renderSvg(frame);
shot.svg;                  // the document
shot.width;                // user units, so a caller can size the element
shot.height;
shot.selfContained;        // true when no character needed a font at view time
shot.fallbackCharacters;   // the ones that did, e.g. ['\u{F0000}']
shot.fontsUsed;            // font files whose glyphs were embedded
```

`renderPng` returns the same story in pixels: `png`, `width`, `height` (SVG
units × `scale`), plus `selfContained`, `fallbackCharacters` and
`systemFontsLoaded` — the last one says whether *this* render paid for the font
scan described below.

### The cost of a fallback

A fully self-contained frame rasterises in tens of milliseconds. A frame with
fallback characters makes resvg enumerate the installed fonts, and it does that
on **every call** — about a second on macOS, several on Windows, with no cache
between renders. Rendering a batch of frames that all contain one uncoverable
character therefore costs seconds per frame.

Whether a frame has fallback characters is a property of *the machine's fonts*,
not of the content: a desktop with CJK and emoji faces embeds almost everything,
while a minimal CI container with one Latin font falls back on both. The slow
path is therefore rarest where it is usually measured and commonest where it
costs the most.

Point the renderer at a font that covers your screen and the problem
disappears. When it cannot, and blank glyphs are acceptable, decline the scan:

```ts
renderPng(frame, { systemFontFallback: false });
```

### Self-containment

Characters no configured font covers fall back to `<text>` with a monospace
family, still positioned per cell. **Not embedded is not the same as not
drawn**: a viewer with a suitable font renders them normally, and `renderPng`
loads system fonts on their behalf by default. What the list really tells you
is that the output depends on the machine displaying or rasterising it — those
characters come out blank only where nothing covers them, which for PNG means
`systemFontFallback: false`.

Fonts are resolved from `font.files`, then `TERMWRIGHT_FONT`, then platform
defaults (Menlo on macOS, DejaVu/Liberation/Noto on Linux, Consolas on Windows,
each followed by a CJK face for coverage). Point it at your own font to match
what your users actually see:

```ts
renderSvg(frame, { font: { files: ['/fonts/JetBrainsMonoNerdFont-Regular.ttf'] } });
```

Emoji are looked up in a colour font last in that chain and embedded as artwork
— a bitmap strike (`sbix`, `CBDT`) as a `data:` image, a `COLR`/`CPAL` font as
its coloured layers — so a screen full of emoji still reports
`selfContained: true`.

## In a failure report

`@termwright/trace` embeds images the caller hands it, rather than rasterising
anything itself — that keeps a native renderer out of every test run:

```ts
import { generateHtmlReport } from '@termwright/trace';

await generateHtmlReport({
  outFile: 'out/report.html',
  results: [{
    id: 't1',
    title: 'login',
    status: 'failed',
    tracePath: 'out/login.twtrace',
    screenshots: [{ label: 'at failure', image: renderPng(frame, { scale: 2 }).png }],
  }],
});
```

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

Implementation decisions: [`NOTES.md`](./NOTES.md).
