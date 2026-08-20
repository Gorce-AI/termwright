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

## Preparing an instrumented build

The launcher-facing API needs only the application directory. It resolves the
exact Ratatui crates through Cargo, creates immutable instrumented copies in
the Termwright cache, and returns the two Cargo config overrides plus the
environment to pass to the real build:

```rust,no_run
use std::process::Command;
use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};

let project = std::path::Path::new("/path/to/app");
let prepared = prepare_instrumented_build(&PrepareOptions::new(project))?;
let mut cargo = Command::new("cargo");
cargo.args(["build"]).current_dir(project);
for config in &prepared.config_args {
    cargo.arg("--config").arg(config);
}
for (key, value) in &prepared.env {
    cargo.env(key, value);
}
let status = cargo.status()?;
prepared.finish()?; // reports a Cargo.lock restoration error instead of hiding it in Drop
assert!(status.success());
# Ok::<(), Box<dyn std::error::Error>>(())
```

The cache key includes the framework versions and complete source-tree digest,
enabled framework features, Rust toolchain and target, probe version and path,
and the complete patch-set bytes. A hit is rehashed before reuse. Entries are
built in a staging directory and published by rename, so an interrupted writer
or a modified copy is never treated as a hit. The default location is
`$TERMWRIGHT_CACHE_DIR`, then `$XDG_CACHE_HOME/termwright`, then
`$HOME/.cache/termwright` (with the platform temporary directory as the final
fallback).

Cargo rewrites the workspace's `Cargo.lock` while substituting path copies.
The returned guard restores its exact bytes and permissions; it also removes a
lockfile that did not exist before preparation. Do not pass `--locked` to the
instrumented build, because Cargo must update its in-memory resolution before
the guard can restore the file. Do not run an ordinary Cargo command in the
same workspace concurrently: both commands would share the same lockfile and
one could observe the other's temporary resolution.

The current patch sets support the crates.io packages used by Ratatui 0.30:
`ratatui-core` 0.1.2 and `ratatui-widgets` 0.3.2. A different version, multiple
versions in one dependency graph, or a path/Git/alternate-registry source is
rejected with a diagnostic rather than producing an apparently successful but
uninstrumented build. Cargo source replacement (vendoring crates.io) works via
the `manifest_path` reported by Cargo metadata.

The patch preparation and cache code itself uses only portable Rust and no
external `patch`/Git executable. The semantic transport is currently Unix-only,
however, because `termwright-protocol` connects over `UnixStream`; Windows
named-pipe support is not yet implemented and is not advertised as working.

## What it can and cannot report

Ratatui is immediate mode, and the honest consequences are these. Each line is
a finding from `docs/architecture/audit/ratatui.md`, not a to-do — with one
correction the audit could not have made, marked below: it measured the public
API from outside the crate, and a patch runs inside it.

| Fact | Reported? |
|---|---|
| widget type | yes, from `core::any::type_name` — a hint, never a role |
| the rectangle a widget was drawn into | yes, as `bounds` |
| whether those cells are still the widget's | **no** — every node says `occlusion: "unknown"` |
| identity across frames | **no** — ids are frame-local and carry the frame number |
| parent/child structure | **no** — the tree is flat; nesting happens inside `render`, where we cannot see |
| number of items in a list, and their text | **yes, but only from inside** — `List::items` is `pub(crate)`, so this is reachable from the patched `ratatui-widgets` and from nowhere else |
| which row is selected | yes, read *after* the render, because rendering clamps the state to what was actually drawn |
| scroll extent | **no** — `ScrollbarState`'s `content_length()` is a setter returning `Self`; only `get_position()` reads |
| author annotations | **yes, opt-in** — `termwright-ratatui::Annotated<W>` adds intent, relationships and optional stable semantic identity to a custom widget render |

Because paint order is unavailable, the driver refuses pointer actions against
these nodes. That is the correct outcome for this framework: `bounds` is where
a widget *asked* to draw, a later write silently wins, and clicking into cells
that may belong to a popup would attribute the result to the wrong widget.
Drive Ratatui applications with keyboard input.

## Annotating custom widgets

The ordinary zero-config path does not require any Termwright import. When an
application owns a custom widget and wants to supply its intent, the separate
`termwright-ratatui` SDK wraps it without replacing its `Widget` or
`StatefulWidget` implementation:

```rust,ignore
use termwright_ratatui::{Action, Annotate, Role, Semantics};

frame.render_widget(
    DeployWidget.annotated(
        Semantics::new()
            .role(Role::Button)
            .name("Deploy")
            .test_id("deploy-release")
            .semantic_key("deployment-control")
            .action(Action::Activate)
            .domain("deploymentStatus", "ready"),
    ),
    area,
);
```

The annotation owns only semantic intent. The probe still owns bounds,
occlusion and collection state, and per-field provenance marks the added fields
as `annotation`. There is deliberately no annotation API for focus, visibility
or cells. Protocol actions are descriptive and still execute as real PTY input.
A `test_id` is only a locator; a separate unique `semantic_key` opts one custom
widget into stable identity and resolves relationships within the current
frame. Unannotated nodes remain frame-local.

The wrapper must itself be passed to `Frame::render_widget` or
`Frame::render_stateful_widget`. A nested widget rendered directly into a
`Buffer` bypasses Ratatui's frame interception point, so its annotation is
dropped instead of being assigned to the wrong outer widget.

Ratatui 0.30.2 and `termwright-ratatui` require Rust 1.88. The transport-only
`termwright-protocol` and the probe crate remain independently CI-checked on
Rust 1.74.
