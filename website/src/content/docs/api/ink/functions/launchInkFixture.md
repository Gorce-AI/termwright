---
title: "Function: launchInkFixture()"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / launchInkFixture

# Function: launchInkFixture()

> **launchInkFixture**(`options`): `Promise`\<[`InkFixtureHarness`](../../interfaces/inkfixtureharness/)\>

Defined in: [ink/src/fixture.ts:128](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/fixture.ts#L128)

Starts a fixture process in a real pty and returns a harness over it.

The fixture renders `component`'s export with normal Ink under the same
injected probe a production app uses, in the alternate screen, so its tree
matches what `mountInk` produces for the same element.

## Parameters

### options

[`LaunchInkFixtureOptions`](../../interfaces/launchinkfixtureoptions/)

## Returns

`Promise`\<[`InkFixtureHarness`](../../interfaces/inkfixtureharness/)\>

## Example

```ts
const harness = await launchInkFixture({
  component: new URL('./counter-app.mjs', import.meta.url),
  props: { label: 'Approve' },
  columns: 40,
  rows: 10,
});
await harness.press('Enter');
await harness.waitForText('pressed 1');
await harness.close();
```
