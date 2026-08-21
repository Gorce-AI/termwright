# @termwright/probe-runtime

Framework-neutral, fail-closed socket transport shared by zero-config
JavaScript probes. It owns handshake validation, full-snapshot publication,
revision commits, marker authentication, limits and channel
shutdown.

It intentionally does not observe framework state or write markers. Only the
framework probe knows when its render bytes have drained, so marker placement
stays in `@termwright/probe-ink` and `@termwright/probe-opentui`.

## Debug performance metrics

`ProbeChannel.performanceMetrics()` returns immutable transport telemetry.
Collection turns on automatically with `TERMWRIGHT_DEBUG=1`/`all` or
`TERMWRIGHT_DEBUG_FILE`, and can be forced with `connectProbe({
performanceMetrics: true, ... })`. Disabled sessions do not call the timer.

The snapshot reports full snapshots, encoded semantic bytes, node and
generic-node counts, failed publications, requested markers and serialization
time, together with per-frame averages. Framework sessions also supply their
Probe IR fact count and report publications superseded in their marker queue.
Fields the shared transport cannot see stay `null`: parent normalization and
whether the framework-specific sink actually drained a marker.

Injected applications do not need a channel handle to inspect these values:
set `TERMWRIGHT_DEBUG_FILE=/path/to/adapter.log`. The runtime appends a
`termwright-probe-performance` JSONL record after each publication and
coalescing update. Records contain counters and timings only, never semantic
text or the authentication token. Debug-file failures are fail-open and cannot
stop the application.
