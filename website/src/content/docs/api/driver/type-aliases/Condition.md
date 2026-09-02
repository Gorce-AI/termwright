---
title: "Type Alias: Condition"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / Condition

# Type Alias: Condition

> **Condition** = \{ `kind`: `"attached"`; `target`: `string`; \} \| \{ `kind`: `"detached"`; `target`: `string`; \} \| \{ `kind`: `"displayed"`; `target`: `string`; \} \| \{ `kind`: `"hidden"`; `target`: `string`; \} \| \{ `kind`: `"visible"`; `target`: `string`; \} \| \{ `kind`: `"in-viewport"`; `minRatio`: `number`; `target`: `string`; \} \| \{ `kind`: `"offscreen"`; `target`: `string`; \} \| \{ `kind`: `"receives-pointer"`; `target`: `string`; \} \| \{ `kind`: `"pointer-region"`; `target`: `string`; \} \| \{ `kind`: `"pointer-input"`; `target`: `string`; \} \| \{ `kind`: `"mouse-input-enabled"`; `target`: `string`; \} \| \{ `kind`: `"enabled"`; `target`: `string`; \} \| \{ `kind`: `"disabled"`; `target`: `string`; \} \| \{ `kind`: `"focused"`; `target`: `string`; \} \| \{ `kind`: `"checked"`; `target`: `string`; `value`: `boolean`; \} \| \{ `kind`: `"selected"`; `target`: `string`; `value`: `boolean`; \} \| \{ `kind`: `"expanded"`; `target`: `string`; `value`: `boolean`; \} \| \{ `kind`: `"collapsed"`; `target`: `string`; \} \| \{ `kind`: `"value"`; `matcher`: `ConditionTextMatcher`; `target`: `string`; \} \| \{ `condition`: `Condition`; `kind`: `"not"`; \} \| \{ `conditions`: readonly `Condition`[]; `kind`: `"all"` \| `"any"`; \}

Defined in: protocol/dist/action-model-C3MoitRQ.d.ts:72
