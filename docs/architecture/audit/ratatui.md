# Upstream audit — Ratatui

> **Historical Phase 0 evidence.** This snapshot predates the Ratatui probe and
> intentionally preserves the original support assessment. Current setup and
> support status live in the website Ratatui adapter guide and compatibility
> reference.

Phase 0 of the zero-config instrumentation campaign. Ratatui is a framework
termwright does not support today — the Rust crate is a protocol client with no
tree adapter — so this audit starts from zero and asks what a probe could
observe at all. It proposes no design.

**Version audited:** `ratatui` 0.30.2, resolved together with `ratatui-core`
0.1.2 and `ratatui-widgets` 0.3.2. Sources read from the local registry
checkout under
`~/.cargo/registry/src/index.crates.io-1949cf8c6b5b557f/`; paths below omit
that prefix. Cargo 1.97.1.

The headline is that Ratatui is immediate mode, and that single fact decides
most of what follows: there is no retained tree, no widget identity, and no
record of which widget painted which cell. Where Textual can be *inspected*,
Ratatui can only be *intercepted*.

---

## 1. Render entry points

`Frame` lives in `ratatui-core`, not in the `ratatui` facade:
`ratatui-core-0.1.2/src/terminal/frame.rs:22`. Its fields are all
`pub(crate)` — `cursor_position` (`:28`), `viewport_area` (`:31`),
`buffer: &'a mut Buffer` (`:34`), `count: usize` (`:37`) — with accessors
`area()` (`:68`), `buffer_mut()` (`:207`) and `count()` (`:235`).

Both render methods are pass-throughs:

```rust
// frame.rs:106
pub fn render_widget<W: Widget>(&mut self, widget: W, area: Rect) {
    widget.render(area, self.buffer);
}

// frame.rs:147
pub fn render_stateful_widget<W>(&mut self, widget: W, area: Rect, state: &mut W::State)
where W: StatefulWidget {
    widget.render(area, self.buffer, state);
}
```

They do not clip, do not validate `area` against `viewport_area`, and record
nothing.

The traits:

- `Widget::render(self, area: Rect, buf: &mut Buffer)` —
  `ratatui-core-0.1.2/src/widgets/widget.rs:70-76`. Note `self` **by value**:
  the widget is consumed by rendering.
- `StatefulWidget::render(self, area, buf, state: &mut Self::State)` with
  `type State: ?Sized` — `.../widgets/stateful_widget.rs:124-134`.

There is **no blanket `impl<W: Widget> Widget for &W`** in 0.30.2. Rendering by
reference is done with per-type impls (`ratatui-widgets-0.3.2/src/table.rs:731`,
`list/rendering.rs:15`, and so on), and the owned impls forward to them
(`list/rendering.rs:9-13`). Consequence for a probe: the `W` observed at a call
site is often `&List<'_>`, not `List<'_>`.

`render_widget_ref` and `render_stateful_widget_ref` exist but are **not**
inherent methods on `Frame`. They live on an extension trait `FrameExt` in the
facade crate (`ratatui-0.30.2/src/widgets.rs:701`, methods at `:725` and
`:754`), whose impl is gated behind the `unstable-widget-ref` feature
(`ratatui-0.30.2/src/widgets.rs:759`, feature declared at
`ratatui-0.30.2/Cargo.toml:79`). Critically, that impl reaches the buffer
through `Frame::buffer_mut()` (`frame.rs:207`) rather than through
`render_widget` — so a hook on `render_widget` alone does not see `_ref` calls.

## 2. The buffer: intent is not ownership

```rust
// ratatui-core-0.1.2/src/buffer/buffer.rs:67
pub struct Buffer {
    pub area: Rect,
    pub content: Vec<Cell>,
}
```

Both fields are public. Cells are a flat row-major `Vec`, addressed through
`index_of` (`buffer.rs:249`) or the non-panicking `index_of_opt`
(`buffer.rs:264`).

**A later write silently wins.** The core writer is `set_stringn`
(`buffer.rs:336-370`), whose body unconditionally assigns:

```rust
// buffer.rs:359
self[(x, y)].set_symbol(symbol).set_style(style);
```

No read-back, no ownership test, no blending. A multi-width grapheme
additionally `reset()`s the trailing cells (`buffer.rs:365`), so a widget can
erase a neighbour's content. `Buffer::merge` says it outright in a comment at
`buffer.rs:451`: *"Push content of the other buffer into this one (may erase
previous data)"*.

**Cells carry no provenance.** `Cell`
(`ratatui-core-0.1.2/src/buffer/cell.rs:37-72`) holds a symbol, colours, a
modifier and a diff option. There is no owner, id or source tag, and the
render path never adds one. The backend sees even less: `Terminal::flush`
(`terminal/buffers.rs:97`) diffs previous against current and hands the backend
positioned cells only.

