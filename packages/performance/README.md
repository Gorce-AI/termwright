# Semantic pipeline performance

This package runs a representative retained-mode workload through the
production semantic pipeline:

- an OpenTUI-shaped stable object tree with focus and value churn.

Immediate mode is measured separately by the real zero-config Charm/Bubble Tea
E2E benchmark (`benchmark:charm`). Ink is intentionally not used as the
immediate-mode representative: React Ink retains a host tree across commits,
even though its reconciler rebuilds parts of it.

Both workloads use the real recognizer, length-prefixed serializer, decoder,
immutable DTO projection, strict message parser and snapshot validator. The
report is JSON so CI and profiling tools can consume it without scraping prose.

```sh
corepack pnpm@9.4.0 --filter @termwright/performance build
corepack pnpm@9.4.0 --filter @termwright/performance benchmark \
  --iterations 1000 --warmup 100 --nodes 96 \
  --output packages/performance/reports/semantic-pipeline.json

corepack pnpm@9.4.0 --filter @termwright/performance benchmark:charm \
  --iterations 8 --output packages/performance/reports/charm-immediate.json

corepack pnpm@9.4.0 --filter @termwright/performance benchmark:opentui \
  --repetitions 3 --window-ms 1000 \
  --output packages/performance/reports/opentui-marker-route.json
```

The Charm command builds the same zero-import Bubble Tea fixture twice, once
normally and once through `prepareInstrumentedBuild`, then drives both binaries
through PTYs with the same 256-key batch. An application-owned marker ends the
measurement before quiet timers and exit scheduling. The harness warms each
binary once, uses a fixed balanced ABBA/BAAB order, requires final screen text
to match, requires the final application state to arrive in a committed
semantic snapshot with zero publication drops, and reports the burst-throughput
ratio of arm medians together with every raw duration pair, paired ratio and
adapter debug counters. Build time and warmups are
excluded. It requires Go and a working PTY, so the fast schema/ceiling test
remains the portable CI gate while the checked-in Charm report records the
latest measured run.

The OpenTUI command wraps the package's real threaded renderer benchmark. It
rotates native, feed-only and feed-plus-marker arms, requires the marker to
follow frame bytes, and records the native/feed throughput ratio. Bun 1.2.15 is
required for the pinned OpenTUI 0.5.3 backend.

The checked-in report is a measured reference, not a universal pass/fail CPU
threshold. CPU timings vary across runners; regression tests enforce the report
schema, both rendering modes, the complete required metric vocabulary, parser
survival and the protocol byte ceiling. Compare timings only on the same class
of machine.

## Metric boundaries

`probeEventsPerFrame` counts Probe IR objects plus render/layout operations.
`bytesPerFrame` includes the four-byte length prefix. `probeSerializationTime`
measures production `encodeFrame`. The parent currently performs no semantic
normalization: probes publish an already normalized tree, so
`parentNormalizationTime` is unavailable. Decode, immutable projection, schema
checks and semantic validation are measured separately as
`parentProtocolValidationTime` instead of being mislabeled.

This harness does not invent data it cannot observe. Backpressure drops,
coalescing and render-marker correlation require a live framework process and
PTY, so those values are `null` with `status: "unavailable"` and a reason. The
current transport sends full snapshots; that counter is measured directly.
`probeHotPathTime` covers recognizer plus
serialization, but excludes framework observation and socket I/O, so it is not
presented as whole-application slowdown.

For OpenTUI's separate live renderer marker-route measurement, see
`packages/probe-opentui/bench/marker-route.ts` and its NOTES. That benchmark
includes native renderer scheduling and answers a different question from this
portable semantic-pipeline benchmark.

## Recorded cadence and regression policy

The `Performance observations` workflow runs every Monday and on manual
dispatch on the `macos-15` arm64 runner with Node 24, Go 1.25 and Bun 1.2.15.
That complete `darwin-arm64-node24-go1.25-bun1.2.15` class is verified before
measurement; the artifact also records the resolved Node, Go and Bun patch
versions. It runs all three benchmarks above, then runs the real `quality/soak`
lifecycle suite repeatedly and the `quality/stress` concurrency suite once
through the certified host. One artifact contains the raw reports, resource
observations and comparison.

