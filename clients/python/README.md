# termwright (Python)

Semantic side-channel client for the [termwright](https://github.com/gorce-ai/termwright)
terminal test driver, plus an adapter for [Textual](https://textual.textualize.io).

An instrumented app publishes its widget tree over a unix socket and commits
each render with a signed OSC marker, so the driver can assert on *roles and
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
`dialog`. Names come from the widget's label, placeholder, content, `name`, or DOM `id`,
in that order; the DOM `id` is also published as `testId`.

Roles that ARIA names from content — `listitem`, `menuitem`, `tab`, `button`,
`checkbox`, `radio`, `cell`, `row`, `heading` — fall back to the text of what
they contain before they fall back to the id. That is what makes a Textual
`ListItem(Label("Open settings"))` addressable as
`getByRole('listitem', { name: 'Open settings' })`: the item holds no text of
its own, the `Label` inside does. Containers are never named this way — a
`region` would otherwise be named by everything on the screen.

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

## Application logs

```python
from termwright import client_from_env
from termwright.client import CAPABILITIES_WITH_LOGS
from termwright.logging_bridge import install_log_handler

client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0",
                         capabilities=CAPABILITIES_WITH_LOGS)
if client is not None and await client.start():
    install_log_handler(client)          # every logging call now reaches the driver
```

`install_log_handler(None)` is a no-op, so an app can call it unconditionally.
Levels map onto the wire's closed ladder (anything below `DEBUG` is `trace`,
`CRITICAL` is `fatal`), `extra=` fields become flat dotted attributes, and the
client drops what the budget does not allow — leaving a gap in `seq` so the
driver can report the loss.

## Diagnostics

When the adapter does not attach, nothing anywhere says why: the dormant rule
means a process with no endpoint behaves exactly like a process that never
heard of termwright. Point `TERMWRIGHT_DEBUG_FILE` at a file and the adapter
writes down what it decided.

```
TERMWRIGHT_DEBUG_FILE=/tmp/adapter.log
```

```text
  tw:diag [p41207]   0.000s open adapter=textual pid=41207 platform=darwin python=3.12 argv0=app.py
  tw:diag [p41207]   0.001s dormant: TERMWRIGHT_TOKEN not set
```

or, on a session that came up:

```text
  tw:sem  [p41207]   0.002s dial unix:/tmp/tw-8f21/s timeout=5000ms
  tw:sem  [p41207]   0.003s hello sent adapter=textual/1.0.0 caps=tree,bounds,…
  tw:sem  [3f9c1a04]  0.011s hello-ack session=3f9c1a04… marker=on subscribe=diffs logs=off
  tw:io   [3f9c1a04]  0.048s r1 snapshot nodes=17
```

Three properties are worth knowing before you rely on it:

- **It never writes to stderr.** The application owns the terminal, and a
  diagnostic line in the middle of a render corrupts the screen the driver is
  asserting on. There is no stderr mode to turn on by mistake.
- **It never fails the application.** An unwritable path, a full disk or a
  closed file turns the log off and changes nothing else.
- **The token never appears in it.** The endpoint does, because the endpoint
  is how you tell one session's socket from another's.

`TERMWRIGHT_DEBUG=<path>` works too, for symmetry with the driver's own
switch. `TERMWRIGHT_DEBUG=1` does **not**: that value means "log to stderr" to
the driver, it reaches this process as well, and stderr is the one destination
an adapter cannot use. Set the value to a path or the adapter stays silent.

The line format is the driver's, so `TERMWRIGHT_DEBUG=1` on the driver and
`TERMWRIGHT_DEBUG_FILE=…` on the app produce two halves of one story that a
single reader can take.

## Zero-config probe (Textual)

The adapter above asks the application to call `enable_semantics()`. The probe
asks it for nothing at all.

```sh
python -m termwright_probe -- python app.py
```

`app.py` imports no termwright, calls nothing of ours, and is not edited. The
launcher puts a generated `sitecustomize.py` on `PYTHONPATH`; CPython imports
it during startup, before the script's own directory reaches `sys.path`; the
probe waits there until the application imports Textual and attaches to
`App.post_display_hook`. A driver that already sets `TERMWRIGHT_ENDPOINT` and
`TERMWRIGHT_TOKEN` can compose the same thing itself:

```python
from termwright_probe import with_probe

command, env, bootstrap = with_probe(["python", "app.py"])
# run `command` with `env`; call bootstrap.cleanup() when the session ends
```

Nothing is written into the project. The temporary directory holds one
generated file and is named only in the child's environment.

**Dormant without instrumentation.** No endpoint and no token means the
launcher creates no directory, and the generated module — if one survived from
an earlier run — installs nothing. A test runs the same application on a pty
with and without the bootstrap and compares the two byte streams: they are
identical. A second test compares an instrumented run against the baseline
after removing the render-commit markers, and those are identical too, which is
the claim that the probe observes rather than redraws.

**What it reports that the adapter could not.**

| Fact | Where it comes from |
|---|---|
| `bounds` = what is on screen | `MapGeometry.visible_region`, Textual's `clip ∩ region` |
| `occlusion: "known"` | widgets ranked by `MapGeometry.order`, the compositor's own sort key |
| roles for your own widget classes | the MRO, so `SaveButton(Button)` is a button with no registration |
| `frameworkType` on anything unrecognised | the widget's class name |
| scrolled out of view vs `display = False` | both `hidden`; the first also `state.offscreen`, with a zero-area rect |

Because paint order is real here, the driver allows pointer actions against
Textual nodes; it refuses them for producers that cannot say whether a node's
cells are covered.

**Where the injection reaches**, measured on CPython 3.12 (see
`docs/architecture/audit/textual.md` for the full table): a plain script,
`-m`, `-c`, a console-script entry point and `uv run` all work. `python -S`
and `python -E` do not, and are not meant to — the first disables `site`
entirely and the second makes the interpreter ignore `PYTHONPATH`. Both are
the person running the interpreter opting out.

## Deviations

Measured against the adapter conventions in the protocol README. Everything
not listed here follows them.

- **Windows support is written, not yet observed here.** A `\\.\pipe\…`
  endpoint is opened through the proactor loop's `create_pipe_connection`,
  which exists only on Windows; every test in this repository runs on POSIX,
  so the verdict for a live pipe comes from CI. On a loop without that method
  the connect fails quietly and the application keeps rendering.

- **`multiline` is derived from the widget type, not a flag** (rule 4). Textual
  has no `multiline` property: `TextArea` accepts newlines and `Input` does
  not, as a matter of what the classes are. The state is published from the
  type for that reason and for no other — no other state here is inferred.
- **Widgets on an inactive screen are absent, not `hidden`** (rule 4). The
  adapter walks `app.screen`, so a pushed-over screen's widgets are not in the
  tree at all. A widget hidden on the *active* screen (`display = False`) does
  publish `hidden: true`. Textual owns the screen stack; reaching into it would
  mean publishing widgets that no longer receive events.
- **`poetry` is unverified.** Poetry was not installed on the machine where the
  injection table was measured. It runs the interpreter from the project venv
  as a subprocess and passes the environment through, so it is *expected* to
  behave like the venv row, and that expectation has not been confirmed. Treat
  a poetry-run application as untested for the probe until somebody watches it
  work.
- **The probe instruments grandchildren too.** `PYTHONPATH` is inherited, so a
  process the application spawns is also instrumented unless the variable is
  scrubbed. Visible to the application as well: it can read its own
  environment. This is a property of the injection mechanism, not a decision.
- **The probe does not report `frame-begin`** (probe capability). Textual calls
  `post_display_hook` from the `finally` of `App._display`, *after* the frame
  has been flushed, so there is no instant the probe could honestly call the
  start of a frame. Consumers must not read a missing `frame-begin` as "no
  frame in progress".
- **A `Static` subclass with a custom `render()` is named by its `content`**
  (rule 2), which is the markup it was given rather than what it draws. Textual
  renders to a strip of segments with no text handle the adapter can read.

## Conformance

`tests/` runs against `clients/test-vectors/`, which is generated from the
normative TypeScript implementation in `packages/protocol`. Framing bytes,
marker MACs, message parsing and snapshot validation are all asserted against
the same vectors in Python, Go and Rust.

```sh
pip install -e ".[dev]"
pytest
```