**Therefore the `area` passed to `render_widget` is a statement of intent, not
a claim on cells.** Any later call whose area intersects it overwrites, and
nothing anywhere records that this happened. Widgets exist specifically to
exploit that: `ratatui-widgets-0.3.2/src/clear.rs`, `block/shadow.rs`,
`fill.rs`. A probe that reports `area` as a node's bounds is reporting where a
widget *tried* to draw. For overlapping UIs — popups, modals, shadows — that
is not where it ended up.

## 3. Stateful widgets: what state is actually readable

| State | Definition | Publicly readable |
|---|---|---|
| `ListState` | `ratatui-widgets-0.3.2/src/list/state.rs:45-48`: `offset`, `selected`, both `pub(crate)` | `offset()` `:95`, `selected()` `:125` |
| `TableState` | `.../table/state.rs:55-59`: `offset`, `selected`, `selected_column` | `offset()` `:171`, `selected()` `:201`, `selected_column()` `:216`, `selected_cell()` `:231` |
| `ScrollbarState` | `.../scrollbar.rs:145-154`: `content_length`, `position`, `viewport_content_length`, all **fully private** | `get_position()` `:496` only |

Two gaps worth naming:

- **No content extent.** Neither `ListState` nor `TableState` carries the
  number of items; that lives on the widget (`List::items` is `pub(crate)`,
  `ratatui-widgets-0.3.2/src/list.rs:113`) with no length accessor. So
  `setSize` — which the semantic tree wants for a list — is not obtainable
  from the state alone.
- **`ScrollbarState` is write-only in practice.** `content_length()`
  (`:445`) and `viewport_content_length()` (`:454`) are *setters returning
  `Self`*, not getters; only `get_position()` reads. `scrollExtent` is
  therefore unavailable without `serde`.

One useful behaviour: rendering **mutates** the state to reflect what was
actually drawn — `list/rendering.rs:58` assigns `state.offset =
first_visible_index`, and `table.rs:757-770` clamps similarly. A probe reading
state *after* the render sees the true viewport rather than the requested one.

## 4. Identity across frames: why it cannot be synthesised

Confirmed absent, in the strong sense: there is no id, key, generation or
handle anywhere in the render path. A repository-wide grep for `type_name`,
`TypeId`, `std::any` across all three crates returns **zero hits** — Ratatui
never inspects widget types at runtime.

`Frame` does carry a frame counter (`frame.rs:37`, read via `count()` `:235`,
incremented at `terminal/render.rs:317`), but that identifies the *frame*, not
anything in it.

The reasons identity cannot be reconstructed, each independently sufficient:

1. `Widget::render(self, ...)` **consumes** the widget, so it does not outlive
   the call and its address cannot be observed again next frame.
2. Applications rebuild widgets every frame; there is no requirement to keep
   them, and idiomatic code does not.
3. `Rect` is neither unique (two widgets are routinely given the same area —
   `Clear` always is) nor stable (layout moves on resize).
4. Call order could serve as a de-facto key, but nothing records it, and the
   sequence is arbitrary application control flow — a loop that renders a
   variable number of rows shifts every subsequent ordinal.
5. Cells cannot be attributed backwards, per §2.

This is the point where the campaign's rule "do not pretend" applies. Any
identity a probe emits for Ratatui would be a fabrication assembled from
`(frame_count, call ordinal, area, type name)`, of which only `frame_count` and
`area` actually exist upstream. Such an id is stable exactly as long as the
application's control flow is, and silently wrong the moment it is not — which
is worse than having no id, because a test written against it fails later and
looks flaky rather than wrong.

## 5. Type names as a role hint

Ratatui never calls `type_name` itself, but a patcher can:
`render_widget<W: Widget>` (`frame.rs:106`) is generic and monomorphised, so
`core::any::type_name::<W>()` inside the body yields the concrete type with no
extra bound.

Built-in widgets live one per module in `ratatui-widgets-0.3.2/src/lib.rs:115-138`
(`barchart`, `block`, `borders`, `canvas`, `chart`, `clear`, `fill`, `gauge`,
`list`, `logo`, `mascot`, `paragraph`, `scrollbar`, `sparkline`, `table`,
`tabs`, plus `calendar` behind a feature), re-exported from
`ratatui-0.30.2/src/widgets.rs:667-689`. Mapping those names onto roles is
mechanical.

Four caveats, all from the source:

- The name is frequently `&ratatui_widgets::list::List<'_>` rather than
  `List`, because owned impls forward to reference impls
  (`list/rendering.rs:9-13`). Lifetimes and `&` must be stripped.
