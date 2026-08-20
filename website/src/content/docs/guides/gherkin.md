---
title: Gherkin feature files
description: Run physical .feature files as native Termwright and Vitest tests, with local step definitions and no generated source files.
---

`@termwright/gherkin` makes a physical `.feature` file a native
`@termwright/test` suite. It is a Vite/Vitest transform, not another runner:
the transformed module exists only in memory, Vitest remains the scheduler, and
no generated `.ts` files are written into the project.

Parsing, pickle compilation and expressions come from the official Cucumber
libraries, pinned by this package as a compatible set:
`@cucumber/gherkin@42.0.1`, `@cucumber/messages@34.2.1` and
`@cucumber/cucumber-expressions@20.1.0`.

## Install and run

The `termwright` umbrella contains both the Gherkin API and the UI integration:

```sh
npm install --save-dev termwright vitest
termwright ui
```

There is no feature compiler to run first and no generated-test directory to
add to `.gitignore`. The UI-owned Vitest host discovers `.feature` files,
transforms them in memory and lists their Scenarios beside provider-owned
`.test.ts` cases. Do not add a `pretest`, `predev` or `bddgen` step for this
path.

## One feature and its steps

```gherkin
# tests/features/arithmetic.feature
Feature: arithmetic

  Background:
    Given a starting value of 2

  Rule: addition preserves arithmetic
    Scenario Outline: add an amount
      When I add <amount>
      Then the result is <total>

      Examples:
        | amount | total |
        | 3      | 5     |
        | 4      | 6     |
```

```ts
// tests/features/arithmetic.steps.ts
import {Given, Then, When, defineSteps} from 'termwright/gherkin';

export default defineSteps(
  Given('a starting value of {int}', ({world}, value) => {
    world.value = value;
  }),
  When('I add {int}', ({world}, amount) => {
    world.value = Number(world.value) + Number(amount);
  }),
  Then('the result is {int}', ({expect, world}, total) => {
    expect(world.value).toBe(total);
  }),
);
```

Definitions are inert values in a default export, not registrations in a
process-global Cucumber world. Every Scenario, and every examples row of a
Scenario Outline, becomes its own native test with a fresh mutable `world`.
Feature and Rule `Background` steps are included by the Cucumber compiler and
run through Termwright's `step()` fixture before the Scenario steps.

The first callback argument also contains `terminal`, `termwright`,
`termwrightOptions`, `step`, `expect`, and `scenario`. `scenario` identifies the
physical feature name, Scenario name, file URI, line and tags. Captured
Cucumber Expression values follow the context; a DocString becomes the final
string argument and a DataTable becomes the final two-dimensional string
array. Regular expressions, the keyword-neutral `Step(...)`, and local
`defineParameterType(...)` declarations are supported too.

## Pairing is nearest-first

Step-definition patterns are resolved relative to `featureRoot`:

- `[filepath]` is the complete feature path without `.feature`;
- `[filepart]` walks from the feature path towards the root, nearest first;
- a pattern containing neither token is global.

For `accounts/admin/login.feature`, `[filepart]` expands through
`accounts/admin/login`, `accounts/admin`, `accounts`, then `.`. At runtime, the
nearest tier containing a matching expression wins. A farther definition is a
fallback, not an ambiguity. Two matching definitions in the same winning tier
fail with an ambiguity error that names both files and expressions; no
arbitrary match is chosen.

The plugin watches the paired files and the roots implied by the patterns. A
created, deleted or renamed definition is paired again, and editing paired glue
invalidates the importing feature.

## Direct Vitest and IDE runs

Ordinary Vitest is deliberately opt-in. Add the plugin and include physical
features alongside the project's existing TypeScript tests. This is also the
configuration an IDE's Vitest integration needs; Termwright does not install or
configure an editor extension:

```ts
// vitest.config.ts
import {gherkinPlugin} from 'termwright/gherkin';
import {defineConfig} from 'vitest/config';

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

This does not replace normal `.test.ts` discovery. It adds `.feature` modules
to the same Vitest process, so both kinds share reporters, retries and the
Termwright fixtures.

## `termwright ui` needs no Gherkin config

`termwright ui` installs the same transform in the Vitest host it owns and
discovers physical `.feature` files automatically. TypeScript cases and
Gherkin Scenarios appear in one Specs catalogue and use the same Run all, file,
Scenario and rerun paths. It does not start Cucumber or a second UI.

The catalogue receives Feature and Rule ancestry, tags and Scenario kind from
the provider. Scenario declarations map back to their physical `.feature`
line, and step calls map to their physical Gherkin lines, so failures and UI
source actions do not point at synthetic JavaScript. Scenario Outline rows get
stable `[example N]` suffixes, giving every row an independent catalogue id and
rerun target even when its title has no placeholder.

:::caution[Current boundary]
This slice has no Gherkin hooks, tag-filter option or editor extension/config.
Tags are preserved as catalogue and Scenario metadata, but they are not a run
filter. Keep setup in `Background` or step definitions and use Vitest/CLI
scoping for the runs supported today.
:::
