# @termwright/probe-tview

Semantics from a [tview](https://github.com/rivo/tview) application that
**imports nothing of ours**.

The application is built through an ephemeral Go workspace that redirects
`github.com/rivo/tview` to an instrumented copy. Nothing is written into the
project: its `go.mod`, its `go.sum` and any `go.work` of its own come out of the
build byte-identical.

## Install

```sh
npm install --save-dev @termwright/probe-tview
```

Requires the Go toolchain and `git` (which the toolchain needs anyway). Node >= 22.

## Usage

One call prepares the build; the launcher owns everything else.

```ts
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({moduleDir: 'path/to/app'});

// build.env carries GOWORK; the project's own files are untouched.
await execFile('go', ['build', '-o', 'app-binary', '.'], {cwd: 'path/to/app', env: build.env});

await launchTerminal({command: ['./app-binary']});
```

The framework version is read from the module, the instrumented copy is cached,
and a second call with the same inputs reuses it.

## What it gives you

Being inside the package is the point. A `tview.Grid` exposes no accessor for
its children at all, so an out-of-package adapter has to be handed a callback;
here it is a field read that also carries whether the item was drawn. A widget
on a `Pages` page that is not shown reports as **hidden** rather than going
missing, so a test can tell "not on screen" from "not there".

Identity is the primitive's pointer: tview retains its widget tree, so the same
`*Button` is the same button across frames. The handshake therefore reports
`identityKind: 'stable'` and only the probe capabilities it earns:
`stable-identity` and `annotations`. Its `frameworkVersion` is the exact
version selected by the verified patch set, not the Go runtime version.

## Describing what the probe cannot see

Zero-config means the probe reads facts. It cannot read intent — which button
is the destructive one, which list is the inbox, what "overdue" means here. For
that, and only for that, an application may import
`github.com/gorce-ai/termwright/clients/go/annotate`:

```go
import (
	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

annotate.Tag(label, annotate.Semantics{Key: "unread-label"})
annotate.Tag(unreadBadge, annotate.Semantics{
	Role: "status", Name: "Unread messages", TestID: "unread-badge",
	Actions: []protocol.Action{protocol.ActionFocus, protocol.ActionActivate},
	LabelledBy: []annotate.SemanticKey{"unread-label"},
})
```

The probe merges this with what it observed: the wording is the author's, the
bounds and the focus stay the probe's. `Semantics` has no field for bounds,
focus, visibility, value, rendered text or framework state — not by convention
but structurally, so an annotation cannot go stale against the screen. Actions
come from the protocol's closed descriptive set and never install callbacks.
Tagging retains nothing; the entry is released with the widget.

`LabelledBy` and `DescribedBy` use framework-neutral `SemanticKey` strings, so
one annotation does not retain its targets. The probe resolves them after the
whole tree has been walked. Missing or duplicate keys are omitted instead of
becoming dangling or arbitrary node references. Pointer identity remains the
stable node id; a key is only the relation target for tview. Primary framework
provenance is reported in `p`, with recognizer and annotation exceptions in
`px`.

This is the one import that makes an application no longer zero-config, which
is why it is optional and why the two example fixtures in this package are kept
apart.

## Dormant without instrumentation

Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` the instrumented copy opens
no socket, writes no marker and renders exactly what upstream renders. That is
measured, not asserted: the test suite builds the same application twice, once
against untouched tview and once against the copy, and requires the two screens
to be byte-identical.

## When it refuses

- `-mod=vendor` in `GOFLAGS` is reported by name rather than overridden;
  workspace mode is incompatible with it, and overriding would change what
  compiles.
- A framework version with no patch set is named as such — "this is not
  tview v0.42.0" — instead of failing somewhere inside a diff.

## Development

```sh
pnpm build && pnpm typecheck && pnpm test
```

The suites that need Go or a pseudo-terminal skip themselves where either is
missing, and say so in a test named for it. `TERMWRIGHT_SKIP_GO=1` and
`TERMWRIGHT_SKIP_PTY=1` force it. Implementation notes, including the traps
that cost time, are in [`NOTES.md`](NOTES.md).