- **Nested widgets never pass through `Frame`.** Composition calls
  `Widget::render` directly — e.g. `list/rendering.rs:35` renders the block,
  `table.rs:751` renders its contents — so a hook on `Frame` sees the outermost
  widget only. The internal structure of a `List` is invisible at that level.
- For custom widgets `type_name` gives `mycrate::ui::StatusBar`: what the
  author called it, not a role. Rust does not guarantee the string is stable
  or unique.
- Generic wrappers such as `Canvas<'_, F>` (`canvas.rs:860`) produce names
  dominated by closure types.

## 6. Crate structure: what has to be patched

`ratatui` 0.30.2 is a facade. It depends on `ratatui-core` 0.1.2
(`ratatui-0.30.2/Cargo.toml:225`), `ratatui-widgets` 0.3.2 (`:244`) and the
backend crates, and its `src/` contains only `lib.rs`, `init.rs`, `prelude.rs`,
`widgets.rs` and the two `*_ref` modules. `ratatui-widgets` depends on
`ratatui-core` (`ratatui-widgets-0.3.2/Cargo.toml:171`); `ratatui-core` depends
on no other ratatui crate.

Everything a probe would hook is in **`ratatui-core`**:

- `Frame`, `render_widget`, `render_stateful_widget` — `src/terminal/frame.rs:22,106,147`
- `Widget`, `StatefulWidget` — `src/widgets/widget.rs:70`, `src/widgets/stateful_widget.rs:124`
- `Buffer`, `Cell` — `src/buffer/buffer.rs:67`, `src/buffer/cell.rs:37`
- `Terminal` and the draw/flush loop — `src/terminal.rs:398`, `terminal/render.rs:81,189,288`, `terminal/buffers.rs:51,97,121`

Patching the `ratatui` facade alone **cannot** intercept a render, because the
facade contains no render machinery. Patching `ratatui-core` propagates to
`ratatui-widgets` and `ratatui` automatically, since both depend on it by
version — one patch entry suffices for the core hook.

No chokepoint is total, and the audit should not pretend otherwise:

1. Nested composition bypasses `Frame` (§5).
2. `render_widget_ref` routes through `buffer_mut()`, in the *facade* crate
   (`ratatui-0.30.2/src/widgets.rs:761`), so it needs a second hook.
3. `Buffer`'s fields are public, so `buf.content[i] = …` is legal application
   code and passes through no method at all.

## 7. The `[patch]` mechanism, measured

The campaign's constraint is: no edit to the user's `Cargo.toml`, no
`[replace]`, ephemeral context only. All of the following was **measured** with
cargo 1.97.1 against a scratch project depending on `ratatui` 0.30.2, using a
copy of `ratatui-core` 0.1.2 with one added marker constant.

**a. `[patch.crates-io]` in a generated `.cargo/config.toml` works, and
propagates transitively.** The scratch binary read the marker through the
dependency graph and printed it, proving the facade's `ratatui-core` resolved
to the patched copy rather than the registry one.

**b. The `--config` flag works with no file at all**:

```
cargo run --config "patch.crates-io.ratatui-core.path='/path/to/patched'"
```

produced the same result after the config file was removed. This is the
stronger form of ephemerality: nothing is written into the project tree, not
even a `.cargo/` directory.

**c. The patch rewrites `Cargo.lock`.** Diffing the lockfile before and after a
patched build shows the `ratatui-core` entry **losing** its `source` and
`checksum` lines — it becomes a path dependency. Running unpatched again
restores them. So the mechanism is *not* lockfile-neutral, and an instrumented
build mutates a file that is normally committed.

**d. `--locked` refuses the patch.** From a clean lockfile,
`cargo metadata --locked --config "patch…"` **failed**, and the lockfile was
left unchanged. That is the honest interaction: `--locked` means "the lock must
not change", the patch requires it to change, and cargo declines rather than
silently proceeding. Any CI that builds with `--locked` — a common and correct
default — cannot be instrumented this way without an explicit accommodation.

**e. Config discovery walks up.** Cargo found the workspace manifest and
config from a nested subdirectory, so a generated `.cargo/config.toml` placed
at the workspace root applies to builds started deeper in the tree. The
converse is the risk: a config written next to a *member* manifest does not
apply to the workspace root.

Remaining sensitivities, not yet measured and flagged for whoever builds this:

- **Renamed dependencies.** `[patch]` keys on the source registry and crate
  name, while a `package = "ratatui"` rename changes only the local alias, so a
  patch is expected to still apply — expected, not verified.
- **Feature unification.** The patched copy must enable the same features the
  real resolution enabled, or the build changes behaviour beyond the hook.
  `unstable-widget-ref` matters specifically, per §1.
- **Version drift.** A patch is accepted only if the patched crate's version
  satisfies the dependants' requirements; `ratatui-core` moving to 0.2 would
  need a new copy of the patched source, not a version bump in the patch entry.


