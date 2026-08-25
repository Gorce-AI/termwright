---
title: "Type Alias: TermwrightErrorCode"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / TermwrightErrorCode

# Type Alias: TermwrightErrorCode

> **TermwrightErrorCode** = `"timeout"` \| `"stale-snapshot"` \| `"ambiguous-locator"` \| `"semantic-capability-unavailable"` \| `"probe-attach-failed"` \| `"capability-unavailable"` \| `"not-actionable"` \| `"input-mode-disabled"` \| `"capability-provider-lost"` \| `"capability-provider-violation"` \| `"evidence-conflict"` \| `"adapter-guarantee-violation"` \| `"duplicate-semantic-key"` \| `"history-truncated"` \| `"protocol-violation"` \| `"capacity"` \| `"process-exited"` \| `"pty-backend-failed"` \| `"session-closed"` \| `"not-found"`

Defined in: [driver/src/api.ts:1143](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/api.ts#L1143)

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
