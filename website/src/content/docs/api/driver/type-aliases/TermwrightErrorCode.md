---
title: "Type Alias: TermwrightErrorCode"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TermwrightErrorCode

# Type Alias: TermwrightErrorCode

> **TermwrightErrorCode** = `"timeout"` \| `"stale-snapshot"` \| `"ambiguous-locator"` \| `"unsupported-action"` \| `"history-truncated"` \| `"protocol-violation"` \| `"capacity"` \| `"process-exited"` \| `"session-closed"` \| `"not-found"`

Defined in: [api.ts:772](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L772)

`@termwright/driver` — PTY + VT sessions, locators, actions and waits.

The normative public API lives in `api.ts`; this module is the only entry
point and re-exports the types from there together with their runtime
implementations.

## Example

```ts
import { launchTerminal } from '@termwright/driver';

const terminal = await launchTerminal({ command: ['node', 'app.js'] });
await terminal.waitForText('Ready');
await terminal.getByRole('button', { name: 'Approve' }).activate();
await terminal.close();
```
