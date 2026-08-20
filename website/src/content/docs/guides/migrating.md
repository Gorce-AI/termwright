---
title: Migrating
description: Coming from an older Termwright adapter, ink-testing-library, teatest, Textual's Pilot, Cypress, or an expect script.
---

## From `ink-testing-library`

This is the migration termwright was built for. `ink-testing-library` is the
only test harness Ink ever had; it is unmaintained and broken on current Ink,
and its model — render to a string, assert on `lastFrame()` — cannot express
focus, mouse, raw mode or a resize.

```tsx
// before
import {render} from 'ink-testing-library';

const {lastFrame, stdin, rerender} = render(<Approve />);
stdin.write('\r');
expect(lastFrame()).toContain('approved');
```

```tsx
// after
import {mountInk} from '@termwright/ink-testing';

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
| — | `getByRole`, `click`, `activate`, resize, raw mode, semantic snapshots |

Two differences to plan for. Everything is asynchronous, because everything
waits on a real render rather than on a string that was already built. And once
you annotate the components with [`useSemantic`](../../adapters/ink/), the
assertions stop being about frames at all:

```tsx
await expect(harness.getByRole('button', {name: 'Approve'})).toBeFocused();
```

## From `@badeball/cypress-cucumber-preprocessor` or `playwright-bdd`

Keep the physical `.feature` files, but replace process-global support-code
registration with a paired module that default-exports `defineSteps(...)`.
`Given`, `When` and `Then` still accept Cucumber Expressions or regular
expressions, and DocStrings, DataTables, Background, Rule and Scenario Outline
remain authoring constructs.

| `@badeball/cypress-cucumber-preprocessor` / `playwright-bdd` | Termwright |
|---|---|
| physical `.feature` files | keep them in place |
| Cypress `[filepath]` / `[filepart]` step-definition patterns | keep the same template vocabulary; matching uses Termwright's nearest-scope rules |
| global `Given(...)` registration or `createBdd()` bindings | `export default defineSteps(Given(...), When(...), Then(...))` |
| `cy.*` commands or a browser `page` fixture | the step context's `terminal` fixture and Termwright locators/actions |
| a generated-tests or `bddgen` pre-step | remove it; the Vite plugin transforms `.feature` files in memory |
| Cucumber hooks and tag expressions | not available in the shipped slice; use `Background` and Vitest/CLI run scopes |

Pairing compatibility does not mean global-registry compatibility. For each
step, Termwright checks exact `[filepath]`, then `[filepart]` from the nearest
ancestor towards the feature root, then global patterns. The first tier with a
match wins; two matches inside that same tier are an error. This lets a local
definition shadow a shared fallback without making resolution depend on import
order.

The execution model changes in one important way: `@termwright/gherkin` parses
and transforms the feature in memory, then declares native `@termwright/test`
cases in Vitest. There is no Cucumber scheduler, generated test directory or
second report. TypeScript tests and `.feature` Scenarios therefore share one
Vitest process and one `termwright ui` catalogue.

Move shared state into the fresh `world` passed to every step callback. Put
per-Scenario setup in `Background` for now: Cucumber hooks, tag filtering and
editor configuration are not included in the shipped slice. Tags are retained
as metadata but do not select a run. Add `gherkinPlugin()` plus a `.feature`
include for direct Vitest/IDE runs; the UI-owned host adds both automatically.
See [Gherkin feature files](../gherkin/) for pairing and a complete config.

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
import {withProbe} from '@termwright/probe-ink';

const {command} = withProbe('node', ['node', 'dist/cli.js']);
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
import {withProbe} from '@termwright/probe-opentui';

const {command} = withProbe('bun', ['bun', 'app.ts']);
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
const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', 'app.py'],
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
import {prepareInstrumentedBuild} from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({moduleDir: 'path/to/app'});
await execFile('go', ['build', '-o', 'app-binary', '.'], {
  cwd: 'path/to/app',
  env: build.env,
});
const app = await terminal.launch({command: ['./app-binary']});
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
const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', 'app.py'],
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

## From Cypress

Not a terminal tool, but the habits transfer — and two of them need rethinking
rather than translating.

| Cypress | Here |
|---|---|
| `cy.fixture('user.json')` and the shared `fixtures/` directory | `launch({files})` / `launch({template})`, declared per test into its own directory |
| custom commands (`Cypress.Commands.add`) | a fixture composed with `test.extend` |
| `beforeEach` that logs in | the same, but as a fixture — it also tears down, and only the tests that ask for it pay for it |

The shape of the change is that setup stops being ambient. A custom command is
available everywhere and costs every test that loads it; a fixture is requested
by name, so a test's dependencies are its parameter list. Likewise there is no
shared fixtures directory: each test declares its files into a directory only it
can see, so no test can inherit what another one left behind.

See [Test data and fixtures](../test-data/).

## From an expect script

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
