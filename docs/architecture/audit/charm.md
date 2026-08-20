# Upstream audit — Bubble Tea, Bubbles, Lip Gloss

> **Historical Phase 0 evidence.** The pinned-source measurements below are
> retained as design evidence. Any current support or setup guidance is
> superseded by the website Bubble Tea adapter guide and compatibility
> reference.

Phase 0 of the zero-config campaign. Where a frame is submitted, what state the
components hold before that frame flattens them into one string, and whether
provenance from component to screen region can survive the trip.

Read against the current stable releases, pulled fresh for this audit — the
repository pins none of them today:

| Module | v1 | v2 |
|---|---|---|
| Bubble Tea | `github.com/charmbracelet/bubbletea` **v1.3.10** | `charm.land/bubbletea/v2` **v2.0.8** |
| Bubbles | `github.com/charmbracelet/bubbles` **v1.0.0** | `charm.land/bubbles/v2` **v2.1.1** |
| Lip Gloss | `github.com/charmbracelet/lipgloss` **v1.1.0** | `charm.land/lipgloss/v2` **v2.0.6** |

**The v2 module path is not `github.com/charmbracelet/…/v2`.** Asking the proxy
for that path fails with `module declares its path as: charm.land/bubbletea/v2`.
Charm moved v2 to a vanity domain, so any probe matching frameworks by module
path must match both hosts or it will silently miss every v2 project.

Same premise as the tview audit: instrumentation lives inside our own copy of
the package, so unexported fields are directly readable.

## 1. Bubble Tea: the submission point

### v1

`Model` is the familiar triple (`tea.go:44-56`): `Init() Cmd`,
`Update(Msg) (Model, Cmd)`, `View() string`. The event loop is
`Program.eventLoop` (`tea.go:380`); the frame leaves the model at `tea.go:502`:

```go
model, cmd = model.Update(msg) // run update
...
p.renderer.write(model.View()) // send view to renderer
```

Two further call sites sit outside the loop — `tea.go:700` (first frame) and
`tea.go:739` (final frame on graceful shutdown) — so a hook placed at `:502`
alone misses both.

The renderer interface is `renderer.write(string)` (`renderer.go:16`), and the
standard implementation only swaps a buffer: `standardRenderer.write`
(`standard_renderer.go:303-317`) does `r.buf.Reset()` then `r.buf.WriteString(s)`.
Output happens elsewhere, on a ticker: `listen()` (`standard_renderer.go:147-157`)
calls `flush()` (`:161`), which writes at `standard_renderer.go:283`
(`r.out.Write(buf.Bytes())`). Frame rate is `defaultFPS = 60`, `maxFPS = 120`
(`standard_renderer.go:18-19`).

### v2

`View()` no longer returns a string (`tea.go:53-65`):

```go
// View renders the program's UI, which can be a string or a [Layer]. The
// view is rendered after every Update.
View() View
```

`View` is a struct (`tea.go:84`) whose `Content string` field holds "styled
strings with styles and hyperlinks encoded as ANSI escape codes" (`tea.go:96`),
alongside `Cursor`, `WindowTitle`, `AltScreen`, `MouseMode`, `OnMouse` and the
rest. **Terminal modes moved from imperative commands to declarative fields on
the frame** — which is a gift for instrumentation: alt-screen state, mouse mode
and cursor are readable from the same value as the content, with no need to
track commands.

All three call sites are consolidated into one wrapper (`tea.go:886-890`):

```go
func (p *Program) render(model Model) {
	if p.renderer != nil {
		p.renderer.render(model.View()) // send view to renderer
	}
}
```

called from the loop (`tea.go:880`), the initial frame (`:1134`) and the final
frame (`:1167`).

**`tea.go:888` is the injection point for v2**, and `tea.go:502` + `:700` + `:739`
for v1. In both cases `View()` runs on the event-loop goroutine, synchronously
after `Update`, so a hook there needs no lock of its own. The renderer's own
mutexes (`standardRenderer.mtx`, `standard_renderer.go:28`; `cursedRenderer.mu`,
`cursed_renderer.go:27`) guard the flush goroutine, not us.

