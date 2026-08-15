# termwright (Go)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver, plus an adapter for [tview](https://github.com/rivo/tview).

An instrumented app publishes its primitive tree over a unix socket and commits
each frame with a signed DCS marker, so tests assert on *roles and names*
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
hook, but the marker is written immediately after `Show()` has flushed the
frame — the marker commits the bytes that precede it, so emitting it any
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
`Form` and `Frame`. **`Grid` has no item accessor**, so its children are
invisible unless you supply them:

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
