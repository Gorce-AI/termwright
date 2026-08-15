# termwright

Test terminal programs the way you test web apps: by **role and name**, not by
counting rows and columns.

```sh
npm i -D termwright
```

## Your first test, in ten lines

```ts
import { expect, test } from 'termwright/test';

test('asks before running a command', async ({ terminal }) => {
  const app = await terminal.launch({ command: ['node', 'agent.js'] });

  await app.waitForText('Permission required');
  await app.getByRole('button', { name: 'Approve' }).activate();

  await expect(app.getByTestId('status')).toHaveText('approved');
});
```

```jsonc
// vitest.config.ts — nothing termwright-specific is required to start.
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { testTimeout: 20_000 } });
```

That runs `agent.js` in a **real pseudo-terminal**, waits on facts rather than
sleeps, and clicks by sending the mouse report a terminal would have sent. If the
program uses one of termwright's adapters (`@termwright/ink`,
`@termwright/opentui`, `termwright-py`, `termwright-go`) the roles come from a
published accessibility tree; if it does not, everything still works against
text and cells.

## What you get from where

| Import | Contents |
|---|---|
| `termwright` | `launchTerminal`, locators, actions, waits, the error taxonomy |
| `termwright/test` | the Vitest preset: `test`, `expect`, matchers, YAML snapshots |
| `termwright/ink` | `mountInk`, `launchInkFixture` for Ink component tests |

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
termwright ui                          # runner + Vitest in watch mode
termwright ui --trace out/login.twtrace  # open a recording from CI and scrub it
termwright codegen -- node agent.js      # drive a program, get a test back
termwright mcp                           # serve the MCP tools to an agent
termwright agent-context                 # versioned JSON: tools, params, exit codes
termwright usage                         # one-screen cheat sheet
termwright skill --out .claude/skills/tw # an agent-skill package
```

`termwright ui` opens a local page with three panes — a live terminal, a
semantic inspector you can point at nodes to get a selector, and a timeline you
can scrub. It starts your project's own Vitest in watch mode and points it at
the runner through `TERMWRIGHT_UI_URL`; the browser's rerun and stop buttons
press the same keys watch mode already understands, and your terminal keeps its
hotkeys. Add `--no-watch` to open the runner without starting a suite, and put
runner arguments after `--`:

```sh
termwright ui -- src/login.test.ts --reporter=dot
```

For the live panes to fill in, add the reporter:

```ts
// vitest.config.ts
import TermwrightUiReporter from '@termwright/ui/reporter';
export default defineConfig({ test: { reporters: ['default', new TermwrightUiReporter()] } });
```

It does nothing when `TERMWRIGHT_UI_URL` is unset, so it is safe to leave in a
repository whose runs are mostly headless.

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
