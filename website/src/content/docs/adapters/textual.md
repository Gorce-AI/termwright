---
title: Textual (Python)
description: The termwright PyPI package — enable_semantics, role and name derivation, and coexisting with Pilot.
---

```sh
pip install termwright              # protocol client only
pip install "termwright[textual]"   # + the Textual adapter
```

Python 3.9+. The protocol modules have no third-party dependencies.

## Instrumenting an app

```python
from textual.app import App, ComposeResult
from textual.widgets import Button, Input, Label

from termwright import enable_semantics


class PermissionApp(App):
    def compose(self) -> ComposeResult:
        yield Label("Allow bash to run?", id="prompt")
        yield Button("Approve", id="approve")
        yield Button("Reject", id="reject")
        yield Input(placeholder="Reason", id="reason")

    def on_mount(self) -> None:
        # Returns None when no driver is attached — nothing is installed then.
        enable_semantics(self)


if __name__ == "__main__":
    PermissionApp().run()
```

Or inherit the mixin, which does the same on mount:

```python
from termwright import TermwrightApp

class PermissionApp(TermwrightApp, App):
    ...
```

Under a driver, this publishes after every flushed frame:

```
application "PermissionApp"
  region                          bounds=(0,0,80,24)
    text "Allow bash to run?"     bounds=(0,0,80,1)  testId=prompt
    button "Approve"              bounds=(1,0,80,3)  testId=approve  [focused]
    button "Reject"               bounds=(4,0,80,3)  testId=reject
    textbox "Reason"              bounds=(7,0,80,3)  testId=reason
```

## Roles and names

Roles come from the widget class, matched along the MRO, so your own
`class SaveButton(Button)` is a `button` with no configuration. `Input` and
`TextArea` map to `textbox`, `DataTable` to `table`, `ListView` / `OptionList`
to `list`, `Label` / `Static` to `text`, containers to `region`, `ModalScreen`
to `dialog`.

Names come from the widget's label, placeholder, renderable, `name`, or DOM
`id`, in that order; the DOM `id` is also published as `testId`. Override either
per widget:

```python
label = Label("87%")
label.termwright_role = "progressbar"
label.termwright_name = "Upload progress"
```

## Coexisting with Pilot

The adapter only reads the DOM from `post_display_hook`, so `run_test()` and
`Pilot` keep working unchanged — semantic tests and pilot tests live in the same
suite. termwright is not positioned as a Pilot replacement; see
[Migrating](../../guides/migrating/) for where each one fits.

## Driving any Python TUI

Textual is a convenience, not a requirement. Any renderer can drive the client
directly: you own the render, the client owns revision numbers and hands you the
marker to write after the render's last byte.

```python
from termwright import SemanticNode, SemanticSnapshot, Rect, client_from_env

client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0")
if client is not None and await client.start():
    marker = await client.publish(
        SemanticSnapshot(
            sessionId="", revision=0, columns=80, rows=24,   # both are overwritten
            rootIds=["root"],
            nodes=[
                SemanticNode(id="root", role="dialog", name="Permission"),
                SemanticNode(id="ok", parentId="root", role="button", name="Approve",
                             bounds=Rect(row=1, column=2, width=9, height=1)),
            ],
        )
    )
    sys.stdout.write(marker)   # only after the render is fully written
    sys.stdout.flush()
```

`publish_nowait` is the same thing for synchronous render callbacks: it returns
the marker immediately and sends the frames on a background task, in order.

## The dormant rule, in Python

`client_from_env()` returns `None` when `TERMWRIGHT_ENDPOINT` and
`TERMWRIGHT_TOKEN` are absent, and `enable_semantics()` installs nothing. That
is deliberately expressed as a constructor returning nothing, so the calling app
needs no feature flag and shipping the adapter in production costs one import.

## Limitations

- **Windows named pipes are not supported.** On a `\\.\pipe\…` endpoint the
  client stays dormant rather than half-working.
- The reference implementation is the TypeScript `@termwright/protocol`; where
  this client differs from it, this client is wrong. Cross-language test vectors
  keep them aligned.
