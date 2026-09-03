# Termwright post-0.4.1 final core-maturity campaign

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

The campaign started from fetched `origin/main` at
`ba2efcf0f74a660281749385682d3d21fbdc2131`. The `protocol/v0.4.1` tag resolves
to `cd8c7e28b5760cfe9cb094f90c1731800b2eeda4`; the two intervening commits were
the user-facing documentation redesign and its trace dependency fix. The source
audit and local evidence below cover campaign commits through
`640bead0f7fa6393ea0bb9d22c3dd6357ae8a373`.

This is a post-0.4.1 report. The earlier
[0.4 production-maturity report](production-maturity-0.4-report.md) remains the
historical record for Unicode, semantic protocol v3, Trace v4, artifact security,
and the first polyglot clean rooms. This campaign did not rewrite those working
foundations.

## Unicode and canonical terminal model

1. **Baseline:** 0.4.1 already used one xterm/headless parser with the
   Termwright-owned Unicode 15 extended-grapheme provider; the remaining work
   was certification and removal of leaked Unicode-version/profile API.
2. **Problem:** the upstream experimental grapheme addon still constructs views
   over pooled Node buffers without respecting `byteOffset`/`byteLength`, while
   current Ghostty wrappers do not expose the complete stable headless contract.
3. **Alternatives researched:** xterm Unicode 11, offset-fixed xterm graphemes,
   owned xterm graphemes, `ghostty-web`, `@wterm/ghostty`, libvterm, and Termless's
   backend/conformance organization.
4. **Source evidence:** upstream xterm issue 6079 remains the pooled-buffer
   defect; the isolated load harness distinguishes import, activation, trie
   initialization, first write, and corpus completion under Node, Vitest
   threads/forks, Vite module-runner on/off, and the Native Host.
5. **Chosen design:** xterm/headless remains the sole production emulator;
   Ghostty and libvterm are independent differential references.
6. **Implementation:** the public profile is now the closed behavior choice
   `default | cjk-wide`; Unicode versions and backend selection are not public
   configuration.
7. **Removed:** the last public Unicode-version-shaped profile type, the `kitty`
   alias, and any production dependency on the experimental addon.
8. **Correctness:** the 23-case corpus checks text, cells, continuation cells,
   cursor, semantic rectangles, pointer hit-testing, screenshots, and replay for
   combining text, VS15/16, modifiers, ZWJ, flags, keycaps/tags, Arabic, Indic,
   Hangul, Thai, bidi, CJK, ambiguous width, and zero-width cases.
9. **Performance:** local Node 24 research measured roughly 32 ms startup,
   29 ms corpus execution, and 24 MiB process RSS for the selected provider.
10. **External certification:** the isolated loader has Node 22 and Node 24
    evidence; this source revision still needs the trusted Linux/macOS/Windows
    matrix before the area can be called PASS.
11. **Limitations:** terminal cell order is not font shaping or browser bidi;
    the orphan-zero-width difference remains explicitly classified.

Full decision and rejected-candidate table:
[unicode-terminal-engine-decision.md](unicode-terminal-engine-decision.md).

## Bounded EventJournal

1. **Baseline:** the 0.4.1 journal and server were bounded, but a worker could
   retain an unbounded `pending.then(...)` chain before transport admission.
2. **Root cause:** count/byte capacity was enforced after asynchronous work and
   one RPC Promise had already been allocated per event.
3. **Alternatives:** fully async admission on every event versus bounded
   synchronous enqueue followed by asynchronous batch drain.
4. **Source evidence:** an intentionally blocked sink reproduced growth ahead
   of the server boundary.
5. **Chosen design:** synchronous count-and-byte admission on the hot path,
   bounded batches, and an awaited attempt/run drain barrier.
6. **Implementation:** at most 64 events / 256 KiB per batch; microtasks reduce
   latency, while explicit `drain()` and `close()` provide correctness.
