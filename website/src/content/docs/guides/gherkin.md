---
title: Gherkin scenarios
description: Write terminal workflows in physical .feature files and run them beside TypeScript tests.
---

Use Gherkin when product behavior is already discussed and reviewed as feature
prose. TypeScript tests remain the simpler default for most test suites.

Termwright runs each Scenario as a normal Termwright test case with the same terminal,
step, retry, trace, report, and Runner behavior as a `.test.ts` case.

## Install Termwright

The umbrella package includes the Gherkin authoring API and Runner integration:

```sh
npm install --save-dev termwright
```

## Write a terminal scenario

```gherkin
# tests/features/command-approval.feature
Feature: Command approval

  Scenario: Approve a command
    Given the permission terminal is running
    When I approve the command
    Then the command should start
```

Pair the feature with a step-definition module:

```ts
// tests/features/command-approval.steps.ts
import { fileURLToPath } from 'node:url';
import type { TerminalHarness } from 'termwright';
import { Given, Then, When, defineSteps } from 'termwright/gherkin';

const program = fileURLToPath(new URL('../../src/permission.js', import.meta.url));

export default defineSteps(
  Given('the permission terminal is running', async ({ terminal, world }) => {
    world.app = await terminal.launch({ command: [process.execPath, program] });
    await world.app.waitForText('Permission required');
  }),
  When('I approve the command', async ({ world }) => {
    await (world.app as TerminalHarness).press('Enter');
  }),
  Then('the command should start', async ({ expect, world }) => {
    await expect(world.app as TerminalHarness).toHaveText('running: ls -la');
  }),
);
```

Each Scenario gets a fresh `world`. The step context also provides `terminal`,
`step`, `expect`, resolved Termwright options, and Scenario metadata.

The generated module imports only `termwright/test` and
`termwright/gherkin/runtime`. A project using a strict package manager does not
need to add Termwright's internal packages beside the umbrella package.

## Manage scenario setup and resources

Use `Before` and `After` for setup tied to each Scenario. Hooks are inert values
in the step-definition module nearest the feature; they do not register
process-global state.

```ts
import { After, Before, Given, defineSteps } from 'termwright/gherkin';

export default defineSteps(
  Before(async ({ terminal, world }) => {
    world.app = await terminal.launch({ command: [process.execPath, program] });
  }),
  After(({ world }) => {
    world.app = undefined;
  }),
  Given('the application is ready', async ({ world }) => {
    await (world.app as TerminalHarness).waitForText('Permission required');
  }),
);
```

Programs created by `terminal.launch()` already close after the Scenario. For a
component helper or custom integration that returns `TerminalHarness`, attach
it to the same fixture:

```ts
Before(async ({terminal, world}) => {
  world.app = await terminal.attach(await mountInk(<Permission />), {
    command: ['<mountInk>'],
  });
});
```

The attached harness participates in Runner live state, trace recording,
application logs, crash reporting, and automatic teardown. This contract is
framework-neutral. Use `defer(cleanup)` or `use(resource)` for other
scenario-scoped resources; cleanup runs in reverse order after `After` hooks,
including after a failed step.

Hooks accept a Cucumber tag expression when setup applies only to part of the
suite:

```ts
Before({ tags: '@component and not @slow' }, async (context) => {
  // scenario-scoped setup
});
```

## Pass project fixtures into steps

For an explicit plugin configuration, export a project-owned extended test
alongside `describe` and `expect`:

```ts title="tests/fixtures.ts"
import { describe, expect, test as base } from 'termwright/test';

export { describe, expect };
export interface ProjectFixtures {
  account: { name: string };
}
export const test = base.extend<ProjectFixtures>({
  account: async ({}, use) => {
    await use({ name: 'Ada' });
  },
});
```

Point `generatedImports.test` at that module and list the custom fixtures. The
list makes Vitest request them statically, preserving its native setup and
teardown lifecycle.

```ts title="vitest.config.ts"
import { fileURLToPath } from 'node:url';
import { gherkinPlugin } from 'termwright/gherkin';
import type { ProjectFixtures } from './tests/fixtures';

gherkinPlugin<ProjectFixtures>({
  fixtureNames: ['account'],
  generatedImports: {
    test: fileURLToPath(new URL('./tests/fixtures.ts', import.meta.url)),
    runtime: 'termwright/gherkin/runtime',
  },
});
```

Use the project fixture type on authored definitions:

```ts
Given<ProjectFixtures>('an account exists', ({ account, world }) => {
  world.name = account.name;
});
```

Gherkin `After` hooks and `defer`/`use` cleanup complete before the custom
fixture tears down. Fixtures on which it depends, including `terminal`, remain
alive through that teardown.

## Run Gherkin in the Runner

```sh
npx termwright ui
```

Runner discovers `.feature` files automatically. Scenarios appear beside
TypeScript cases in Specs. You can run a directory, feature file, Scenario, or
the complete catalog. Authored Given/When/Then prose appears in the execution
timeline, with driver actions and assertions nested below the matching step.

No generated TypeScript files or separate Cucumber process are required.

## Configure the embedded engine and editor

The Termwright host loads the project's Vite/Vitest configuration. Add the
plugin and an explicit `.feature` include there; execute through Termwright:

```ts
// vitest.config.ts
import { gherkinPlugin } from 'termwright/gherkin';

export default {
  plugins: [
    gherkinPlugin({
      featureRoot: 'tests/features',
      stepDefinitions: ['[filepath].steps.{ts,tsx,mts}'],
    }),
  ],
  test: {
    include: ['tests/**/*.test.ts', 'tests/features/**/*.feature'],
  },
};
```

Select the feature through the Termwright host:

```sh
npx termwright test -- tests/features/command-approval.feature
```

## Filter scenarios by tag

Runner-owned execution accepts standard Cucumber tag expressions:

```sh
npx termwright ui --tags '@e2e and not @slow'
```

Filtering happens during feature collection, so excluded Scenario and Outline
rows do not enter the test suite.

## Use Background and Scenario Outline

`Background`, `Rule`, `Scenario Outline`, `Examples`, DocStrings, and DataTables
are supported. Background steps run before the Scenario and remain visible as
authored steps in Runner.

Use `Background` for setup shared by Scenarios in one feature. Use normal
Termwright fixtures for reusable application setup across feature files.

## Editor support and step diagnostics

The source of every case and step remains the physical `.feature` line, so
Vitest output and Runner's Open source action return to authored prose. Install
the official [Cucumber for VS Code](https://github.com/cucumber/vscode)
extension (`CucumberOpen.cucumber-official`) and align its source globs with
Termwright:

```json title=".vscode/settings.json"
{
  "cucumber.features": ["**/*.feature"],
  "cucumber.glue": [
    "**/*.steps.{ts,tsx,mts}",
    "**/*.feature.{ts,tsx,mts}",
    "**/step_definitions/**/*.{ts,tsx,mts}"
  ]
}
```

The Cucumber language server then provides completion, undefined-step
diagnostics, and navigation from a physical feature step to the matching
`Given`/`When`/`Then` call. Termwright independently validates undefined and
same-tier ambiguous definitions during collection, before a scenario body can
run, so editor feedback is not the test suite's correctness boundary.

For expressions, step pairing, ambiguity, Scenario Outline identity, and the
transform contract, see [Gherkin reference](../../reference/gherkin/).
