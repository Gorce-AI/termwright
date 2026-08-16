# @termwright/screenshot — implementation notes

Open items are first; everything after them is settled.

## Open

- **Window chrome** (title bar, rounded corners) for documentation screenshots
  was deliberately left out. It is presentation, and easy to add around the SVG,
  so it stays out until something actually needs it.
- **COLR v1** (gradients, transforms, compositing): fontkit exposes v0 layers,
  so a v1 font degrades to its v0 layers or to an outline.
- **The COLR path is not exercised against a real COLR font in CI.** macOS ships
  `sbix` and Linux Noto ships `CBDT`, so no machine here has one. The layer code
  is driven through a stand-in shaped like the fontkit surface it touches; that
  tests the mapping and the colour conversion, not fontkit's own parsing.

## Resolved

- **Bold and italic used to be synthesised always.** Real faces are loaded when
  the system has them; synthesis is the fallback. See "Bold and italic" below.
- **Colour emoji used to force `selfContained: false`**, because colour glyphs
  are not outlines and fell through to `<text>`. Bitmap strikes and COLR layers
  are embedded now. See "Colour glyphs" below.

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

## Bold and italic: real faces first, synthesis as the fallback

A TrueType collection holds a whole family, so `Menlo.ttc` yields Menlo-Bold,
Menlo-Italic and Menlo-BoldItalic beside the regular face. `loadFonts` opens
every face in a file and asks each one about itself — `OS/2.fsSelection.bold`
and `.italic`, plus a non-zero `post.italicAngle` — rather than guessing from
the file name.

A bold cell is then drawn with the bold face, and synthesis only happens when
no face matches: `FontSet.hasFace()` decides, and `renderSvg` stops stroking
and shearing the moment a real face exists. Shearing a face that is already
italic would double the slant, which is the visible failure this replaced.

Faces matching the requested style are tried first, but a character only the
regular face covers still beats no glyph at all — coverage wins over style.

Note the placement quirk that remains for synthesised italics: `<use>` applies
its own `transform` *and* its `x`/`y`, and the order is easy to get wrong.
Those glyphs fold the translation into the transform and omit `x`/`y`.

## Colour glyphs

`FontSet.glyphFor()` returns the richest thing a font offers, in this order:

1. **bitmap strike** (`sbix`, `CBDT`) — fontkit hands back PNG bytes, which go
   into the SVG as a `data:` URI. Apple Color Emoji is `sbix`-only, and Noto's
   bitmap builds are `CBDT`, so this is the path most colour emoji take.
2. **`COLR`/`CPAL` layers** — stacked outlines, each with its palette colour
   baked in. A `<use>` fill never reaches them, which is correct: a colour
   glyph must ignore the cell's foreground.
3. **plain outline**, as before.

Bitmaps come before layers because a font that ships both means the bitmap is
the artwork and the outline is the fallback, not the other way round.

The point of all this is that `selfContained` stops being false for any screen
containing an emoji. An embedded PNG needs no font at the viewing end, so the
flag now says what it means.

### Cells are grapheme clusters, so they get shaped

A cell can hold several code points: `⚠️` is U+26A0 plus a variation selector,
`👨‍👩‍👧` is three people joined by ZWJ. Looking up `codePointAt(0)` renders the
first component and silently drops the rest, so multi-code-point clusters go
through `font.layout()`, which applies the font's own substitutions. The family
resolves to one glyph rather than to a man.

A variation selector also steers *which font* answers. Several monochrome
symbol fonts cover U+26A0, and one of them sits earlier in the fallback chain
than the emoji font, so `⚠️` came out as a thin black outline. When the cluster
carries U+FE0F the author asked for the emoji presentation, so an outline is
kept only as a last resort.

### Costs of embedding colour glyphs

- **Bitmap strikes are requested at a fixed 96 ppem.** Large `fontSize` values
  can look soft; the strike is picked by the font, not resampled.
- Each distinct emoji adds roughly 6–12 kB of base64 to the SVG. They are
  deduplicated through `<defs>`, so a screen repeating one emoji pays once, but
  a screen of many distinct ones grows.

The COLR limits live under "Open" at the top of this file, since they are things
this package still cannot do rather than trade-offs it chose.

## resvg re-scans system fonts on every call

Measured, because it looked like a Windows problem and was not: rasterising an
SVG that contains `<text>` costs ~0.8 s on macOS and 6–7.7 s on a Windows CI
runner, while the same frame in outline mode costs 55–76 ms. The expensive part
is `loadSystemFonts`, and resvg pays it **per `Resvg` instance** — the second
and third calls are as slow as the first, so a warm-up does nothing.

Two consequences:

- `renderPng` only asks for system fonts when the SVG actually has fallback
  characters, and `systemFontFallback: false` declines even then, for callers
  rendering many frames who would rather have blank glyphs than minutes of font
  enumeration.
- The package's own PNG tests render in outline mode with explicit
  `cellWidth`/`lineHeight`, which keeps their geometry assertions exact without
  paying the scan. Exactly one test renders an uncoverable character on
  purpose, and it carries a raised timeout with a comment saying why. This is
  the fix for the CI timeout — a per-test budget increase would have papered
  over a cost the library was imposing on its users too.

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
