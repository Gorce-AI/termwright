# @termwright/probe-charm

Semantics from a [Bubble Tea](https://github.com/charmbracelet/bubbletea)
application that **imports nothing of ours**.

The application is built through an ephemeral Go workspace that redirects
Bubble Tea to an instrumented copy. Nothing is written into the project: its
`go.mod`, its `go.sum` and any `go.work` of its own come out of the build
byte-identical.

## Install

```sh
npm install --save-dev @termwright/probe-charm
```

Requires the Go toolchain and `git`. Node >= 22.

## Two majors, and why the path matters

Bubble Tea v2 is not the v1 path with a suffix. It lives at
`charm.land/bubbletea/v2`, a vanity import, so a probe that looks for
`github.com/charmbracelet/bubbletea/v2` finds a module that does not exist and
concludes the application is v1.

```ts
import {detectCharmFlavour, capabilitiesFor} from '@termwright/probe-charm';

const flavour = await detectCharmFlavour('path/to/app');
// → {major: 'v2', module: 'charm.land/bubbletea/v2', version: 'v2.0.8', companions: {…}}

capabilitiesFor(flavour.major); // v1 never claims `bounds`
```

Detection runs with `GOWORK=off` so it reports what the project requires rather
than what some workspace currently redirects. An application that somehow
requires both majors is refused by name instead of being guessed at.

## What it gives you

The patch set puts a hook where the frame is produced — one call site in v2's
`Program.render`, three in v1, which is the difference between the two designs
rather than an accident. From there the probe walks the user's model by
reflection and reports the components it recognises.

Recognition is by package path and type, and it reads **public accessors
only**. Bubbles is a separate module from Bubble Tea, so patching Bubble Tea
buys the frame hook and nothing about the widgets; the optional Bubbles patch
set adds accessor files (it edits nothing) and the probe finds them by name. An
unpatched Bubbles therefore reports less rather than failing to build.

Those accessors exist because the public API answers a slightly different
question than a test asks:

| component | the public API says | the accessor says |
|---|---|---|
| `spinner` | a glyph — "animating" and "stuck" look alike | the frame index |
| `progress` | `Percent()` is the animation's *target* | the fraction actually drawn |
| `filepicker` | a highlighted path, no position | index and entry count |
| `table` | nothing distinguishes absent from scrolled out | the rendered window |

## Passwords are not published

`textinput.Value()` returns the contents whatever the widget draws. A masked
field publishes **no value** and is marked readonly, so a reader can tell
"empty" from "withheld", and a password cannot reach the semantic tree, the
trace archive or the HTML report. The end-to-end test types a secret, waits for
the mask to prove the application received it, and asserts the secret appears
nowhere in the published tree.

## No bounds, and why that is the honest answer

Neither major reports geometry. By the time a frame reaches the renderer it is
one styled string, and Lip Gloss has destroyed the mapping from fragment to
screen region — padding is spaces indistinguishable from content, truncation
discards the tail without recording that it existed.

So the probe reports component, name and value **without a position** rather
than inventing coordinates, and the capability set says so. Two channels could
restore it on v2 (the layer compositor, and per-cell OSC 8 hyperlinks); neither
is wired, and [`NOTES.md`](NOTES.md) records what is measured about each,
including the fact that our emulator keeps only the `id` parameter of an OSC 8
sequence.

## Describing what the probe cannot see

A Bubble Tea component is a value — `Update` returns a copy — so there is no
address to register an annotation against. A component instead declares its own
semantics, and the probe asks before it tries to recognise anything:

```go
import "github.com/gorce-ai/termwright/clients/go/annotate"

func (g gauge) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{Role: "meter", Name: "Disk usage"}
}
```

That order is the point: a custom type no recognizer knows would otherwise be
walked past in silence. A component the probe *does* recognise gets both — the
author's wording and the probe's observed facts. `Semantics` has no field for
bounds, focus or rendered text, structurally, so a declaration cannot go stale
against the screen.

## Current surface

This package exports detection (`detectCharmFlavour`, `capabilitiesFor`,
`BUBBLETEA_MODULES`) and re-exports the shared Go machinery from
`@termwright/probe-go` — workspace generation, the copy cache and the patch
sets. Unlike `@termwright/probe-tview` there is **no single
`prepareInstrumentedBuild` call yet**: the assembly of copy → patch → workspace
lives in this package's tests, which is honest about where it is rather than a
convenience that does not exist.

## When it refuses

- `-mod=vendor` in `GOFLAGS` is reported by name rather than overridden.
- A Bubble Tea version with no patch set is named as such instead of failing
  somewhere inside a diff.
- An application requiring both majors is refused rather than half-instrumented.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

Suites needing Go or a pseudo-terminal skip themselves where either is missing,
in a test named for it; `TERMWRIGHT_SKIP_GO=1` and `TERMWRIGHT_SKIP_PTY=1`
force it. Implementation notes, including the traps that cost time, are in
[`NOTES.md`](NOTES.md).
