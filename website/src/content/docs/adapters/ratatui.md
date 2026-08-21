---
title: Ratatui
description: Build a verified Ratatui application with frame-local semantic observation.
---

Ratatui is immediate mode. Termwright instruments the exact supported crate
sources so it can observe widgets while each frame is rendered.

## Prepare an instrumented build

Add the annotation SDK and build helper:

```sh
cargo add termwright-ratatui termwright-probe-ratatui
```

```rust
use termwright_probe_ratatui::launch::{prepare_instrumented_build, PrepareOptions};

let project = std::path::Path::new("/path/to/app");
let prepared = prepare_instrumented_build(&PrepareOptions::new(project))?;
let mut cargo = std::process::Command::new("cargo");
cargo.args(["build"]).current_dir(project);
for config in &prepared.config_args { cargo.arg("--config").arg(config); }
for (key, value) in &prepared.env { cargo.env(key, value); }
let status = cargo.status()?;
prepared.finish()?;
assert!(status.success());
```

Always call `finish()`. Cargo temporarily changes lockfile resolution while the
instrumented sources are active; `finish()` restores the prior file. Do not run
another Cargo command in the workspace concurrently.

## Annotate a custom widget

```rust
frame.render_widget(
    DeployWidget::new().annotated(
        Semantics::new().role(Role::Button).name("Deploy").test_id("deploy")
    ),
    area,
);
```

The annotation wrapper adds role, name, test id, relationships, actions, and
domain state. It does not override geometry or rendered cells.

Applications that already route `crossterm::Event::Mouse` can expose that same
production router as authoritative evidence:

```rust
use std::sync::Arc;
use termwright_ratatui::register_pointer_evidence_provider;

let _registration = register_pointer_evidence_provider(Arc::new(mouse_router))?;
```

The provider reports regions and an optional hit test; it never dispatches an
event. `locator.click()` still encodes terminal mouse bytes and sends them
through the PTY. The runnable [Ratatui list example](https://github.com/gorce-ai/termwright/tree/main/examples/ratatui-list)
uses one router for both evidence and its normal `crossterm` event handler.

## Supported behavior

Ratatui 0.30.2 is verified on macOS and Linux. Nodes are frame-local unless an
annotated render call has a unique `semantic_key`; intended rectangles are
automatic. Display state and paint ownership are unavailable from Ratatui.
Exact pointer ownership is application-integrated when the production router
is registered; without one, semantic pointer actions fail deterministically.
Unsupported dependency graphs are rejected.

See [Framework compatibility](../../reference/compatibility/) for exact versions.
