# `@termwright/gherkin`

Run physical Gherkin `.feature` files as native `@termwright/test` cases. The
package is a Vite/Vitest transform: it parses the feature and emits the test
module in memory, so it does not create generated source files or introduce a
second test scheduler. Parsing and expressions use the official Cucumber
libraries, pinned exactly to compatible versions in this package:
`@cucumber/gherkin@42.0.1`, `@cucumber/messages@34.2.1`, and
`@cucumber/cucumber-expressions@20.1.0`.

## Setup

Add the plugin and include `.feature` files explicitly in the Vitest config:

```ts
import { defineConfig } from 'vitest/config';
import { gherkinPlugin } from '@termwright/gherkin';

export default defineConfig({
  plugins: [gherkinPlugin({
    featureRoot: 'tests/features',
    stepDefinitions: [
      '[filepath].steps.{ts,tsx,mts}',
      '[filepart]/step_definitions/**/*.{ts,tsx,mts}',
      '../step_definitions/**/*.{ts,tsx,mts}',
    ],
  })],
  test: {
    include: ['tests/**/*.test.ts', 'tests/features/**/*.feature'],
  },
});
```

This explicit config is for ordinary `vitest run` and IDE Vitest integrations.
It does not alter their normal `.test.ts` discovery unless the project opts in.
`termwright ui` installs the same plugin in its owned Vitest host and adds
physical `.feature` files to that host's discovery automatically, alongside
provider-owned `.test.ts` cases in one catalogue and the existing Termwright
runner UI; it does not start a separate Gherkin runner or UI. Catalogue entries
carry an explicit Gherkin kind, Feature/Rule ancestry, tags, and physical source
line rather than reconstructing structure from a test title.

## Step definitions

A paired module default-exports inert definitions. They are scoped to the
feature which imported them; nothing is registered process-wide.

```ts
import { Given, Then, When, defineSteps } from '@termwright/gherkin';

export default defineSteps(
  Given('a starting value of {int}', ({ world }, value) => {
    world.value = value;
  }),
  When('I add {int}', ({ world }, amount) => {
    world.value = Number(world.value) + Number(amount);
  }),
  Then('the result is {int}', ({ expect, world }, total) => {
    expect(world.value).toBe(total);
  }),
);
```

The first callback argument contains the native Termwright fixtures
(`terminal`, `termwright`, `termwrightOptions`, and `step`), Vitest `expect`, a
fresh mutable `world` for the Scenario/Outline row, and physical Scenario
metadata. Captures follow it. A DocString or DataTable, when present, is the
last argument.

`defineParameterType(...)` declares a custom Cucumber Expression parameter
type without global registration. `Step(...)` declares a keyword-neutral step;
`Given`, `When`, and `Then` provide readable authoring names but, like
Cucumber, matching is based on the expression rather than the feature keyword.

## Pairing and precedence

Patterns are resolved relative to `featureRoot`:

- `[filepath]` is the complete relative feature path without `.feature`.
- `[filepart]` expands from nearest to farthest. For
  `foo/bar/baz.feature`, it expands as `foo/bar/baz`, `foo/bar`, `foo`, then
  `.`.
- A pattern without either token is global.

For each feature step, the first tier containing a match wins: `[filepath]`,
then each `[filepart]` distance, then global. More than one match in that same
nearest tier is an error. Files and matches are sorted deterministically.
Paired files are registered as Vite watch dependencies, and a glue hot update
also invalidates its importing feature module. Pattern roots are watched and
pairing is resolved again when matching glue is created, deleted, or renamed.

Every Scenario and every Scenario Outline example row becomes its own native
`test`. Outline rows receive a deterministic `[example N]` suffix so each row
has its own catalogue id and rerun target even when the Outline title contains
no placeholders. Background and feature steps run through Termwright's
`step()` fixture. The emitted source map points test declarations to the
physical Scenario line and step calls to their physical Gherkin lines.

Those boundaries are first-class UI events, not labels reconstructed from a
generated Vitest title. While a Scenario runs, the runner receives the keyword,
prose, physical `file:line:column`, outcome, and stable step id. A terminal
launched inside `Given` joins the already-open step, so its live screen and
driver actions appear beneath the authored prose. The same ids and metadata are
retained in the trace for replay. A Scenario without a terminal or driver
actions still shows its Given/When/Then lifecycle; the UI does not invent an
empty terminal session for it.

## Current slice

This package currently exposes the plugin, step definitions, custom parameter
types, Background, Scenarios, Scenario Outlines, DocStrings, and DataTables.
The `termwright ui` host uses it for discovery, Run all, file/Scenario runs and
reruns without writing generated source files. Hooks, tag filtering, and editor
configuration are not part of this slice.
