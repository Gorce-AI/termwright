# Trace v4 streaming decision record

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Baseline and root cause

The previous writer retained `castEvents[]`, `traceEvents[]`, semantic snapshots,
and logs for the full attempt. `finalize()` sorted them, projected every
`castOffset`, built line arrays, joined complete files, wrote them, and hashed
the complete strings. Runtime memory therefore scaled with event count and
finalization introduced a second materialization peak. `packTrace()` repeated
the pattern with whole-file reads and `zipSync()`.

The forcing constraint was the persisted `castOffset`: idle trimming was chosen
only at finalization, so no record could be complete when observed.

## Chosen architecture

Trace v4 is the only supported format. It keeps a directory as the canonical
runtime artifact and contains:

- `session.cast`: append-only presentation stream;
- `events.jsonl` and `logs.jsonl`: canonical monotonic `t`, with no persisted
  `castOffset`;
- `semantics.jsonl`: a full keyframe followed by revision-based deltas when the
  encoded delta is smaller than its independent keyframe;
- `timeline.jsonl`: raw cast anchors and hidden windows, separate from domain
  events;
- `meta.json` and `COMMITTED`: final metadata and the validity marker.

Idle policy is selected when the writer is created. The reader derives
`castOffset` lazily, retaining the existing useful UI facade without retaining
the run in the writer. Semantic replay uses the protocol's validated atomic
delta apply, and a missing or mismatched base is corruption.

The writer owns one sequential append loop with limits for pending records and
pending UTF-8 bytes. It batches at most 128 records / 1 MiB, updates SHA-256
from exactly the bytes written, and fails with `capacity` on saturation. It
never creates one promise per event. `dispose()` is awaitable and removes the
private staging directory. Finalization drains, fsyncs, writes the commit, and
atomically renames. Passing `retain-on-failure` attempts await disposal, so no
durable heavy bundle remains.

Portable ZIP packaging uses streaming `ZipDeflate`, filesystem streams, and
writable backpressure. Canonical directory checksum verification also streams
bytes. The old trace reader and format detection path do not exist.

## Rejected alternatives

- Retaining v1/v3 records and adding a new reader branch: forbidden legacy cost
  and leaves `castOffset` as a materialization constraint.
- Generic JSON Patch for semantics: weaker domain invariants and no revision
  base contract.
- Fixed semantic keyframe interval: arbitrary without workload evidence. The
  encoded delta/full comparison is deterministic and content-sensitive.
- Immediate ZIP creation: adds compression and container complexity to the hot
  run path.

## Evidence

`pnpm test -- -- --run packages/trace` passes 152 tests with retries disabled.
Oracles cover atomic publication retry, incomplete traces, checksums, lazy time
projection, keyframe/delta reconstruction, and deterministic capacity failure.

`pnpm certify:trace-streaming` wrote 20,000 output events / 81,920,000 output
bytes on Node 24.1.0, macOS arm64. The resulting trace was 82,909,700 bytes.
Across the last four equal phases RSS varied by 1,753,088 bytes; heap variation
across all eight phases was 1,761,824 bytes. Finalization added 49,152 RSS
bytes. This supports the invariant that writer memory is a function of bounded
queues and active state, not accumulated trace bytes.

## Remaining limitations

- The canonical writer is certified locally on macOS arm64; the required Node
  22/24 and Linux/macOS/Windows release matrix remains external CI work.
- ZIP reading and unpacking remain size-capped whole-container operations. The
  runtime format and pack path are streaming; a future portable-reader audit
  should select a random-access or streaming unzip implementation.
- Artifact Security 2.0 now runs before bytes enter the spool. Its remaining
  OS/runtime and raster canary evidence is tracked in
  `artifact-security-2.md` rather than treated as a Trace v4 format gap.
