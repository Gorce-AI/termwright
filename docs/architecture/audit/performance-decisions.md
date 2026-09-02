# Performance decisions

Each entry is a decision with the measurement behind it. `DEFER` here never
means "ran out of time" — it means the measurement said the complexity is not
worth buying. Numbers come from an Apple M-series laptop unless stated; they
are recorded for their ratio and order of magnitude, not as absolutes to
compare across machines.

## Direct cell reads — IMPLEMENTED

`session.cell()` called `screen().cell()`, and `captureScreen` materialises
every cell in the viewport, the text of every row, the cursor, the modes and a
link resolver, then returns one cell.

| Path                      |   Per call | Heap per call |
| ------------------------- | ---------: | ------------: |
| `screen().cell(25, 10)`   | 1352.35 µs |      10 255 B |
| `captureCell(vt, 25, 10)` |    0.48 µs |         729 B |

Measured on a 200×50 terminal (10 000 cells) over 2 000 iterations after
warm-up. Equivalence is pinned by 11 tests comparing the two paths cell by cell
across styled runs, 256-colour and RGB, wide CJK, emoji with modifiers,
combining marks, hyperlinks, inverse and dim, blank rows, every out-of-range
coordinate, and a scrolled viewport.

The ratchet asserts a factor of ten against a measured factor of ~2 800.

## Text-only screen capture — IMPLEMENTED

`waitForText` joined the row strings out of `captureRows`, which resolves the
colour, attributes and hyperlink of every cell first. The wait polls, so this
was rebuilt on every iteration.

| Path                                          |   Per call | Heap per call |
| --------------------------------------------- | ---------: | ------------: |
| `captureRows(vt).map(r => r.text).join('\n')` | 1406.88 µs |      39 029 B |
| `captureText(vt)`                             |   20.55 µs |      34 062 B |

Same terminal, 500 iterations. The heap difference is small because the joined
string is most of what remains, which is why the ratchet guards time rather
than allocation. Equivalence is pinned by 12 tests over the same corpus,
including after scrolling and including trailing blank rows, which a substring
search can depend on.

## Ring buffer for bounded logs — IMPLEMENTED for the bounded-state invariant

The original measurement showed that replacing `Array.shift()` was not needed
for latency alone. The production-maturity campaign changed the deciding
constraint: capped diagnostic state must have mechanically bounded retention
and O(1) eviction independent of engine array behavior. Session diagnostics,
application logs, and crash-input history therefore share one tested bounded
ring implementation.

| Capacity | 200 000 pushes with `shift()` | With a ring buffer | Ratio |
| -------: | ----------------------------: | -----------------: | ----: |
|      200 |                       16.6 ms |             5.5 ms | 3.00× |
|    1 000 |                       14.1 ms |             4.5 ms | 3.12× |
|   10 000 |                       12.8 ms |             5.0 ms | 2.53× |

That is 0.07 µs against 0.02 µs per line, so this remains a resource-invariant
change rather than a claimed user-visible speedup. Tests pin oldest-first
ordering, overwrite behavior, clearing, and zero-capacity retention.

## Semantic transport ratchets — IMPLEMENTED

The paired reference/candidate gate now admits semantic encoded bytes per frame
and full-snapshot count as first-class observations. Both are stable work-count
metrics rather than shared-runner wall time. A candidate may use at most 10%
plus 128 bytes/frame more encoded semantic data than its exact paired reference,
and it may not increase the number of full publications at all.

Delta count is retained as evidence but is deliberately not a lower-is-better
ratchet: for a fixed 1,000-frame workload, replacing a full publication with a
delta increases that count while improving the architecture. Validation time
keeps the existing wider timing tolerance because it is measurably noisier.
