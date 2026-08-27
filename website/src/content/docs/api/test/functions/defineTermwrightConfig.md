---
title: "Function: defineTermwrightConfig()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / defineTermwrightConfig

# Function: defineTermwrightConfig()

> **defineTermwrightConfig**(`config`): [`TermwrightConfig`](../../interfaces/termwrightconfig/)

Defined in: [test/src/config.ts:272](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L272)

Validates a configuration object and returns it unchanged.

Exists for the same reason as Vite's `defineConfig`: type inference in a
plain `termwright.config.ts`, plus eager validation of the values that would
otherwise fail deep inside a test run.

## Parameters

### config

[`TermwrightConfig`](../../interfaces/termwrightconfig/)

## Returns

[`TermwrightConfig`](../../interfaces/termwrightconfig/)

## Example

```ts
export default defineTermwrightConfig({
  columns: 100,
  rows: 30,
  trace: 'retain-on-failure',
  profiles: { ci: { trace: 'on', palette: XTERM_PALETTE } },
});
```
