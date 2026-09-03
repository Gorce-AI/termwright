# Resource-aware scheduling

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Host capacity and planning

The CLI resolves the selected policy at host startup rather than treating a
profile name as a fixed worker count. The detector combines Node's available
parallelism with Linux cgroup v2/v1 CPU quotas, takes the smaller of host and
cgroup memory, reserves memory for the OS/host, and measures free space on the
artifact filesystem. An unavailable disk metric remains `unavailable`; it is
never represented as zero.

The effective worker and terminal ceilings are deterministic minimums of the
named policy ceiling and detected CPU, memory, and disk slots. Both equations
are stored as decision strings. Synthetic 2 CPU/2 GiB, 4 CPU/7 GiB, high-memory,
and disk-constrained profiles are executable tests.

## Atomic attempt admission

The existing `ResourceBroker` remains the only scheduler. Its resource vector
now includes `cpuWeight`, `memoryWeight`, and `ioWeight` alongside PTY, process,
semantic endpoint, native-host, and trace capacity. Every collected test gets a
normal per-attempt vector, including pure Vitest tests. `test.resources()` adds
a closed `load: light | normal | heavy | exclusive` hint; users do not provide
megabytes. `hostPressure: 'exclusive'` reserves the complete CPU, memory, I/O,
and native-host capacity rather than only excluding another native-host user.
Complete vectors are admitted atomically and resource pressure queues work
without changing trace or semantic fidelity.

Broker snapshots explain queued work with the exact limiting resources and FIFO
head-of-line reason. Run configuration and run-manifest provenance contain the
effective capacities, per-attempt cost, detected host budget, and planner
decisions, so CI admission is inspectable rather than guessed.

A deliberately small reference scheduler independently reconstructs strict
FIFO admission for new attempts from only capacities, queued vectors, and
releases. Sixty-four seeded generated workloads compare every broker snapshot
with that model. Each run asserts that no resource exceeds capacity, every
individually admissible request completes, and two executions of the same seed
produce the same grant waves. Holding every resource behind an initial barrier
forces heavy and light requests through the queue and makes starvation or
younger-attempt bypass observable rather than timing-dependent.

One bounded exception is required for liveness: an already-active attempt may
acquire a fitting continuation resource ahead of a blocked new attempt. Without
that rule, an active test holding CPU weight can deadlock while requesting its
first terminal behind an exclusive waiter that needs the CPU weight to be
released. The regression test holds a base lease, queues an exclusive waiter,
then proves the active attempt can acquire and release its terminal before the
exclusive waiter runs. It does not permit a new light attempt to bypass FIFO.

A separate schedule-independence oracle runs the same isolated suite with
serial, two-slot, and six-slot capacities, changes request order, and reverses
release order. It compares the sorted user-visible verdict and essential
evidence for every test. Lease IDs, admission timing, and completion order are
intentionally excluded: they are scheduler provenance, not test evidence.

## Historical cost feedback

The Native Host maintains one local, advisory `resource-costs-v1.json` beside
the run-history directory. Stable test identity is stored only as a SHA-256 of
project, normalized file, full name, and source location. Each of at most 2,048
entries retains the newest 32 duration and worker-RSS measurements. P50, p95,
and EWMA are computed from those bounded samples; malformed or oversized cache
data becomes a conservative cache miss.

Historical p95 worker RSS may only raise `memoryWeight`; it never lowers an
explicit declaration or changes CPU/I/O from duration alone. The conversion
uses the detected host memory budget per broker weight and caps at the existing
ResourceBroker capacity. Every task carries its cache hit/miss, sample count,
quantiles, and final vector into the authoritative `attempt.started` event.
Cache persistence is private (`0700` directory, `0600` atomic replacement),
contains no terminal output or test names, and cannot invalidate already
committed run evidence.

Local Node 24 evidence on 2026-09-02 ran the same Native Host identity twice:
the first canonical start recorded `history=miss`; the second recorded a
one-sample hit with duration p50/p95, RSS p95, and the resulting unchanged
conservative vector. The cache contained 51 hashed entries, was `0600`, and the
focused storage/host/real-runner matrix passed 51/51 tests without retry.

## Remaining evidence

Windows whole-job CPU, peak memory, process-count, and I/O accounting is now
implemented through the already-owned Job Object and published with explicit
metric source/kind/unit metadata. POSIX deliberately reports whole-tree
accounting as `unavailable` instead of polling an ambiguous PID tree. External
Node 22/24 and constrained Linux/macOS/Windows runs are still pending; until
then this area is not PASS.
