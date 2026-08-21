---
title: Gherkin scenarios
description: Write terminal workflows in physical .feature files and run them beside TypeScript tests.
---

Use Gherkin when product behavior is already discussed and reviewed as feature
prose. TypeScript tests remain the simpler default for most test suites.

Termwright runs each Scenario as a normal Vitest case with the same terminal,
step, retry, trace, report, and Runner behavior as a `.test.ts` case.

## Install Termwright

The umbrella package includes the Gherkin authoring API and Runner integration:

```sh
npm install --save-dev termwright vitest
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
import {fileURLToPath} from 'node:url';
import type {TerminalHarness} from 'termwright';
import {Given, Then, When, defineSteps} from 'termwright/gherkin';

const program = fileURLToPath(new URL('../../src/permission.js', import.meta.url));

export default defineSteps(
  Given('the permission terminal is running', async ({terminal, world}) => {
    world.app = await terminal.launch({command: [process.execPath, program]});
    await world.app.waitForText('Permission required');
  }),
  When('I approve the command', async ({world}) => {
    await (world.app as TerminalHarness).press('Enter');
  }),
  Then('the command should start', async ({expect, world}) => {
    await expect(world.app as TerminalHarness).toHaveText('running: ls -la');
  }),
);
```

Each Scenario gets a fresh `world`. The step context also provides `terminal`,
`step`, `expect`, resolved Termwright options, and Scenario metadata.

## Run Gherkin in the Runner

```sh
npx termwright ui
```

Runner discovers `.feature` files automatically. Scenarios appear beside
TypeScript cases in Specs. You can run a directory, feature file, Scenario, or
the complete catalog. Authored Given/When/Then prose appears in the execution
timeline, with driver actions and assertions nested below the matching step.

No generated TypeScript files or separate Cucumber process are required.

## Run with Vitest and an IDE

Direct Vitest and IDE runs require the plugin and an explicit `.feature`
include:

```ts
// vitest.config.ts
import {gherkinPlugin} from 'termwright/gherkin';
import {defineConfig} from 'vitest/config';

export default defineConfig({
  plugins: [gherkinPlugin({
    featureRoot: 'tests/features',
    stepDefinitions: ['[filepath].steps.{ts,tsx,mts}'],
  })],
  test: {
    include: ['tests/**/*.test.ts', 'tests/features/**/*.feature'],
  },
});
```

Then use normal Vitest selection:

```sh
npx vitest run tests/features/command-approval.feature
```

## Use Background and Scenario Outline

`Background`, `Rule`, `Scenario Outline`, `Examples`, DocStrings, and DataTables
are supported. Background steps run before the Scenario and remain visible as
authored steps in Runner.

Use `Background` for setup shared by Scenarios in one feature. Use normal
Termwright fixtures for reusable application setup across feature files.

## Current limitations

Gherkin hooks, tag-based run filtering, and a Termwright-specific editor
extension are not available. Tags are retained as Scenario metadata. Use
Background, step definitions, fixtures, and Vitest or Runner run scopes for the
supported workflows.

For expressions, step pairing, ambiguity, Scenario Outline identity, and the
transform contract, see [Gherkin reference](../../reference/gherkin/).