7. **Removed:** the duration-proportional Promise chain and one-RPC-per-event
   wire contract.
8. **Correctness:** saturation is a typed capacity failure, authoritative events
   never drop, order is preserved, sink errors survive until finalization, and
   saturated shutdown drains or fails explicitly.
9. **Performance:** a real 11-test PTY run used two sink calls and peaked at 244
   pending events / 174,562 pending bytes.
10. **External certification:** local macOS ARM64/Node 24 and slow-consumer
    stress pass; other supported hosts remain pending.
11. **Limitations:** an explicitly opened completed-run view may materialize the
    independently bounded persisted stream.

Decision record: [bounded-event-journal.md](bounded-event-journal.md).

## Resource scheduler and telemetry

1. **Baseline:** 0.4.1 had capacity detection and weighted admission, but lacked
   an independent scheduler oracle and published only partial process metrics.
2. **Root causes:** scheduler safety was tested mainly by examples; Windows Job
   Object accounting was owned but not exposed; `hostPressure` excluded only
   another native-host user rather than all host pressure.
3. **Alternatives:** a second scheduler, PID-tree polling, strict FIFO for every
   acquisition, and extension of the existing ResourceBroker.
4. **Source evidence:** 64 seeded generated workloads compare every grant wave
   with a small independent model. A mixed Go/Ink workload also exposed a real
   hold-and-wait deadlock: an exclusive waiter blocked a terminal continuation
   needed by the active attempt that held its CPU capacity.
5. **Chosen design:** one ResourceBroker; FIFO for new attempts; fitting
   continuation priority only for an already-active attempt; full-vector
   `hostPressure: 'exclusive'`; platform-qualified telemetry.
6. **Implementation:** CPU/memory/I/O/PTY/process/semantic/native-host/trace
   admission, cgroup-aware host capacity, bounded history, deterministic reasons,
   Windows Job CPU/memory/process/I/O fields, and explicit unavailable values.
7. **Removed:** the misleading interpretation of host exclusivity and the risk
   of publishing unlike platform metrics under a generic RSS label.
8. **Correctness:** no generated schedule exceeds capacity; admissible work
   completes; new light work cannot bypass an older heavy attempt; active
   continuation cannot deadlock; serial/two-slot/six-slot schedules yield the
   same verdict and essential evidence.
9. **Performance/resources:** the deterministic 2 CPU / 2 GiB profile admits at
   most two workers and three terminals; history can only raise conservative
   memory cost and cannot make a runnable test permanently inadmissible.
10. **External certification:** the Windows native query is implemented and
    contract-tested but requires a completed Windows workflow. POSIX accurately
    reports whole-tree accounting as unavailable.
11. **Limitations:** there is no portable non-polling POSIX whole-tree memory
    primitive and no fabricated cross-platform replacement; concurrent
    host-wide temp peak is likewise not inferred from per-writer peaks.

Decision records: [resource-aware-scheduling.md](resource-aware-scheduling.md)
and [resource-telemetry.md](resource-telemetry.md).

## Performance and resource ratchets

1. **Baseline/problem:** several resource claims used single start/end samples
   or had no independent structural oracle.
2. **Alternatives:** arbitrary wall-time percentages versus deterministic
   counters and repeated-window trend estimates.
3. **Chosen design:** exact count/byte ratchets first; noisy RSS evidence uses
   warm-up, repeated windows, ranges, and a Theil-Sen trend.
4. **Implementation/correctness:** schedule-independence compares user-visible
   evidence only; trace certification measures four steady windows after four
   warm-up windows and rejects both sustained slope and excessive range.
5. **Local evidence:** the 20,000-event / 81.92 MB trace reached a sampled
   212,140,032-byte process peak, 819,200-byte steady RSS range,
   300,373 bytes per 2,500-event Theil-Sen trend (120.15 B/event), and
   131,072-byte finalization growth.
