# Termwright 0.4 production-maturity campaign

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

Baseline: `protocol/v0.3.1`, resolved at campaign start to
`4b82096b7951e7ae6494eb37fb06b4e4ab32a6ba` on `main`.
The release-candidate branch subsequently integrated `origin/main` at
`7eff69b0f25cf996689757114a0cf092779080f3`, including the coordinated 0.3.2
release, before its final package-readiness checks.

This report is the release-candidate summary. Detailed measurements, corpora,
protocol schemas, and rejection evidence remain in the linked decision records.
No compatibility reader, deprecated config alias, or legacy semantic path was
added for Termwright 0.3.1.

## Unicode and terminal engine

1. **Baseline:** xterm/headless used the Unicode 11 addon and full grapheme
   clustering was not a production invariant.
2. **Root cause:** the upstream grapheme addon created typed views over pooled
   `Buffer.buffer` without its offset and length. Allocator state, rather than
   Vitest itself, selected corruption, a data error, or an apparent hang.
3. **Investigated alternatives:** Unicode 11 xterm, patched upstream grapheme
   addon, a Termwright-owned provider, `ghostty-web`, `@wterm/ghostty`, and
   libvterm were measured on the same corpus. Termless informed the backend and
   differential-runner shape, not the PTY layer.
4. **Chosen architecture:** one xterm/headless state machine with a
   Termwright-owned Unicode 15 extended-grapheme provider; Ghostty and libvterm
   remain independent oracles.
5. **Rejected alternatives:** the experimental addon still carries its pooled
   buffer defect; current Ghostty wrappers lack the complete stable headless
   cell/lifecycle surface Termwright needs; public multi-engine selection adds
   product complexity without a user benefit.
6. **Implementation:** modern grapheme clustering, explicit `default` and
   `cjk-wide` behavior profiles, shared live/replay/UI width logic, a minimal
   load matrix, geometry corpus, protocol corpus, and classified gap ledger.
7. **Removed:** `UnicodeVersion = '11'`, the `kitty` alias, and production
   dependence on the Unicode 11 addon.
8. **Correctness evidence:** the 23-case corpus covers ZWJ, modifiers, flags,
   VS15/16, combining text, Arabic, Devanagari, Hangul, Thai, bidi, CJK,
   continuation cells, cursor position, semantic bounds, hit testing, and
   screenshots. The canonical provider has zero classified geometry gaps.
9. **Performance evidence:** Node 24 research measured about 32 ms startup,
   29 ms corpus time, and 24 MiB process RSS; no order-of-magnitude regression
   over the old path was observed.
10. **OS/runtime evidence:** the isolated loader passes Node 22.23.2 and
    24.1.0; packed macOS arm64 interaction evidence passes. The complete
    release OS/architecture matrix remains external.
11. **Remaining limitations:** terminal cells preserve graphemes and geometry,
    not font shaping; bidi presentation and orphan zero-width handling retain
    explicitly classified terminal-profile differences.

Decision record: [unicode-terminal-engine-decision.md](unicode-terminal-engine-decision.md).

## Incremental semantic pipeline

1. **Baseline:** retained UIs republished and revalidated complete trees even
   when one node changed.
2. **Root cause:** the wire protocol exposed only full snapshots and downstream
   layers rebuilt owned data and indexes without a revision patch contract.
3. **Investigated alternatives:** generic JSON Patch, the removed TreeDelta,
   normalized upserts, persistent-tree packages, and ordinary staged Maps.
4. **Chosen architecture:** protocol v3 `semantic-full`, revision-based
   `semantic-delta`, and `semantic-resync-request`; staged Maps commit atomically
   and maintain locator indexes incrementally.
5. **Rejected alternatives:** JSON Patch is too permissive, TreeDelta predates
   evidence invariants, best-effort mismatch apply is non-deterministic, and a
   persistent-tree dependency did not justify its complexity.
6. **Implementation:** explicit add/update/remove/root/clear operations,
   `baseRevision`, provenance-coupled qualified fields, full invariant checks,
   normal resync, validate-once owned DTOs, exact frame byte lengths, dirty
   publishing in reliable adapters, and deterministic full-to-delta derivation.
7. **Removed:** semantic protocol v2, snapshot envelopes, repeated deep
   projection, stringify-for-size, and old full-index rebuild paths.
8. **Correctness evidence:** full-state and incremental reconstruction are
   compared after every mutation; invalid bases, cycles, references, rectangles,
   actions, evidence, and capability requirements leave committed state intact.
   TypeScript, Python, Go, and Rust producers pass their protocol suites.
9. **Performance evidence:** the retained-tree workload reduced bytes/frame
   from 57,387.893 to 3,083.841 (-94.6%) and validation from 2,096.893 to
   76.923 microseconds/frame (-96.3%); 1,000 full snapshots became one full and
   999 deltas.
10. **OS/runtime evidence:** Node 24 and packed clean-room adapters pass locally;
    Node 22 and the complete OS matrix remain external.
11. **Remaining limitations:** producers without trustworthy dirty-node
    knowledge deliberately continue publishing full keyframes.

