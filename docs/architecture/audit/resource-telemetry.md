# Resource telemetry

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

Native run manifest v4 has one required, validated resource-telemetry record.
The host measures coordinator CPU deltas, start/end RSS, a 50 ms sampled RSS
peak, PTY slot peak, journal admissions/bytes, sink batches, and peak bounded
journal backlog. Sampling starts with the synchronous run request and is always
stopped when the run completes, including failed history startup.

The schema uses the literal `unavailable` where ownership or platform support
does not justify a number. In particular, the current checkpoint does not call
root-process RSS “whole tree RSS”, does not infer process count from scheduler
slots, and does not invent terminal, semantic, trace, temp-disk, or final
artifact byte counts. Zero remains meaningful only for an available counter
that observed no use, such as PTY slots in a pure unit run.

The run-history reader accepts only manifest v4. There is no v3 reader or
migration path.

Remaining work is explicit: worker reporting, Windows Job Object accounting,
a capability-qualified POSIX process-tree collector, and direct byte counters
from driver/semantic/trace artifact ownership. Cross-platform Node 22/24 runs
remain external certification evidence.