### Does v2 move to cells?

Underneath, yes; at the model boundary, no. `cursedRenderer.render`
(`cursed_renderer.go:579-584`) merely stores the view; `flush`
(`cursed_renderer.go:257`) does the work, rasterising through
`uv.NewStyledString(view.Content)` (`:268`) and
`content.Draw(s.cellbuf, s.cellbuf.Bounds())` (`:311`) into an
`ultraviolet` screen buffer, then `s.scr.Render(...)` (`:461`) and the actual
write at `:568`. So **the model still hands over one styled string**
(`View.Content`), and the cell grid exists one layer below. A string-frame probe
at `tea.go:888` keeps working; a cell-level probe is possible but must reach
into the renderer.

### v1 → v2, what an instrumentation author must know

| Was | Is |
|---|---|
| `github.com/charmbracelet/bubbletea` | `charm.land/bubbletea/v2` (`go.mod:1`) |
| `View() string` (`tea.go:55`) | `View() View` struct (`tea.go:64`, def. `:84`) |
| `renderer.write(string)` (`renderer.go:16`) | `renderer.render(View)` + `flush(bool) error` (`renderer.go:26,29`) |
| ~30 imperative renderer methods (`renderer.go:4-85`) | 14 methods; modes are `View` fields (`renderer.go:18-57`) |
| `standardRenderer`, line-diffed strings (`standard_renderer.go:180`) | `cursedRenderer` over `ultraviolet` cell buffer (`cursed_renderer.go:22`) |
| three bare `p.renderer.write(...)` call sites | one `p.render(model)` wrapper (`tea.go:886`) |
| ticker owned by renderer (`standard_renderer.go:88`) | ticker owned by `Program` (`tea.go:1393`), double flush (`:1417-1418`) |
| `KeyMsg` concrete type (`key.go:45`) | `KeyPressMsg`/`KeyReleaseMsg` + `KeyMsg` interface (`key.go:191,224,259`) |
| `MouseMsg` (`mouse.go:8`) | split messages (`mouse.go:83`) + per-view `View.OnMouse` (`tea.go:126`) |

## 2. Bubbles: state before the flattening

Every component's `View()` returns `string` in both majors, so all semantic
detail must be read from fields **before** calling it. The good news is that
almost everything we need is a plain field.

| Component | Model | Name / label | Value | Focus | Selection | Scroll | Renders via |
|---|---|---|---|---|---|---|---|
| `textinput` | v1 `:89` / v2 `:90` | `Placeholder` (`:95`), `Prompt` (v1 `:93`, v2 `:94`) | `value []rune` (v1 `:127`, v2 `:123`) | `focus bool` (v1 `:131`, v2 `:127`), `Focused()` | cursor `pos` (v1 `:134`, v2 `:130`) | `offset`, `offsetRight` (v1 `:138`, v2 `:134`) | Lip Gloss + concat |
| `textarea` | v1 `:188` / v2 `:247` | `Placeholder` (v1 `:204`), `Prompt` (v1 `:200`) | `value [][]rune` (v1 `:258`, v2 `:333`) | `focus bool` (v1 `:262`, v2 `:337`) | `col`,`row` (v1 `:265`) | via nested viewport | Lip Gloss **+ `strings.Builder`** (v1 `:1101`) |
| `list` | `:147` (both) | `Title` (`:158`) | `items []Item` (`:196`), `filteredItems` (`:201`) | — | `cursor int` (`:183`, page-relative); `Index()`, `GlobalIndex()` | via `Paginator` | Lip Gloss + builder + `fmt.Sprintf` |
| `table` | v1 `:17` / v2 `:16` | `cols []Column{Title,Width}` (v1 `:36`) | `rows []Row` (v1 `:33`) | `focus bool` (v1 `:24`) | `cursor int` | `start`,`end` (v1 `:28`) | Lip Gloss |
| `progress` | v1 `:126` / v2 `:187` | — | `percentShown` (v1 `:153`), `targetPercent` (`:154`) — `Percent()` returns the **target**, not what is drawn | — | — | — | **hand-built** `strings.Builder` (v1 `:280`) |
| `paginator` | v1 `:37` / v2 `:39` | — | `Page`, `PerPage`, `TotalPages` (v1 `:41-45`) | — | `Page` | — | **no Lip Gloss at all** — `fmt.Sprintf` (v1 `:213`) |
| `viewport` | v1 `:23` / v2 `:52` | — | `lines []string` (v1 `:66`, v2 `:98`) | — | — | v1 `YOffset` public (`:36`); v2 `yOffset` private (`:72`) + `YOffset()` (`:469`) | Lip Gloss + `strings.Join` |
| `filepicker` | v1 `:133` / v2 `:127` | `CurrentDirectory` (v1 `:140`) | `files []os.DirEntry` (v1 `:147`) | — | `selected int` (v1 `:155`) | v1 `min`/`max` → **v2 `minIdx`/`maxIdx`** (`:152-153`) | mostly hand-built |
| `spinner` | `:88` (both) | — | `Spinner.Frames` | — | `frame int` (`:99`), no getter | Lip Gloss, single fragment |

