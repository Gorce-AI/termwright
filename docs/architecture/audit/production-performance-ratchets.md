# Production performance and resource ratchets

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

The table separates measurements from unavailable evidence. `UNAVAILABLE`
means that the old implementation was not measured with the same harness or
that the current ownership boundary cannot report the metric honestly; it is
never substituted with zero.

| Metric                            |      Before |                                       After |      Change |
| --------------------------------- | ----------: | ------------------------------------------: | ----------: |
| semantic bytes/frame              |  57,387.893 |                                   3,083.841 |      -94.6% |
| semantic validation µs/frame      |   2,096.893 |                                      76.923 |      -96.3% |
| full semantic snapshots/run       |       1,000 |                                           1 |      -99.9% |
| deltas/run                        |           0 |                                         999 |        +999 |
| trace peak RSS                    | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |
| trace finalization peak RSS       | UNAVAILABLE |                                   +49,152 B | UNAVAILABLE |
| long-run RSS slope                | UNAVAILABLE |              1,753,088 B steady-phase range | UNAVAILABLE |
| final trace bytes                 | UNAVAILABLE |                                82,909,700 B | UNAVAILABLE |
| journal calls                     | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |
| journal peak backlog              |   unbounded | bounded by configured event and byte limits |     bounded |
| worker RSS                        | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |
| owned process RSS where available | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |
| temp disk peak                    | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |
| passing artifacts                 | UNAVAILABLE |        deleted in `retain-on-failure` tests |   invariant |
| failed artifacts                  | UNAVAILABLE |               atomically published in tests |   invariant |
| full suite wall                   | UNAVAILABLE |                                 UNAVAILABLE | UNAVAILABLE |

The trace run wrote 20,000 events and 81,920,000 output bytes. Its steady-phase
RSS range and finalization delta are bounded-memory evidence, not a claim that
they are absolute peak RSS or a cross-machine baseline.

The paired performance policy now blocks regressions in semantic bytes/frame
and full-publication count alongside the existing semantic hot-path, lifecycle,
resource, and framework-overhead observations. The gate uses two exact-checkout
samples per subject in balanced R,C,C,R order, verifies an identical harness,
and retains raw provenance. Wall time is intentionally not tightened from these
local results.

External work remains: execute the paired gate on its pinned macOS runner,
collect the Node 22/24 and OS certification matrix, and add direct counters for
trace RSS, journal sink calls, worker/process-tree RSS, and temp/artifact bytes
before those rows can become release ratchets.
