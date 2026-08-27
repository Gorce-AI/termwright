# `@termwright/resource-broker`

The authoritative, Node-only resource scheduler used by Termwright's native
test host. It prevents parallel workers from overcommitting pseudo-terminals,
external processes, semantic endpoints, and trace writers.

Most test suites should select a
[Termwright resource profile](https://gorce-ai.github.io/termwright/reference/configuration/#resource-profiles)
instead of importing this package. The direct API exists for host integrations
and deterministic scheduler tests; those integrations can install it with
`pnpm add @termwright/resource-broker`.

## Scheduling contract

A request reserves its complete resource vector atomically or waits in the
visible FIFO queue. Smaller requests cannot bypass the head and starve an older
multi-resource request. Deadlines, aborts, worker epochs, attempt ownership, and
lease tokens fail closed. A lease reports attached process/session identities
and must be released explicitly.

```ts
import { ResourceBroker } from '@termwright/resource-broker';

const broker = new ResourceBroker({
  runId,
  capacities: {
    ptySession: 4,
    externalProcess: 4,
    semanticEndpoint: 4,
    traceWriter: 4,
  },
});

broker.registerWorker({ runId, workerId: 'worker-1', workerEpoch: 1 });
const lease = await broker.acquire({
  runId,
  workerId: 'worker-1',
  workerEpoch: 1,
  attemptId,
  resources: { ptySession: 1, externalProcess: 1 },
  deadline,
});

await lease.attach([{ resource: 'externalProcess', pid: child.pid }]);
await lease.release();
```

`snapshot()` returns capacities, current use, active leases, attachments, and
queued requests for diagnostics. It is observational and does not grant
resources.

## Worker transport

`@termwright/resource-broker/transport` exposes the authenticated local IPC
server and client used between the host and Vitest workers. The server creates a
random token by default, requires `hello` before requests, binds identity to the
current run and worker epoch, bounds frames/connections/request counts, and uses
constant-time token comparison. Treat both its endpoint and token as ephemeral
secrets; do not expose the transport on a network or persist credentials.

Node.js 22 and 24 are supported.
