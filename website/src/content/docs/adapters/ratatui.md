---
title: Ratatui
description: Add semantic locators to a Rust Ratatui application.
---

Ratatui renders widgets immediately on each frame instead of keeping a widget
tree. The Termwright integration observes those render calls in an
instrumented build.

## Prepare an instrumented build

The application and build helper are separate Rust crates. Add each Termwright
crate to the manifest that uses it. This example assumes sibling `app` and
`build-tool` crates; create the small build-tool crate first if the project
does not have one:

```sh
cargo add --manifest-path app/Cargo.toml termwright-ratatui@0.4.1
cargo add --manifest-path build-tool/Cargo.toml termwright-probe-ratatui@0.4.1
```

The application and build helper require Rust 1.88 or newer. The supported
Ratatui version is 0.30.2. Keep both Termwright crates on the same release as
the npm `termwright` package.

Semantic instrumentation is supported on macOS and Linux. On Windows, test a
Ratatui binary through the black-box terminal API.

The build helper is a small Rust program that runs before the TypeScript test
suite. Its core is:

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

Always call `finish()`. The helper temporarily changes dependency resolution
and restores it afterward. Do not run another Cargo command in the same
workspace until it finishes.

The complete
[Ratatui example build tool](https://github.com/gorce-ai/termwright/tree/main/examples/ratatui-list/build-tool)
includes its `Cargo.toml`, error handling, and output path. After building,
launch the binary from a normal Termwright test:

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const binary = fileURLToPath(new URL('../app/target/debug/ratatui-list', import.meta.url));

test('shows releases', async ({ terminal }) => {
  const app = await terminal.launch({ command: [binary] });
  await expect(app.getByRole('list')).toBeAttached();
});
```

## Give a widget stable meaning

```rust
use termwright_ratatui::{Annotate, Role, Semantics};

frame.render_widget(
    DeployWidget::new().annotated(
        Semantics::new()
            .role(Role::Button)
            .name("Deploy")
            .semantic_key("deploy")
    ),
    area,
);
```

A render call exists for one frame. Add a unique `semantic_key` when a locator
must follow the same application element across frames. The annotation can
also provide a role, name, relationships, actions, and application state.

## Pointer input

If the application handles `crossterm::Event::Mouse`, it can register the same
router with Termwright:

```rust
use std::sync::Arc;
use termwright_ratatui::register_pointer_evidence_provider;

let _registration = register_pointer_evidence_provider(Arc::new(mouse_router))?;
```

Termwright uses the router to choose a cell, then sends a normal terminal mouse
event through the PTY. Without a registered router, locator-based clicks fail
instead of guessing; keyboard input remains available. The
[Ratatui list example](https://github.com/gorce-ai/termwright/tree/main/examples/ratatui-list)
shows the complete setup.

## Supported behavior

The integration reports intended widget bounds. Ratatui does not provide
ancestor clipping or paint ownership, so viewport visibility is unavailable.
Only the exact crate versions in
[Framework compatibility](../../reference/compatibility/) are supported.
