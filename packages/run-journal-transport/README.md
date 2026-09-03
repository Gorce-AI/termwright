# `@termwright/run-journal-transport`

Authenticated local IPC for authoritative run events emitted by Termwright's
Vitest workers. The Native Host owns the server and journal sink; workers use a
client bound to one run and one worker incarnation. Application test suites do
not normally import this package.

Native-host integrations can install it with
`pnpm add @termwright/run-journal-transport`.

```ts
import { connectRunJournalWorker, startRunJournalServer } from '@termwright/run-journal-transport';

const server = await startRunJournalServer({
  runId,
  append: (event) => journal.append(event),
});

const client = await connectRunJournalWorker({
  endpoint: server.endpoint,
  token: server.token,
  runId,
  workerId: 'worker-1',
  workerEpoch: 1,
  handshakeDeadline,
});

client.enqueue(event, deadline); // synchronous bounded admission for hot paths
await client.drain(); // lifecycle barrier: every admitted batch was acknowledged
await client.flush(deadline);
await client.close();
await server.close();
```

The first frame must authenticate and identify the run and worker. The host
assigns the event producer identity; a worker cannot choose or reuse it. A newer
worker epoch invalidates the previous connection, and events whose run,
producer, epoch, order, or schema disagrees with that binding fail closed.

`enqueue()` either admits immediately or throws before allocating deferred work;
the queue is bounded by both event count and serialized bytes. Background
delivery failures are retained and rethrown by `drain()`, `flush()`, or
`close()`. Use `append()` only when the caller needs acknowledgement for that
individual event.

Frames are length-prefixed JSON with a 384 KiB ceiling. Tokens are random by
default and compared in constant time. Append, flush, handshake, and shutdown
have explicit ownership or deadlines, so a missing acknowledgement cannot be
reported as durable progress. Server shutdown stops intake, drains every
already-received append, closes the endpoint, and rejects if the journal sink
failed. Keep endpoints and tokens process-local and ephemeral; this transport
is not a network API.

Node.js 22 and 24 are supported. Use the typed client rather than depending on
the wire representation.
