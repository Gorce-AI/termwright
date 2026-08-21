---
title: Migrating
description: Replace an existing terminal-test harness with Termwright.
---

Use this guide when you already test a CLI or TUI with another harness. If you
know Playwright or Cypress but are starting a terminal test suite, see
[Coming from Playwright or Cypress](../../concepts/web-testing/) instead.

## From `ink-testing-library`

If you currently use `ink-testing-library`, Termwright's component API provides
an in-process migration path for current Ink releases. It adds terminal input,
focus, resize, semantic locators, and retained traces beyond `lastFrame()`
string assertions.

```tsx
// before
import {render} from 'ink-testing-library';

const {lastFrame, stdin, rerender} = render(<Approve />);
stdin.write('\r');
expect(lastFrame()).toContain('approved');
```

```tsx
// after
import {mountInk} from 'termwright/ink';

const harness = await mountInk(<Approve />);
await harness.press('Enter');
await harness.waitForText('approved');
await harness.close();
```

The mapping is mostly mechanical:

| `ink-testing-library` | termwright |
|---|---|
| `render(<App/>)` | `await mountInk(<App/>)` |
| `lastFrame()` | `harness.screen().text()`, or `waitForText` / `toHaveText` |
| `frames` | the [trace recording](../../tools/traces-reports/) — every frame, with timing |
| `stdin.write('\r')` | `harness.press('Enter')` |
| `rerender(<App/>)` | `await harness.rerender(<App/>)` |
| `unmount()` | `await harness.close()` |
| — | `getByRole`, retrying assertions, resize, raw mode, semantic snapshots |

Two differences to plan for. Everything is asynchronous, because everything
waits on a real render rather than on a string that was already built. And once
you annotate the components with [`useSemantic`](../../adapters/ink/), the
assertions stop being about frames at all:

```tsx
await expect(harness.getByRole('button', {name: 'Approve'})).toBeFocused();
```

## From the pre-probe Termwright adapters

Early Termwright releases asked each application to start its semantic adapter.
The current model puts observation in a launcher-injected **probe** and keeps
application imports optional and annotation-only. Migrating has the same shape
in every language:

1. remove the call or mixin that owns instrumentation;
2. launch or build through the framework probe;
3. keep only annotations that express developer intent the framework cannot
   expose itself.

Do not copy physical facts into the new annotations. Bounds, focus, visibility,
rendered text, values and framework state belong to the probe; duplicating them
in application metadata would let the tree disagree with the screen.

### Ink: `semanticRender` → normal `render` plus `@termwright/probe-ink`

The old `@termwright/ink` package wrapped the renderer:

```tsx
// before
import {semanticRender} from '@termwright/ink';

semanticRender(<App />, {alternateScreen: true});
```

Restore the application's ordinary Ink entry point and attach the probe to the
test command:

```tsx
// application
import {render} from 'ink';

render(<App />, {alternateScreen: true});
```

```ts
// test launcher
import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-ink';

const entry = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const {command} = withProbe('node', [process.execPath, entry]);
const app = await terminal.launch({command});
```

`useSemantic` and `<Semantic>` still exist in `@termwright/ink`, but they now
only annotate an existing Ink host. Keep author-owned role, name, description,
test id, relationships, actions and `extended` domain data. Remove legacy
annotation fields that restated focus, value, visibility, bounds or portable
widget state. The probe observes what Ink retains and reports an unavailable
fact as unavailable rather than accepting an override.

### OpenTUI: `instrumentRenderer` → normal renderer plus `@termwright/probe-opentui`

Delete the manual instrumentation call; the application continues to own and
construct its renderer:

```ts
// before
import {instrumentRenderer} from '@termwright/opentui';

const renderer = await createCliRenderer();
instrumentRenderer(renderer);
```

```ts
// after: application
const renderer = await createCliRenderer();
```

```ts
// after: test launcher
import {fileURLToPath} from 'node:url';
import {withProbe} from '@termwright/probe-opentui';

const entry = fileURLToPath(new URL('../app.ts', import.meta.url));
const {command} = withProbe('bun', ['bun', entry]);
const app = await terminal.launch({command});
```

`describeRenderable` remains in `@termwright/opentui`, but it is an optional
weak annotation registry, not a renderer adapter. Keep intent such as role,
name, description, test id, relationships, actions and `extended`; let the
probe own geometry, clipping, focus, rendered text, value and selection. The
old `@termwright/opentui/testing` mount surface has no compatibility alias in
the annotation SDK; migrate those tests to the real-PTY probe path rather than
keeping a second renderer owner alive.

### Python/Textual: `enable_semantics` and `TermwrightApp` → startup probe

Remove both the explicit call and the mixin:

```python
# before
from termwright import TermwrightApp, enable_semantics

class NotesApp(TermwrightApp, App):
    ...

# The alternative legacy shape was a plain App whose on_mount called
# enable_semantics(self).
```

The application becomes an ordinary `App`. Launch it through the probe:

```ts
import {fileURLToPath} from 'node:url';

const appPath = fileURLToPath(new URL('../app.py', import.meta.url));

const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', appPath],
});
```

