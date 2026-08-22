# termwright-ratatui

Author-intent annotations for custom Ratatui widgets observed by Termwright's
instrumented build probe.

```rust
use termwright_ratatui::{Action, Annotate, Role, Semantics};

let widget = DeployWidget::new().annotated(
    Semantics::new()
        .role(Role::Button)
        .name("Deploy")
        .description("Deploy the current release")
        .test_id("deploy-release")
        .semantic_key("deployment-control")
        .action(Action::Activate)
        .labelled_by("deployment-label")
        .domain("deploymentStatus", "ready"),
);
frame.render_widget(widget, area);
```

`Annotated<W>` implements both `Widget` and `StatefulWidget`, including the
corresponding reference forms when the wrapped widget supports them. It calls
the original render exactly once with the same area, buffer and state.

## Trust boundary

The SDK can express only author intent:

- role, name, description and test id;
- explicit application-domain JSON under `extended`.
- descriptive protocol actions, relationships to other semantic keys and an
  optional stable semantic key for a recreated widget value.

It has no API for geometry, focus, visibility, cells or collection selection.
Domain keys named `bounds`, `state` or `actions` remain nested JSON; the probe
never promotes them into portable facts or callback capabilities. A declared
`Action` is only a capability hint and still resolves through real terminal
input.
Geometry, clipping and pointer observations, collection state, and frame commit
ordering continue to come from the instrumented framework.

`test_id` remains a locator and correlation hint. `semantic_key` is deliberately
separate: a unique key produces a `k:<key>` node id that survives recreation and
can be used by `labelled_by` / `described_by`. Empty keys remain frame-local;
duplicate non-empty keys terminate the semantic session with
`duplicate-semantic-key`. The handshake remains conservatively
`identityKind: frame-local` because ordinary unannotated Ratatui nodes still do.

The wrapper itself is an authoritative render boundary. It is observed both
through `Frame::render_widget` / `Frame::render_stateful_widget` and when a
custom parent calls its `Widget::render` implementation directly. An exact
Frame announcement is claimed instead of duplicated. Nested `Annotated`
calls retain hierarchy only where their real Rust call nesting proves it;
ordinary unannotated immediate-mode calls remain flat.

## Versions

This crate is pinned to Ratatui 0.30.2 and therefore declares Rust 1.88, the
same floor as Ratatui itself. `termwright-protocol` and
`termwright-probe-ratatui` remain independently buildable on Rust 1.74.

Both this SDK and the build probe it depends on are published on crates.io.
The release workflow publishes `termwright-protocol`, then
`termwright-probe-ratatui`, then this crate so every registry dependency exists
before its consumer is uploaded.