Decision record: [incremental-semantic-protocol.md](incremental-semantic-protocol.md).

## Trace v4 and artifact security

1. **Baseline:** the writer retained duration-proportional arrays and created a
   second full materialization at `finalize()`; redaction was fragmented across
   persistence sinks.
2. **Root cause:** persisted `castOffset` required final timeline knowledge, and
   the old archive format had no secure append boundary or commit transaction.
3. **Investigated alternatives:** compatibility readers, immediate ZIP output,
   fixed keyframe intervals, post-finalization redaction, and an append-oriented
   directory with streaming optional packaging.
4. **Chosen architecture:** Trace v4 is an append-only directory with canonical
   monotonic time, separate timeline transformations, semantic keyframes/deltas,
   incremental hashes, an incomplete marker, and atomic commit. One
   `ArtifactSecurityPolicy` acts before every temporary or final trace write.
5. **Rejected alternatives:** v3 compatibility preserves the materialization
   constraint; immediate ZIP burdens the hot path; fixed intervals lack
   workload evidence; post-write redaction has already crossed the security
   boundary.
6. **Implementation:** bounded sequential batches, fsync/rename publication,
   async abort, streaming pack, retain-on-failure deletion, VT-aware sanitizer
   across chunks and controls, a bounded secret registry, width-preserving
   masks, and pre-rasterization screenshot rectangles.
7. **Removed:** old trace readers/detection, whole-run event arrays, per-event
   mapped timestamps, whole-file hashing/ZIP construction, and scalar artifact
   security config.
8. **Correctness evidence:** replay equals live state at sampled revisions;
   incomplete, truncated, hash-modified, or base-mismatched traces fail closed.
   Canary tests cover input, paste, semantics, split and ANSI-interleaved output,
   OSC, Unicode, logs, crashes, diagnostics, and screenshot source removal.
9. **Performance evidence:** 20,000 events / 81.92 MB output produced an
   82,909,700-byte trace and exact 82,909,700-byte writer staging high-water,
   with a 1,294,336-byte steady-phase RSS range, a 212,746,240-byte sampled
   process peak, and only 49,152 bytes RSS growth at finalization.
10. **OS/runtime evidence:** local macOS arm64 Node 24 evidence passes; nightly
    Linux/macOS Node 22/24 and release-matrix executions remain external.
11. **Remaining limitations:** portable ZIP reading is still capped but
    materializing; trace-only RSS and concurrent host-wide temporary-disk peak
    are not yet authoritative telemetry even though each writer now reports its
    exact staging high-water; raster-level secret scanning awaits the external
    clean-room matrix.

Decision records: [trace-v4-streaming.md](trace-v4-streaming.md) and
[artifact-security-2.md](artifact-security-2.md).

## Journal, scheduling, and telemetry

1. **Baseline:** the journal could accumulate unbounded payload bytes, transport
   paid one RPC/promise per event, and concurrency followed static profile
   ceilings rather than host resources.
2. **Root cause:** admission counted neither serialized size nor a complete
   atomic resource vector, while final run history embedded a materialized event
   array.
3. **Investigated alternatives:** async admission on every hot-path event,
   bounded synchronous enqueue with batch drain, a second scheduler, root-only
   process metrics, and cgroup/filesystem-aware extension of ResourceBroker.
4. **Chosen architecture:** bounded synchronous admission plus asynchronous
   batches; the existing ResourceBroker atomically admits CPU, memory, I/O, PTY,
   process, endpoint, native-host, and trace resources using detected capacity
   and bounded historical costs.
5. **Rejected alternatives:** per-event awaits reduce throughput, silent drop
   destroys evidence, a second scheduler splits ownership, and root PID metrics
   cannot be labelled whole-tree accounting.
6. **Implementation:** event/byte limits, explicit diagnostic gaps, controlled
   authoritative saturation, append-only checksummed run history, cgroup v1/v2
   CPU and memory detection, filesystem budget, deterministic admission reasons,
   bounded p50/p95/EWMA history, worker CPU/RSS sampling, PTY/trace/journal and
   artifact counters, and literal `unavailable` capabilities.
7. **Removed:** per-event worker RPC, finalize-heavy embedded run events,
   unbounded host projections, static core-only worker selection, and fabricated
   zeroes for unsupported metrics.
8. **Correctness evidence:** transport saturation, gaps, stale producers,
   batching, crash/tamper detection, atomic resource reservations, constrained
   2 CPU/2 GiB, 4 CPU/7 GiB, high-memory, and disk-limited planner profiles all
   pass without changing verdict or evidence fidelity.
9. **Performance evidence:** a real 11-test PTY run drained the journal in two
   sink calls with a bounded peak of 244 events / 174,562 bytes; semantic and
   trace counters reconstruct independently from the canonical event stream.
10. **OS/runtime evidence:** local macOS arm64 Node 24 evidence passes; cgroup,
    Windows, and full Node 22/24 host executions remain external.
11. **Remaining limitations:** Windows Job Object resource accounting,
    capability-qualified POSIX tree accounting, and host-wide temporary-disk
    peak are intentionally `unavailable`, not inferred.

