# Bounded EventJournal and transport

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Admission and saturation

`RunEventJournal` now owns both event-count and serialized-byte limits. The byte
cost is measured once before admission. Authoritative and state events fail with
`journal-full` before validator or queue mutation when no capacity exists. State
replacement credits the replaced entry, so a stable key does not accumulate
backlog.

Diagnostic eviction remains explicitly lossy: only unsealed diagnostics may be
removed, and every removal is represented by a bounded `journal.gap` event. If
the loss marker itself cannot be reserved within the count and byte limits, the
append fails instead of silently dropping evidence. Event-class counts and byte
accounting are O(1), and current plus peak backlog are observable.

## Worker transport

The former one-request-per-event wire contract was removed. A worker now owns a
bounded admission queue (event and byte limits), drains batches of at most 64
events / 256 KiB, and reports a `capacity` error immediately when saturated.
Batching is triggered by a microtask for latency and by `flush()`/`close()` for
correctness; no timer determines whether data is delivered. The server validates
the complete batch and worker binding before invoking the sink.

## Evidence and remaining boundary

Protocol tests cover byte saturation, state replacement, explicit diagnostic
gaps and accounting after flush. Transport tests cover batching, bounded
admission, stale producers and close-time drain. Current and peak transport
backlog plus batch count are machine-observable.

The queueing boundary is bounded, but `RunEventPersistence` still materializes
the complete recorded/persisted run history for the current run-manifest
contract. Consequently this checkpoint does **not** claim total event-persistence
memory is independent of run duration. Removing that finalize-oriented history
array is a separate required migration before the campaign's full resource
invariant can be marked PASS.

External evidence still required: Node 22/24 and Linux/macOS/Windows constrained
host runs with measured peak backlog and RPC reduction.
