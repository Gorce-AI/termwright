---
title: Assertions
description: Assert terminal text, semantic state, visibility, geometry, logs, and process behavior with retrying matchers.
---

Import `expect` from `termwright/test`. Termwright registers matchers that poll
terminal and semantic revisions until the expectation passes or reaches the
configured expect timeout.

```ts
import {expect, test} from 'termwright/test';
import {fileURLToPath} from 'node:url';

const profile = fileURLToPath(new URL('../profile.js', import.meta.url));

test('saves a profile', async ({terminal}) => {
  const app = await terminal.launch({command: [process.execPath, profile]});
  await app.press('Enter');
  await expect(app).toHaveText('Saved');
});
```

## Assert terminal text

```ts
await expect(app).toHaveText('Ready');
await expect(app).toHaveText(/items: \d+/);
await expect(app).not.toHaveText('Error');
```

Use this for text a user can see on the terminal grid. On a locator,
`toHaveText()` checks the semantic element's text or value.

## Assert presence and semantic state

```ts
const save = app.getByRole('button', {name: 'Save'});

await expect(save).toBeAttached();
await expect(save).toBeFocused();
await expect(save).toBeEnabled();
await expect(mode).toBeChecked();
await expect(tab).toBeSelected();
await expect(details).toBeExpanded();
await expect(name).toHaveValue('Ada');
await expect(save).toHaveExtendedState({value: 'release'});
```

Use `toHaveState()` for less common portable flags. The named matchers above
are clearer for enabled, checked, selected, expanded, and value state.

`toBeAttached()` asks whether the node is present in the semantic tree. It does
not claim that the element is painted or inside the viewport.

## Assert display and viewport visibility

Geometry and visibility are capability-dependent:

```ts
await expect(panel).toBeDisplayed();
await expect(panel).toBeVisible();
await expect(panel).toBeInViewport({fully: true});
await expect(panel).toBeOffscreen();
```

An unknown or unsupported observation does not satisfy either the positive or
negated matcher. This prevents `not.toBeVisible()` from passing merely because
the framework cannot observe visibility.

Use `toBeHidden()` when either a hidden state or detachment is acceptable. See
[Geometry and visibility](../../reference/geometry-visibility/) for the complete
contract and framework matrix.

For transient UI such as a loader, wait on that concrete condition instead of
waiting for the whole terminal to become idle:

```ts
const loader = app.getByRole('progressbar', {name: 'Saving'});
await loader.waitFor({state: 'hidden'}); // hidden or removed from the tree
```

Use `{state: 'detached'}` when removal from the semantic tree itself is the
behavior under test. An unrelated animated status bar does not block either
condition.

## Assert bounds and spatial relationships

```ts
await expect(card).toHaveBounds({width: 40, height: 8});
await expect(label).toHaveSpatialRelation({
  relation: 'left-of',
  target: input,
});
```

Use geometry assertions for behavior that depends on layout: responsive panes,
scrolling, clipping, or a bordered region's size. Do not use exact dimensions
for unrelated decoration.

Both elements in a spatial assertion must come from the same session, revision,
and coordinate space.

## Assert application logs

```ts
await expect(app).toHaveLogged({
  minLevel: 'warn',
  message: /retrying connection/,
});
```

By default, an application `error` log can fail an otherwise passing test. See
[Application logs](../app-logs/).

Assert on `app` for one launched session. Assert on the `terminal` fixture when
a test launches several sessions and the query should cover their combined log
collection.

## Configure the assertion timeout

```ts
configureTermwright({
  timeouts: {expect: 10_000},
});
```

Override an individual matcher only when the operation has a known different
budget:

```ts
await expect(app).toHaveText('Imported 10,000 rows', {timeout: 30_000});
```

Do not put a fixed sleep before an assertion. The matcher already waits for the
condition and completes immediately when it becomes true.

## Snapshot assertions

Cell and semantic snapshots have different purposes. See [Snapshots](../snapshots/)
before choosing one.
