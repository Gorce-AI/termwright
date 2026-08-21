# termwright (Go)

Semantic side-channel client and developer annotation SDK for Termwright's
automatic [tview](https://github.com/rivo/tview) and Charm probes.

An instrumented app publishes its primitive tree over a unix socket and commits
each frame with a signed OSC marker, so tests assert on *roles and names*
instead of screen-scraping cells.

The protocol client speaks `termwright/2`. Every published semantic revision
is a complete v2 snapshot with evidence-qualified geometry and pointer
observations.

**Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`, an
instrumented framework copy opens no socket, writes no marker and produces the
same terminal bytes as upstream.

## Install

```sh
go get github.com/gorce-ai/termwright/clients/go
```

Two packages:

- `.../clients/go/protocol` — framing, marker, message and snapshot validation,
  socket client. Depends on the standard library only.
- `.../clients/go/annotate` — describe your widgets to the zero-config probes.
  Standard library only, and dormant when no driver is attached. Needs Go 1.24
  (`runtime.AddCleanup`).

## Automatic tview semantics

```go
package main

import "github.com/rivo/tview"

func main() {
	app := tview.NewApplication()
	approve := tview.NewButton("Approve")
	reject := tview.NewButton("Reject")
	root := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(approve, 1, 0, true).
		AddItem(reject, 1, 0, false)
	root.SetTitle("Permission")

	if err := app.SetRoot(root, true).Run(); err != nil {
		panic(err)
	}
}
```

The application imports no Termwright package. Build it through
`@termwright/probe-tview`:

```ts
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({moduleDir: 'path/to/app'});
await execFile('go', ['build', '-o', 'app-binary', '.'], {
  cwd: 'path/to/app',
  env: build.env,
});
await launchTerminal({command: ['./app-binary']});
```

The generated `go.work` redirects only tview and the probe client to cached,
verified copies. The project's `go.mod`, `go.sum`, source tree and existing
workspace remain byte-identical.

Under the driver the ordinary application publishes, after every committed frame:

```
region "Permission"   visible=(0,0,80,24)
  button "Approve"    visible=(0,0,80,1)  [focused]
  button "Reject"     visible=(1,0,80,1)
```

### Where the marker is emitted

The pinned tview patch observes its draw traversal and wraps the internal
`tcell.Screen`. The tree is built from the just-drawn primitives, while the
private `OSC 8487` marker is emitted only after `Show()` flushes the frame. A
marker can therefore commit only the terminal bytes that precede it.

The probe also forces one redraw as soon as the handshake completes. tview has
usually drawn its first frame by then and an idle application never draws
again, so without that nudge the first tree would only appear once the user
pressed a key — and a test that starts with `waitForText` plus a semantic
assertion, with no input, would find no tree at all.

### Roles and children

Roles come from the tview type: `Button` → `button`, `InputField`/`TextArea` →
`textbox`, `Checkbox` → `checkbox`, `List`/`DropDown`/`TreeView` → `list`,
`Table` → `table`, `TextView` → `text`, `Modal` → `dialog`, containers →
`region`. Names come from the widget label, then the box title, then its text.
`List` and `DropDown` entries are published as `listitem` nodes with
`positionInSet`/`setSize`, so they are addressable even though they are not
primitives.

Because observation runs inside tview, it reads container fields that the
public API does not expose. This includes `Grid` children and the visibility of
`Pages` entries, so hidden pages remain in the tree as hidden and no custom
enumeration callback is required.

## Without tview

Any TUI can drive `protocol.Client` directly. You own the render; the client
owns the revision numbers and returns the marker to write after the frame.

```go
client := protocol.FromEnv(protocol.Options{AdapterName: "my-tui", AdapterVersion: "1.0.0"})
if client != nil && client.Start(protocol.DialTimeout) == nil {
	snapshot := protocol.NewSnapshot("", 0, 80, 24) // session and revision are filled in
	evidence := protocol.DefaultEvidence("my-tui")
	displayed := true
	rootRect := protocol.Rect{Row: 0, Column: 0, Width: 80, Height: 24}
	buttonRect := protocol.Rect{Row: 1, Column: 2, Width: 9, Height: 1}
	snapshot.RootIDs = []string{"root"}
	snapshot.Nodes = []protocol.Node{
		{ID: "root", Role: protocol.RoleDialog, Name: "Permission",
			Geometry: protocol.NodeGeometryObservations{
				Displayed: protocol.Observation[bool]{Status: "known", Value: &displayed, Evidence: evidence},
				IntendedRect: protocol.Observation[protocol.Rect]{Status: "known", Value: &rootRect, Evidence: evidence},
				VisibleRect: protocol.Observation[protocol.Rect]{Status: "known", Value: &rootRect, Evidence: evidence},
			}},
		{ID: "ok", ParentID: "root", Role: protocol.RoleButton, Name: "Approve",
			Geometry: protocol.NodeGeometryObservations{
				Displayed: protocol.Observation[bool]{Status: "known", Value: &displayed, Evidence: evidence},
				IntendedRect: protocol.Observation[protocol.Rect]{Status: "known", Value: &buttonRect, Evidence: evidence},
				VisibleRect: protocol.Observation[protocol.Rect]{Status: "known", Value: &buttonRect, Evidence: evidence},
			}},
	}
	marker, _ := client.Publish(snapshot)
	os.Stdout.WriteString(marker) // only after the render is fully written
}
```

A framework probe also sets `Options.Probe`. This block is separate from the
adapter capability list: it reports which framework is actually instrumented,
whether object identities survive a frame, and only the optional observations
the probe can support. Leave `FrameworkVersion` empty when it was not detected;
the wire omits it rather than guessing from the Go runtime.

## Annotations

The zero-config probes (`@termwright/probe-tview`, `@termwright/probe-charm`)
observe facts: this is a button, it holds this text, it has the focus, it was
drawn here. What they cannot observe is intent — that this list is the inbox,
that a row is *overdue* in the sense your domain means. `annotate` is where the
author supplies that, and it is the only package here that a zero-config
application imports.

There are two shapes because the two frameworks differ in one property, widget
identity.

**tview retains its primitives**, so an address is a usable key and a widget
you did not write can be described from outside:

```go
import "github.com/gorce-ai/termwright/clients/go/annotate"

annotate.Tag(unreadBadge, annotate.Semantics{
	Role:   "status",
	Name:   "Unread messages",
	TestID: "unread-badge",
	Domain: map[string]any{"sync": "pending", "retryCount": 2},
})
```

`Tag` is generic over a pointer so that `Tag(myStruct, …)` fails to compile
rather than annotating a copy. Tagging twice replaces; tagging with an empty
`Semantics` is `Untag`. Nothing is retained — the entry is released by a
cleanup attached to the widget, so a long-running TUI that creates and discards
widgets does not grow a map forever.

**A Bubble Tea component is a value**: `Update` returns a copy, and the address
stops meaning anything after the first keystroke. There the component declares
its own semantics, which the compiler checks and nothing has to release:

```go
func (g gauge) TermwrightSemantics() annotate.Semantics {
	return annotate.Semantics{Role: "meter", Name: "Disk usage"}
}
```

Both are read on the side channel only. An annotated run and an unannotated one
paint the same bytes.

### What an annotation may not say

`Semantics` carries `Role`, `Name`, `TestID`, `Description` and `Domain`, and
nothing else. There is deliberately no field for geometry, focus or rendered
text: the screen is the authority on those, and an annotation able to restate
them would eventually contradict them — turning a passing test into a lie
rather than a failure. Physical facts stay with the probe, wording comes from
here, and where both speak the merge order is the one in the protocol README:
annotation above recognizer, but never above an observed fact.

`Domain` is published as the node's `extended` namespace, not folded into its
description or promoted to portable state. JavaScript tests can read it with
`locator.extendedState()` or assert selected keys with
`toHaveExtendedState(...)`.

A role outside the vocabulary is dropped rather than guessed, so a typo costs
you the override and not the node.

## Application logs

The framework probe owns its private client; a zero-change tview application
does not receive that client as an application API. A custom Go semantic
producer may opt into `protocol.NewSlogHandler(client, nil)`. Groups and
attributes flatten to dotted keys, `slog` levels map onto the wire's closed
ladder, and a record the budget refuses leaves a gap in `seq`.

## Diagnostics

When the probe does not attach, nothing anywhere says why: the dormant rule
means a process with no endpoint behaves exactly like a process that never
heard of termwright. Point `TERMWRIGHT_DEBUG_FILE` at a file and the probe
writes down what it decided.

```
TERMWRIGHT_DEBUG_FILE=/tmp/adapter.log
```

```text
  tw:diag [p41207]   0.000s open adapter=tview pid=41207 platform=linux/amd64 go=go1.24.0 argv0=todo
  tw:diag [p41207]   0.001s dormant: TERMWRIGHT_TOKEN not set
```

or, on a session that came up:

```text
  tw:sem  [p41207]   0.002s dial unix:/tmp/tw-8f21/s timeout=5000ms
  tw:sem  [p41207]   0.003s hello sent adapter=tview/1.0.0 caps=tree,intended-geometry,clipped-geometry,…
  tw:sem  [3f9c1a04]  0.011s hello-ack session=3f9c1a04… marker=on subscribe=snapshots logs=off
  tw:io   [3f9c1a04]  0.048s r1 snapshot nodes=17
  tw:io   [3f9c1a04]  0.049s performance r1 bytes=3481 nodes=17 unknown=2 serialization_us=44.125
```

With the debug log enabled, `Client.PerformanceMetrics()` also returns a
machine-readable value snapshot: full snapshots, semantic bytes,
nodes, generic/unknown nodes, failed publications, requested markers and
serialization time, including per-frame averages. Collection is tied to the
non-nil debug log so normal render paths do not pay for timers or a second node
scan. Facts the protocol client cannot observe remain JSON `null`: raw probe
events, parent normalization and whether the caller actually drained the
returned marker to the PTY. The client owns no coalescing queue, so its own
coalescing count is a measured zero; a framework probe with a queue reports its
counter separately.

Three properties are worth knowing before you rely on it:

- **It never writes to stderr.** The application owns the terminal, and a
  diagnostic line in the middle of a render corrupts the screen the driver is
  asserting on. There is no stderr mode to turn on by mistake.
- **It never fails the application.** An unwritable path, a full disk or a
  closed file turns the log off and changes nothing else.
- **The token never appears in it.** The endpoint does, because the endpoint
  is how you tell one session's socket from another's.

`TERMWRIGHT_DEBUG=<path>` works too, for symmetry with the driver's own
switch. `TERMWRIGHT_DEBUG=1` does **not**: that value means "log to stderr" to
the driver, it reaches this process as well, and stderr is the one destination
the probe cannot use. Set the value to a path or the probe stays silent.

The line format is the driver's, so `TERMWRIGHT_DEBUG=1` on the driver and
`TERMWRIGHT_DEBUG_FILE=…` on the app produce two halves of one story that a
single reader can take.

## Deviations

Measured against the probe conventions in the protocol README. Everything
not listed here follows them.

- **Windows support is compiled, not yet observed here.** The named-pipe
  transport (`go-winio`, behind a `windows` build tag) cross-compiles and vets
  clean, but this repository's checks run on POSIX, so the verdict for a live
  pipe comes from CI rather than from a local run.

- **`testId` has no native source** (rule 3). tview exposes no identifier — a
  Box title is display text, not an id — so the only source is
  `annotate.Tag`. A widget with no annotation publishes no
  `testId` at all rather than a synthesised one, because an id that shifts when
  an unrelated widget is added fails later and looks flaky rather than wrong.
- **`modal` is derived from the widget type, not a flag** (rule 4). A
  `tview.Modal` is modal by construction and the type carries no property to
  read. No other state here is inferred: `disabled`, `checked` and `focused`
  all come from `IsDisabled`, `IsChecked` and `HasFocus`.
- **The probe is exact-version build instrumentation.** It sees private `Grid`
  children precisely because the verified patch runs inside tview; an
  unsupported tview version is refused rather than approximated from the
  public API.
- **List and DropDown entries are synthesised, not primitives** (rule 3). They
  are published as `listitem` nodes with generated ids (`p4:item0`), because
  tview keeps them as text rather than as widgets. They carry no `testId`, and
  their ids move if the list is reordered — address them by role and name.
- **DropDown options other than the current one have positional names** (rule
  2). tview exposes no per-index accessor, so an unselected option is published
  as `option 2` rather than its text.

## Conformance

`protocol/vectors_test.go` runs against `clients/test-vectors/`, generated from
the normative TypeScript implementation in `packages/protocol`. Framing bytes,
marker MACs, message parsing and snapshot validation are asserted against the
same vectors in Go, Python and Rust.

```sh
go test ./...
```

One vector group is skipped here: `encoding/json` replaces unpaired surrogates
with U+FFFD before this package can see them, so the frame carrying a lone
surrogate cannot be detected in Go. Those cases are marked `"optional": true`
in `framing.json`.
