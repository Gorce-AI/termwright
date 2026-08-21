---
title: "Function: mountInk()"
editUrl: false
---

[**@termwright/ink**](../../)

***

[@termwright/ink](../../) / mountInk

# Function: mountInk()

> **mountInk**(`element`, `options?`): `Promise`\<[`InkHarness`](../../interfaces/inkharness/)\>

Defined in: [ink/src/mount.tsx:148](https://github.com/Gorce-AI/termwright/blob/main/packages/ink/src/mount.tsx#L148)

Mounts an Ink element in this process and returns a harness over it.

The component runs against a headless VT emulator fed by Ink's own output, so
everything the driver offers a real terminal applies here: `getByRole`,
viewport cells and `press()` as key bytes. No callback is ever invoked
directly on the component — asserting a prop spy *after* physical input is
the point. Ink currently leaves occlusion unknown, so semantic click is
deliberately refused; drive activation with the keyboard.

The mount resolves once the first frame has been published, so locators work
immediately.

## Parameters

### element

`ReactNode`

### options?

[`MountInkOptions`](../../interfaces/mountinkoptions/) = `{}`

## Returns

`Promise`\<[`InkHarness`](../../interfaces/inkharness/)\>

## Example

```tsx
const onPress = vi.fn();
const harness = await mountInk(<Approve onPress={onPress} />, { columns: 40, rows: 10 });
await harness.press('Tab');
await harness.waitForStable();
await harness.press('Enter');
await harness.waitForText('approved');
await vi.waitFor(() => expect(onPress).toHaveBeenCalledOnce());
await harness.close();
```