Notes that change what a probe can promise:

- **No Bubbles component has a `disabled` field.** `filepicker` computes
  disabledness inside `View()` (`filepicker.go:394`,
  `disabled := !m.canSelect(name) && !f.IsDir()`), derived from `AllowedTypes`
  (v1 `:144`) and `DirAllowed`/`FileAllowed` (`:151-152`). Everywhere else the
  state simply does not exist and must not be invented.
- **`textinput` may mask its value.** `EchoMode`/`EchoCharacter` (v1 `:95-96`)
  route through `echoTransform` (v1 `:541`), so the rendered text is `••••`
  while `value` holds the secret. A probe reading `value` would exfiltrate a
  password into a semantic tree — the value must come from the same transform
  the view uses, or be omitted for non-normal echo modes.
- **`progress.Percent()` lies about the frame.** It returns `targetPercent`
  (v1 `:242`) while the bar draws `percentShown` (`:153`).

### The nesting is the tree

Components embed other components, and that hierarchy is exactly the semantic
tree we want to publish:

- `list` → `spinner` (`list.go:178`), `paginator` (`:182`), `help` (`:184`),
  `textinput` as the filter input (`:185`) — identical lines in v1 and v2 — plus
  dynamic children through `delegate ItemDelegate` (`:203`).
- `table` → `viewport` (v1 `:27`), `help` (v1 `:19`).
- `textarea` → `*viewport` (v1 `:276`, v2 `:351`), `cursor` (v1 `Cursor` `:227`,
  v2 `virtualCursor` `:276`).
- `textinput` → `cursor` (v1 `:97`, v2 `:104`).
- `filepicker` has **no** child models — it scrolls with its own `min`/`max`
  and a private stack (`filepicker.go:173`), despite looking like a viewport user.
- `progress`, `paginator`, `spinner`, `viewport` are leaves.

Item text for a list comes from the delegate, not the model:
`DefaultDelegate.Render` reads `i.Title()` / `i.Description()`
(`defaultitem.go:147-152`). That is where a list item's accessible name has to
be captured, before it is written into the `io.Writer` the delegate is handed
(`defaultitem.go:140`).

### v1 → v2 highlights

Beyond the module path: public `Width`/`Height` fields became getter/setter
pairs across `filepicker`, `help`, `progress`, `table`, `textinput` and
`viewport` (`UPGRADE_GUIDE_V2.md:106-122`); `viewport.New(width, height)`
(v1 `:15`) became `New(opts ...Option)` (v2 `:43`); `viewport.YOffset` went
private; `filepicker.min`/`max` were renamed `minIdx`/`maxIdx`;
`progress.Update` changed from `(tea.Model, tea.Cmd)` (v1 `:210`) to
`(Model, tea.Cmd)` (v2 `:264`); `textarea.View()` split into a pointer-receiver
`view()` (v2 `:1353`) plus the value-receiver `View()` (`:1450`). The `list`
model struct is byte-for-byte the same in both.

