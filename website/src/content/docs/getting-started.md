---
title: Getting started
description: Install the Vitest preset, write your first terminal test, and see what it does when it fails.
---

## Install

```sh
npm install --save-dev termwright vitest
```

`termwright` is the umbrella: the CLI plus the surface most projects need, so a
test file has one import instead of three. Everything below imports from
`termwright/test`; if you prefer the individual packages, the same code works
with `@termwright/test` — see [Packages](../reference/packages/).

Node >= 22, Vitest >= 3.2, ESM only. Prebuilt pseudo-terminal binaries ship for
macOS, Linux (glibc) and Windows; Alpine/musl is not supported — use
`node:22-slim`. See [Limitations](../reference/limitations/) before you plan a
CI image.

If your application is an [Ink](https://github.com/vadimdemedes/ink) app and you
want locators by role and name rather than by text, also install the adapter —
it is a production dependency, and it does nothing at all outside a test run:

```sh
npm install @termwright/ink
```

## Your first test

Any program works, instrumented or not. This one is a plain script:

```ts
// tests/agent.test.ts
import {expect, test} from 'termwright/test';

test('asks before running a command', async ({terminal}) => {
  const app = await terminal.launch({command: ['node', 'agent.js']});

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('running: ls -la');
});
```

```json
// package.json
{
  "scripts": {"test": "vitest run"}
}
```

```sh
npm test
```

Run the suite through a script rather than `npx`. In a workspace, `npx` will
happily fetch a *different* Vitest than the one your tests were written
against — a script, `pnpm exec` or `node_modules/.bin` always resolves the
local one.

The `terminal` fixture launches as many sessions as the test needs and closes
all of them on teardown. Each test gets a fresh temporary directory as its
default `cwd`, and a minimal environment — only `PATH`, `HOME` and friends are
inherited — so a stray variable on a laptop cannot change what CI sees.

A program that reads files gets them declared on the launch, into that same
private directory:

```ts
const app = await terminal.launch({
  command: ['node', 'editor.js'],
  files: {'config.json': JSON.stringify({theme: 'dark'})},
});
```

See [Test data and fixtures](../guides/test-data/) for templates, and for
composing your own fixtures on top of the preset.

## Adding semantics

`waitForText` and `toHaveText` read the grid, which is honest but positional.
Annotate the application once and the test can address it by meaning instead.
With Ink, swap `render` for `semanticRender`:

```tsx
import {useRef, useState} from 'react';
import {Box, Text, useInput, type DOMElement} from 'ink';
import {semanticRender, useSemantic} from '@termwright/ink';

function Approve({onDone}: {onDone: () => void}) {
  const ref = useRef<DOMElement>(null);
  const [focused, setFocused] = useState(true);

  useSemantic(ref, {role: 'button', name: 'Approve', state: {focused}});

  useInput((_input, key) => {
    if (key.return) onDone();
    setFocused(true);
  });

  return (
    <Box ref={ref} borderStyle="round">
      <Text>Approve</Text>
    </Box>
  );
}

const app = semanticRender(<Approve onDone={() => app.unmount()} />, {
  alternateScreen: true,
});
await app.waitUntilExit();
```

The test now says what it means:

```ts
await app.getByRole('button', {name: 'Approve'}).activate();
await expect(app.getByRole('dialog')).not.toBeVisible();
```

`<Box aria-role="button" aria-label="Approve">` is picked up too, so an app that
already annotated itself for Ink's screen-reader support needs no changes —
except that Ink does not retain `aria-label` on the element, so the accessible
name comes from the rendered text unless you supply one through `useSemantic`.

:::note[Pass `alternateScreen: true` if your tests assert on coordinates]
Ink measures elements inside its *live layout region*, which coincides with the
terminal viewport only when Ink owns the whole screen. The adapter claims the
`absolute-bounds` capability only for interactive alternate-screen renders.
:::

## Waits, not sleeps

Every wait is driven by a screen revision, a semantic revision or a process
event. There is no `sleep` anywhere in the API, and reaching for one is almost
always a sign that a wait was missing:

| Call | Settles when |
|---|---|
| `waitForText('Ready')` | the grid shows the text |
| `waitFor({state})` on a locator | the node reaches that state |
| `waitForRender({after})` | a new frame is committed |
| `waitForStable({frames, timeout})` | no screen or semantic revision for a quiet interval, and no unpaired render in flight |
| `waitForReady()` | the program signals a shell prompt (OSC 133), or the screen settled |
| `waitForExit()` | the process exits |
| `settled()` | negotiation has reached its verdict — after this, `semanticTree` will not change again |

`settled()` is the one to use when a test needs to *branch* on whether the
program published a tree. `capabilities()` answers immediately with what is
known so far, and right after launch three things can still be pending: the
negotiation window, the grace a slow adapter gets to attach after it, and the
first tree of an adapter that did attach.

```ts
const capabilities = await app.settled();
if (capabilities.semanticTree) {
  await app.getByRole('button', {name: 'Approve'}).click();
}
```

One consequence worth internalising early: **the semantic tree lags the screen
by design.** The render-commit marker follows the frame's bytes, so a
`waitForText` can return a beat before the tree describing that frame is
observable. The matchers in `@termwright/test` poll through that gap for you,
which is why an assertion is often the right way to wait:

```ts
await app.press('Tab');
await expect(app.getByRole('textbox', {name: 'Message'})).toBeFocused();
await app.type('hello');
```

Reading the tree directly (`semanticTree()`, `semanticState()`) right after a
text wait is the case that needs an explicit `await app.waitForStable()`.

## When it fails

A failure reads like Playwright's: what was expected, what was observed, the
timeout that elapsed, the candidate nodes, and an excerpt of the screen.

```
expect(getByRole('button', { name: 'Approve' })).toBeVisible()

Expected: visible
Received: hidden
Timeout:  5000ms

suggestion: narrow the locator with within(), a name option, or select one with first()/nth()
candidates:
  - button "Reject" ref=n4@7
screen:
  Permission required
     Approve    [Reject]
```

Add the reporter and the same failure also produces a self-contained HTML report
with a visual diff, a semantic diff and the recording:

```ts
// vitest.config.ts
import {defineConfig} from 'vitest/config';
import TermwrightReporter from 'termwright/reporter';

export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    retry: 2,
    reporters: ['default', new TermwrightReporter()],
  },
});
```

Import the reporter from its own subpath, never from a package root:
`vitest.config.ts` is loaded before the test runner exists, and the root modules
register matchers on `expect` as a side effect. Using the individual packages
instead of the umbrella, the same import is `@termwright/test/reporter`.

## Where to go next

- [Locators](../guides/locators/) — the two dialects, and what to do without a
  semantic tree.
- [Assertions and snapshots](../guides/assertions/) — matchers, and the YAML
  snapshot format.
- [Component testing](../guides/component-testing/) — mount an Ink component
  instead of launching a process.
- [Traces and reports](../guides/traces/) — what is recorded, and how to read it.
- [MCP for agents](../guides/mcp/) — the same driver, for an AI agent.