Replace `termwright_role`, `termwright_name` and `termwright_test_id` convention
attributes with the explicit annotation SDK for custom widgets:

```python
from termwright.textual import semantic

@semantic(role="status", name="Upload progress", test_id="upload-progress")
class UploadStatus(Widget):
    ...
```

Use `termwright.textual.annotate(widget, ...)` for a retained third-party
instance you cannot decorate. Built-in Textual roles, names, DOM ids, geometry,
focus and state need no annotation.

### Go/tview: `termwright.Attach` → instrumented build

Remove `clients/go/termwright`, `Attach`, and its `WithChildren`,
`WithDescriber`, `WithTestIDs` and `SetTestID` options from the application.
Build the unchanged tview program through the exact-version probe:

```ts
import {resolve} from 'node:path';
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const moduleDir = resolve('path/to/app');
const binaryPath = resolve(moduleDir, 'app-binary');
const build = await prepareInstrumentedBuild({moduleDir});
await execFile('go', ['build', '-o', 'app-binary', '.'], {
  cwd: moduleDir,
  env: build.env,
});
const app = await terminal.launch({command: [binaryPath]});
```

The probe can read tview's private container structure, so the legacy
`WithChildren` escape hatch is no longer needed. Move author wording and stable
test ids to the framework-neutral annotation SDK:

```go
import "github.com/gorce-ai/termwright/clients/go/annotate"

annotate.Tag(upload, annotate.Semantics{
    Role: "progressbar", Name: "Upload progress", TestID: "upload-progress",
    Domain: map[string]any{"queue": "release"},
})
```

`annotate.Semantics` intentionally has no geometry, focus, visibility, value,
rendered-text or framework-state fields. `WithLogs` also has no annotation
equivalent: annotations describe nodes, not a logging transport. Follow a log
file from `launch({logs})`, or use `protocol.Client` directly for a custom
semantic producer that owns its own `slog` bridge.

## From Textual's Pilot

Pilot is good, and termwright is **not** a replacement for it. Pilot runs
in-process, which makes it fast and gives it access to the app object; that is
the right tool for unit-testing a widget.

Reach for termwright when you need what an in-process harness structurally
cannot give you:

- a **real pseudo-terminal** — raw mode, `SIGWINCH`, signals, exit codes, the
  program as its users run it;
- **cross-framework** tests: one suite driving your Python TUI and the Node CLI
  it shells out to;
- revision-based waiting, recordings and the failure report;
- the same session driven by an [AI agent over MCP](../mcp/).

The Textual application needs no integration code. The test launcher injects
the probe at interpreter startup:

```ts
// the test, in TypeScript, driving the real program
import {fileURLToPath} from 'node:url';

const appPath = fileURLToPath(new URL('../app.py', import.meta.url));

const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', appPath],
});
await app.getByRole('button', {name: 'Approve'}).activate();
```

The two coexist: Pilot for widget-level tests, termwright for the end-to-end
lane. See [Textual](../../adapters/textual/) for what the automatic probe publishes.

## From teatest (Bubble Tea)

`teatest` drives a Bubble Tea `Model` in process and asserts on its output. It
stays useful. Termwright adds the real terminal boundary and an exact-version
probe that publishes recognised component role, value and state.

Bubble Tea composes strings — Lip Gloss joins have no per-widget positions to
publish — so semantic geometry and pointer actions remain unavailable. Role
and state locators work for recognised or annotated model components; text and
style locators still cover the rendered grid. Read
[Bubble Tea](../../adapters/bubbletea/) before planning the split between
`teatest` model tests and Termwright end-to-end tests.

## From `expect` or `pexpect`

`expect` and `pexpect` are line-oriented: they match patterns on a stream. That
works until the program starts repainting the same rows, which is precisely when
a TUI test gets hard.

```python
# before
child.expect('Permission required')
child.sendline('y')
child.expect('running:')
```

```ts
// after
await app.waitForText('Permission required');
await app.press('y');
await app.waitForText('running:');
```

The shapes match one-to-one, and what you gain is a *screen*: `screen().line(12)`
is answerable, colours and modes are modelled, and a failure leaves a recording
instead of a stream transcript.

Translate stream expectations to `waitForText()` and input writes to
`press()`, `type()`, or `paste()`. There is no `send` / `expect(pattern)`
compatibility API.

## From a custom PTY, `spawn()`, or tmux harness

Keep the executable and the user-visible scenarios. Replace process lifecycle,
input, terminal parsing, polling, and artifact collection with the corresponding
Termwright surfaces:

| Existing harness | Termwright |
|---|---|
| `spawn()` or PTY setup | `terminal.launch()` |
| raw stdout buffer | `app.screen()` |
| polling loop | `waitForText()` or a retrying assertion |
| stdin writes | `press()`, `type()`, or `paste()` |
| shared fixture directory | `launch({files})` or `launch({template})` |
| transcript on failure | retained trace and HTML report |

Start by preserving the existing keyboard-driven workflow. Add semantic
locators only after the relevant [framework integration](../../adapters/) is
running and verified.
