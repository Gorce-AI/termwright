# Incremental semantic protocol decision

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**  
Baseline: `origin/main` at `4b82096b7951e7ae6494eb37fb06b4e4ab32a6ba`

## Decision

Termwright uses one protocol-v3 semantic stream. `semantic-full` establishes a
keyframe, `semantic-delta` carries a domain-specific patch with `revision` and
`baseRevision`, and `semantic-resync-request` makes recovery from a missing or
mismatched base a normal protocol operation. Protocol v2 and the old
`snapshot` envelope are removed rather than retained behind compatibility
logic.

A patch separates absent fields (unchanged) from explicit `clear` lists. Node
adds, updates, removals, root changes, geometry, evidence, hit grids, cursor,
and provider evidence are staged before the ordinary full-tree invariant
validator acts as an independent oracle. A failed patch cannot mutate the
committed revision. Qualified values and their evidence are patched as one
field value, preventing stale provenance from being combined with a new value.

The frame decoder owns the first and only hostile DTO projection and records
the exact framed byte length. Downstream validation recognizes that owned DTO,
so it neither deep-projects it again nor serializes it merely to rediscover its
wire size. The driver updates role, exact-name, test-id, and id indexes from the
changed-node map; full publications remain supported for producers without
reliable dirty-node knowledge.

## Rejected alternatives

- Generic JSON Patch: too permissive and harder to validate against semantic
  tree invariants.
- Best-effort application after a base mismatch: breaks deterministic replay
  and can combine unrelated revisions.
- Reintroducing the removed TreeDelta format: it predates qualified evidence
  and the current committed-revision model.
- A persistent-tree dependency: current Maps plus atomic staging are smaller,
  faster to audit, and sufficient for the measured workloads.

## Evidence

- Native Host suite: 3,424 passed, 82 declared platform/capability skips, zero
  failures, retries disabled.
- Protocol/driver focused suite: 432 passed.
- Go: `go test -race -count=1 ./...` passed.
- Python locked environment: 254 passed, one declared skip.
- Rust: `cargo test --locked` passed.
- TypeScript typecheck: all 35 package projects passed.
- Static ratchets: formatting, lint, package metadata, platform deviations,
  deterministic constructs, semantic completeness, mission completion, and
  protocol lockstep passed.

The checked-in retained-tree workload is the same 1,000-frame, 96-node Node 24
Darwin arm64 benchmark before and after the change:

| Metric                       |     Before |     After | Change |
| ---------------------------- | ---------: | --------: | -----: |
| semantic bytes/frame         | 57,387.893 | 3,083.841 | -94.6% |
| semantic validation µs/frame |  2,096.893 |    76.923 | -96.3% |
| full semantic snapshots/run  |      1,000 |         1 | -99.9% |
| deltas/run                   |          0 |       999 |   +999 |

These local measurements are architecture evidence, not cross-platform release
certification. Node 22 and the Linux/macOS/Windows release matrix remain an
external CI requirement.
