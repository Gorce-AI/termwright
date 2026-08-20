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
current TypeScript probe transport sends full snapshots and no deltas; those
two counters are measured as such. `probeHotPathTime` covers recognizer plus
serialization, but excludes framework observation and socket I/O, so it is not
presented as whole-application slowdown.

For OpenTUI's separate live renderer marker-route measurement, see
`packages/probe-opentui/bench/marker-route.ts` and its NOTES. That benchmark
includes native renderer scheduling and answers a different question from this
portable semantic-pipeline benchmark.
