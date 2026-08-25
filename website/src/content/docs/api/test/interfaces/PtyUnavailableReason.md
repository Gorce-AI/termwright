---
title: "Interface: PtyUnavailableReason"
editUrl: false
---

[**@termwright/test**](../../)

***

[@termwright/test](../../) / PtyUnavailableReason

# Interface: PtyUnavailableReason

Defined in: [test/src/pty-available.ts:25](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L25)

Why this machine reported no pseudo-terminal.

`opted-out` is a deliberate choice and means nothing is wrong. `probe-failed`
is a machine that cannot do the thing the suite exists to test, and the two
must not look alike: a run whose PTY suites all skipped for the second
reason has proven nothing, and returning a bare `false` for both is how that
becomes a green tick.

## Properties

### detail

> `readonly` **detail**: `string`

Defined in: [test/src/pty-available.ts:27](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L27)

***

### kind

> `readonly` **kind**: `"opted-out"` \| `"probe-failed"`

Defined in: [test/src/pty-available.ts:26](https://github.com/Gorce-AI/termwright/blob/main/packages/test/src/pty-available.ts#L26)
