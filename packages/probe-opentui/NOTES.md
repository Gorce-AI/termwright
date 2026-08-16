# @termwright/probe-opentui — implementation notes

## Which marker route survives `useThread=true` — measured, not reasoned

OpenTUI writes its frames from a Zig thread over FFI, so the Ink trick of
appending to stdout after the frame does not transfer. Three routes came out of
the Phase 0 audit; `bench/marker-route.ts` runs them against each other. Numbers
below: Bun 1.2.15, macOS arm64, `@opentui/core@0.5.3`, `targetFps: 240`, 2 s
windows, median of three runs, `useThread: true` throughout.

| arm | fps | vs native | bytes seen in JS | marker route works |
|---|---|---|---|---|
| `native` (untouched stdout) | 203 | — | **0** | impossible |
| `feed-quiet` (custom stdout, no marker) | 205 | +1.0 % | 3 118 | — |
| `feed` (custom stdout + marker per frame) | 194 | −4.4 % | 10 401 | yes, by construction |
| `postprocess` (custom stdout + `addPostProcessFn`) | 193 | −4.9 % | 10 114 | see below |
| `postprocess-real` (real stdout + `addPostProcessFn`) | 182–192 | −5..−10 % | 0 | ordering unprovable |

Four things the measurement settled that reading the source did not:

1. **The audit's central claim is confirmed by number, not inference.** With the
   real stdout the JS side sees *zero* bytes. Intercepting `process.stdout.write`
   cannot be a marker route here, unlike under Ink.
2. **The NativeSpanFeed is free.** Handing OpenTUI a custom stdout — which is
   what makes it route bytes back into JS — cost nothing measurable (+1 %, inside
   run-to-run noise). The ~4 % belongs to the per-frame marker write, not to the
   feed. That was worth separating: the obvious assumption is the opposite.
3. **A JS write to `process.stdout` is not swallowed.** It goes through the
   renderer's `writeOut` into the same native queue as the frames, so all 365
   markers appeared in the captured stream. The audit had left this open.
4. **`postprocess` still cannot be trusted for attribution.** `addPostProcessFn`
   runs *before* `renderNative()` (`chunk-node-kq7as74d.js:9794-9799`), so a
   marker queued during frame N is queued ahead of frame N's own bytes. The
   captured stream interleaves plausibly — every marker is preceded by a real
   63-byte frame — but which frame a given marker commits could not be
   established from outside the process, and "plausible interleaving" is exactly
   the kind of evidence that reads as proof and is not.

**Decision: the feed.** A custom stdout puts the frame bytes in JS, which is the
only place ordering is ours to choose rather than to infer — the same guarantee
the Ink adapter has. It costs ~4 % of frame rate at a synthetic 200 fps, which is
far above any real TUI's frame rate, and nothing at all when no marker is being
written.

### A trap in the benchmark itself

The first run measured a **static** tree and reported every marker "preceded by
frame bytes" — with gaps of exactly one byte. OpenTUI skips redundant native
renders, so a static UI emits almost nothing after its first paint and there was
nothing to order against. The benchmark now mutates text every frame through
`setFrameCallback`. Anyone re-running this must keep that: a static fixture makes
every route look correct.
