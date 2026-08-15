# @termwright/screenshot — implementation notes

## Glyph outlines, with `<text>` as the fallback — not one or the other

The brief offered two options: embed glyph outlines the way tui-test does, or
emit `<text>` with a font-family stack. The package does both, per character,
and the split is the interesting part.

**Outlines are the default** because they are the only way a screenshot is
honest. A `<path>` renders identically on a machine that has never heard of the
font, which matters exactly when it is hardest to notice it went wrong: Nerd
Font icons, box drawing, powerline separators. A `<text>` screenshot of a
Starship prompt on a CI runner without the font is a row of tofu, and nothing in
the pipeline flags it. Outlines also mean the PNG path needs no fonts at all —
resvg is handed `loadSystemFonts: false` when everything was embedded, so the
raster is byte-identical between a laptop and a bare container.

**`<text>` is the fallback** because outlines cannot cover everything. A Latin
monospace font has no CJK; colour emoji are not outlines at all. Falling back
per character keeps the rest of the screen self-contained, and
`ScreenshotSvg.selfContained` plus `fallbackCharacters` tell the caller exactly
which characters carry the caveat, instead of silently degrading.

A font that maps a character to `.notdef` (glyph 0) counts as *not covering* it.
Without that check, CJK on a Latin font renders as a row of identical empty
boxes — which looks like a rendering bug rather than a missing font.

The default font list therefore has two tiers: a monospace face first (it sets
the cell advance and covers Latin, box drawing and most icon ranges), then a CJK
face purely for coverage. A proportional CJK face is fine because the glyph is
centred inside the two columns the emulator assigned it — geometry never comes
from the font.

## Geometry comes from the grid, never from font metrics

Cell `(row, column)` is drawn at `padding + column × cellWidth`, and a
double-width cell spans two columns because `CellSnapshot.width === 2`. This is
what makes emoji and CJK line up: the emulator already decided the widths, and
the renderer's only job is to respect that decision. Font advance is used for
exactly one thing — picking a default `cellWidth` so glyphs fill their cells —
and it is overridable.

In `<text>` runs each character gets its own `x` coordinate
(`x="5 15 25"`, with `text-anchor="middle"`), so even a proportional fallback
font stays on the grid.

## Bold and italic are synthesised

Outlines come from the regular face, so bold is a stroke around the glyph and
italic is `skewX(-12)` about the baseline — the same trick a terminal emulator
uses when it has no bold face. Loading four faces per family would be more
faithful, and is a reasonable 1.x change, but it multiplies font loading and
makes the `<defs>` id scheme carry a face dimension for a difference most
screenshots do not show.

Note the placement quirk: `<use>` applies its own `transform` *and* its `x`/`y`,
and the order is easy to get wrong. Italic glyphs therefore fold the translation
into the transform and omit `x`/`y` entirely.

## Deduplicated `<defs>`, merged background runs

A 100×30 screen is 3000 cells drawn from a few dozen distinct characters. Each
distinct glyph is emitted once into `<defs>` with the font scale baked into its
transform, and every cell is a `<use href="#id" x y fill>`. Background colours
are merged into one `<rect>` per horizontal run. Without both, a full-screen SVG
would be megabytes.

## resvg over a browser

`@resvg/resvg-js` is a Rust rasteriser with prebuilt binaries — no Chromium
download, no browser process, and it runs inside a test run without fighting the
runner for stdio. The trade-off is a native module: it needs a prebuilt binary
for the platform, which is why the report in `@termwright/trace` takes rendered
bytes from the caller rather than depending on this package. Nobody running
`pnpm test` should pay for a native renderer they never asked for.

## Dependency on `@termwright/protocol`

Type-only, and for one reason: `CursorInfo` lives in protocol and the driver
imports it without re-exporting it, so `.d.ts` consumers cannot resolve it
transitively under pnpm's strict layout. Same relaxation `trace` and `ui`
already have, recorded in `CHANGELOG-contracts.md`. Nothing from protocol
survives into `dist/index.js`.

## Tests and fonts

Golden SVG output is asserted in `<text>` mode, which never touches a font and
is therefore byte-identical on every machine. Outline-mode tests assert
structure (paths deduplicated, uses positioned, fallback reported) rather than
byte-comparing against a font that differs per platform, and are guarded by
`it.runIf(hasSystemFont)` so a font-less container still runs the rest.

The PNG tests do decode: `inkCoverage` rasterises with `loadSystemFonts: false`
and counts pixels differing from the background, which proves the `<defs>`/
`<use>` outlines actually reach the raster — a blank PNG would otherwise pass a
signature-and-dimensions check happily.

## Open

- **Bold/italic faces** instead of synthesis (see above).
- **Colour emoji**: outlines cannot carry `COLR`/`CBDT` colour layers, so emoji
  always fall back to `<text>` and depend on the viewer's emoji font. Embedding
  colour glyph layers is possible in principle and worth revisiting if emoji in
  screenshots turn out to matter.
- **Window chrome** (title bar, rounded corners) for documentation screenshots
  was deliberately left out; it is presentation, and easy to add around the SVG.
