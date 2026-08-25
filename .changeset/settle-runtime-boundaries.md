---
"@termwright/driver": patch
"@termwright/desktop-host": patch
"@termwright/probe-ink": patch
"@termwright/run-history": patch
"termwright": patch
---

Keep shared probe build outputs immutable while the Native Host is running,
with a pre-host content fingerprint that builds missing fresh-clone inputs,
rebuilds stale inputs, and rejects source or artifact changes inside test
workers. Settle deadline, process-exit and Ink render race branches during
teardown. A cancelled desktop control bind now remains owned until a late
listener is closed, so startup rollback cannot leave an orphaned socket or
named pipe. Promote Vitest
async-handle leak evidence into a non-certifying infrastructure result.

Compare exact reference and candidate revisions on one macOS runner in a fixed
reference/candidate/candidate/reference sequence. The paired gate binds the
toolchain, measurement harness, controller, round order, subject commit, CI
attempt and every raw report with SHA-256 provenance; Bun/OpenTUI is mandatory,
and process and file-descriptor leaks remain exact-zero invariants.

Move native run manifests to schema v3 with host-monotonic total duration and
per-attempt start/finish offsets. Validate those intervals against the run
boundary and reject v2 or internally inconsistent timing evidence.

The independent Windows Vitest/PTY reliability harness now invokes the exact
lockfile-backed Vitest entry point directly through Node instead of relying on
non-executable `.cmd` shell shims.
