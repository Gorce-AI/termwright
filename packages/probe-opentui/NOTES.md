# @termwright/probe-opentui — implementation notes

## Two specifier forms, and why they are not unified

CI turned both of these up, and the second one reversed a decision that read as
obviously right.

**A path handed to `node --import` must be a `file://` URL.** On Windows an
absolute path fails with `ERR_UNSUPPORTED_ESM_URL_SCHEME: Received protocol
'd:'` — a drive letter parses as a scheme, which is a confusing way for it to
fail. `withProbe` therefore emits `pathToFileURL(entry).href`. Bun was measured
to accept either form, so both runtimes get the URL: one form that works
everywhere beats two where the rarer one rots.

**Inside the shim the opposite holds.** The obvious next step — convert the
re-import specifier to a URL too, for the same Windows reason — silently breaks
Bun. Measured on Bun 1.2.15: a shim that re-imports through `file:///…` arrives
with **one export**, not the framework's whole surface. `export *` forwards
nothing. The wrapper still works, so `createCliRenderer` looks fine and every
other export is simply gone; only a test that asserts on a second export catches
it, which is exactly the test that did.

The rule the shim follows now: **echo back the specifier form the loader handed
over.** Node's hooks give a URL, Bun's `onLoad` gives a native path, and each
runtime demonstrably consumes what it produced. `toModuleUrl` exists for the
launcher flag alone.

Unverified: Bun on Windows, where the shim would embed a `D:\…` path. No CI lane
runs Bun on Windows today, and the form is self-consistent (Bun produced it), but
nobody has watched it work.

## Which CI lane has Bun

Bun lives in one lane, not in the build jobs, so the process tests probe for it
(`src/testing/bun-available.ts`, the same shape as conformance's `ptyAvailable`)
and drop the Bun arms when it is missing. A test named "skips the Bun arms
because no bun binary is reachable" runs in that case, so a reduced run says so
instead of looking fully green. `TERMWRIGHT_SKIP_BUN=1` forces it.

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
