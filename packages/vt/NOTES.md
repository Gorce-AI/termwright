# @termwright/vt — implementation notes

## Root cause of the historical grapheme-addon hang

The failure was not caused by Vitest. The addon constructs typed-array views of
a pooled Node Buffer without its `byteOffset` and `byteLength`. Depending on
allocator state that reads unrelated slab bytes and produces a corrupt trie, a
`Data error`, or an apparent hang.

The executable matrix in `scripts/certify-unicode-load-matrix.mjs` covers plain
Node, Vitest threads/forks, Vite Module Runner on/off, and the Termwright Native
Host. The offset-correct Termwright provider passes every lane on Node 22 and
24; the upstream package does not.

Production does not mutate global `Buffer.poolSize`; the zero-sized pool appears
only in the diagnostic control that proves the root cause.

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
