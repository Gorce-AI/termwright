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

## Streaming canonical history

The finalize-heavy run manifest v4 was removed. Manifest v5 stores the canonical
journal as append-only `events.ndjson`; each drained journal batch is appended
to the private run-history staging directory and contributes to an incremental
SHA-256, event count, and byte count. The small final manifest binds all three,
the event file is fsynced before the commit marker, and only the final directory
rename publishes the run. A reader rejects a missing, truncated, modified, or
misordered stream.

The stream has explicit 1,000,000-event and 512 MiB capacities. Saturation is a
controlled persistence failure, never truncation or a silent authoritative
drop; the same bounds protect the materializing completed-run reader from a
forged size declaration.

The host no longer retains parallel `recorded[]` and `persisted[]` arrays. Its
non-authoritative completion/debug projection is a 4,096-entry O(1) ring; exact
attempt activity needed by the finalization barrier is maintained as a compact
per-attempt index. External journal sinks are live projections and cannot make
canonical persistence retry an already appended batch.

## Evidence and remaining boundary

Protocol tests cover byte saturation, state replacement, explicit diagnostic
gaps and accounting after flush. Transport tests cover batching, bounded
admission, stale producers and close-time drain. Current and peak transport
backlog plus batch count are machine-observable.

Focused tests cover more events than the live projection capacity, verify that
all canonical events are streamed while only the newest 4,096 remain in memory,
and reject event-stream size/hash tampering. The persisted-reader facade may
materialize events when a UI explicitly opens a completed run; that read-time
cost is not retained in the running test host.

Run-event protocol v3 removes the final duration-proportional validator state.
`causedBy` may reference only an already observed event inside the newest 65,536
event IDs; forward references and expired causes fail closed. This makes cycles
impossible by construction. Producer ordering keeps one record per producer
with a 4,096-producer ceiling and the stream admits at most 1,000,000 events,
matching the persisted artifact ceiling. Event-ID collision detection uses a
fixed 128-Mibit, seven-probe filter. At the event ceiling its modeled
false-positive probability is below one per billion lookups; a probabilistic
collision can reject valid input, but can never admit a known collision. Each
producer keeps only the newest 4,096 exact IDs to fail early on a broken UUID
source; the canonical merged-stream validator remains authoritative for older
IDs.

These bounds make journal validation memory a function of configured queues,
producer capacity, causal horizon, and fixed filters rather than run duration.
The completed-run reader remains intentionally materializing but is protected
by the separate 512 MiB / 1,000,000-event artifact cap.

External evidence still required: Node 22/24 and Linux/macOS/Windows constrained
host runs with measured peak backlog and RPC reduction.
