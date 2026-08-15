---
title: Limitations and FAQ
description: Platform support, what is untested, what is deliberately out of scope, and the traps that cost other people an afternoon.
---

This page is deliberately blunt. A test tool that oversells what it observes is
worse than one that says where it stops.

## Platforms

| Platform | Status |
|---|---|
| macOS (arm64, x64) | supported, tested |
| Linux, glibc | supported, tested |
| Windows / ConPTY | supported by design and in the CI matrix; **see the caveats below** |
| Alpine / musl | **not supported** — use `node:22-slim` |

Alpine is not an oversight: no pseudo-terminal candidate ships musl prebuilds,
and a build-from-source path in CI is not a support story we are willing to
promise.

### What is actually untested on Windows

Being honest about the gap between "the CI lane exists" and "this has been
exercised":

- the Ink adapter has not been run on a ConPTY host, though named pipes are
  handled transparently by `node:net`;
- `@termwright/ink-testing` has not been exercised on ConPTY — the in-process
  mount path has no platform surface at all, the fixture path does;
- the conformance suites have not been run on Windows. They skip cleanly where
  no pty opens, **which is not the same as passing**.

The Python and Go clients stay **dormant on a Windows named-pipe endpoint**
rather than half-working, so instrumented Textual and tview apps are
generic-mode on Windows today.

## Known gaps by area

**Semantics**

- Ink publishes no `cursor` field: Ink exposes no way to read the committed
  cursor position from outside a component.
- The `text-ranges` and `tree-diffs` capabilities are not claimed by any adapter
  yet. Both are additive in 1.x.
- Bounds are only trustworthy where an adapter claims `absolute-bounds` — for
  Ink, that means interactive alternate-screen renders, and it drops bounds
  entirely once `<Static>` shifts the layout region.

**Runner UI**

- Multiple sessions in one test are attached and listed, but the terminal pane
  shows the first one that produced output.
- Screenshots are a separate package by design
  ([`@termwright/screenshot`](../../guides/traces/)), not something the runner
  does.
- There is no committed browser test suite yet; the panes were verified through
  Playwright by hand.

**Screenshots**

- A character no configured font covers falls back to `<text>` with a monospace
  family instead of an embedded outline. It still renders wherever a suitable
  font exists, and `selfContained` / `fallbackCharacters` say when that applies.
- `bold` is synthesised by stroking and `italic` by shearing, because the
  outlines come from the regular face.
- No MCP tool returns a PNG yet: the renderer exists, the wiring into
  `trace.frame_at` and `trace.diff` does not, and asking for one fails loudly
  rather than silently.

**MCP**

- No tool returns `ImageContent`. A real PNG needs a rasteriser, and headless
  Chromium is not an acceptable dependency; `snapshot {variant: "full"}` writes
  text, ANSI and HTML to disk instead.
- Concurrent *driver* sessions are covered by conformance; concurrent MCP
  sessions have their own ownership rules still to certify.

**Component testing**

- `launchInkFixture` has no `rerender`. Change props by relaunching, or drive
  the change through input.
- There is no `mountOpenTui` yet, though the backend, streams and settlement
  helpers are framework-agnostic and exported for exactly that.

## Traps that cost an afternoon

**A PTY coalesces writes.** Two `press()` calls routinely arrive as one chunk.
An application that treats a chunk as one event silently drops the second key —
which shows up as a flaky multi-key test, not as a failure. Tokenise the chunk:
escape sequences whole, then one code point at a time.

**`waitForText` returns on the first line of a frame, not the last.** If you
then assert on coordinates, half the screen may still be in flight. Wait for
something the program draws *last*.

**Text that can scroll off is not a safe thing to wait for.** A pty may deliver
a program's whole output in one chunk, so waiting on an early line passes or
fails depending on how the write was split. Target the newest line, or a
full-frame repaint.

**The tree lags the screen by design.** The marker follows the frame, so a
`waitForText` can precede the matching semantic revision by a beat. The preset's
matchers poll through it; direct tree reads need `waitForStable()`.

**`waitForReady` can return before the command it should wait for starts.**
Between `press('Enter')` and the shell's `OSC 133 C`, the last mark still says
"prompt waiting". Wait for the command to be observably running first.

**A ZWJ cluster's width is disputed.** Yoga (Ink) and the Unicode 11 addon
disagree on sequences like `👩‍👩‍👧`, which shifts every row below it inside a
bordered box. Keep such sequences out of layouts whose bounds you assert on.

**Clicking needs the application to enable mouse tracking.** If it does not,
`click()` refuses with `unsupported-action` rather than sending bytes nobody
reads. Use `press()` and `activate()`.

## Deliberate non-goals

Not oversights — decisions:

- shells beyond bash, zsh and pwsh;
- Sixel and kitty-graphics assertions;
- a VHS-style `.tape` DSL (revisit at 2.0);
- our own test scheduler — Vitest's sharding, `--last-failed` and
  `--repeat-each` are what we ride on;
- pixel-exact native terminal chrome;
- screen-reader accessibility claims. The role model is ARIA-aligned so that
  bridge stays open, but termwright does not certify anything about assistive
  technology.

Frameworks we are not adapting: blessed (dead), termui (stagnant).

## FAQ

**Does the adapter slow down or change my production app?**
No. Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` it opens nothing,
allocates nothing and emits nothing, and its output is byte-for-byte identical
to an uninstrumented run. Conformance asserts that against a baseline build.

**Can a program forge the render marker?**
No. The marker's MAC is keyed with the per-session token and binds both session
and revision, comparison is constant-time, and an unverified marker raises a
`marker-unverified` diagnostic rather than committing a revision.

**Do I need Vitest?**
No. The driver is runner-agnostic and works from `node:test`, Jest or a plain
script. `@termwright/test` is a thin adaptation layer — roughly 5% of the code —
and it is swappable without touching the driver or the protocol.

**Can I test a program I did not write?**
Yes, in generic mode: text, cells, colours, modes, scrollback, mouse, paste,
resize. You cannot get a semantic tree out of a program that does not publish
one, and termwright will not invent roles for it.

**Can it attach to an already-running session?**
No. termwright launches the program itself; owning the pty is what makes input,
sizing, environment and recording deterministic. If you cannot own the process,
[tmux is the right tool](../../guides/why-not-tmux/).

**Why is my cell snapshot different in CI?**
Almost always colour. Set a [profile with a pinned palette](../configuration/),
which also pins `TERM` and `COLORTERM` for the launched program.
