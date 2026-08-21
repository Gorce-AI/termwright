# termwright

End-to-end testing for command-line and terminal user-interface applications.
Run a real program in a PTY, send terminal input, use retrying assertions, and
inspect failures in the desktop Runner. Framework integrations add semantic
locators when the framework can provide them.

```sh
npm i -D termwright
```

## Your first test

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const agent = fileURLToPath(new URL('../agent.js', import.meta.url));

test('asks before running a command', async ({ terminal }) => {
  const app = await terminal.launch({ command: [process.execPath, agent] });

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('approved');
});
```

```jsonc
// vitest.config.ts — nothing termwright-specific is required to start.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 20_000 } });
```

The test uses text and keyboard input, so it works without a framework
integration. Integrations provide roles, accessible names, state, geometry,
and exact pointer ownership where the framework can observe them.

## What you get from where

| Import | Contents |
|---|---|
| `termwright` | `launchTerminal`, locators, actions, waits, the error taxonomy |
| `termwright/test` | the Vitest preset: `test`, `expect`, matchers, YAML snapshots |
| `termwright/ink` | `mountInk`, `launchInkFixture` for Ink component tests |
| `termwright/gherkin` | physical `.feature` support, step definitions and the explicit Vitest plugin |
| `termwright/reporter` | the trace reporter, for `vitest.config.ts` |
| `termwright/ui-reporter` | the runner's lifecycle reporter, for a manually started UI server/test process |

Everything a project needs is reachable from this one package, config included —
so `termwright` in `devDependencies` is the whole install:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';
import TermwrightReporter from 'termwright/reporter';
import TermwrightUiReporter from 'termwright/ui-reporter';

export default defineConfig({
  test: { reporters: ['default', new TermwrightReporter(), new TermwrightUiReporter()] },
});
```

The two reporters are independent and compose: one writes `.twtrace` archives,
the other streams a live run to `termwright ui`. The UI one does nothing when
`TERMWRIGHT_UI_URL` is unset, so it is safe to leave configured in a repository
whose runs are mostly headless. `termwright ui` injects that reporter
automatically; configure it yourself only when your own script starts the UI
server and Vitest separately.

`termwright` on its own has no test-runner dependency, so a script or a
`node:test` file can use it:

```ts
import { launchTerminal } from 'termwright';

const app = await launchTerminal({ command: ['htop'] });
await app.waitForText('CPU');
console.log(app.screen().text());
await app.close();
```

## The CLI

```sh
termwright ui                            # runner + Vitest in watch mode, opens Termwright desktop
termwright ui --browser                  # use the same runner in the system browser
termwright ui --no-open                  # …or just print the URL
termwright ui --trace out/login.twtrace  # open a recording from CI and scrub it
termwright report --trace out/login.twtrace  # …or write it as one shareable HTML file
termwright codegen -- node agent.js      # drive a program, get a test back
termwright mcp                           # serve the MCP tools to an agent
termwright agent-context                 # versioned JSON: tools, params, exit codes
termwright usage                         # one-screen cheat sheet
termwright skill --out .claude/skills/tw # an agent-skill package
```

`termwright ui` opens a local runner with Specs, Runner, Runs and Settings
views. Runner keeps a single execution rail — cases with the selected case's
Test body, steps and commands expanded inline — beside the live terminal,
semantic inspector, logs and timeline. It starts your project's own Vitest in
watch mode, injects the UI reporter, and points both reporter and worker-side
terminal bridge at the runner through `TERMWRIGHT_UI_URL`.
Vitest options remain native and are forwarded to watcher and targeted browser
runs; for example, `termwright ui -- --retry=2` allows two additional attempts.
This is per-test retry, not a second whole-run rerun.

The watch process keeps its native terminal and hotkeys. A browser rerun starts
a separate, precisely targeted Vitest child; Stop terminates that child
without taking down the watcher or the UI server. The row becomes cancelled
only after the child exits, and a failed cancellation is shown as such.

