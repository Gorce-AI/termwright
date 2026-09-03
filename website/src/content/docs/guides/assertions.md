---
title: Assert and wait
description: Check terminal text, element state, visibility, geometry, and logs without fixed sleeps.
---

Import `expect` from `termwright/test` and await every Termwright matcher:

```ts
import { expect, test } from 'termwright/test';

test('saves a profile', async ({ terminal }) => {
  const app = await terminal.launch({ command: ['my-cli', 'edit'] });

  await app.press('Enter');
  await expect(app).toHaveText('Saved');
});
```

Matchers observe terminal changes until the expectation passes or its timeout
expires. You normally do not need a sleep before an assertion.

## Check terminal text

```ts
await expect(app).toHaveText('Ready');
await expect(app).toHaveText(/items: \d+/);
```

On a session, `toHaveText()` searches text visible in the terminal grid. On a
semantic locator, it checks a known value first and falls back to the element's
accessible name.

Use `app.waitForText()` when reaching some screen is only a prerequisite for
the next action:

```ts
await app.waitForText('Choose a profile');
await app.press('ArrowDown');
```

## Check an element

Semantic element assertions require a framework integration:

```ts
const save = app.getByRole('button', { name: 'Save' });
const plan = app.getByRole('listitem', { name: 'Basic plan' });
const name = app.getByRole('textbox', { name: 'Name' });

await expect(save).toBeAttached();
await expect(save).toBeFocused();
await expect(save).toBeEnabled();
await expect(plan).toBeSelected();
await expect(name).toHaveValue('Ada');
```

`toBeAttached()` means that the element exists in the semantic tree. It does not
mean that the element is painted or inside the terminal viewport.

## Check visibility

```ts
await expect(panel).toBeDisplayed();
await expect(panel).toBeVisible();
await expect(panel).toBeInViewport({ fully: true });
await expect(panel).toBeOffscreen();
```

These matchers on semantic locators require the integration to provide the
corresponding geometry or viewport information. A physical screen locator
already has terminal-cell geometry. Unsupported visibility does not make
`not.toBeVisible()` pass. The assertion fails and explains that the observation
is unavailable.

Use `toBeHidden()` when either a hidden element or a removed element is
acceptable. Use `toBeDetached()` when removal from the semantic tree is the
behavior under test.

See [Geometry and visibility](../../reference/geometry-visibility/) for the
exact meanings and framework support.

## Wait for transient UI

Wait for the condition you actually need:

```ts
const loader = app.getByRole('progressbar', { name: 'Saving' });
await loader.waitFor({ state: 'hidden' });
await expect(app.getByRole('status')).toHaveText('Saved');
```

An unrelated spinner or clock elsewhere in the application does not block this
wait. Use `waitForQuiet()` only when an operation depends on the whole screen no
longer changing, such as a coordinate-based click or a snapshot after an
animation.

## Check layout

```ts
await expect(card).toHaveBounds({ width: 40, height: 8 });
await expect(label).toHaveSpatialRelation({
  relation: 'left-of',
  target: input,
});
```

Use layout assertions for responsive behavior, clipping, scrolling, or fixed
terminal regions. Avoid exact dimensions when spacing is only decoration.

## Check application logs

```ts
// After configuring an application log source:
await expect(app).toHaveLogged({
  minLevel: 'warn',
  message: /retrying connection/,
});
```

By default, a collected application log at `error` level fails an otherwise
passing test.
See [Inspect application logs](../app-logs/) for logger setup and redaction.

## Check process exit

For a CLI that should finish successfully, wait for its final status:

```ts
expect(await app.waitForExit()).toEqual({ code: 0, signal: null });
```

Use a text or semantic assertion before `waitForExit()` when the screen state is
also part of the behavior.

## Change a timeout

Set an individual timeout when the operation has a known longer budget:

```ts
await expect(app).toHaveText('Imported 10,000 rows', { timeout: 30_000 });
```

Set suite defaults through [Termwright configuration](../../reference/configuration/).
A longer timeout is appropriate for a known slow operation; it is not a fix for
an assertion that observes the wrong state.

## Snapshot larger states

Use a cell snapshot when exact terminal rendering matters. Use a semantic
snapshot when roles, names, hierarchy, and state matter. Read
[Use snapshots](../snapshots/) before snapshotting a full screen.

## Next steps

- [Choose a locator](../locators/)
- [Use snapshots](../snapshots/)
- [Debug an assertion timeout](../../tools/debugging/)
