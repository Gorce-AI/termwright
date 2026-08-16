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
units × `scale`), plus `selfContained` and `fallbackCharacters`.

### Self-containment

Characters no configured font covers fall back to `<text>` with a monospace
family, still positioned per cell. They render correctly wherever a suitable
font exists, and the flag tells you when that caveat applies.

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