## 3. Lip Gloss: can provenance survive?

This is the question the whole Charm strategy turns on. Bubble Tea hands over
one string; we need to know which component produced which region of it.

### Where fragments are composed

`Style.Render` (v1 `style.go:234`, v2 `:268`) joins its arguments with a space
(v1 `:243` via `joinString` `:165`), word-wraps (v1 `:368`, v2 `:414`), then
**rebuilds the string one line — or one rune — at a time** into a
`strings.Builder` (v1 `:375-394`, v2 `:420-442`), then applies padding (v1
`:404-420`), alignment (`:426`,`:440`), border (`:445` → `borders.go:281`),
margins (`:446`) and finally `MaxWidth`/`MaxHeight` truncation (`:449-467`,
`ansi.Truncate` at `:454`).

`JoinHorizontal` (`join.go:28`) and `JoinVertical` (`:116`) are identical in
both majors. Both immediately split every input into lines
(`join.go:49`,`:131`, via `getLines` = `strings.Split` + `ansi.StringWidth`,
v1 `get.go:545`), pad heights with empty strings (`:56-79`), pad widths with
`strings.Repeat(" ", …)` (`:88`), and emit a single `strings.Builder` result
(`:94`). `Place`/`PlaceHorizontal`/`PlaceVertical` (v2 `position.go:37`,`:43`,
`:89`) do the same with a whitespace filler.

Crucially, **the boundary information exists while these functions run** —
`maxWidths[j]` and the block index say exactly how many columns fragment `j`
occupies on each row — and is discarded at `b.String()`. Nothing is returned.

One version difference worth noting: v1's `Render` is **not** a pure function of
its input. `style.go:235-236` falls back to a global renderer singleton
(`renderer.go:12`) and `style.go:245` consults `s.r.ColorProfile()`. v2 removed
that; its `Render` is pure with respect to the string.

### The three options, judged against the code

**(a) Identity of the string (a map keyed by `unsafe.StringData`) — not viable.**
Every path allocates a fresh buffer: `strings.Join` in `joinString`
(v1 `style.go:165`), the per-rune `strings.Builder` in the styling core
(v1 `:375-394`), `b.String()` in the joins (`join.go:94`). The only functions
that return their input bit-for-bit are the no-ops — `position.go:48`
(`if gap <= 0 { return str }`) and the early exit at `style.go:294` — which are
precisely the cases where a registry is not needed.

**(b) Content hash plus a call token — workable as a fallback, but fragile.**
It would wrap `Style.Render` and look the registered fragments up in the final
string. It breaks in named places: two list rows with identical text hash the
same; `join.go:88` pads a fragment's line with spaces *after* it was registered;
`ansi.Truncate` (v1 `style.go:454`) and `Wrap` (`:368`) change both content and
line count so the registered form never appears in the output at all; and
`StyleRanges` (v1 `ranges.go:12`) rewrites styling over an already-rendered
string. The salvageable form is a hash **per line, after normalising trailing
spaces**, anchored by column — not a hash per fragment.

**(c) One layer down — viable, and only in v2.** Two independent mechanisms
already exist:

1. **The compositor is already a provenance table.** `Layer` carries an `id`
   (`layer.go:13`, set by `ID(id string)` at `:51`), and
   `Compositor.flattenRecursive` (`layer.go:243-265`) computes absolute bounds
   per layer:

   ```go
   bounds := image.Rectangle{
       Min: image.Pt(absX, absY),
       Max: image.Pt(absX+width, absY+height),
   }
   ```

   with `c.index[layer.id] = layer`, and `Hit(x, y)` (`:280`) returning the
   top-most layer's ID and bounds at a point. That is literally
   "rectangle in the final layout → fragment identifier", already implemented.
   Its limit: bounds come from `Width(layer.content)`/`Height(layer.content)`
   (`:246`), so it covers fragments passed as `Layer`s, not ones glued together
   by `JoinHorizontal`.
