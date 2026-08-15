# termwright (Python)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver, plus an adapter for [Textual](https://textual.textualize.io).

An instrumented app publishes its widget tree over a unix socket and commits
each render with a signed DCS marker, so the driver can assert on *roles and
names* instead of screen-scraping cells.

**Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` in the
environment the adapter opens no socket, writes no marker, and renders exactly
the bytes it would have rendered anyway. Shipping it in production costs you
one import.

## Install

```sh
pip install termwright              # protocol client only
pip install "termwright[textual]"   # + the Textual adapter
```

Requires Python 3.9+. The protocol modules have no third-party dependencies.

## Textual in 30 lines

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

Under the driver this publishes, after every flushed frame:

```
application "PermissionApp"
  region                          bounds=(0,0,80,24)
    text "Allow bash to run?"     bounds=(0,0,80,1)  testId=prompt
    button "Approve"              bounds=(1,0,80,3)  testId=approve  [focused]
    button "Reject"               bounds=(4,0,80,3)  testId=reject
    textbox "Reason"              bounds=(7,0,80,3)  testId=reason
```

### Roles and names

Roles come from the widget class, matched along the MRO, so your own
`class SaveButton(Button)` is a `button` without any configuration. `Input` and
`TextArea` map to `textbox`, `DataTable` to `table`, `ListView`/`OptionList` to
`list`, `Label`/`Static` to `text`, containers to `region`, `ModalScreen` to
`dialog`. Names come from the widget's label, placeholder, renderable, `name`,
or DOM `id`, in that order; the DOM `id` is also published as `testId`.

Override either per widget:

```python
label = Label("87%")
label.termwright_role = "progressbar"
label.termwright_name = "Upload progress"
```

### Coexisting with `Pilot`

The adapter only reads the DOM from `post_display_hook`, so `run_test()` and
`Pilot` keep working unchanged — semantic tests and pilot tests live in the same
suite.

## Without Textual

Any TUI can drive the client directly. You own the render; the client owns the
revision numbers and hands you the marker to write after the render's last byte.

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

## Conformance

`tests/` runs against `clients/test-vectors/`, which is generated from the
normative TypeScript implementation in `packages/protocol`. Framing bytes,
marker MACs, message parsing and snapshot validation are all asserted against
the same vectors in Python, Go and Rust.

```sh
pip install -e ".[dev]"
pytest
```
