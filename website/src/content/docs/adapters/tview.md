---
title: tview (Go)
description: The Go module — Attach, where the marker is emitted, role derivation, and the Grid caveat.
---

```sh
go get github.com/gorce-ai/termwright/clients/go
```

Two packages:

- `.../clients/go/protocol` — framing, marker, message and snapshot validation,
  socket client. Standard library only.
- `.../clients/go/termwright` — the [tview](https://github.com/rivo/tview)
  adapter. Depends on tview and tcell.

## Instrumenting an app

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

A `nil` `*Session` is safe to use and to `Close` — that is how the dormant rule
is expressed in Go, so an instrumented binary needs no build tag.

Under a driver this publishes, after every committed frame:

```
region "Permission"   bounds=(0,0,80,24)
  button "Approve"    bounds=(0,0,80,1)  [focused]
  button "Reject"     bounds=(1,0,80,1)
```

## Where the marker is emitted

`Attach` wraps the `tcell.Screen`. The tree is built in tview's after-draw hook,
but the marker is written immediately after `Show()` has flushed the frame — the
marker commits the bytes that *precede* it, so emitting it any earlier would let
the driver act on a paint that has not landed.

`WithMarkerWriter` sends it somewhere other than `os.Stdout`; `WithScreen`
supplies your own screen (a `tcell.SimulationScreen` in tests).

## Roles and children

Roles come from the tview type: `Button` → `button`, `InputField` / `TextArea` →
`textbox`, `Checkbox` → `checkbox`, `List` / `DropDown` / `TreeView` → `list`,
`Table` → `table`, `TextView` → `text`, `Modal` → `dialog`, containers →
`region`. Names come from the widget label, then the box title, then its text.
`List` and `DropDown` entries are published as `listitem` nodes with
`positionInSet` / `setSize`, so they are addressable even though they are not
primitives.

Children are enumerated through the accessors tview exposes: `Flex`, `Pages`,
`Form` and `Frame`.

:::caution[`Grid` has no item accessor]
tview exposes no way to enumerate a `Grid`'s children, so they are invisible
unless you supply them.
:::

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

## Driving any Go TUI

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

`slog` records reach the driver instead of corrupting the render:

```go
session, _ := termwright.Attach(app, root, termwright.WithLogs())
slog.SetDefault(slog.New(protocol.NewSlogHandler(session.Client(), nil)))

slog.Error("policy missing", "path", "/etc/app/policy.json")  // never painted
```

`NewSlogHandler(nil, nil)` is never enabled, so the dormant path costs nothing.
Groups and attributes flatten to dotted keys, levels map onto the wire's closed
ladder, and a record the budget refuses leaves a gap in `seq` rather than being
renumbered. See [Application logs](../../guides/app-logs/).

## Limitations

- **Windows named pipes are not supported**; the client stays dormant on a
  `\\.\pipe\…` endpoint rather than half-working.
- One cross-language test vector group is skipped in Go: `encoding/json`
  replaces unpaired surrogates with U+FFFD before this package sees them, so a
  frame carrying a lone surrogate cannot be detected here. Those cases are
  marked `"optional": true` in the vectors.