### Measured again at implementation time (Phase 6)

Four more facts, from patching a real copy rather than a marker constant. The
scratch project depends on `ratatui` 0.30.2; the copy is `ratatui-core` 0.1.2
with an insertion inside `Frame::render_widget` itself.

**f. The patched code executes, not merely resolves.** The earlier measurement
proved the graph *pointed* at the copy. This one proves the copy *runs*: the
line inserted into `render_widget` printed on every frame, and vanished when
the `--config` flag was dropped. Resolution and execution are different claims
and only the second one matters.

**g. `ratatui-core` is `#![no_std]`** (`src/lib.rs:1`). A patch that reaches
for `std` unguarded does not compile — measured, with `cannot find macro
eprintln in this scope`. The `std` feature *is* enabled in a normal
application, because the `ratatui` facade turns it on (`cargo metadata` reports
`["default", "layout-cache", "std", "underline-color"]`), but that is the
facade's doing and not a property of the crate. Every line of instrumentation
must therefore sit behind `#[cfg(feature = "std")]`, or a `no_std` user of
`ratatui-core` alone gets a broken build from a tool they never invoked.

**h. Cargo's registry sources are writable.** `~/.cargo/registry/src/**` keeps
the write bit, so a copy is editable straight away. This is worth stating
because the Go probe had to strip read-only bits from its module cache copy;
that trap does not exist here and the defensive code should not be transplanted.

**i. The lockfile damage is reversible, exactly.** Finding (c) stands — a
patched build rewrites `Cargo.lock` — but any subsequent ordinary build
restores it **byte for byte**, including under `--offline` (verified by
checksum: before and after are the same hash, the patched state a different
one). So a launcher can guarantee the project is left as it found it by saving
the lockfile's bytes and writing them back, rather than hoping. The residual
risk is a concurrent build racing that restore, which is a caveat to document,
not a bug to fix.

## 8. Findings that constrain the design

1. `ratatui-core` is the crate to patch; the `ratatui` facade contains no
   render machinery at all.
2. There is **no total interception point**. Nested composition, `_ref`
   rendering and direct `Buffer` writes each bypass `Frame`.
3. `area` is intent, not ownership: overlapping widgets overwrite cells with no
   record, so published bounds cannot be trusted for overlapping UIs without
   modelling paint order.
4. Widget identity across frames **cannot be derived** from anything upstream.
   Whatever the Probe IR does here, it must not present a synthesised ordinal
   as a stable handle.
5. Selection and scroll *position* are readable for `List` and `Table`; content
   *extent* is not readable anywhere, and `ScrollbarState` exposes only
   position. **Corrected in Phase 6:** this measured the public API, and a
   patch runs *inside* the crate. `List::items` is `pub(crate)`, so the item
   count and the item text are reachable from a patched `ratatui-widgets` and
   from nowhere else — which is what makes `setSize` and item names
   obtainable, and what justifies patching a second crate. `ScrollbarState`'s
   private fields are still private to the patch too, so `scrollExtent`
   remains unavailable.
6. `type_name` is available and mechanical for built-ins, but yields author
   names rather than roles for custom widgets, and never sees nested children.
7. The ephemeral `--config` patch is real and needs no file in the project —
   but it rewrites `Cargo.lock` and is refused outright under `--locked`. The
   rewrite is exactly reversible, so a launcher restores the bytes; `--locked`
   has no accommodation and must be reported to the user as unsupported.
8. Instrumentation must be `no_std`-safe. `ratatui-core` declares `#![no_std]`
   and only gets `std` because the facade enables it, so every patched line
   lives behind `#[cfg(feature = "std")]`.

**Phase 8 amendment:** upstream still has no native annotation storage, but
the public `termwright-ratatui::Annotated<W>` wrapper is itself an exact render
boundary. It claims a matching `Frame::render_widget` observation without
duplicating it and also observes direct nested `Widget::render` calls. RAII
call boundaries preserve hierarchy only for actual nested `Annotated` calls;
they do not invent a retained tree, stable identity, or any physical fact.

**Injection-doctrine verification:** `ratatui-widgets` cannot be demoted to an
append-only T2 reader without losing fidelity. The required fact is not merely
`List::items`: rendering mutates and clamps `ListState.offset`, and the probe
must correlate the item text/count with the state that was actually drawn.
An appended getter can expose private state but cannot run after that mutation
inside the existing render call. The current one-anchor rendering hook is
therefore genuine T3 debt, exact-certified separately from `ratatui-core`.
Backend wrapping remains invalid for widget semantics, while the causal marker
hook is restricted to certified concrete backends that can write through the
same sink; unsupported backends fail closed rather than falling back to
process stdout.
