---
title: Test data and your own fixtures
description: Declaring the files a program starts with, composing fixtures on top of the preset, and what that looks like coming from Cypress.
---

## Files the program starts with

A terminal program's input is mostly files. Declare them on the launch and they
exist in the test's private directory — which is also the program's `cwd` —
before it starts:

```ts
const app = await terminal.launch({
  command: ['node', 'editor.js'],
  files: {
    'config.json': JSON.stringify({theme: 'dark'}),
    'notes/todo.md': '- write tests\n',
  },
});
```

Directories are created as needed, and a `Uint8Array` is written as bytes.

To start from a whole project, copy a template first. The declared files are
written **over** it, so a test can take a fixture project and change only the
one file it is actually about:

```ts
await terminal.launch({
  template: 'test/fixtures/project',
  files: {'config.json': '{}'},
});
```

### There is no shared fixtures directory, on purpose

This is the part worth internalising, because most testing tools work the other
way and the absence looks like a gap until you see why.

Files are declared by the test that needs them, into a directory only that test
can see. So no test can depend on what another one left behind, and reading a
test tells you its entire input without opening a second file. A path that would
escape that directory is refused rather than written.

## Building your own fixtures

The preset's `test` is Vitest's own `test.extend`, so the way to make a suite
terse is to compose on top of it rather than wait for the preset to grow an
option:

```ts
import {test as base, expect} from 'termwright/test';
import type {TerminalHarness} from 'termwright';

const test = base.extend<{app: TerminalHarness}>({
  app: async ({terminal}, use) => {
    const app = await terminal.launch({files: {'config.json': '{}'}});
    await app.waitForText('ready');
    await use(app);
    // Still inside the terminal fixture: the session is alive here, so a
    // fixture that logs out or asserts a final state can still do it.
  },
});

test('saves on ctrl-s', async ({app}) => {
  await app.press('Control+s');
  await expect(app).toHaveText('saved');
});
```

Three guarantees hold, and the preset pins all three with its own tests:

- **The types flow through.** Your fixture's type is visible in the test
  callback, alongside the preset's.
- **The preset's fixtures stay injectable next to yours** — `{app, terminal,
  step}` all work in the same test.
- **Teardown runs inside-out**, which is the one that matters in practice: when
  your fixture cleans up, the session it built on is still alive. A fixture that
  logs out, snapshots a final state or asserts on a log can still do it.

## Coming from Cypress

| Cypress | Here |
|---|---|
| `cy.fixture('user.json')` and the shared `fixtures/` directory | `launch({files})` / `launch({template})`, declared per test into its own directory |
| custom commands (`Cypress.Commands.add`) | a fixture composed with `test.extend` |
| `beforeEach` that logs in | the same, but as a fixture — it also tears down, and only the tests that ask for it pay for it |

The shape of the change is that setup stops being ambient. A custom command is
available everywhere and costs every test that loads it; a fixture is requested
by name, so a test's dependencies are its parameter list.