The UI catalogues and executes only cases declared by `test`/`it` from
`@termwright/test` (or `termwright/test`). The preset attaches a versioned
provider marker at declaration time; discovery reads that metadata and the
UI-owned Vitest runner skips every unmarked case, including a plain Vitest
sibling in the same file. This applies to Run all, directory, file and case
buttons; a foreign `test.only` cannot suppress the marked Termwright cases.
A normal `vitest run` does not use that UI runner and retains Vitest's usual
`.only` behavior.
The marker is also the extension point for future test providers; no additional
provider is implied to exist today.

Physical Gherkin features join that same catalogue automatically. Put paired
step definitions beside the feature and import the authoring API from the
umbrella package:

```ts
import { fileURLToPath } from 'node:url';
import { Given, defineSteps } from 'termwright/gherkin';

const appPath = fileURLToPath(new URL('../app.js', import.meta.url));

export default defineSteps(
  Given('the login screen is open', async ({ terminal, world }) => {
    world.app = await terminal.launch({ command: [process.execPath, appPath] });
  }),
);
```

`termwright ui` transforms `.feature` files in memory in the same owned Vitest
host used for discovery, Run all and browser reruns. Scenario locations remain
the physical `.feature` path and line, and generated test files are never
written. Gherkin and TypeScript cases share this one UI; no Cucumber scheduler
or second runner is started. Feature/Rule ancestry, tags and Scenario kind are
provider-authored catalogue metadata, not guesses made by splitting titles.
During execution, Given/When/Then are streamed as native Termwright step
boundaries with their physical source. A terminal launched by a step, its live
output, actions, assertions and retained replay all remain attached to that
step. Actionless scenarios keep their prose and outcome without a fabricated
terminal panel.
Ordinary `vitest run` and IDE runs remain unchanged; opt them in by adding
`gherkinPlugin()` and a `.feature` include to their Vitest config as documented
by `@termwright/gherkin`. Hooks, tag filters and editor configuration are not
included in the current Gherkin slice.

Interactive use opens the packaged Termwright desktop application. Use
`--browser` for the system browser or `--no-open` for a server-only process. In
server-only mode, copy the complete printed URL because it includes the local
authentication token:

```
termwright ui (live) — http://127.0.0.1:53219/?token=k3n…
```

Window opening is skipped with `--no-open`, `--json`, non-interactive stdout,
and CI. The URL is printed in those cases.

Add `--no-watch` to open the runner without starting a suite, and put Vitest
arguments after `--`:

```sh
termwright ui -- src/login.test.ts --reporter=dot
```

The command supplies `default` and `termwright/ui-reporter` automatically. An
additional `--reporter` after `--` composes with them. An initial `-t` or
`--testNamePattern` scopes the watcher; selecting a different test in the
browser replaces that name filter for the targeted one-shot run so two filters
cannot combine into an empty selection.

`termwright report` writes the same viewer as `ui --trace`, but as one HTML file
with the bundle, recording and imported assets (including the SVG Termwright
mark) inlined — no server, no network requests, so it travels as a CI artifact
or an attachment. `--json` prints
`{path, bytes, cut}`; when an archive exceeds the budget (8 MiB by default) both
the CLI and the page say exactly how many frames and log records were left out,
because a truncated artifact that looks complete is worse than a large one.

That is a different artifact from the failure report `@termwright/trace`
generates: this one is the whole viewer over one archive, that one is the visual
and semantic diff around a single failing step.

`termwright mcp` forwards every argument to `@termwright/mcp` untouched, so
`termwright mcp --http --port 7333` and `termwright-mcp --http --port 7333` are
the same command.

**Exit codes**: 0 ok, 1 assertion, 2 usage, 3 no-session, 4 ipc, 5 internal —
the taxonomy in [`/CONTRACTS.md`](../../CONTRACTS.md) §MCP. `--json` makes
output machine-readable, and failures carry a `kind`.

## Requirements

Node >= 22, ESM only. Vitest >= 3.2 is an optional peer: needed for
`termwright/test` and for `termwright ui`'s watch mode, and for nothing else.

Implementation decisions: [`NOTES.md`](./NOTES.md).
