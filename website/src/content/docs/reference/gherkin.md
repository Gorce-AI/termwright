---
title: Gherkin reference
description: Step expressions, pairing rules, Scenario metadata, supported Gherkin constructs, and Vitest integration.
---

`@termwright/gherkin` transforms physical `.feature` files into native
`@termwright/test` cases in memory. Vitest remains the scheduler and no
generated source is written to the project.

## Supported authoring constructs

- Feature, Rule, Background, Scenario, Scenario Outline, and Examples
- Cucumber Expressions and regular expressions
- custom parameter types
- DocStrings and DataTables
- tags as catalog and Scenario metadata
- keyword-neutral `Step()` definitions

The parser, message model, expression engine, and Scenario compilation use the
official Cucumber packages shipped as one compatible dependency set.

## Define steps

Step definitions are inert values in a default export:

```ts
import type {TerminalHarness} from 'termwright';
import {Given, Then, When, defineParameterType, defineSteps} from 'termwright/gherkin';

const priority = defineParameterType({
  name: 'priority',
  regexp: /low|high/,
  transformer: (value) => value,
});

export default defineSteps(
  priority,
  Given('a {priority} priority command', ({world}, value) => {
    world.priority = value;
  }),
  When(/I press (.+)/, async ({world}, key) => {
    await (world.app as TerminalHarness).press(String(key));
  }),
  Then('the command starts', async ({expect, world}) => {
    await expect(world.app as TerminalHarness).toHaveText('running');
  }),
);
```

Captured expression values follow the context argument. A DocString is the
final string argument. A DataTable is the final two-dimensional string array.

## Step context

Every Scenario receives a fresh mutable `world`. The context also contains:

- `terminal` and resolved Termwright options;
- `step`, so authored Gherkin steps share the normal trace timeline;
- `expect`;
- `scenario`, including feature and Scenario names, URI, line, and tags.

Each Examples row becomes a separate case with a stable `[example N]` suffix.

## Pair step definitions

Pairing patterns are resolved relative to `featureRoot`:

- `[filepath]` is the complete feature path without `.feature`;
- `[filepart]` walks from the feature path toward the root, nearest first;
- patterns without either token are global.

For `accounts/admin/login.feature`, `[filepart]` checks
`accounts/admin/login`, `accounts/admin`, `accounts`, then `.`. The nearest tier
with a matching expression wins. Two matches in that tier fail with an
ambiguity error naming both definitions.

Created, removed, renamed, or edited paired files invalidate the feature during
watch mode.

## Runner-owned Vitest host

`termwright ui` installs the transform and projects `.feature` discovery from
the resolved Vitest include patterns. TypeScript cases and Scenarios share one
catalog, reporters, retries, run scopes, and rerun contract.

Source locations point to the physical feature and step lines. The UI does not
expose synthetic transformed JavaScript.

## Direct Vitest configuration

Direct Vitest and IDE runs must add `gherkinPlugin()` and include `.feature`
files. See [Gherkin scenarios](../../guides/gherkin/#run-with-vitest-and-an-ide)
for a complete configuration.

## Unsupported behavior

The current integration does not provide Cucumber hooks, tag-expression run
filtering, or an editor extension. It does not run a Cucumber scheduler or
write a generated-test directory.
