---
title: How waiting works
description: Choose a specific wait or retrying assertion instead of a fixed delay.
---

Wait for the state the next line needs:

```ts
await app.waitForText('Profile name');
await app.type('release');
await expect(app).toHaveText('Saved release');
```

Termwright wakes a wait when the relevant terminal, semantic, log, or process
state changes. It does not need a short polling sleep between checks.

## Choose a wait

| Wait                   | Use it when                                                        |
| ---------------------- | ------------------------------------------------------------------ |
| `waitForText()`        | The terminal screen must contain text                              |
| `locator.waitFor()`    | An element must become attached, hidden, visible, or detached      |
| `waitForExit()`        | Process termination is the expected result                         |
| `waitForShellPrompt()` | An integrated shell reports a prompt                               |
| `waitForRender()`      | Low-level code needs a screen revision newer than a known revision |
| `settled()`            | Code needs to inspect which integration features connected         |
| `waitForQuiet()`       | A geometry-dependent operation needs a heuristic quiet interval    |

A retrying assertion is usually clearer than waiting for any render:

```ts
await expect(app.getByRole('button', { name: 'Save' })).toBeEnabled();
```

## Avoid fixed sleeps

A fixed delay waits too long on a fast machine and may still be too short on a
slow one. It also hides the condition the test depends on.

Use `waitForQuiet()` narrowly. “No recent screen change” does not prove that an
application finished its work. It is useful when a pointer target or snapshot
needs a moving layout to settle.

## Wait for the render after raw input

Low-level tests can capture a revision before input and wait for a later one:

```ts
const before = app.checkpoint();
await app.keyboard.press('Tab');
await app.waitForRender({ after: before.screenRevision });
```

Prefer an assertion on the intended result when one exists. It explains the
behavior and cannot pass on an unrelated render.

## Actions and assertions wait for different things

An action can wait for its locator to resolve and become actionable. It does not
wait for the application-specific result of the input. Assert that result:

```ts
await save.activate();
await expect(app).toHaveText('Saved');
```

Termwright does not repeat an action after physical input begins.

## Whole-test retries

The `--retry` option reruns an entire failed test. It is separate from matcher
waiting:

```sh
npx termwright test -- --retry=2
```

This allows up to three attempts. If a later attempt passes, the run is marked
flaky and exits non-zero. Use retries to gather failure traces, not to make an
unstable test pass in CI.

## Related pages

- [Assert and wait](../../guides/assertions/)
- [Debug an assertion timeout](../../tools/debugging/)
- [Configure timeouts](../../reference/configuration/#set-timeouts)
