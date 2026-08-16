---
title: Application logs
description: Turning log.error() into assertable test state — the termwright:log channel, file tails, logger bridges, and the error nobody asserted on.
---

A TUI cannot print diagnostics to the screen without corrupting its own render,
so applications write them to a logger instead — where a test can no longer see
them. That is the gap this closes: `log.error(...)` becomes test state you can
assert on, and an error nobody asserted on fails the test anyway.

## Following a log file

The zero-instrumentation path. Works with any program, in any language:

```ts
const app = await terminal.launch({
  command: ['node', 'editor.js'],
  logs: [{path: 'var/editor.log', label: 'editor'}],
});
```

A file that does not exist yet is waited for — programs create their log on
first write — and one that already exists is followed **from its current end**,
so a session never replays a previous run. Truncation and rotation restart the
tail rather than failing, with a `log-source` diagnostic saying why.

## Asserting on logs

```ts
await expect(app).toHaveLogged({level: 'info', message: /saved in \d+ms/});
expect(app.logs.filter({minLevel: 'warn'})).toEqual([]);
```

`terminal.logs` answers `all()`, `filter(query)`, `text(query)` and `clear()`.
A query narrows by `level`, `minLevel`, `source` (`'file' | 'adapter'`),
`label`, `logger`, `message` (substring or pattern) and `sessionId`.
`toHaveLogged` polls like every other matcher, so asserting right after an
action is safe.

`text()` renders entries without timestamps, sequence numbers or revisions, so
it is stable enough to snapshot:

```
info starting up
warn storage: disk almost full free=12
[editor] plain line from the file
```

## An error nobody asserted on fails the test

By default, a test that passes while the program logged an `error` fails anyway.
This is the assertion nobody writes: clicking through a flow while the program
logs `error: failed to save` is not a passing test, it is a test that did not
look.

```
The test passed, but the program logged 1 record at level error or above:
  error db: save failed

Assert on them with expect(terminal).toHaveLogged({ level: ... }), or turn the check off:
  for one test:   terminal.failOnLogLevel(false)
  for the suite:  defineTermwrightConfig({ failOnLogLevel: false })
```

Raise or lower the bar with `failOnLogLevel: 'warn' | 'fatal' | false`.

Two things it deliberately does not do. It never fails on a **file line** — a
followed file yields text, not levels, and guessing severity from the word
"error" would fail tests over a URL. And it never fires on a test that already
failed: the assertion that failed is the story.

When records never reached the test — dropped by the adapter, or refused over
budget — the failure says how many, because the list it prints is only what
arrived, and calling that the whole story would misrepresent the evidence.
`terminal.logs.lostRecords()` exposes the same number.

## Structured records: the `termwright:log` channel

`termwright:log` is a **documented public name**, not an implementation detail.
Anything may publish to it with no dependency on termwright at all:

```ts
import {channel} from 'node:diagnostics_channel';

channel('termwright:log').publish({level: 'error', message: 'payment failed'});
```

`@termwright/logs` adds normalisation and redaction at the source, plus a guard
for expensive context:

```ts
import {publishLog, hasLogSubscribers} from '@termwright/logs';

publishLog({level: 'warn', message: 'cache miss', attrs: {key: 'user:42'}});
publishLog(() => ({level: 'debug', message: expensiveDump()})); // thunk never runs unlistened
```

Two properties make this safe to leave wired up in production: **zero cost when
nobody is listening** (the input object is not even read), and **secrets
redacted at ingress**, before any subscriber sees a record — not at render time,
by which point the record has already been handed out.

## Logger bridges

```ts
import {termwrightDestination} from '@termwright/logs/pino';
const logger = pino({level: 'trace'}, termwrightDestination());

import {createWinstonTransport} from '@termwright/logs/winston';
winston.createLogger({transports: [createWinstonTransport()]});

import {termwrightReporter} from '@termwright/logs/consola';
createConsola({reporters: [termwrightReporter()]});

import {TermwrightLogRecordProcessor} from '@termwright/logs/otel';
new LoggerProvider({processors: [new TermwrightLogRecordProcessor()]});
```

The bridges are **optional peers**: nothing is imported unless you import the
matching subpath, so a project using pino never pulls in winston. Each bridge
implements the library's documented extension point structurally and imports
nothing from it, so it cannot drift from the version you installed — and the
bridge tests run against the *real* libraries rather than doubles, which is how
two integration bugs were caught.

## One line per language

An instrumented application publishes structured records over the semantic
channel. The adapter announces the `logs` capability, is granted a rate budget
in the handshake, and its records arrive with `source: 'adapter'`.

```python
from termwright.client import CAPABILITIES_WITH_LOGS
from termwright.logging_bridge import install_log_handler

client = client_from_env(adapter_name="my-tui", adapter_version="1.0.0",
                         capabilities=CAPABILITIES_WITH_LOGS)
if client is not None and await client.start():
    install_log_handler(client)   # every logging call now reaches the driver
```

```go
session, _ := termwright.Attach(app, root, termwright.WithLogs())
slog.SetDefault(slog.New(protocol.NewSlogHandler(session.Client(), nil)))
```

```rust
let layer = TermwrightLayer::new(Arc::new(Mutex::new(client)));
tracing_subscriber::registry().with(layer).init();
```

All three follow the dormant rule: `install_log_handler(None)` is a no-op,
`NewSlogHandler(nil, nil)` is never enabled, and the Rust `tracing` feature is
off by default. Levels map onto the wire's closed ladder, attributes flatten to
dotted keys, and a record the budget refuses **leaves a gap in `seq`** rather
than being renumbered — so a gap means records were dropped upstream, not that
two counters disagree.

## Redaction

Covered by default: credential-shaped values anywhere in text (bearer tokens,
JWTs, GitHub/AWS/Slack/OpenAI keys, private-key blocks, credentials in a URL)
and any attribute whose key looks like a credential (`password`, `token`,
`authorization`, `apiKey`, `cookie`, including dotted paths like
`req.headers.cookie`).

Deliberately **not** covered: generic high-entropy strings. Redacting anything
that "looks random" destroys git SHAs, request ids, checksums and trace ids —
the things that make a log worth reading — while protecting nothing a format
rule misses. Configure your own shape if your secrets have one:

```ts
subscribeToLogs(handler, {redaction: {keyPattern: /ssn|iban/i, replacement: '***'}});
```

Because the channel is public, redaction runs on **both** sides: at publish time
for records that went through the package, and again on receive for records that
did not. It is idempotent.

## In the trace and the runner

Logs are written to `logs.jsonl` in the archive — absent when the session logged
nothing — and the runner shows them in its Logs tab, on the same timeline as
everything else. Notable levels appear as marks on the scrubber, so an error is
something you can jump to.

Note that file lines are stored **raw** and carry the same handling caveat as a
crash report's screen tail: they are what the program wrote, unscrubbed.

## From a mounted component

For a harness the fixtures did not launch, subscribe yourself:

```ts
const app = await mountInk(<App />, {logs: [{path: 'var/app.log'}]});
collectLogs(app);
await expect(app).toHaveLogged({source: 'file', message: 'saved'});
```

A mount does **not** capture `console.*` by default, and that default is right:
a mounted component shares the runner's process, so its `console` is literally
Vitest's — capturing it would file the runner's output, and other tests' output,
as the component's log.
