# Clean-room Native Host certification

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

`scripts/pack-clean-room-termwright.mjs` computes the local-package dependency
closure of the `termwright` package, includes only the native PTY prebuild for
the executing platform/architecture, packs every member, and validates each
archive. `scripts/check-installed-termwright.mjs` then creates a fresh project
under an installation containing only those tarballs and registry
dependencies. It does not use workspace symlinks.

The consumer has two independently discovered files: one imports the user's
`vitest@latest`, while the other imports `termwright/test`. The latter launches
a real TUI through the production native PTY, asserts a ZWJ family,
Devanagari, and CJK text, performs an Enter action, and requires one atomically
committed trace v4. The canary also requires one run manifest v7 containing
both specs, measured coordinator telemetry, and terminal/semantic/trace/final
artifact counters that exactly equal its canonical `trace.resource` event.
Retries are zero.

Local evidence on 2026-09-02: macOS arm64, Node 24.1.0, 21 locally packed
packages, 274 installed registry/tarball packages, two files and two passing
tests. The installed manifest v7 and trace v4 resource evidence were
independently checked after installation, demonstrating that this is an
executable certification rather than structural inspection.

The existing Linux/macOS build matrix and Windows native-driver matrix now run
the canary on Node 22 and Node 24 after their native addon is available. Those
remote rows remain pending until the changed workflow executes. The trusted
release workflow repeats the packed-host canary before sealing release
artifacts.

The nightly Linux, macOS, and Windows Node 22/24 soak rows now install the same
tarballs with Ink 7.1.1 and React, then compare 30-second and 180-second real
Ink attempts in one fresh consumer. The application publishes a semantic
status on every retained render and writes through a real PTY. The oracle
requires output, semantic-delta, and trace bytes to scale with duration while
the worker peak RSS may grow by at most 96 MiB; both attempts retain committed
trace v4 archives and run with zero retries. A local 2-second/8-second execution
passed with 41/159 deltas, 122,348/418,460 trace bytes, and 36,093,952 bytes of
RSS growth. The actual multi-minute rows are external certification pending.

OpenTUI, Textual, Go and Rust still need equivalent framework-specific
clean-room consumers; existing workspace examples do not count as substitutes.
