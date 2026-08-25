---
title: "Function: registerTermwrightMatchers()"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / registerTermwrightMatchers

# Function: registerTermwrightMatchers()

> **registerTermwrightMatchers**(): `void`

Defined in: [test/src/matchers.ts:1175](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/matchers.ts#L1175)

Registers the matchers with Vitest's `expect`. Importing `@termwright/test`
calls this for you; it is exported for setups that build their own entry
point. Calling it twice is a no-op.

## Returns

`void`
