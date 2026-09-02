# Production performance and resource ratchets

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

The table separates measurements from unavailable evidence. `UNAVAILABLE`
means that the old implementation was not measured with the same harness or
that the current ownership boundary cannot report the metric honestly; it is
never substituted with zero.

| Metric                            |      Before |                                After |      Change |
| --------------------------------- | ----------: | -----------------------------------: | ----------: |
| semantic bytes/frame              |  57,387.893 |                            3,083.841 |      -94.6% |
| semantic validation µs/frame      |   2,096.893 |                               76.923 |      -96.3% |
| full semantic snapshots/run       |       1,000 |                                    1 |      -99.9% |
| deltas/run                        |           0 |                                  999 |        +999 |
| trace peak RSS                    | UNAVAILABLE |   212,746,240 B sampled process peak | UNAVAILABLE |
| trace finalization peak RSS       | UNAVAILABLE |                            +49,152 B | UNAVAILABLE |
| long-run RSS slope                | UNAVAILABLE |       1,294,336 B steady-phase range | UNAVAILABLE |
| final trace bytes                 | UNAVAILABLE |                         82,909,700 B | UNAVAILABLE |
| journal calls                     | UNAVAILABLE |                                    2 | UNAVAILABLE |
| journal peak backlog              |   unbounded |           244 events / 174,562 bytes |     bounded |
| worker RSS                        | UNAVAILABLE |                        220,561,408 B | UNAVAILABLE |
| owned process RSS where available | UNAVAILABLE |                          UNAVAILABLE | UNAVAILABLE |
| temp disk peak                    | UNAVAILABLE |       82,909,700 B exact writer peak | UNAVAILABLE |
| passing artifacts                 | UNAVAILABLE | deleted in `retain-on-failure` tests |   invariant |
| failed artifacts                  | UNAVAILABLE |        atomically published in tests |   invariant |
| full suite wall                   | UNAVAILABLE |                          UNAVAILABLE | UNAVAILABLE |

The trace run wrote 20,000 events and 81,920,000 output bytes. Its
212,746,240-byte RSS value is the maximum of explicit certification-process
samples, not trace-only allocation. The writer's 82,909,700-byte temporary-disk
high-water is exact: it advances at every successful staging write and includes
the private incomplete marker. In this run it did not exceed the committed
trace size. The RSS range and finalization delta are bounded-memory evidence,
not a cross-machine baseline.

The journal/worker rows come from a local 11-test real-PTY Native Host run on
macOS arm64/Node 24.1.0. Manifest v7 reconstructed the worker maximum and
aggregate CPU from independently persisted `attempt.finished` evidence. The
same run reconstructed 3,320 terminal bytes, 26,279 semantic bytes (six full
records and three deltas), and 116,472 retained trace bytes from ten
`trace.resource` records. They establish that the counters are live; they are
not cross-machine regression thresholds.

The paired performance policy now blocks regressions in semantic bytes/frame
and full-publication count alongside the existing semantic hot-path, lifecycle,
resource, and framework-overhead observations. The gate uses two exact-checkout
samples per subject in balanced R,C,C,R order, verifies an identical harness,
and retains raw provenance. Wall time is intentionally not tightened from these
local results.

The nightly reliability workflow now runs the 20,000-event/81.92 MB trace
streaming certification independently on Linux and macOS under Node 22 and 24,
with GC exposed and its JSON evidence retained. This is a deterministic
resource workload, not an elapsed-time sleep. Those rows remain external
certification pending until the workflow executes.

The packed Ink long-run oracle additionally compares two real PTY/semantic
attempts in the same worker. Its local 2-second/8-second qualification grew
trace bytes from 122,348 to 418,460 and semantic deltas from 41 to 159 while
sampled worker peak RSS grew by 36,093,952 bytes. Nightly certification uses
30-second/180-second attempts and rejects more than 96 MiB of RSS growth.

External work remains: execute the paired gate on its pinned macOS runner,
collect the Node 22/24 and OS certification matrix, and add direct counters for
trace-only RSS, process-tree RSS, and concurrent host-wide temp-disk peak before
those rows can become release ratchets.
