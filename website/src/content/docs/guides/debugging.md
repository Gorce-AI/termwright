---
title: Debugging a failing test
description: The debug log, crash reports, diagnostics, and the one rule that saves the most time — what "matched 0 nodes" on a correct-looking screen actually means.
---

## Start here: matched 0 nodes on a screen that looks right

The single most useful diagnostic rule in this project, learned the expensive
way while writing the examples:

:::danger[A locator matching nothing while the screen looks correct is not a selector problem]
It means the **semantic channel died**. The screen keeps rendering because the
application is fine — the tree stopped arriving.
:::

Rewriting the selector will not help, and the hour spent rewriting it is the
cost of not knowing this. Check, in order:

```ts
app.capabilities().semanticTree;   // false: no adapter, or the handshake never completed
app.semanticTree();                // null: nothing paired yet
app.diagnostics();                 // the actual reason
```

The diagnostics name the failure directly: `negotiation-timeout` (no adapter
answered in the window), `adapter-disconnected` (it went away mid-session),
`protocol-violation` (the channel was closed on a bad frame),
`marker-unverified`, `revision-expired`. Every termwright error message also
carries `semanticTree: true|false`, so a failure tells you which world you were
in when it happened.

## The debug log

```sh
TERMWRIGHT_DEBUG=1 npm test
```

Or `debug: true` on a launch. This is the terminal equivalent of Playwright's
`DEBUG=pw:api` — a live log to stderr of what was called, what was awaited, and
how each ended:

```
  tw:api  [c87be6be]   0.229s getByRole("button", {"name":"Approve"}) → getByRole("button", name=~"Approve")
  tw:api  [c87be6be]   0.229s locator.click() started
  tw:sem  [c87be6be]   0.251s semantic revision 1 published (tree and marker paired)
  tw:api  [c87be6be]   0.253s locator.click() succeeded in 24 ms
  tw:wait [c87be6be]   0.455s locator.resolve({"timeout":200}) failed after 202 ms: TimeoutError [timeout]: …
```

| Category | What it shows |
|---|---|
| `api` | calls, and how a locator was interpreted |
| `wait` | what was awaited, how long, how it ended |
| `vt`, `sem` | screen and semantic revisions |
| `diag` | diagnostics as they happen |
| `io` | raw PTY traffic — only with `TERMWRIGHT_DEBUG=all` |

The `sem` lines are what settle the question above: if you see revisions being
published, the channel is alive and the selector really is wrong. If they stop,
it is not.

The session token is never printed, and `paste` / `write` payloads are logged by
size only. Switched off, nothing is wrapped and no listener is registered.

## When the program dies on its own

A crash is not a test failure — it is the test losing its subject — so the
driver assembles one artifact instead of leaving you to reconstruct it:

```ts
const report = app.crashReport(); // null for a clean exit, close() or signal()
report?.screenTail;               // the panic or stack trace, as painted
report?.recentInputs;             // what was sent just before
report?.lastSemanticTree;         // the last paired revision, if any
```

It also arrives as a `crash` event just before `exit`, and any wait that can no
longer make progress fails with `process-exited` carrying a short excerpt of the
same tail. The exit is published only after the dying output has been parsed, so
the trace is in the report rather than still in flight.

Everything is bounded: 50 lines and 16 KiB of tail, 20 inputs, 20 diagnostics.

:::caution[Treat a crash report like a screenshot]
The screen tail is deliberately **unscrubbed** — it is what the terminal showed.
Pastes are recorded by size only, but whatever the program printed is in there
verbatim. Mind that when storing or forwarding archives.
:::

## Diagnostics

`terminal.diagnostics()` is the bounded, oldest-first log of what the session
decided on its own, and the same entries arrive live as `diagnostic` events — so
a test can assert on a failure mode instead of inferring it from prose.

Entries that stand for several things carry a `count`, so you never have to
parse message text: summing `count` over `log-dropped` answers "how many log
records never reached me". A repeated record carries none, because a duplicate
is not a loss.

Two diagnostics worth recognising:

- **`delta-resync`** — a tree delta could not be composed, so the driver asked
  for a full tree. Nothing was lost and the last good tree stayed observable;
  it is a repair, not damage. See [Protocol](../../reference/protocol/).
- **`ready-settled-screen`** — `waitForReady()` guessed from silence rather than
  observing an OSC 133 prompt mark. If readiness is flaky, this is why.

## The report and the recording

Every failure already has a recording: trace collection defaults to
`retain-on-failure`, so the archive of the failing test is kept. Open it in the
runner and scrub to the moment:

```sh
termwright ui --trace termwright-report/<test>.twtrace
```

The HTML report adds the visual diff, the semantic diff in plain sentences, and
the failing step highlighted. See [Traces and reports](../traces/).

## A short checklist

1. Does `capabilities().semanticTree` say `true`? If not, the adapter never
   attached — nothing about locators matters yet.
2. Does `TERMWRIGHT_DEBUG=1` show `sem` revisions arriving? If they stop
   mid-test, the channel died; read `diagnostics()`.
3. Did the program crash? `crashReport()` is not null, and its `screenTail`
   usually says exactly what happened.
4. Did it log something? An `error` record fails the test by itself — see
   [Application logs](../app-logs/).
5. Is the assertion racing the tree? A screen wait can precede the matching
   semantic revision; the matchers poll through that gap, direct tree reads need
   `waitForStable()`.
6. Only then: is the selector wrong?
