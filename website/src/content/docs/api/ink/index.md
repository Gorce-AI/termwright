---
title: "@termwright/ink"
editUrl: false
---

**@termwright/ink**

***

# @termwright/ink

`@termwright/ink` provides Ink annotations and component testing through one
public package.

[mountInk](functions/mountink/) runs a component in the current process;
[launchInkFixture](functions/launchinkfixture/) runs a component in a real pseudo-terminal. Both
return the same terminal harness used by end-to-end tests.

## Example

```tsx
import {mountInk, Semantic} from '@termwright/ink';

const harness = await mountInk(
  <Semantic role="button" name="Approve"><Text>Approve</Text></Semantic>,
);
await harness.press('Enter');
await harness.close();
```

## Interfaces

- [InkFixtureHarness](interfaces/inkfixtureharness/)
- [InkHarness](interfaces/inkharness/)
- [InkSemanticAnnotation](interfaces/inksemanticannotation/)
- [LaunchInkFixtureOptions](interfaces/launchinkfixtureoptions/)
- [MountInkOptions](interfaces/mountinkoptions/)
- [SemanticProps](interfaces/semanticprops/)
- [SettleOptions](interfaces/settleoptions/)

## Type Aliases

- [JsonProps](type-aliases/jsonprops/)
- [JsonValue](type-aliases/jsonvalue/)
- [MountInkRenderOptions](type-aliases/mountinkrenderoptions/)
- [SemanticChild](type-aliases/semanticchild/)

## Functions

- [launchInkFixture](functions/launchinkfixture/)
- [mountInk](functions/mountink/)
- [Semantic](functions/semantic/)
- [useSemantic](functions/usesemantic/)
