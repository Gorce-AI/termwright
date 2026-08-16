# @termwright/vt — implementation notes

## Upstream blocker: the grapheme addon hangs under vitest

`@xterm/addon-unicode-graphemes` cannot be loaded in this repository's test
environment. Measured, not assumed:

| How | Result |
|---|---|
| plain `node` ESM import | resolves in ~20 ms |
| vitest, `threads` pool, ESM import | never completes (killed at 40 s+) |
| vitest, `forks` pool | never completes |
| vitest, `createRequire` instead of `import` | never completes |
| 0.4.0 (`latest`) and 0.5.0-beta.299 | both hang identically |

Bisected down to a test file whose only content is the import. `@xterm/headless`
and `@xterm/addon-unicode11` import fine in the same worker, so it is specific
to this addon.

Consequence: `UnicodeVersion` is `'11'` only, and the `kitty` profile ships
without grapheme clustering. A profile that needed the addon would hang the
suite of every package importing `@termwright/vt`, which is all of them.

To revisit: retry after an upstream release, or move the grapheme-profile tests
to a plain-node runner outside vitest.

## Why the base provider is captured through a stub

The addons do not export their providers, and xterm exposes no getter for a
registered one. Reading `terminal.unicode._providers` would work and is what a
first draft did, but it is a private field.

`activate(terminal)` only ever calls `terminal.unicode.register(...)`, so the
addon is handed a stub that captures the registration. That is public API, it
keeps the real terminal free of Unicode versions nobody asked for, and it
breaks loudly rather than silently if an addon ever starts doing more in
`activate`.

## Why the width overrides verify themselves

`charProperties` returns a packed integer — `(charKind << 3) | (width << 1) |
shouldJoin` — whose layout is internal to xterm. The decorator needs to unpack
and repack it, so before it does, `canOverrideWidths` asks the base provider
about two characters whose width is not in dispute and checks that the
round-trip is exact. If a future xterm changes the encoding, the overrides
switch themselves off and the profile degrades to its base version instead of
reporting invented widths.

## The ambiguous table is curated, and says so

`AMBIGUOUS_RANGES` is not the whole `EastAsianWidth=A` property. It covers what
appears in terminal user interfaces — box drawing, block elements, arrows,
geometric shapes, enclosed alphanumerics, Greek, Cyrillic, typographic
punctuation — because those decide whether a bordered layout lines up. The
package documents profiles as switches that reproduce how terminals differ, not
as emulations, which is what makes a curated table honest rather than a
half-finished one.
