# Upstream audit — tview

> **Historical Phase 0 evidence.** The pinned-source measurements below are
> retained as design evidence. Any current support or setup guidance is
> superseded by the website tview adapter guide and compatibility reference.

The release implementation resolved the build-mechanism question differently
from this audit's initial premise: it uses an official `-toolexec` compiler
wrapper to add owned T1 compilation units directly to the resolved tview/tcell
packages. It does not copy modules, generate `go.work`, apply source patches or
bind support to upstream byte digests. Chained public before/after-draw hooks
arm only tview's final call through a public `tcell.Screen` decorator; custom
intermediate `Show` calls cannot publish partial semantics. The T1 unit reads
sealed state under tview's existing draw lock. The measurements below remain the evidence for that
lifecycle and state selection, not current implementation instructions.

Phase 0 of the zero-config campaign. What tview offers as a place to hook, what
state it holds where, and how a build-time replacement reaches it.

Read against **tview v0.42.0** (the version `clients/go/go.mod:7` pins) with
**tcell v2.8.1**, from the module cache at
`$GOMODCACHE/github.com/rivo/tview@v0.42.0`. Every claim below carries a
`file.go:line`. Line numbers are that version's; tview ships no CHANGELOG, so
they must be re-checked on any bump — see [Version sensitivity](#version-sensitivity).

Design premise this audit is written against: instrumentation lives **inside the
package**, in our own copy, so unexported fields are readable directly and no
reflection is needed.

## 1. The draw pipeline

`Application.draw()` (`application.go:703-747`) is the whole frame. It takes the
application's write lock for its entire duration (`application.go:704-705`),
snapshots `screen`, `root`, `beforeDraw` and `afterDraw` (`:707-711`), returns
early when either screen or root is nil (`:714-716`), sizes the root for
fullscreen (`:719-722`), clears, and then runs the fixed sequence:

```go
if before != nil {
    if before(screen) { screen.Show(); return a }
}
root.Draw(screen)
if after != nil { after(screen) }
screen.Show()
```

(`application.go:727-744`)

Two public entry points reach it. `Application.Draw()` (`application.go:684-689`)
does **not** draw on the calling goroutine — it wraps `a.draw()` in
`QueueUpdate`, so the work moves to the `Run()` loop and the caller blocks;
its doc warns that calling it from the main thread deadlocks. `ForceDraw()`
(`application.go:698-700`) is the synchronous form and must not be called from a
goroutine. `screen.Sync()` never runs inside `draw()`; it is reachable only
through `Application.Sync()` (`application.go:753-764`), which posts to the
update channel and takes only a read lock.

### The hooks

| Hook   | Signature                        | Where                    |
| ------ | -------------------------------- | ------------------------ |
| before | `func(screen tcell.Screen) bool` | `application.go:775-778` |
| after  | `func(screen tcell.Screen)`      | `application.go:790-793` |

Neither setter takes a lock, so both must be installed before `Run()`.
`before` returning `true` suppresses the root draw **and** the after hook, while
still calling `screen.Show()` (`application.go:727-731`) — a frame that never
reaches `afterDraw`. `after` returns nothing and cannot veto anything.

**`afterDraw` fires once per drawn frame, after the tree has been walked, and
before tcell flushes.** `after(screen)` at `application.go:740` and
`screen.Show()` at `:744` are consecutive statements in one function, same
goroutine, no lock released in between. So a hook there sees exactly the
contents that are about to go out, but the bytes have not gone out yet. If the
publishing contract is "after the frame's bytes were flushed", the injection
point is after line 744 and before the `return` at `:746` — still under the
lock. This matters for us because the render-commit marker must follow the
frame's bytes; the current Go client already writes it from a place that
satisfies that ordering (`clients/go/termwright/attach.go`, `commitScreen.Show`).

### The Primitive interface

Declared at `primitive.go:6-69`: `Draw`, `GetRect`, `SetRect`, `InputHandler`,
`Focus`, `HasFocus`, `Blur`, `MouseHandler`, `PasteHandler`. **It exposes no
children, no role and no text.** Any tree reconstruction is therefore a type
switch over concrete types plus their unexported fields — which is exactly what
the inside-the-package premise buys us, and what makes an external adapter need
either reflection or a hand-maintained registry.

`Box.Draw` delegates to `Box.DrawForSubclass(screen, b)` (`box.go:365-367`); the
`p` argument is used only for `p.HasFocus()` when picking border runes
(`box.go:394`). Rects live on `Box` (`box.go:18`) and are assigned **by parents
during the draw**: `Flex.Draw` calls `item.Item.SetRect(...)` immediately before
`item.Item.Draw(screen)` (`flex.go:187-201`), and the root's rect is set in
`draw()` itself (`application.go:719-722`).

## 2. Concurrency: where reading state is legal

The only mutex is the `sync.RWMutex` embedded in `Application`
(`application.go:73`). It guards `screen`, `title`, `focus`, `root`,
`rootFullscreen` and the mouse/paste flags; the hook fields and `inputCapture`
are written without it. `Run()` (`application.go:279`) selects over `a.events`
and `a.updates` (`:391-515`), executing updates inline (`:510-513`).
`QueueUpdate` (`:876-881`) sends and then **blocks** on the done channel;
`QueueUpdateDraw` (`:885-891`) is `QueueUpdate` plus `a.draw()`. Both channels
are buffered at `queueSize = 100` (`application.go:13`).

**Safe to read primitive state from:** `beforeDraw` / `afterDraw`, any
`InputHandler` / `MouseHandler` / `PasteHandler`, and the body of a
`QueueUpdate` function. All of these run on the `Run()` goroutine.

**Never from a hook** — `afterDraw` is called at `application.go:740`, inside
`draw()`, which holds the write lock from `:704`:

| Call from inside a hook                                                                           | Result                                                                                                   |
| ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `QueueUpdate` / `QueueUpdateDraw` / `Draw()`                                                      | blocks forever on the done channel (`:879`) — the loop is inside `draw()` and will never drain the queue |
| `ForceDraw()` / `draw()`                                                                          | re-entrant `a.Lock()` at `:704` on a non-reentrant mutex                                                 |
| `SetFocus` (`:839`), `SetRoot` (`:809`), `Stop` (`:625`), `GetFocus` (`:860`), `Suspend` (`:644`) | same mutex, same deadlock                                                                                |
| `QueueEvent` (`:896-898`), `Sync()` (`:754`)                                                      | safe — non-blocking sends, subject to the 100-slot buffer                                                |

Consequence for the probe: **publishing must be a non-blocking send on our own
channel, never a `QueueUpdate`.** `GetRect()` (`box.go:93-95`) is an unsynchronised
field read, so calling it from any other goroutine is a data race and may
observe a pre-layout rect.

`TextView` is the one primitive with its own `sync.Mutex` (`textview.go:137`);
`InputField` additionally has `autocompleteListMutex` (`inputfield.go:97`).

## 3. Containers

| Container | Children field                                                                                 | Public accessor                                                                                                       | Geometry notes                                                                                                                                                                                                                                      |
| --------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Flex`    | `items []*flexItem` (`flex.go:37`), fields `Item/FixedSize/Proportion/Focus` (`flex.go:20-26`) | `GetItemCount()` `flex.go:113`, `GetItem(i)` `flex.go:121`                                                            | no stored child rect; computed in `Draw` (`flex.go:145`) and pushed via `SetRect`                                                                                                                                                                   |
| `Grid`    | `items []*gridItem` (`grid.go:35`)                                                             | **none**                                                                                                              | `gridItem` carries `visible bool` and `x,y,w,h` — "the last position … undefined if visible is false" (`grid.go:17-18`). `Width/Height` on `gridItem` are **row/col spans**, not cells (`grid.go:201`); `x,y` are **relative to the grid's corner** |
| `Pages`   | `pages []*page` (`pages.go:24`)                                                                | `GetPageNames(visibleOnly)` `pages.go:57`, `GetPageCount` `:51`, `GetFrontPage` `:242`, `GetPage` `:253`              | visibility is the **exported** field `page.Visible` (`pages.go:12`); `GetPageNames` iterates back-to-front (`:57-65`) and returns `nil` when empty                                                                                                  |
| `Frame`   | single `primitive Primitive` (`frame.go:23`)                                                   | `GetPrimitive()` `frame.go:70`                                                                                        | texts in `text []*frameText` (`frame.go:26`) with **no accessor**                                                                                                                                                                                   |
| `Form`    | `items []FormItem` (`form.go:64`) **and** `buttons []*Button` (`form.go:67`) separately        | `GetFormItemCount/GetFormItem` `form.go:443/450`, `GetButtonCount/GetButton` `:393/381`, `GetFocusedItemIndex` `:488` | `focusedElement int` (`form.go:82`) is a **single index across both lists**, items first (`:79-81`)                                                                                                                                                 |

`Grid` is the reason the current Go adapter ships `WithChildren`: with `items`
unexported and no accessor (only `GetOffset()` at `grid.go:244`), an
out-of-package adapter cannot walk a Grid at all. **Inside the package this
disappears** — `g.items[i].Item` plus `visible` and `x,y,w,h` is the complete
picture, and it is strictly better than what `WithChildren` can supply, because
it carries per-item visibility and last-drawn geometry.

## 4. Atomic primitives: the private state worth reading

Every primitive below embeds `*Box` and has no rect of its own. `TextArea.width/height`
(`textarea.go:199`) and `TextView.width/height` (`textview.go:140`) are _requested
form sizes_, not positions; `TableCell.x/y/width` (`table.go:63`) is the cell's
last drawn position.

| Primitive    | Name / label                                         | Value                                                                                         | Selection                                | Other state                                                                       | Public getters                                                                                    |
| ------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `Button`     | `text` (`button.go:17`) — **not** `label`            | —                                                                                             | —                                        | `disabled` (`:14`)                                                                | `GetLabel()` `:57`, `IsDisabled()` `:110`                                                         |
| `InputField` | delegated to `textArea` (`inputfield.go:82`, `:174`) | delegated (`:163`)                                                                            | —                                        | `fieldWidth` (`:86`); **no own label/text/placeholder field**                     | `GetText()` `:163`, `GetLabel()` `:174`; no `GetPlaceholder`, no `IsDisabled`                     |
| `TextArea`   | `label` (`textarea.go:206`), `placeholder` (`:203`)  | piece chain: `initialText` (`:229`), `editText` (`:233`), `spans` (`:242`) — **not a string** | cursor/selection structs (`:285-298`)    | `disabled` (`:196`), `rowOffset`/`columnOffset` (`:264`/`:267`)                   | `GetText()` `:440`, `GetLabel()` `:798`, `GetDisabled()` `:844`, `GetOffset()` `:906`             |
| `Checkbox`   | `label` (`checkbox.go:21`)                           | —                                                                                             | —                                        | `checked` (`:18`), `disabled` (`:15`)                                             | `IsChecked()` `:85`, `GetLabel()` `:96`                                                           |
| `DropDown`   | `label` (`dropdown.go:54`)                           | `options []*dropDownOption` (`:27`)                                                           | `currentOption` (`:34`, negative = none) | `open` (`:43`), `disabled` (`:24`)                                                | `GetCurrentOption()` `:147`, `GetOptionCount()` `:338`, `IsOpen()` `:652`                         |
| `List`       | —                                                    | `items []*listItem` (`list.go:45`)                                                            | `currentItem` (`:48`)                    | scroll is **`itemOffset`** (`:82`) + `horizontalOffset` (`:86`)                   | `GetCurrentItem()` `:144`, `GetOffset()` `:165`, `GetItemCount()` `:428`, `GetItemText(i)` `:441` |
| `Table`      | —                                                    | `content TableContent` interface (`table.go:476`)                                             | `selectedRow/selectedColumn` (`:490`)    | `rowOffset/columnOffset` (`:503`), `visibleRows` (`:509`)                         | `GetSelection()` `:638`, `GetOffset()` `:669`, `GetRowCount/GetColumnCount` `:780/785`            |
| `TreeView`   | —                                                    | `root`/`nodes []*TreeNode` (`:303`/`:350`)                                                    | `currentNode` (`:306`, nil = none)       | scroll is **`offsetY`** (`:327`)                                                  | `GetCurrentNode()` `:392`, `GetScrollOffset()` `:500`, `GetRowCount()` `:508`                     |
| `Modal`      | —                                                    | `text` (`modal.go:22`)                                                                        | —                                        | buttons live in `m.form.buttons` (`:19`)                                          | **none at all**                                                                                   |
| `TextView`   | `label` (`textview.go:159`)                          | `text strings.Builder` (`:145`)                                                               | —                                        | scroll is **`lineOffset`** (`:180`) + `columnOffset` (`:188`); own mutex (`:137`) | `GetText()` `:403`, `GetScrollOffset()` `:583`                                                    |

Two traps that will bite a probe author:

- **Scroll field names are inconsistent across primitives.** `List.itemOffset`,
  `TextView.lineOffset`, `TextArea.rowOffset`, `Table.rowOffset`,
  `TreeView.offsetY`, `Grid.rowOffset` (that last one scrolls the _container_).
  There is no single field name to reach for.
- **`disabled` exists on only five types** — `Button` (`button.go:14`),
  `Checkbox` (`:15`), `DropDown` (`dropdown.go:24`), `TextArea`
  (`textarea.go:196`), `Image` (`image.go:255`). `TextView.SetDisabled` is a
  documented no-op (`textview.go:298-300`): text views are always read-only and
  hold no such field.

`HasFocus()` is overridden — do **not** read `Box.hasFocus` — in `InputField`
(`inputfield.go:464`), `DropDown` (`dropdown.go:673`), `TextView`
(`textview.go:799`), `Modal` (`modal.go:151`), `Flex` (`flex.go:218`), `Grid`
(`grid.go:260`), `Pages` (`pages.go:263`), `Frame` (`frame.go:179`) and `Form`
(`form.go:784`). `Box`'s own comment says container primitives ignore it
(`box.go:48-50`).

`Table` does not own its data: `content TableContent` (`table.go:476`) is an
interface (`:234`), so with custom content the default cell store does not
exist. Read through `GetCell`/`GetRowCount`/`GetColumnCount`
(`:740`/`:780`/`:785`), never through `tableDefaultContent.cells` (`:317`).

### State that is only valid after a draw

These are zero or stale before the first frame, which is precisely when an
eager probe would read them: `gridItem.visible/x/y/w/h` (`grid.go:17-18`),
`Table.visibleRows`/`visibleColumnIndices`/`visibleColumnWidths`
(`table.go:509-515`), `TextView.pageSize`/`lastWidth` (`textview.go:174-177`),
`TextArea.lastHeight`/`lastWidth` (`textarea.go:270`), `TreeView.nodes`
(`treeview.go:350`, see the comment at `:504-507`), `TreeNode.level`
(`treeview.go:43-45`), `TableCell.x/y/width` (`table.go:62-63`), and
`Box.innerX == -1` before initialisation (`box.go:76`).

Publishing from `afterDraw` sidesteps all of it, which is another argument for
that hook over any eager walk.

## 5. Version sensitivity

tview ships **no CHANGELOG**; the only stated policy is `README.md:157-163`,
where the author promises backwards compatibility for the public API while
reserving the right to change "internal interfaces such as `Primitive`". Private
fields carry no guarantee whatsoever — which is the standing risk of the
inside-the-package approach and the reason the probe needs a version-pinned
copy plus a compile-time canary.

Names that are easy to get wrong, all confirmed in v0.42.0:

- `Button` has no `label` field; the label is `text` (`button.go:17`) even
  though the getter is `GetLabel()` (`:57`).
- `page.Visible` (`pages.go:12`), `flexItem.Item/FixedSize/Proportion/Focus`
  (`flex.go:21-25`) and `gridItem.Item/Row/Column/Width/Height` (`grid.go:11-15`)
  are **exported fields inside unexported types** — `p.visible` will not compile.
- `InputField` holds no text, label or placeholder of its own; everything routes
  through `i.textArea` (`inputfield.go:82`, `:163`, `:174`, `:186`, `:293`).
- `TableCell.Color/BackgroundColor/Attributes` are kept only for backwards
  compatibility (`table.go:32-42`); use `Style`/`SelectedStyle`.

Fields with no public API at all, and therefore the most likely to move:
`TreeView.stableNodes` (`treeview.go:352-354`), `TreeView.movement`/`step`
(`:313`/`:318`), `Table.clampToSelection` (`table.go:492-494`),
`TextArea.lineStarts` (`textarea.go:279`), `Form.lastFinishedKey`
(`form.go:100-102`).

## 6. The build-time mechanism: `go.work` with `GOWORK`

The decision is to reach the instrumented copy through an **ephemeral
workspace file**, leaving the user's `go.mod` and `go.sum` untouched. Everything
below was verified empirically against **go1.24.4**, not read off the docs.

The generated file is a plain workspace with a filesystem replace:

```
go 1.22

use  /path/to/user/module
replace github.com/rivo/tview => /path/to/our/instrumented/tview
```

Invoked as `GOWORK=/path/to/generated.work go build ./...`.

**What was verified.**

1. _The replace takes effect._ `go list -m github.com/rivo/tview` prints the
   bare version without the workspace and `v0.42.0 => /…/instrumented/tview`
   with it.
2. _The instrumented copy is what actually compiles._ Introducing an undefined
   symbol into the copy fails the build with
   `../instrumented/tview/probe_marker.go:2:23: undefined: …`, while the same
   build without `GOWORK` still succeeds against the pristine module cache.
   This is the canary the probe should keep permanently.
3. _The user's files are not touched._ `go.mod` and `go.sum` are byte-identical
   before and after (md5 unchanged). A filesystem replace needs no `go.sum`
   entry, and **no `go.work.sum` was created** next to the generated file.
4. _`GOWORK` overrides a workspace the project already has._ With the user's own
   `go.work` present and discoverable, `GOWORK=<ours>` still wins;
   `GOWORK=off` disables workspace mode entirely.
5. _A `replace` in the user's `go.mod` loses to ours._ With the user replacing
   tview with their own fork in `go.mod`, the workspace replace still selects
   our copy — workspace replaces override module replaces.

**The failure mode that must be designed around.** A generated workspace that
lists only the target module **breaks a multi-module project**. Reproduced with
an `app` + `lib` workspace: the user's own `go.work` builds, and a generated one
containing only `use ./app` fails with

```
main.go:6:2: example.com/lib@v0.0.0: unrecognized import path "example.com/lib":
    reading https://example.com/lib?go-get=1: 404 Not Found
```

because dropping their `use ./lib` sends Go to the network for a module that
only exists on disk. Re-adding both `use` directives alongside our `replace`
builds cleanly. **The generator must therefore inherit the existing workspace
rather than invent one.** Read it machine-readably with `go work edit -json`,
which returns `{"Go": …, "Use": [{"DiskPath": …}], "Replace": …}`, then emit
that plus our replace. The user's existing replaces have to be carried across
too, minus any that target the framework we are replacing.

**Open questions for Phase 1.** Where the instrumented copy physically lives and
how it is keyed (framework module path plus exact version, since the copy is
version-specific); how the `go` directive in the generated file is chosen when
the workspace members disagree; and whether `GOFLAGS` already set by the user
can interfere (`-mod=vendor` in particular, which is incompatible with workspace
mode and would need to be detected and reported rather than silently overridden).
