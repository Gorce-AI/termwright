---
title: Debug a failed test
description: Diagnose startup, locator, input, assertion, process, and CI failures.
---

Start with the failure message. Operation failures include the timeout, observed
state, and relevant terminal or process details when available. Then open the
test in the Runner when you need to see how that state developed:

```sh
npx termwright ui
```

## The suite does not start

Run the environment check:

```sh
npx termwright doctor
```

It reports unsupported Node or operating-system versions, a missing native PTY
backend, and problems loading the test engine. Fix these before debugging the
test itself.

## A locator finds nothing

1. Wait for text that proves the application reached the expected screen.
2. Open the Runner's semantic tree and check whether the element exists.
3. Compare its role, accessible name, and parent with the locator.

```ts
await app.waitForText('Permission required');
await expect(app.getByRole('button', { name: 'Approve' })).toBeAttached();
```

If the Runner has no semantic tree, check that the framework integration is
installed and enabled. An uninstrumented application still supports
`waitForText()` and `getByScreenText()`. `getByText()` is a semantic locator and
does require an integration.

## A locator matches more than one element

Narrow it by name or semantic container:

```ts
const dialog = app.getByRole('dialog', { name: 'Delete note' });
const confirm = app.getByRole('button', { name: 'Delete' }).within(dialog);
```

Avoid `first()` unless order is the behavior under test. The ambiguity error
lists matching candidates to help you choose a stable distinction.

## Input has no effect

- For keyboard input, check which element is focused.
- Send keys separately if the application must rerender between them.
- For mouse input, confirm that the application enabled mouse reporting.
- Check whether the integration supports an exact pointer target.
- Use `waitForQuiet()` when a moving layout must settle before a
  coordinate-dependent action.

```ts
await expect(save).toBeFocused();
await save.press('Enter');
await expect(app).toHaveText('Saved');
```

See [Send input](../../guides/actions/) for semantic click requirements and
low-level coordinate input.

## An assertion times out

Replay the test and seek to the failing assertion. Check whether the expected
state:

- never appeared;
- appeared in another terminal session;
- used a different role, name, or value;
- appeared after a genuinely long operation; or
- could not be observed by the current integration.

Do not add a sleep. Fix the observed condition, or set a larger timeout on the
specific assertion when the operation has a known longer duration.

## Visibility is unavailable

`toBeVisible()` needs geometry and viewport information from the integration.
If that fact is unsupported, both the positive and negated visibility assertion
fail.

Use `toBeAttached()` only when semantic-tree membership is what you mean. Check
[geometry and visibility support](../../reference/geometry-visibility/) before
depending on viewport assertions.

## The application exits unexpectedly

The failure includes the exit code or signal and recent terminal output. Open
the retained trace to inspect the last screen and any application logs:

```sh
npx termwright ui --trace path/to/run.twtrace
```

If the process is expected to exit, wait for it explicitly and assert its
status rather than performing another terminal action afterward.

```ts
expect(await app.waitForExit()).toEqual({ code: 0, signal: null });
```

## CI fails but local development passes

Compare:

- Node version;
- operating system and architecture;
- terminal columns, rows, and profile;
- environment variables and input files;
- framework and integration versions.

Reproduce CI without retries:

```sh
CI=true TERMWRIGHT_RETRIES=0 npx termwright test --resource-profile ci
```

Use `--resource-profile windows-ci` on Windows.

Download the retained trace or HTML report from the failing job. A diagnostic
run may use `-- --retry=2`, but a fail-then-pass result remains flaky and exits
non-zero.

## Collect more detail

- Set `TERMWRIGHT_DEBUG=1` to print API calls, waits, and diagnostics.
- Temporarily set `trace: 'on'` to retain a successful run.
- Generate a self-contained report with `npx termwright report --trace …`.
- Inspect structured application logs in the Runner.

Debug output can contain application data. Inspect it before publishing a CI
log or attaching it to an issue.

[Open traces and reports →](../traces-reports/)
