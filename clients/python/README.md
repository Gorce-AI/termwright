# termwright (Python)

Semantic side-channel client, automatic probe and optional annotation SDK for
[Textual](https://textual.textualize.io).

An instrumented app publishes its widget tree over a unix socket and commits
each render with a signed OSC marker, so the driver can assert on _roles and
names_ instead of screen-scraping cells.

The protocol client speaks `termwright/2`. Every published semantic revision
is a complete v2 snapshot with evidence-qualified geometry and pointer
observations.

**Dormant rule.** Without `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN` the
probe installs nothing, opens no socket, writes no marker, and renders exactly
the bytes it would have rendered anyway.

## Install

```sh
pip install termwright              # protocol client + probe + annotation SDK
pip install "termwright[textual]"   # + Textual itself
```

Requires Python 3.9+. The Textual extra installs the exactly certified Textual
8.2.8 runtime; the protocol modules have no third-party dependencies.

## Automatic Textual semantics

The application is ordinary Textual code with no Termwright import:

```python
from textual.app import App, ComposeResult
from textual.widgets import Button, Input, Label

class PermissionApp(App):
    def compose(self) -> ComposeResult:
        yield Label("Allow bash to run?", id="prompt")
        yield Button("Approve", id="approve")
        yield Button("Reject", id="reject")
        yield Input(placeholder="Reason", id="reason")

if __name__ == "__main__":
    PermissionApp().run()
```

The Termwright launcher injects the probe at Python startup. The direct form,
useful for a custom runner, is:

```sh
python -m termwright_probe -- python app.py
```

Under the driver this publishes after every causally ordered frame enqueue:

```
application "PermissionApp"
  region                          visibleRect=(0,0,80,24)
    text "Allow bash to run?"     visibleRect=(0,0,80,1)  testId=prompt
    button "Approve"              visibleRect=(1,0,80,3)  testId=approve  [focused]
    button "Reject"               visibleRect=(4,0,80,3)  testId=reject
    textbox "Reason"              visibleRect=(7,0,80,3)  testId=reason
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

### Custom widgets

Automatic geometry, focus, visibility and framework state still come from
Textual. A decorator supplies only application intent that the framework
cannot know:

```python
from termwright.textual import semantic

@semantic(
    role="button",
    name=lambda widget: f"Deploy {widget.environment}",
    test_id="deploy-production",
    extended=lambda widget: {"environment": widget.environment},
    actions=("focus", "activate"),
    key=lambda widget: f"deployment:{widget.environment}",
)
class DeployWidget(Widget):
    ...
```

`name`, `description`, `test_id`, `extended`, `labelled_by`, `described_by`,
`actions` and `key` accept either constants or callables receiving the
live widget. The declaration is inherited by subclasses. For a third-party
instance use `annotate(widget, ...)`; the registry is weak and does not keep a
discarded widget alive.

`labelled_by` and `described_by` may return a widget or a sequence of widgets.
`key` is the stable semantic identity for a domain component that Textual may
recreate. `actions` uses the protocol's closed descriptive vocabulary; it never
registers an out-of-band callback, and interaction still becomes real PTY
input.

The API intentionally has no geometry, focus, visibility, rendered-text or
portable-state arguments. Those physical facts remain probe-owned, and merge
tests enforce that the annotation cannot replace them.

### Coexisting with `Pilot`

The probe only reads the DOM from `post_display_hook`, so `run_test()` and
`Pilot` keep working unchanged — semantic tests and pilot tests live in the same
suite.

## Without Textual

Any TUI can drive the client directly. You own the render; the client owns the
revision numbers and hands you the marker to write after the render's last byte.

```python
from termwright import (
    NodeGeometryObservations,
    Observation,
    Rect,
    SemanticNode,
    SemanticSnapshot,
    client_from_env,
    framework_evidence,
)

def geometry(rect: Rect) -> NodeGeometryObservations:
    return NodeGeometryObservations(
        displayed=Observation("known", True, evidence=framework_evidence("my-adapter")),
        intendedRect=Observation("known", rect, evidence=framework_evidence("my-adapter")),
        visibleRect=Observation("known", rect, evidence=framework_evidence("my-adapter")),
    )

client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0")
if client is not None and await client.start():
    marker = await client.publish(
        SemanticSnapshot(
            sessionId="", revision=0, columns=80, rows=24,   # both are overwritten
            rootIds=["root"],
            nodes=[
                SemanticNode(id="root", role="dialog", name="Permission",
                             geometry=geometry(Rect(0, 0, 80, 24))),
                SemanticNode(id="ok", parentId="root", role="button", name="Approve",
                             geometry=geometry(Rect(row=1, column=2, width=9, height=1))),
            ],
            coordinateSpace=Observation("known", "viewport-cells", evidence=framework_evidence("my-adapter")),
            hitGrid=Observation("unsupported", capability="pointer-hit-grid",
                                reason="framework-unobservable"),
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
  tw:sem  [p41207]   0.003s hello sent adapter=textual/1.0.0 caps=tree,states,actions,render-revisions,intended-geometry,clipped-geometry,pointer-hit-grid
  tw:sem  [3f9c1a04]  0.011s hello-ack session=3f9c1a04… marker=on subscribe=snapshots logs=off
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

## Injection details

```sh
python -m termwright_probe -- python app.py
```

`app.py` imports no termwright, calls nothing of ours, and is not edited. The
launcher puts a generated `sitecustomize.py` on `PYTHONPATH`; CPython imports
it during startup, before the script's own directory reaches `sys.path`; the
probe waits there until the application imports Textual and observes the
certified `App._display` / driver enqueue / `post_display_hook` boundary. The
marker is appended without waiting to the same WriterThread FIFO, after the
frame; a full queue fails the semantic channel instead of blocking Textual's
event loop. Strong probing is certified only for Textual 8.2.8's exact built-in
`LinuxDriver` and `WindowsDriver` with their exact `WriterThread`; custom
`driver_class` values and inline mode fail the semantic channel explicitly
rather than publishing an unprovable commit. A driver that already sets `TERMWRIGHT_ENDPOINT` and
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

**What it reports automatically.**

| Fact                                      | Where it comes from                                                    |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| intended and visible rectangles           | `MapGeometry.region` and `MapGeometry.visible_region`                  |
| exact pointer recipient                   | `Screen.get_widget_at`, compressed into the snapshot hit grid          |
| roles for your own widget classes         | the MRO, so `SaveButton(Button)` is a button with no registration      |
| `frameworkType` on anything unrecognised  | the widget's class name                                                |
| scrolled out of view vs `display = False` | both `hidden`; the first also `state.offscreen`, with a zero-area rect |

The driver allows pointer actions only when the snapshot's hit grid names the
node as the recipient at the target cell. Paint order alone is not sufficient.

**Where the injection reaches**, measured on CPython 3.12 (see
`docs/architecture/audit/textual.md` for the full table): a plain script,
`-m`, `-c`, a console-script entry point, `uv run` and `poetry run` all work. The
Python 3.12 CI lane installs both environment managers and executes these real
subprocess cases. `python -S`
and `python -E` do not, and are not meant to — the first disables `site`
entirely and the second makes the interpreter ignore `PYTHONPATH`. Both are
the person running the interpreter opting out.

## Deviations

Measured against the probe conventions in the protocol README. Everything
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
  probe walks `app.screen`, so a pushed-over screen's widgets are not in the
  tree at all. A widget hidden on the _active_ screen (`display = False`) does
  publish `hidden: true`. Textual owns the screen stack; reaching into it would
  mean publishing widgets that no longer receive events.
- **Ownership is process-local and one-shot.** The first application
  interpreter atomically owns the generated bootstrap. Before the
  application's first line, the probe captures its credentials privately and
  removes the endpoint, token, owner marker, and bootstrap path from the
  inherited environment. Python children and grandchildren therefore cannot
  attach to the parent's semantic session. `poetry run` receives a one-hop
  launcher marker so ownership is claimed by its target interpreter, not by
  Poetry's own console process.
- **The probe does not report `frame-begin`** (probe capability). A frame is
  accepted only when the same `_display` attempt successfully enqueued output
  through an exact certified non-headless built-in driver before
  `post_display_hook`. The writer is preflighted before snapshot publication,
  then its marker is appended to that same FIFO. A full or replaced writer
  fails closed without blocking on queue capacity. This exposes no instant the
  probe could honestly call the start of a frame. Consumers must not read a
  missing `frame-begin` as "no frame in progress".
- **A `Static` subclass with a custom `render()` is named by its `content`**
  (rule 2), which is the markup it was given rather than what it draws. Textual
  renders to a strip of segments with no text handle the adapter can read.

## Application evidence providers

`termwright.evidence` exposes closed pointer, focus, scroll, paint,
terminal-input-mode, and action-strategy provider families.
`ApplicationFocusEvidenceProvider.observe` returns a semantic
recipient mapping or authoritative `None`; the wire keeps `focused` and `none`
distinct from an unnegotiated provider. Registration must happen before the
session freeze, and providers publish evidence/recipes only—physical input is
still sent through the PTY.

`ApplicationTerminalInputModeEvidenceProvider.observe` reports the production
parser's exact mouse and focus modes. It is authoritative evidence for hidden
ConPTY state, not a callback or a request to synthesize terminal modes.

## Conformance

`tests/` runs against `clients/test-vectors/`, which is generated from the
normative TypeScript implementation in `packages/protocol`. Framing bytes,
marker MACs, message parsing and snapshot validation are all asserted against
the same vectors in Python, Go and Rust.

```sh
pip install -e ".[dev]"
pytest
```
