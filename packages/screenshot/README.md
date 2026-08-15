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
`strikethrough` and the cursor (block, bar, underline) are all drawn. `bold` is
synthesised by stroking and `italic` by shearing, because the outlines come from
the regular face.

## Self-containment

`renderSvg` reports whether it managed to embed everything:

```ts
const shot = renderSvg(frame);
shot.selfContained;        // true when no character needed a font at view time
shot.fallbackCharacters;   // the ones that did, e.g. ['\u{F0000}']
shot.fontsUsed;            // font files whose outlines were embedded
```

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

## In a failure report

`@termwright/trace` embeds images the caller hands it, rather than rasterising
anything itself — that keeps a native renderer out of every test run:

```ts
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
