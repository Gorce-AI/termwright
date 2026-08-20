---
title: Waiting and retries
description: Understand when Termwright waits, what assertions retry, and how test retries differ from actionability waits.
---

Termwright waits for observable changes instead of sleeping for a fixed delay.
The relevant event may be a terminal screen revision, semantic revision,
process event, or render marker.

## Wait for the state you need

```ts
await app.waitForText('Ready');
await expect(app.getByRole('button', {name: 'Save'})).toBeFocused();
```

The assertion retries until it passes or reaches the expect timeout. This
covers the normal gap between terminal output and the semantic revision for the
same application frame.

## Explicit waits

| Wait | Use when |
| --- | --- |
| `waitForText()` | The terminal grid must contain text. |
| `locator.waitFor()` | A semantic node must become attached, hidden, or visible. |
| `waitForReady()` | The application reaches a prompt or a quiet initial screen. |
| `waitForStable()` | Geometry must stop changing before an action. |
| `waitForRender()` | You need a revision newer than a known screen revision. |
| `waitForExit()` | Process termination is the expected result. |
| `settled()` | Code must branch on whether semantic negotiation succeeded. |

Avoid `setTimeout()` and fixed sleeps. They wait too long on fast machines and
remain too short on slow ones.

## Action retries and assertion retries

An action may retry while its target is resolving or becoming actionable. It
does not wait for an arbitrary application outcome. Assert that outcome after
the action.

```ts
await save.activate();
await expect(app).toHaveText('Saved');
```

## Test retries

Vitest schedules whole-case retries. Configure them with `test.retry`, the
`--retry` CLI flag, or `termwrightRetry()`:

```ts
retry: termwrightRetry({ci: 2, local: 0})
```

This is separate from matcher polling. Reports retain the ordered reasons from
earlier failed attempts and mark a final pass as flaky.
