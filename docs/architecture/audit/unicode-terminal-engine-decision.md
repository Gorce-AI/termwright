# Unicode and terminal-engine decision

Status: accepted for the post-0.3.1 campaign

Baseline: `4b82096b7951e7ae6494eb37fb06b4e4ab32a6ba`

Evidence runtime: Node 22.23.2 and Node 24.1.0

## Decision

Termwright keeps `@xterm/headless` 6.0 as its single production terminal state
machine and replaces Unicode 11 with a Termwright-owned Unicode 15 extended
grapheme provider. Ghostty and libvterm remain independent conformance oracles,
not user-selectable production backends.

The owned provider is the MIT-licensed xterm grapheme algorithm and Unicode
trie behind a small internal boundary. Its typed-array views respect
`byteOffset` and `byteLength`, and U+200B following a base cell no longer adds
an extra column. The old `UnicodeVersion` selector and the `kitty` profile are not
part of the new model: every run gets modern grapheme behavior; profiles only
select genuine ambiguous-width and reflow policy.

## Historical hang: root cause

The old note said the grapheme addon worked in plain Node but hung in Vitest.
The isolated matrix disproved that explanation. The published addon constructs
`DataView(data.buffer)` and `Uint32Array(data.buffer)` over a Node pooled Buffer
without applying its offset and length. Depending on allocator state this reads
unrelated slab bytes and produces one of three outcomes: a corrupt but loadable
trie, `Data error`, or an apparent import/initialization hang.

The same source defect remains in xterm master as of `c58ea363`; it is tracked
upstream in [xterm.js #6079](https://github.com/xtermjs/xterm.js/issues/6079).
The addon is also still listed as experimental in the
[xterm.js repository](https://github.com/xtermjs/xterm.js/tree/master/addons/addon-unicode-graphemes).

`scripts/certify-unicode-load-matrix.mjs` runs:

- plain Node with clean and deliberately used Buffer pools;
- Vitest 4 threads and forks;
- Vite Module Runner enabled and disabled;
- the Termwright Native Host.

On both supported Node lines the Termwright provider passes every lane. The
unmodified upstream addon does not. Setting `Buffer.poolSize = 0` is retained
only as a diagnostic control in the research harness; production never mutates
global Buffer policy.

## Candidate evidence

The 23-case corpus covers ASCII, Latin-1, combining marks, VS15/16, modifiers,
ZWJ family/profession/gender sequences, flags, keycaps, tag sequences, Arabic,
Devanagari, Hangul, Thai, bidi text, CJK, ambiguous width, and zero-width text.
The ledger is bidirectional: an added or removed gap fails certification until
it is classified as a Termwright bug, backend bug, intentional terminal-profile
difference, or an explicit research question. Every entry also carries a
human-readable reason; a bare allow-list is rejected by the certifier.

| Criterion            | xterm + Unicode 11 | upstream xterm graphemes with offset fix | Termwright provider |            ghostty-web + mode 2027 | @wterm/ghostty |                 libvterm reference |
| -------------------- | -----------------: | ---------------------------------------: | ------------------: | ---------------------------------: | -------------: | ---------------------------------: |
| geometry gaps        |                  8 |                                        2 |               **0** |                                  1 |              3 |                                  3 |
| Node 22              |                yes |                                      yes |             **yes** |                                yes |            yes | unsupported by package declaration |
| Node 24              |                yes |                                      yes |             **yes** |                                yes |            yes |                                yes |
| protocol contract    |              17/17 |                                    17/17 |           **17/17** |        incomplete headless surface |          13/18 |                     reference only |
| public teardown      |                yes |                                      yes |             **yes** | `free()`, but grapheme buffer leak |             no |                                yes |
| init RSS, Node 24    |            ~28 MiB |                                  ~26 MiB |         **~24 MiB** |                            ~30 MiB |        ~27 MiB |                            ~54 MiB |
| corpus time, Node 24 |             ~29 ms |                                   ~29 ms |          **~29 ms** |                              ~4 ms |          ~4 ms |                              ~4 ms |
| startup, Node 24     |             ~32 ms |                                   ~34 ms |          **~32 ms** |                             ~31 ms |         ~27 ms |                            ~105 ms |

Timing and RSS are process-level research measurements, not CI ratchets. Their
purpose is to reject order-of-magnitude regressions; the committed performance
suite will own stable thresholds.

## Why Ghostty is not canonical yet

Ghostty's grapheme correctness and feed throughput are excellent. It is the
strongest independent oracle and a credible future canonical engine. The
available headless JavaScript wrappers are not yet a production-quality
Termwright boundary, however:

- `ghostty-web`'s simplified headless cells expose resolved RGB but not original
  palette provenance, do not expose hyperlink URIs, and its `free()` omits the
  allocated grapheme buffer; repeated create/read/free eventually traps in
  WASM;
- its xterm-compatible wrapper requires opening a DOM terminal, so it is not a
  headless Node API;
- `@wterm/ghostty` fixes several exported capabilities but fetches a `file:` URL
  in Node, reports no title/bell, and exposes no teardown although its WASM ABI
  contains `deinit`;
- the current wterm WASM is pinned to Ghostty 1.3.1 and differs from current
  ghostty-web on the Devanagari geometry case.

Working around those gaps through wrapper private fields would replace one
fragile dependency with another. Termwright therefore does not do that.

## Why the chosen option is not “the experimental addon in production”

Termwright does not depend on the addon at runtime. It owns the provider source,
the offset-correct trie boundary, its tests, and its conformance ledger. xterm
remains responsible for terminal parsing, buffers, reflow, cursor state, modes,
serialization, and lifecycle—all areas where the existing driver already has
complete, tested integration.

Research-only dependencies are dev dependencies and do not enter packed
Termwright packages.

## Remaining limitations

- Terminal grids preserve code points and cell geometry; they do not perform
  font shaping. Arabic/Indic visual shaping belongs to screenshot/rendering
  certification in addition to grid correctness.
- Mixed-direction terminal behavior remains profile-dependent and must be
  interpreted as terminal cell order, not browser bidi layout.
- An orphan zero-width character at the start of a line has no base cell.
  Ghostty ignores it; xterm preserves it in a zero-width placeholder that
  consumes one buffer position. The differential corpus classifies this
  explicitly instead of pretending the terminal ecosystem defines one answer.
- The Unicode table must be deliberately regenerated and re-certified when the
  canonical Unicode version changes.
