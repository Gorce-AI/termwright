# `@termwright/run-history`

Transactional storage and strict reading for Termwright Native Host run
manifests. The Runner and reporters consume these records; ordinary test suites
use `termwright` and do not write manifests themselves.

Host and reporter integrations can install the storage API with
`pnpm add @termwright/run-history`.

Each run starts in a private staging directory. Event batches append to an
independently checksummed `events.ndjson`; no complete journal array is needed
by the writer. Commit writes the bounded manifest, binds it to the event count,
byte length, and SHA-256 digest, writes the commit marker, then atomically
renames the directory into place and syncs its parent. A colliding RunId fails
instead of overwriting history. The canonical journal, attempt index, result,
runtime, resource profile, timeouts, and CI/Git provenance are verified by the
reader. Manifest v5 also requires capability-aware resource telemetry. Coordinator
CPU/RSS and bounded-journal metrics are numeric measurements. Metrics the host
cannot yet observe authoritatively, such as whole-process-tree RSS on POSIX,
are the literal `unavailable`, never a fabricated zero.

The canonical stream fails with an explicit capacity error above 1,000,000
events or 512 MiB. Authoritative evidence is never silently dropped, and an
untrusted manifest cannot make the materializing reader allocate beyond those
bounds.

Manifest status preserves `passed-with-skips` as a separate terminal verdict.
Readers must not collapse it into `passed`: the Native Host evaluates the
exact skip policy separately when deciding the command's certification result.
The manifest verdict alone never proves that policy matched. Its canonical
journal retains the applicable declarations, identity-bound skipped tests,
policy issues, and aggregate policy result so an evidence reader can audit the
decision without relying on attempt counters.

```ts
import { beginRunManifest, readRunHistory } from '@termwright/run-history';

const transaction = await beginRunManifest('.termwright/runs', start);
await transaction.appendEvents(eventBatch);
await transaction.commit(manifest);

const records = await readRunHistory('.termwright/runs');
for (const record of records) {
  if (record.state === 'complete') console.log(record.manifest.status);
  else if (record.state === 'unsupported-version') console.warn(record.state, record.version);
  else console.warn(record.state, record.reason);
}
```

Readers return explicit `complete`, `incomplete`, `corrupt`, or
`unsupported-version` records. They never reinterpret a partial transaction or
unknown format as a successful run. `readRunManifest()` addresses one typed
RunId; `readRunHistory()` returns newest records first and accepts a result
limit.

`NODE_RUN_MANIFEST_WRITER` is the durable filesystem implementation. Supplying
a custom `RunManifestWriter` is intended for alternative stores and fault
tests; it must preserve exclusive creation, append order, event-file and
directory durability, and atomic rename semantics.

Node.js 22 and 24 are supported. The on-disk format is internal release data;
consume it through this package rather than reading its files directly.
