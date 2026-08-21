---
title: "Type Alias: TextMatcher"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TextMatcher

# Type Alias: TextMatcher

> **TextMatcher** = \{ `kind`: `"exact"`; `text`: `string`; \} \| \{ `kind`: `"substring"`; `text`: `string`; \} \| \{ `kind`: `"regex"`; `source`: `RegExp`; \}

Defined in: [selectors.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/selectors.ts#L17)

How a piece of text is compared.
