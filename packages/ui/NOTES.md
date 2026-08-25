# @termwright/ui — implementation notes

## Projection, not execution

The UI is a projection of the Termwright Native Host and persisted traces. It
never starts Vitest, parses reporter stdout, reconstructs test identity or owns
correctness events. `termwright test`, `watch`, and `ui` share one persistent
host, EventJournal and ResourceBroker.

The WebSocket remains useful for attached terminal sessions and browser
controls. Test/run lifecycle comes from the host's versioned journal and is
projected into the browser protocol in process. A disconnected or slow browser
cannot change a run result.

## Identity

Discovery uses programmatic native collection. Every catalogue row carries an
invocation-scoped RunnerTaskId plus provider-authored metadata. Targeted runs
send that id back unchanged. Attempt start/end messages carry the exact
AttemptId, ExecutionId and RunnerTaskId. File/title are display and source facts
only; no file-title parser or reconciliation fallback exists.

Run start carries the host's collision-safe RunId. Stop names that exact RunId,
so a stale request cannot cancel a subsequent watch run. Historical manifests
remain tied to the Git/runtime provenance that produced them and are never
heuristically adopted by the current catalogue.

## Evidence and terminal state

Every attached session announces its terminal profile and frozen Effective
Session Contract before dependent output/tree events. Session ownership uses
AttemptId. Semantic values are projected through the artifact policy before
they reach the hub; the browser never receives plaintext merely to redact it
later.

The terminal pane consumes raw PTY bytes as base64 and uses the announced width
profile. Semantic revisions, action plans and actionability explanations retain
their evidence provenance. Trace replay goes only through `@termwright/trace`
readers and exposes complete/incomplete/corrupt/unsupported artifact states.

## Bounded diagnostics

The hub and live-session producer are bounded projections: total replay bytes,
output bytes, pre-connect producer bytes and each viewer transport buffer have
independent ceilings. A slow viewer is disconnected without affecting another
viewer or the run. Semantic state coalesces to its latest validated revision;
lossy eviction is represented by a diagnostic gap. Authoritative run events and
correctness log decisions live in the host journal/trace sinks.
Projection loss must be represented as an explicit diagnostic gap before the
Runner may claim its diagnostics are complete. Recoverable session/tree state
may coalesce, while lifecycle identities are never inferred from remaining
messages.

## Lifecycle

Server startup owns every watcher, recorder, trace reader, socket and listener
transactionally. Bind failure rolls back prior acquisitions. Close attempts all
cleanups and aggregates failures. Browser RPCs for run/stop return typed HTTP
outcomes rather than fire-and-forget promises.

## Security

The server binds loopback by default and generates separate random viewer and
producer capabilities. A viewer credential cannot publish and a worker
credential cannot read/control. Producer sockets claim session ownership and
cannot publish lifecycle; semantic snapshots are fully validated before they
enter the hub. Paths and RunIds are validated before filesystem use. Raw
input recording is opt-in; redacted is the default. The diagnostics copy action
excludes tokens, URLs, paths, commands, output, logs, semantic content and
errors.