6. **Removed:** the range or start/end delta being described as a memory slope.
7. **External certification/limitations:** machine-sensitive CPU/RSS/wall-time
   values remain qualification evidence, not narrow shared-runner ratchets.

Detailed table and methodology:
[production-performance-ratchets.md](production-performance-ratchets.md).

## Vitest engine boundary

1. **Baseline:** Vitest was embedded, but public package subpaths and helper
   packages still made the engine boundary look extensible.
2. **Root cause:** host/worker code and package tests could reach engine-specific
   exports outside the one intended adapter.
3. **Alternatives:** mutable `onFinished`/`onFailed`, `onAfterRetryTask`,
   `aroundEach`, and `onAfterRunTask` were checked against Vitest 4.1.11 source.
4. **Chosen design:** the private `TermwrightTestRunner` owns ALS and uses public
   per-try `onAfterRetryTask`; `onAfterRunTask` is only a fail-closed barrier.
5. **Implementation:** the engine package is private and packed into the CLI;
   an executable boundary test rejects public Vitest-facing imports and proves
   a tarball consumer still runs with its own Vitest installation.
6. **Removed:** public `@termwright/test/runner`,
   `@termwright/test/vitest-engine`, `@termwright/resource-broker/vitest`, and
   mutation of task completion arrays.
7. **Correctness/performance:** attempt finalization still occurs once per real
   try after public hooks/fixtures; no extra runner layer was added to hot paths.
8. **External certification/limitations:** direct consumer `aroundEach` teardown
   is outside Vitest's public per-try hook and is not falsely claimed as committed
   attempt evidence; Node/OS packaging rows remain pending.

Decision record: [vitest-engine-boundary.md](vitest-engine-boundary.md).

## Clean rooms, documentation, and public surface

1. **Baseline:** packed Ink/OpenTUI and polyglot examples existed, but README,
   Getting Started, CLI/configuration prose, compatibility tables, and exports
   could still drift independently.
2. **Root cause:** duplicated snippets/tables were human-maintained and every
   package export had not been classified as intentional public surface.
3. **Alternatives:** documentation-only review versus extracting exact snippets
   and deriving/validating content from executable sources.
4. **Chosen design:** documentation is a tested product contract; packaging
   canaries consume tarballs, wheels, archived Go modules, and packaged crates.
5. **Implementation:** README and Getting Started fences materialize byte-for-byte
   into a fresh tarball project, then run `doctor` and `test`; CLI/configuration
   tables are checked against parser/types; compatibility comes from the registry;
   sitemap, canonical URLs, robots, anchors, API references, and internal links
   are gated.
6. **Removed:** accidental UI provider, public runner subpaths, and the misleading
   `probe-ink/internal/testing` name. All 33 public packages and exports are
   classified in `quality/public-api-surface.json`.
7. **Correctness:** local required examples pass 22/22 with no skips across Ink,
   OpenTUI, Textual, Bubble Tea, tview, and Ratatui; the packed boundary test
   verifies consumer Vitest coexistence.
8. **Documentation evidence:** the static build contains 320 pages; 18,765
   internal links and 320 sitemap entries pass with zero broken links.
9. **External certification:** wheel/tarball/crate/source-archive clean rooms are
   defined in required CI. Their completed Linux records and the Node/OS release
   matrix are still pending for this revision.
10. **Limitations:** the local macOS run used an isolated Python environment but
    did not pretend to be the release artifact registry verification step.

Surface record: [api-config-error-surface.md](api-config-error-surface.md).

## Required resource report

`UNAVAILABLE` means there is no comparable 0.4.1 measurement or no honest
platform capability. It never means zero.

