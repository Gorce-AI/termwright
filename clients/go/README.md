# termwright (Go)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver, plus an adapter for [tview](https://github.com/rivo/tview).

An instrumented app publishes its primitive tree over a unix socket and commits
each frame with a signed OSC marker, so tests assert on *roles and names*
instead of screen-scraping cells.

**Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the
environment `Attach` returns `(nil, nil)`: no socket, no marker, no change to
what the app renders. A `nil` `*Session` is safe to use and to `Close`.

## Install

```sh
go get github.com/gorce-ai/termwright/clients/go
```

Two packages:

- `.../clients/go/protocol` — framing, marker, message and snapshot validation,
  socket client. Depends on the standard library only.
- `.../clients/go/termwright` — the tview adapter. Depends on tview and tcell.

## tview in 30 lines

```go
package main

import (
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/termwright"
)

func main() {
	app := tview.NewApplication()
	approve := tview.NewButton("Approve")
	reject := tview.NewButton("Reject")
	root := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(approve, 1, 0, true).
		AddItem(reject, 1, 0, false)
	root.SetTitle("Permission")

	// Returns (nil, nil) when no driver is attached; nothing is installed then.
	session, err := termwright.Attach(app, root)
	if err != nil {
		panic(err)
	}
	defer session.Close()

	if err := app.SetRoot(root, true).Run(); err != nil {
		panic(err)
	}
}
```

Under the driver this publishes, after every committed frame:

```
region "Permission"   bounds=(0,0,80,24)
  button "Approve"    bounds=(0,0,80,1)  [focused]
  button "Reject"     bounds=(1,0,80,1)
```

### Where the marker is emitted

`Attach` wraps the `tcell.Screen`. The tree is built in tview's after-draw
hook, but the marker — a private `OSC 8487` sequence terminated by BEL — is
written immediately after `Show()` has flushed the frame — the marker commits the bytes that precede it, so emitting it any
earlier would let the driver act on a paint that has not landed. Use
`WithMarkerWriter` to send it somewhere other than `os.Stdout`, and
`WithScreen` to supply your own screen (a `tcell.SimulationScreen` in tests).

`Attach` also forces one redraw as soon as the handshake completes. tview has
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

Children are enumerated through the accessors tview exposes: `Flex`, `Pages`,
`Form` and `Frame`. `Pages` is the one container that keeps children it is not
showing, so everything under an unshown page is published with `hidden` set
(and inherits it downwards, and never claims focus) — a `toBeVisible()`
assertion must not go green for a screen that has not opened yet.

**`Grid` has no item accessor**, so its children are invisible unless you
supply them:

```go
session, _ := termwright.Attach(app, root,
	termwright.WithChildren(func(p tview.Primitive) []tview.Primitive {
		if p == myGrid {
			return []tview.Primitive{header, body, footer}
		}
		return nil // fall back to the built-in enumeration
	}),
	termwright.WithDescriber(func(p tview.Primitive) (protocol.Role, string, bool) {
		if p == myGauge {
			return protocol.RoleProgressBar, "Upload progress", true
		}
		return "", "", false
	}),
)
```

## Without tview

Any TUI can drive `protocol.Client` directly. You own the render; the client
owns the revision numbers and returns the marker to write after the frame.

```go
client := protocol.FromEnv(protocol.Options{AdapterName: "my-tui", AdapterVersion: "1.0.0"})
if client != nil && client.Start(protocol.DialTimeout) == nil {
	snapshot := protocol.NewSnapshot("", 0, 80, 24) // session and revision are filled in
	snapshot.RootIDs = []string{"root"}
	snapshot.Nodes = []protocol.Node{
		{ID: "root", Role: protocol.RoleDialog, Name: "Permission"},
		{ID: "ok", ParentID: "root", Role: protocol.RoleButton, Name: "Approve",
			Bounds: &protocol.Rect{Row: 1, Column: 2, Width: 9, Height: 1}},
	}
	marker, _ := client.Publish(snapshot)
	os.Stdout.WriteString(marker) // only after the render is fully written
}
```

## Application logs

```go
session, _ := termwright.Attach(app, root, termwright.WithLogs())
slog.SetDefault(slog.New(protocol.NewSlogHandler(session.Client(), nil)))

slog.Error("policy missing", "path", "/etc/app/policy.json")  // never painted
```

`NewSlogHandler(nil, nil)` is never enabled, so the dormant path costs nothing.
Groups and attributes flatten to dotted keys, `slog` levels map onto the wire's
closed ladder, and the client drops what the budget does not allow — leaving a
gap in `seq` so the driver can report the loss.

## Diagnostics

When the adapter does not attach, nothing anywhere says why: the dormant rule
means a process with no endpoint behaves exactly like a process that never
heard of termwright. Point `TERMWRIGHT_DEBUG_FILE` at a file and the adapter
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
  tw:sem  [p41207]   0.003s hello sent adapter=tview/1.0.0 caps=tree,bounds,…
  tw:sem  [3f9c1a04]  0.011s hello-ack session=3f9c1a04… marker=on subscribe=diffs logs=off
  tw:io   [3f9c1a04]  0.048s r1 snapshot nodes=17
```

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
an adapter cannot use. Set the value to a path or the adapter stays silent.

The line format is the driver's, so `TERMWRIGHT_DEBUG=1` on the driver and
`TERMWRIGHT_DEBUG_FILE=…` on the app produce two halves of one story that a
single reader can take.

## Deviations

Measured against the adapter conventions in the protocol README. Everything
not listed here follows them.

- **Windows support is compiled, not yet observed here.** The named-pipe
  transport (`go-winio`, behind a `windows` build tag) cross-compiles and vets
  clean, but this repository's checks run on POSIX, so the verdict for a live
  pipe comes from CI rather than from a local run.

- **`testId` has no native source** (rule 3). tview exposes no identifier — a
  Box title is display text, not an id — so the only source is the annotation,
  via `WithTestIDs` or `Session.SetTestID`. A widget with neither publishes no
  `testId` at all rather than a synthesised one, because an id that shifts when
  an unrelated widget is added fails later and looks flaky rather than wrong.
- **`modal` is derived from the widget type, not a flag** (rule 4). A
  `tview.Modal` is modal by construction and the type carries no property to
  read. No other state here is inferred: `disabled`, `checked` and `focused`
  all come from `IsDisabled`, `IsChecked` and `HasFocus`.
- **`Grid` children are invisible without help** (rules 1–5, transitively).
  tview offers no item accessor for `Grid`, so its children reach the tree only
  through `WithChildren`. Everything under an unsupplied Grid is simply absent.
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
