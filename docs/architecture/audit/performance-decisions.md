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

| Path | Per call | Heap per call |
| --- | ---: | ---: |
| `screen().cell(25, 10)` | 1352.35 µs | 10 255 B |
| `captureCell(vt, 25, 10)` | 0.48 µs | 729 B |

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

| Path | Per call | Heap per call |
| --- | ---: | ---: |
| `captureRows(vt).map(r => r.text).join('\n')` | 1406.88 µs | 39 029 B |
| `captureText(vt)` | 20.55 µs | 34 062 B |

Same terminal, 500 iterations. The heap difference is small because the joined
string is most of what remains, which is why the ratchet guards time rather
than allocation. Equivalence is pinned by 12 tests over the same corpus,
including after scrolling and including trailing blank rows, which a substring
search can depend on.

## Ring buffer for bounded logs — DEFERRED on measurement

The bounded log and diagnostic buffers use `Array.shift()` once the cap is
reached. A ring buffer is faster, and the absolute cost is too small to justify
the indirection.

| Capacity | 200 000 pushes with `shift()` | With a ring buffer | Ratio |
| ---: | ---: | ---: | ---: |
| 200 | 16.6 ms | 5.5 ms | 3.00× |
| 1 000 | 14.1 ms | 4.5 ms | 3.12× |
| 10 000 | 12.8 ms | 5.0 ms | 2.53× |

That is 0.07 µs against 0.02 µs per line. A test producing ten thousand log
lines — far more than a typical one — would save under a millisecond. V8
already special-cases `shift()` for arrays of this size, so the theoretical
O(n) cost does not materialise at these bounds.

Revisit if a bound grows by orders of magnitude, or if a profile shows these
buffers in a hot path for some other reason.
