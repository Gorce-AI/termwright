# @termwright/pty

Termwright's internal native pseudo-terminal implementation for macOS, Linux
and Windows. It is consumed by `@termwright/driver`; application tests should
normally install `termwright` or a framework adapter instead.

The POSIX backend owns its `forkpty()` master, reads until kernel EOF (including
Linux's PTY `EIO` end condition), preserves ordered input with native
backpressure, and owns the child's process group. The Windows backend owns its
ConPTY pipes and job object. Neither platform uses a timeout, retry, quiet
window, or a private field from another PTY package to decide that output has
ended.

Input is admitted to an ordered native queue capped at 8 MiB. Overflow is
rejected synchronously; an asynchronous OS write failure permanently closes
admission and is reported to the driver. Drain means every byte admitted before
that edge has left the native queue, not that the child has consumed it. Output
crosses a bounded 64-event native-to-JavaScript channel, so a busy JavaScript
consumer backpressures the pseudoterminal instead of growing memory without a
limit. Disposal aborts that channel before joining producers, preventing a
backpressure/teardown deadlock.

Prebuilt Node-API addons are selected through optional packages for macOS >=
13.5, glibc Linux at the Ubuntu 22.04 ABI floor (glibc >= 2.35), and Windows 10
version 1809 / Server 2019 or newer, on arm64 and x64. Every release artifact is compiled and
then exercised on the matching native host. Packaging also rejects a Darwin
deployment target other than 13.5 and Linux symbol requirements newer than the
Ubuntu 22.04 glibc/libstdc++ ABI floor. A missing or unloadable matching
addon fails closed with the attempted package paths in its diagnostic; there is
no fallback terminal implementation.
