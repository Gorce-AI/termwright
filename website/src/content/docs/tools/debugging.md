---
title: Debug a failing test
description: Diagnose locator, input, assertion, process, semantic, and CI failures with the Runner, traces, and reports.
---

Start with the failure message. Termwright includes the expectation, observed
state, timeout, matching candidates, terminal excerpt, and process diagnostics
when they are available.

If the suite cannot start at all, run `npx termwright doctor` first. It checks
the project-local Vitest installation, PTY backend, locale, and artifact access.

## A locator finds nothing

**Check:**

1. Wait for text that proves the application reached the expected screen.
2. Open the Runner inspector and confirm that a semantic tree exists.
3. Check the role, accessible name, and scope shown in the tree.

**Common causes:** the framework integration was not enabled, the framework does not retain
that semantic fact, the element is on an inactive screen, or the accessible
name differs from its visual decoration.

```ts
await app.waitForText('Permission required');
await expect(app.getByRole('button', { name: 'Approve' })).toBeAttached();
```

Use a screen assertion when the program has no semantic integration.

## A locator matches more than one element

Narrow by name or scope:

```ts
const dialog = app.getByRole('dialog', { name: 'Delete note' });
const confirm = app.getByRole('button', { name: 'Delete' }).within(dialog);
```

Avoid `first()` unless position is the intended behavior. See
[Handling multiple matches](../../guides/locators/#handle-multiple-matches).

## Input did not change the application

- For keyboard input, confirm that the intended control is focused.
- Send separate interactions as separate `press()` calls.
- For pointer input, inspect `hitTest()` and the framework capability matrix.
- Use `waitForQuiet()` before a geometry-dependent action if layout is moving.

```ts
await expect(save).toBeFocused();
await save.press('Enter');
await expect(app).toHaveText('Saved');
```

## An assertion times out

Open the Runner and rerun the case. The execution timeline shows the current
step and action while the terminal remains live. After the run, scrub the
replay to the failing marker and inspect semantic state at the same time.

Do not fix a timeout by adding a sleep. Determine whether the expected state
never occurred, occurred in a different session, or requires a larger explicit
timeout because the operation itself is slow.

## Visibility is unknown or unsupported

`toBeVisible()` requires qualified viewport information. An unsupported or
unknown observation fails both the positive and negated assertion.

Use `toBeAttached()` if tree membership is the behavior you need. Do not replace
visibility with attachment when on-screen rendering is the actual requirement.
See [Geometry and visibility](../../reference/geometry-visibility/).

## The application exits unexpectedly

Termwright reports the exit code or signal, recent terminal output, and the
trace path. Open the retained recording:

```sh
termwright ui --trace termwright-report/traces/<trace>.twtrace
```

Use the crash marker to inspect the terminal, semantic tree, and logs at the
failure time.

## CI differs from local

Check the Node version, terminal profile, viewport size, environment, and input
files. First reproduce the certifying configuration with no retries:

```sh
CI=true TERMWRIGHT_RETRIES=0 pnpm test -- --resource-profile ci
```

After reproducing the failure, a non-certifying diagnostic run may use
`TERMWRIGHT_RETRIES=2`. Termwright preserves every failed attempt and returns a
non-zero flaky result even if a later attempt passes.

Download the CI HTML report and trace artifacts instead of relying only on the
terminal log. See [Run tests in CI](../../guides/ci/).

## Collect more evidence

- Set `TERMWRIGHT_DEBUG=1` for driver decisions and waits.
- Use `trace: 'on'` temporarily to retain successful runs.
- Retain a trace and run `termwright report --trace …` for a self-contained HTML artifact.
- Inspect application logs in the Runner; dropped records are shown explicitly.

[Traces and reports →](../traces-reports/)
