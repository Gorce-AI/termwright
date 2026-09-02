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
megabytes. Complete vectors are admitted atomically and resource pressure queues
work without changing trace or semantic fidelity.

Broker snapshots explain queued work with the exact limiting resources and FIFO
head-of-line reason. Run configuration and run-manifest provenance contain the
effective capacities, per-attempt cost, detected host budget, and planner
decisions, so CI admission is inspectable rather than guessed.

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

Whole-process-tree CPU/RSS accounting is not part of this checkpoint. Windows
Job Object metrics and truthful POSIX capability reporting still require
implementation. External Node 22/24 and constrained Linux/macOS/Windows runs
are also pending; until then this area is not PASS.
