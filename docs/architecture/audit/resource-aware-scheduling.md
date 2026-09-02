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

## Remaining evidence

Historical p50/p95 cost feedback and whole-process-tree CPU/RSS accounting are
not part of this checkpoint. Windows Job Object metrics and truthful POSIX
capability reporting still require implementation. External Node 22/24 and
constrained Linux/macOS/Windows runs are also pending; until then this area is
not PASS.
