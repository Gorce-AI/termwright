# termwright-probe-ratatui

The half of the Ratatui probe that needs `std`.

`ratatui-core` is `#![no_std]`. It gets `std` only because the `ratatui` facade
enables it, and a Ratatui application that uses the core crate alone may have
no `std` at all. Sockets, threads and the protocol client are therefore
impossible inside the patched crate, and everything that needs them lives here
instead.

The patched `ratatui-core` gains this crate as an **optional** dependency,
enabled by its own `std` feature, and calls into it from `Frame::render_widget`
behind `#[cfg(feature = "std")]`. Measured on `ratatui-core` 0.1.2: a
`--no-default-features` build compiles and does not pull this crate in at all,
so a `no_std` user gets a byte-identical build from a tool they never invoked.

Nothing here is called unless the application was launched with
`TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`. Without them the hook returns on
its first branch and the application renders exactly what it would have
rendered alone.

## What it can and cannot report

Ratatui is immediate mode, and the honest consequences are these. Each line is
a finding from `docs/architecture/audit/ratatui.md`, not a to-do.

| Fact | Reported? |
|---|---|
| widget type | yes, from `core::any::type_name` — a hint, never a role |
| the rectangle a widget was drawn into | yes, as `bounds` |
| whether those cells are still the widget's | **no** — every node says `occlusion: "unknown"` |
| identity across frames | **no** — ids are frame-local and carry the frame number |
| parent/child structure | **no** — the tree is flat; nesting happens inside `render`, where we cannot see |
| number of items in a list | **no** — `List::items` is `pub(crate)` with no length accessor, so `setSize` is unobtainable |
| scroll extent | **no** — `ScrollbarState`'s `content_length()` is a setter returning `Self`; only `get_position()` reads |
| author annotations | **no** — Ratatui has nowhere to put one |

Because paint order is unavailable, the driver refuses pointer actions against
these nodes. That is the correct outcome for this framework: `bounds` is where
a widget *asked* to draw, a later write silently wins, and clicking into cells
that may belong to a popup would attribute the result to the wrong widget.
Drive Ratatui applications with keyboard input.
