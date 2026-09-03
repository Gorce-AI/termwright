---
title: "Function: configureTermwright()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / configureTermwright

# Function: configureTermwright()

> **configureTermwright**(`config`): [`ResolvedTermwrightConfig`](../../interfaces/resolvedtermwrightconfig/)

Defined in: [test/src/config.ts:399](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/config.ts#L399)

Installs the project configuration. Call it from a Vitest `setupFiles`
module; every fixture and matcher created afterwards observes it.

## Parameters

### config

[`TermwrightConfig`](../../interfaces/termwrightconfig/)

## Returns

[`ResolvedTermwrightConfig`](../../interfaces/resolvedtermwrightconfig/)

## Example

```ts
// vitest.setup.ts
import { configureTermwright } from '@termwright/test';
import config from './termwright.config.js';

configureTermwright(config);
```
