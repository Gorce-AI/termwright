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
  --iterations 3 --output packages/performance/reports/charm-immediate.json

corepack pnpm@9.4.0 --filter @termwright/performance benchmark:opentui \
  --repetitions 3 --window-ms 1000 \
  --output packages/performance/reports/opentui-marker-route.json
```

The Charm command builds the same zero-import Bubble Tea fixture twice, once
normally and once through `prepareInstrumentedBuild`, then drives both binaries
through PTYs with the same input. It alternates arm order, requires their final
screen text to match, and reports the median instrumented/vanilla wall-time
ratio together with actual adapter debug counters. Build time is excluded. It
requires Go and a working PTY, so the fast schema/ceiling test remains the
portable CI gate while the checked-in Charm report records the latest measured
run.

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

The former `baselines/darwin-arm64-node24.json` seed was measured with Go
1.24.4 and is retained only as historical evidence. The scheduled and normal
manual modes never compare against it. To bootstrap the required Go 1.25
baseline from a pushed branch containing this workflow:

1. Dispatch `Performance observations` with `mode=capture`.
2. Download `performance-baseline-candidate-darwin-arm64-node24-go1.25-bun1.2.15`.
3. Review its raw reports, runner descriptor and candidate values, then commit
   the candidate as
   `baselines/darwin-arm64-node24-go1.25-bun1.2.15.json` unchanged.
4. Dispatch `mode=observe`; this is the first normal proof against the newly
   committed, toolchain-qualified baseline.

Capture reads tolerances and the annotate-only history policy from the
value-free `.policy.json`; every baseline value and source comes from that
dispatch's measurements. A non-zero process or descriptor cleanup observation
fails capture and produces no candidate baseline. The schema requires both
cleanup metrics as exact zero-count invariants independently of the policy
file, so removing a policy entry cannot disable the gate. Each candidate embeds
the verified runner descriptor, including resolved toolchain versions, and the
SHA-256 digest of every raw quality and benchmark input. Capture and observation
also validate each report's schema, platform, architecture and runtime against
that descriptor before using any metric.

The quality observation defines startup as run-manifest creation to the first
attempt. Per-test overhead is the mean post-startup run duration outside the
recorded attempt: collection, scheduling and finalization, with the controlled
test workload subtracted. A process-tree sampler records aggregate peak RSS and
open descriptors. Cleanup is the number of observed descendant processes, and
the descriptors they still own, after the certified host exits; both have an
exact zero baseline. The host itself also fails closed if its resource broker
or run finalization barrier finds a leak.

Timing and footprint regressions beyond their recorded tolerance emit native
GitHub warning annotations and appear in the job summary. They deliberately do
not change the job's exit status while the baseline is young. Process or file
descriptor cleanup above its exact zero allowance is not performance noise: it
emits an error and fails the scheduled/manual workflow. Invalid reports, failed
suites, retries/reruns, missing measurements and a runner-class mismatch also
fail because there is no trustworthy observation to compare.

The tolerances are data, not hidden workflow constants: startup allows 50%,
post-startup orchestration and RSS 35%, peak descriptors 25%, the semantic p95
50%, and the framework ratios 35% (Charm) and 25% (OpenTUI), each with the small
absolute allowance recorded beside it. Cleanup allows no leak at all.

The performance comparison may become merge-blocking only after at least 12
successful weekly samples from the same runner class have been retained and
reviewed, and the thresholds have been recalibrated from that history rather
than this single seed. Changing `history.decision` requires that review and a
separate branch-protection change; the current schema accepts only `annotate`.
