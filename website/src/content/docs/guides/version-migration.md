---
title: Version migration
description: Update applications that used Termwright's earlier in-process framework adapters.
---

This page applies only to projects that used Termwright framework adapters
before the current integration model. New projects should start from the
[framework integration overview](../../adapters/).

Current integrations observe the framework from the launched process. The
application keeps only optional annotations for meaning the framework cannot
expose. Remove application code that starts or owns instrumentation.

| Earlier setup | Current setup |
|---|---|
| Ink `semanticRender()` | normal Ink `render()` plus `@termwright/probe-ink` in the test launcher |
| OpenTUI `instrumentRenderer()` | normal renderer plus `@termwright/probe-opentui` in the test launcher |
| Textual `enable_semantics()` or `TermwrightApp` | ordinary Textual `App` launched through `termwright_probe` |
| tview `termwright.Attach()` | unchanged application built with `prepareInstrumentedBuild()` |

Do not copy geometry, focus, visibility, rendered text, value, selection, or
framework state into annotations. The integration observes those facts.
Annotations are for application-owned names, roles, test ids, relationships,
actions, and domain data.

## Ink

Restore the ordinary Ink renderer:

```tsx
import {render} from 'ink';

render(<App />, {alternateScreen: true});
```

Use `withProbe()` from `@termwright/probe-ink` when constructing the test
command. Existing `useSemantic()` and `<Semantic>` annotations can remain after
removing fields that duplicate observed framework state.

See [Ink](../../adapters/ink/) for the current launch and annotation examples.

## OpenTUI

Remove `instrumentRenderer()` and let the application construct its normal
renderer. Use `withProbe()` from `@termwright/probe-opentui` in the test
launcher.

`describeRenderable()` remains available for optional application meaning. It
must not override geometry, clipping, focus, text, value, or selection.

See [OpenTUI](../../adapters/opentui/) for the current setup.

## Textual

Remove `enable_semantics()` and the `TermwrightApp` mixin. Launch the ordinary
application through the Python integration:

```ts
const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', appPath],
});
```

Replace `termwright_role`, `termwright_name`, and `termwright_test_id`
convention attributes with `@semantic(...)` or `annotate(...)` only where
Textual cannot expose the required application meaning itself.

See [Textual](../../adapters/textual/) for the current setup.

## tview

Remove `termwright.Attach()` and its `WithChildren`, `WithDescriber`,
`WithTestIDs`, and `SetTestID` options. Prepare an instrumented copy of the
supported tview version before building:

```ts
const build = await prepareInstrumentedBuild({moduleDir});
await execFile('go', ['build', '-o', binaryPath, '.'], {
  cwd: moduleDir,
  env: {...process.env, ...build.env},
});
```

Use the Go annotation SDK for application-owned names, test ids, relationships,
actions, and domain data. The integration owns component structure and
geometry.

See [tview](../../adapters/tview/) for the current build workflow.
