---
"@termwright/driver": patch
"@termwright/desktop-host": patch
"@termwright/probe-ink": patch
"termwright": patch
---

Keep shared probe build outputs immutable while the Native Host is running,
with a pre-host content fingerprint that builds missing fresh-clone inputs,
rebuilds stale inputs, and rejects source or artifact changes inside test
workers. Settle deadline, process-exit and Ink render race branches during
teardown, and promote Vitest
async-handle leak evidence into a non-certifying infrastructure result.

Qualify performance baselines by their complete runtime toolchain and add a
value-free policy for capturing a reviewed Go 1.25 baseline from real CI
measurements. Captured baselines retain the verified environment descriptor and
SHA-256 provenance for every raw report, while process and file-descriptor leak
metrics remain mandatory exact-zero schema invariants in capture and observe.

The independent Windows Vitest/PTY reliability harness now invokes npm and
Vitest directly through Node instead of relying on non-executable `.cmd` shell
shims.