2. **Per-cell metadata through OSC 8.** `uv.Cell` (`ultraviolet/cell.go:15-26`)
   carries a `Link Link` field, and `Link` is `{URL, Params string}`
   (`cell.go:90-97`). v2's `Style.Hyperlink` (`set.go:820`) emits
   `ansi.SetHyperlink(link, linkParams)` around the content (`style.go:445`),
   and the parser assigns it to every cell (`styled.go:152`, and again on
   truncation at `:176`). So a fragment id placed in `Params` **travels with the
   character** through wrap, truncation and composition, and is readable per cell
   via `Canvas.CellAt` (`canvas.go:57`). It is the only channel in Lip Gloss where
   metadata moves with the text rather than beside it.

### Where provenance is lost for good

`joinString` collapsing several arguments with an inserted space
(v1 `style.go:165`); word-wrap inserting newlines mid-fragment (`:368`, v2 `:414`);
the per-rune styling core, after which input and output byte offsets have no
linear relation (`:375-394`); padding (`:404-420`, `pad` at `:535`), alignment
(`align.go:12`,`:61`) and margins (`:487`) — all `strings.Repeat`, indistinguishable
from real spaces; borders inserting characters before and after content on the
same line (`borders.go:281`,`:425`); `MaxWidth` truncation discarding the tail
with no record of its length (`style.go:454`); `MaxHeight` dropping whole
fragments (`:465`); `inline` deleting newlines (`:362`); `JoinHorizontal`'s
space padding and empty filler lines (`join.go:88`,`:60-78`); `Place`'s
whitespace filler, which can carry the *same style* as the content
(`WithWhitespaceForeground`) and so is not even distinguishable by ANSI
(`position.go:71-83`); and `StyleRanges` rewriting styles over finished output
(v1 `ranges.go:12`).

All measurement is in **terminal columns**, not bytes — `Width` walks lines with
`ansi.StringWidth` (`size.go:15`), `Height` is `strings.Count(str, "\n") + 1`
(`size.go:30`) — so any byte-range side table has to maintain its own
byte↔column mapping.

### Recommendation

Option **(c)**, and it splits by major. For **v2**, ride the layer compositor
where the app uses layers, and carry fragment ids in `uv.Cell.Link.Params` for
everything else: the metadata then survives exactly the operations that destroy
a string-offset table. For **v1**, and for v2 apps that compose purely with
`JoinHorizontal`/`Place`, no mechanism preserves the mapping — option (b) as a
per-line hash is the ceiling, and even that loses to truncation and wrapping.

That ceiling is not a defeat, because the spec already prescribes the honest
degradation: **component known, fragment known, final position unknown.** The
Bubbles audit above shows the first two are cheap — role, name, value and state
are plain fields read before `View()` — while only the third depends on Lip
Gloss cooperating. A v1 probe should publish the tree without bounds and
declare it, exactly as the protocol allows a class-B adapter to do; a v2 probe
can claim `absolute-bounds` where the compositor or the link channel provides
them.

## Open questions for Phase 1

- Which major to target first. v2 is where provenance is achievable, but v1 is
  what most projects still import; the probe must detect the major from the
  module path (`charm.land/…` vs `github.com/charmbracelet/…`) and select a
  different strategy, not a different parameter.
- Whether hijacking `uv.Cell.Link` collides with an application's real
  hyperlinks. `Params` is a free-form string, so a namespaced key is possible,
  but an app that sets its own OSC 8 links on the same cells would overwrite it —
  needs a decision on precedence and a conformance case.
- Where the fragment id is minted. `Style.Render` has no notion of the component
  calling it; the id has to come from the Bubbles wrapper (which knows it is, say,
  the filter input of list #3), which means the two probes are coupled and cannot
  ship independently.