To bootstrap the required Go 1.25 baseline from a pushed branch containing
this workflow:

1. Dispatch `Performance observations` with `mode=capture`.
2. Download `performance-baseline-candidate-darwin-arm64-node24-go1.25-bun1.2.15`.
3. Review its raw reports, runner descriptor and candidate values, then commit
   the candidate as
   `baselines/darwin-arm64-node24-go1.25-bun1.2.15.json` unchanged.
4. Dispatch `mode=observe`; this is the first normal proof against the newly
   committed, toolchain-qualified baseline.

Capture reads reviewed tolerances from the value-free `.policy.json`; every
baseline value and source comes from that
dispatch's measurements. A non-zero process or descriptor cleanup observation
fails capture and produces no candidate baseline. The schema requires both
cleanup metrics as exact zero-count invariants independently of the policy
file, so removing a policy entry cannot disable the gate. Each candidate embeds
the verified runner descriptor, including resolved toolchain versions, and the
SHA-256 digest of every raw quality and benchmark input. The quality input also
binds the timing, instrumented lifecycle-soak and stress roles to one exact host
invocation and to the SHA-256 digest of every committed `manifest.json`. Its
provenance records the collector digest and measured Git commit; on GitHub
Actions it additionally requires the exact workflow run id, first-attempt number
and `GITHUB_SHA`. Capture and observation recompute the collector digest and Git
identity and reject missing, corrupt, unsupported or cross-run evidence before
using any metric. They also validate each report's schema, platform,
architecture and runtime against the runner descriptor.

The quality observation records first-run pre-attempt time and the mean
post-startup run orchestration time outside the recorded attempt: collection,
scheduling and finalization, with the controlled test workload subtracted. Both
the run duration and the attempt offset are measured by the host's monotonic
clock; wall timestamps remain provenance only. Runs are ordered by the host's
logical configuration-event sequence, not their wall timestamps. This timing
phase runs without external process-table,
memory or descriptor samplers, so the observation does not measure its own
resource probes. Resource evidence is collected in a separate instrumented
lifecycle soak, preserving detection of leaks accumulated across persistent-host
cycles, and in the certified 16-session stress phase. On macOS that process-tree
sampler records the maximum
sampled process-tree `Summary Footprint` reported by `/usr/bin/footprint`,
rather than summing per-process RSS or `phys_footprint` values that count shared
pages more than once. Memory-footprint and descriptor observation run
independently, so the slower descriptor probe cannot suppress memory samples.
The 16-session stress fixture publishes an
atomically written, nonce-bound READY record only after every terminal is live;
it retains ownership until the collector records either a successful snapshot
or a terminal failure. A failed or incomplete snapshot fails the test and the
collector, while fixture teardown still closes every session. The raw quality
report retains the validated snapshot method, expected session count and exact
process count, and baseline capture rejects an incomplete record. Cleanup is the
number of observed descendant processes, and the descriptors they still own,
after the certified host exits; both have an exact zero baseline. The host
itself also fails closed if its resource broker
or run finalization barrier finds a leak.

Every timing or footprint regression beyond its recorded tolerance emits a
native GitHub error and fails the scheduled/manual workflow. Process or file
descriptor cleanup above its exact zero allowance is handled by the same hard
gate. Invalid reports, failed suites, retries/reruns, missing measurements and a
runner-class mismatch also fail because there is no trustworthy observation to
compare. The workflow is intentionally scheduled/manual because it is an
expensive, runner-class-qualified observation; when it runs, there is no
annotate-only or green-with-warning state.

The tolerances are data, not hidden workflow constants: first-run pre-attempt
time allows 50%, post-startup orchestration and physical footprint 35%, peak descriptors 25%,
the semantic p95 50%, and the framework ratios 35% (Charm) and 25% (OpenTUI),
each with the small absolute allowance recorded beside it. Cleanup allows no
leak at all.

Changing a tolerance requires a reviewed policy change and a fresh baseline
capture. Old annotate-only policy fields are rejected rather than retained as
backward compatibility.