Decision records: [bounded-event-journal.md](bounded-event-journal.md),
[resource-aware-scheduling.md](resource-aware-scheduling.md), and
[resource-telemetry.md](resource-telemetry.md).

## Vitest boundary and clean-room adoption

1. **Baseline:** Termwright owned Vitest but mutated task `onFinished` and
   `onFailed` arrays, published engine subpaths, and primarily certified
   workspace-linked fixtures.
2. **Root cause:** the attempt lifecycle and package tests crossed engine-private
   and monorepo-private boundaries.
3. **Investigated alternatives:** Vitest 4.1.11 `onAfterRetryTask`, `aroundEach`,
   `onAfterRunTask`, private task arrays, packed npm consumers, wheels, Go source
   archives, and Cargo packages.
4. **Chosen architecture:** one private `TermwrightTestRunner`/CLI engine adapter,
   public per-try finalization through `onAfterRetryTask`, runner-owned ALS, and
   tarball/wheel/crate/source-archive clean-room consumers.
5. **Rejected alternatives:** mutable task arrays are unstable internals;
   `aroundEach` cannot prove outermost ordering; `onAfterRunTask` is not per try;
   workspace symlinks do not certify published boundaries.
6. **Implementation:** private engine DTOs, fail-closed finalization barriers,
   removed engine exports, user-Vitest coexistence, packed generic/Ink/OpenTUI,
   wheel-installed Textual, packaged Bubble Tea, and packaged Ratatui canaries,
   plus Unicode interaction and long-run resource workloads.
7. **Removed:** `@termwright/test/runner`, `@termwright/test/vitest-engine`, and
   mutation of Vitest completion/failure hook arrays.
8. **Correctness evidence:** each clean-room app runs a real TUI, protocol
   full/delta publication, locators/actions, terminal output, and trace commit;
   consumers reject imports from workspace client sources.
9. **Performance evidence:** the packed Ink long-run comparison grows trace
   bytes and semantic deltas with duration while enforcing a bounded RSS delta;
   native test retries remain zero.
10. **OS/runtime evidence:** all local consumers pass on macOS arm64 Node 24;
    release CI defines Linux/macOS/Windows Node 22/24 lanes and official native
    architectures, but their completed workflow records remain external.
11. **Remaining limitations:** direct consumer `aroundEach` teardown occurs
    after Vitest's public per-try hook and is not claimed as committed attempt
    evidence; registry-default Go/Rust resolution requires the coordinated 0.4
    tags.

Decision records: [vitest-engine-boundary.md](vitest-engine-boundary.md) and
[clean-room-native-host.md](clean-room-native-host.md).

### Executable public quick start

The README and Getting Started application/test are one executable source
contract. Delimited Markdown fences are compared byte-for-byte with
`examples/getting-started`; drift fails `check:fast`. The packed clean-room
consumer materializes the exact documented snippets, runs `termwright doctor`,
then runs the unmodified documented test through tarball-only packages. The
same consumer retains the independent Unicode and user-Vitest coexistence
canaries, so documentation verification cannot weaken packaging coverage.

## Release evidence and package state

The required performance table is maintained in
[production-performance-ratchets.md](production-performance-ratchets.md).
Every user-visible package change has a pending changeset. The npm fixed group,
Python wheel, Rust crates, generated protocol constants, compatibility registry,
and Go tag are deliberately versioned together by the SHA-bound Version PR and
`sync-protocol-version.mjs`; campaign commits do not hand-edit release versions.

The current local release-candidate evidence is:

- the complete Native Host run passed 3,543 tests across 320 files with 53 exact
  declared platform/capability skips, no failures, and retries disabled; this
  includes the 51 added semantic/grapheme boundary tests and the enabled
  Textual conformance suite;
- deterministic-core coverage passed at 89.45% statements, 85.53% branches,
  92.16% functions, and 91.02% lines;
- all seven public example families passed 22/22 with the CI-equivalent Textual
  environment and no skips;
- compatibility passed 20/20; native PTY EOF, Darwin fast-exit, package
  boundaries, generated docs, API docs, the 319-page website, 20,270 internal
  links, and generated protocol vectors passed;
- npm registry readiness passed for all 33 public workspace packages after the
  branch integrated the published 0.3.2 release;
- an isolated Version PR dry-run from that merged HEAD consumed every pending
  changeset and produced 0.4.0 for all 33 public npm packages, the Python wheel,
  and all three Rust crates. Protocol lockstep passed at 0.4.0; Go correctly
  requires the coordinated `clients/go/v0.4.0` tag because it has no versioned
  manifest.

Before a release may become `PASS`, the trusted release workflow must consume
those changesets into 0.4.0, execute the full no-retry matrix, install only the
sealed npm/PyPI/crates artifacts, verify registry bytes, and publish the
coordinated npm, `protocol/v0.4.0`, and `clients/go/v0.4.0` tags. Until those
external records exist, the campaign remains **IMPLEMENTED — EXTERNAL
CERTIFICATION PENDING**.
