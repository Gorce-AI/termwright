---
title: "Function: inheritedSpawnEnv()"
editUrl: false
---

[**@termwright/driver**](../../)

***

[@termwright/driver](../../) / inheritedSpawnEnv

# Function: inheritedSpawnEnv()

> **inheritedSpawnEnv**(): `Record`\<`string`, `string`\>

Defined in: [driver/src/session.ts:3458](https://github.com/Gorce-AI/termwright/blob/main/packages/driver/src/session.ts#L3458)

The smallest environment a child can actually start in on this platform.

Spawning with just `PATH` reads as admirably minimal and is fine on POSIX,
but on Windows a Node child without `SystemRoot` aborts inside CSPRNG
initialization with exit code 134 before running a line of code — no error,
no output, just a number that looks like the program failed. Anywhere that
spawns a helper process should take this instead of writing its own list.

## Returns

`Record`\<`string`, `string`\>
