---
title: Locators
description: Two locator dialects over one engine, what happens without a semantic tree, and the rules that keep a locator from silently matching the wrong thing.
---

A locator is a lazy handle, not a snapshot of a node. It is re-resolved against
the latest accepted tree every time you act on it, so a locator you built before
a re-render still points at the right thing afterwards.

```ts
const approve = app.getByRole('button', {name: 'Approve'});
await app.press('Tab');       // the screen changes
await approve.activate();     // resolved again, right now
```

## The Playwright dialect

```ts
app.getByRole('button', {name: 'Approve'});
app.getByRole('button', {name: /^Rej/, state: {disabled: true}});
app.getByLabel('Message');
app.getByText('running: ls -la', {occurrence: 2});
app.getByTestId('approve-button');
```

| Builder | Matches |
|---|---|
| `getByRole(role, {name, exact, state})` | a node's role, its accessible name, and any state keys you list |
| `getByLabel(text, {exact})` | the labelling relation |
| `getByText(text, {exact, occurrence, fg, bg, attributes})` | node text with a semantic tree, grid text without one |
| `getByTestId(id)` | an author-supplied test id — a promise of stability |

Names accept a string or a `RegExp` and are compared after whitespace
normalization. `state` is a partial: `{disabled: true}` asserts only that key.

## The CSS dialect

The same engine, addressed the way Textual users already think:

```ts
app.locator('dialog button.primary:focused');
app.locator('#reject');
app.locator('button:disabled');
```

`#id`, `.class`, descendant combination, and the pseudo-classes `:focused`,
`:disabled`, `:selected`, `:checked`. Use whichever dialect reads better in the
test; they resolve identically.

## Scoping, ordering, counting

```ts
const dialog = app.getByRole('dialog', {name: 'Permission'});
await app.getByRole('button', {name: 'Approve'}).within(dialog).click();

await app.getByRole('listitem').first().activate();
await app.getByRole('listitem').nth(2).press('Enter');
console.log(await app.getByRole('listitem').count());
```

## Strictness is the point

- **Zero matches** is not a failure yet: the locator waits until its deadline,
  which is what makes `await expect(locator).toBeVisible()` a legitimate way to
  wait for a render.
- **More than one match** fails immediately with `ambiguous-locator` and a
  bounded list of candidates. Narrow it with `within()`, a `name`, or select one
  explicitly with `first()` / `nth()`. A locator is never allowed to quietly
  pick the first of several.

## Refs and staleness

`resolve()` gives you the node behind the locator, including a ref:

```ts
const target = await app.getByRole('button').first().resolve();
// target.ref  -> 'n8@42'   (node id @ semantic revision)
// target.rect -> {row, column, width, height} | null
await app.locatorForRef(target.ref).click();
```

A ref is bound to the revision that minted it. Reusing one after that revision
was superseded raises `stale-snapshot` rather than acting on a node that may
have moved. The fix is always the same: take a fresh snapshot and use its refs.
Generic (non-semantic) matches get a grid ref instead: `grid:1,2,9,1@7`.

## Without a semantic tree

Programs that do not ship an adapter are still perfectly testable. The locator
layer falls back to the grid, and it never invents a role:

```ts
app.getByText(/error/i);                       // literal or regex over grid text
app.getByText('FAILED', {fg: 'red'});          // style predicates
app.getByText('Done', {occurrence: 2});        // pick among matches
app.scrollback.search('deprecated');           // search the retained history
```

Generic matches resolve to rectangles, `ResolvedTarget.semantic` is `false`, and
every diagnostic says `semanticTree: false`. If a test needs `getByRole`, the
answer is to [add an adapter](../../adapters/), not to guess.

## Actions are physical

Every action goes out through the pseudo-terminal. Before a pointer action the
driver pre-flights the node — visible, enabled, inside the viewport, and mouse
tracking actually enabled by the child — and refuses with `unsupported-action`
instead of writing bytes nobody reads.

```ts
await locator.click();                       // a real SGR mouse report
await locator.doubleClick();
await locator.press('Control+K');            // honors application cursor/keypad modes
await locator.type('ls -la');
await locator.wheel({deltaY: 3});
await locator.dragTo(other);
```

`activate()` is the one to reach for when you care about the outcome rather than
the input method: it clicks if it can, otherwise focuses and sends Enter or
Space, and its receipt tells you which happened.

```ts
const receipt = await locator.activate();
receipt.strategy; // 'click' | 'focus-enter' | 'focus-space'
```

That matters for components that never enable mouse tracking — a very common
case in Ink apps. `click()` on one of those fails honestly;
`activate()` succeeds through the keyboard.

## Timeouts

Five classes, each overridable per call, per launch and per environment
variable:

| Class | Default | Covers |
|---|---|---|
| `action` | 5 s | resolving a locator and acting on it |
| `text` | 5 s | `waitForText`, `toHaveText` |
| `idle` | 2 s | `waitForIdle`, `waitForStable` |
| `ready` | 10 s | `waitForReady` |
| `exit` | 10 s | `waitForExit` |

```ts
await app.getByRole('button').click({timeout: 15_000});
await terminal.launch({command, timeouts: {action: 15_000}});
// TERMWRIGHT_TIMEOUT_ACTION=15000 npx vitest run
```
