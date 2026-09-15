---
title: "Interface: LaunchSidecarOptions"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / LaunchSidecarOptions

# Interface: LaunchSidecarOptions

Defined in: [test/src/sidecar.ts:17](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L17)

## Properties

### command

> `readonly` **command**: readonly \[`string`, `string`\]

Defined in: [test/src/sidecar.ts:18](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L18)

***

### cwd?

> `readonly` `optional` **cwd?**: `string`

Defined in: [test/src/sidecar.ts:19](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L19)

***

### env?

> `readonly` `optional` **env?**: `Readonly`\<`Record`\<`string`, `string` \| `undefined`\>\>

Defined in: [test/src/sidecar.ts:20](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L20)

***

### maxOutputBytes?

> `readonly` `optional` **maxOutputBytes?**: `number`

Defined in: [test/src/sidecar.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L26)

Per-stream tail retained for diagnostics. Defaults to 256 KiB.

***

### ready?

> `readonly` `optional` **ready?**: [`SidecarReadiness`](../../type-aliases/sidecarreadiness/)

Defined in: [test/src/sidecar.ts:22](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L22)

Output-driven readiness. Omit when successful spawn itself means ready.

***

### readyTimeout?

> `readonly` `optional` **readyTimeout?**: `number`

Defined in: [test/src/sidecar.ts:23](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L23)

***

### shutdownTimeout?

> `readonly` `optional` **shutdownTimeout?**: `number`

Defined in: [test/src/sidecar.ts:24](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/sidecar.ts#L24)
