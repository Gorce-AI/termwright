# @termwright/logs

Application log capture for terminal tests.

A TUI cannot print diagnostics to the screen without corrupting its own render,
so applications write them to a logger instead — where a test can no longer see
them. This package carries those records to termwright over the
`termwright:log` diagnostics channel, so `log.error(...)` becomes assertable
test state rather than an invisible side effect.

Two properties make it safe to leave wired up in production code:

- **Zero cost when nobody is listening.** `publishLog` checks for subscribers
  before it touches its input, so a thunk is never invoked and an input object
  is never even read.
- **Secrets are redacted at ingress**, before any subscriber sees a record —
  not at render time, because by then the record has already been handed out.

## Install

```sh
pnpm add @termwright/logs
```

The logger bridges are **optional peers**: nothing is imported unless you
import the matching subpath, so a project using pino never pulls in winston.

## Usage

```ts
import { publishLog, subscribeToLogs, hasLogSubscribers } from '@termwright/logs';

// --- In the application: one line, no termwright dependency required. ---
import { channel } from 'node:diagnostics_channel';
channel('termwright:log').publish({ level: 'error', message: 'payment failed' });

// Or, with this package, for normalisation and redaction at the source:
publishLog({ level: 'warn', message: 'cache miss', attrs: { key: 'user:42' } });

// Expensive context? Guard it — the thunk never runs without a listener.
publishLog(() => ({ level: 'debug', message: expensiveDump() }));
if (hasLogSubscribers()) {
  /* ... */
}

// --- In the harness: collect records. ---
const records: LogRecord[] = [];
const stop = subscribeToLogs((record) => records.push(record), {
  onInvalid: (detail) => console.warn('dropped a log record:', detail),
});

// Every record is already valid per @termwright/protocol and already redacted.
stop();
```

### Bridges

```ts
import pino from 'pino';
import { termwrightDestination } from '@termwright/logs/pino';
const logger = pino({ level: 'trace' }, termwrightDestination());

import winston from 'winston';
import { createWinstonTransport } from '@termwright/logs/winston';
winston.createLogger({ transports: [createWinstonTransport()] });

import { createConsola } from 'consola';
import { termwrightReporter } from '@termwright/logs/consola';
createConsola({ reporters: [termwrightReporter()] });

import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { TermwrightLogRecordProcessor } from '@termwright/logs/otel';
new LoggerProvider({ processors: [new TermwrightLogRecordProcessor()] });
```

Each bridge implements the library's documented extension point structurally
and imports nothing from it, so it cannot drift from the version you installed.
The bridge tests run against the **real** libraries rather than doubles — which
is how two integration bugs were caught: winston reads `transport.log.length`
to spot legacy transports (so the method must exist), and consola carries the
message in `args[0]`, not in `message`.

## The channel is a public contract

`termwright:log` is a documented name, not an implementation detail. Anything
may publish to it with no dependency on termwright, and the subscriber side
normalises, redacts and validates whatever arrives. A publisher may therefore
send a pino-shaped object, a winston-shaped one, or the protocol's own
`LogRecord`; all three land as a valid record.

Because the channel is public, redaction runs on **both** sides: at publish
time for records that went through this package, and again on receive for
records that did not. Redaction is idempotent.

## Redaction

Default coverage: credential-shaped values anywhere in text (bearer tokens,
JWTs, GitHub/AWS/Slack/OpenAI keys, private-key blocks, credentials embedded in
a URL) and any attribute whose key looks like a credential (`password`,
`token`, `authorization`, `apiKey`, `cookie`, …, including dotted paths like
`req.headers.cookie`).

Deliberately **not** covered: generic high-entropy strings. Redacting anything
that "looks random" destroys git SHAs, request ids, checksums and trace ids —
the things that make a log worth reading — while protecting nothing a format
rule misses. Configure `keyPattern`/`valuePatterns` if your secrets have a
house shape.

```ts
subscribeToLogs(handler, {
  redaction: { keyPattern: /ssn|iban/i, replacement: '***' },
});
```

## Record shape

Records are `LogRecord` from `@termwright/protocol`: `ts` (epoch ms), `level`
(`trace`…`fatal`), `message`, `seq`, and optional `attrs`, `logger`,
`revision`. Normalisation never fails — it coerces, flattens nested attributes
with dot notation, and truncates — because dropping a diagnostic for being
slightly the wrong shape is worse than shortening it.

`seq` is assigned by the publisher and preserved on receive, so a **gap means
records were dropped upstream** rather than that two counters disagree.

## Development

```sh
pnpm --filter @termwright/logs build
pnpm --filter @termwright/logs typecheck
pnpm --filter @termwright/logs test
pnpm --filter @termwright/logs test:hostile   # same suites, 128 MB heap cap
```