| Metric                              |      Before |                                      After |
| ----------------------------------- | ----------: | -----------------------------------------: |
| journal peak pending events         |   unbounded |                                        244 |
| journal peak pending bytes          |   unbounded |                                  174,562 B |
| journal RPC calls                   | UNAVAILABLE |                                          2 |
| long-run RSS slope                  | UNAVAILABLE |  300,373 B / 2,500 events (120.15 B/event) |
| trace peak RSS                      | UNAVAILABLE |           212,140,032 B process-level peak |
| temp disk peak                      | UNAVAILABLE |                82,909,700 B writer staging |
| worker peak memory                  | UNAVAILABLE |                              220,561,408 B |
| owned-process memory metric         | UNAVAILABLE | Windows peak job memory; POSIX UNAVAILABLE |
| max safe concurrency, 2 CPU / 2 GiB |      static |                 2 workers / 3 PTY sessions |
| full-suite wall time                | UNAVAILABLE |      330.94 s local Native Host test phase |
| semantic bytes                      | UNAVAILABLE |   26,279 B in the measured 11-test PTY run |
| final artifact bytes                | UNAVAILABLE |  116,472 B in the measured 11-test PTY run |

## Final certification table

| Requirement                       | Status                                       | Evidence                                                                |
| --------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------- |
| Full grapheme correctness         | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | 23-case geometry/action/replay corpus; supported-OS rerun pending       |
| Canonical emulator decision       | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | xterm/headless + owned Unicode 15; decision table complete              |
| Differential terminal conformance | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | Ghostty and libvterm ledger; release-matrix run pending                 |
| Bounded EventJournal              | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | synchronous count/byte admission and blocked-sink stress                |
| Journal batching                  | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | 64-event/256-KiB bounds; two calls in measured run                      |
| Adaptive resource scheduling      | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | cgroup-aware planner, 64-seed reference oracle, continuation regression |
| Whole-process telemetry           | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | qualified Windows Job metrics; POSIX explicitly unavailable             |
| Temp-disk telemetry               | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | exact per-writer staging peak; host-wide concurrent peak unavailable    |
| Resource regression ratchets      | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | structural counters plus warm-up/windowed Theil-Sen trace oracle        |
| Vitest adapter cleanup            | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | private provider package and packed-boundary test                       |
| Textual clean-room                | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | local isolated Python run; trusted wheel job pending                    |
| Go clean-room                     | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | packaged Bubble Tea/tview jobs; trusted run pending                     |
| Rust clean-room                   | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | packaged Ratatui job; trusted run pending                               |
| Long-run clean-room               | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | short local qualification and 30 s/180 s nightly oracle                 |
| Executable README                 | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | exact snippet tarball test                                              |
| Executable docs                   | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | docs/parser/registry/API/link gates                                     |
| Expected skip ledger              | PASS                                         | local run matched all declared identities; zero failures                |
| Linux Node 22/24                  | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | required CI matrix defined; current revision not yet executed           |
| macOS Node 22/24                  | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | local Node 24 passes; Node 22 and trusted matrix pending                |
| Windows Node 22/24                | IMPLEMENTED — EXTERNAL CERTIFICATION PENDING | required x64/ARM64 CI matrix defined; current revision not yet executed |

## Local release-candidate evidence

- `check:fast`: package metadata, docs contracts, platform deviations,
  determinism, semantic completeness, mission completion, and protocol lockstep
  passed.
- Native build and PTY EOF certification passed on macOS ARM64/Node 24.1.0;
  1,048,612 bytes drained to authoritative EOF.
- The full Native Host phase passed 3,551 tests across 321 passing files, with
  53 exact declared platform/capability skips, one fully skipped file, and no
  failures. Retries were disabled.
- Deterministic-core coverage passed 480/480 tests at 89.45% statements,
  85.53% branches, 92.16% functions, and 91.02% lines.
- Darwin fast-exit passed 32 waves / 128 exact tails; compatibility passed
  20/20; all required examples passed 22/22 without skips after installing the
  Python client and Textual in an isolated environment.
- Packed private boundaries, all package/example typechecks, generated docs,
  protocol vectors, the 320-page website, and the zero-broken-link gate passed.

The campaign is not labelled PASS until trusted CI executes this exact source
lineage across the required OS/Node matrix and release artifact verification.
