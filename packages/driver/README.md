# @termwright/driver

The heart of termwright: a real PTY plus a standards-grade VT emulator, with
Playwright-shaped locators, actions and waits on top.

One session owns one pseudo-terminal, one `@xterm/headless` emulator and one
private semantic endpoint. Uninstrumented programs are observed through the grid
(text, cells, colors, modes, scrollback). Programs launched through a framework
probe, or wired to a custom semantic producer, additionally publish a **semantic tree**, which unlocks
`getByRole('button', { name: 'Approve' })` instead of text scraping. Both modes
share the same `TerminalHarness` interface, so tests degrade honestly rather
than breaking.

Every action goes through the PTY — a click is a real mouse report, a keystroke
is real bytes. There is no callback back-channel into the application.

## Install

```sh
pnpm add -D @termwright/driver
```

Node >= 22, ESM only. Prebuilt PTY binaries ship for macOS, Linux (glibc) and
Windows; Alpine/musl is not supported (use `node:22-slim`).

## Usage

```ts
import { launchTerminal, TermwrightError } from '@termwright/driver';

const terminal = await launchTerminal({
  command: ['node', 'app.js'],
  columns: 100,
  rows: 30,
});

// Generic observation works for any program.
await terminal.waitForText('Ready');
console.log(terminal.screen().text());
console.log(terminal.screen().cell(0, 0).fg);

// Semantic locators work when the program publishes a semantic tree.
if (terminal.capabilities().semanticTree) {
  // Present only for an instrumented framework probe. Adapter capabilities
  // describe wire traffic; probe.capabilities describe observable framework facts.
  console.log(terminal.capabilities().probe);
  const approve = terminal.getByRole('button', { name: 'Approve' });

  // Evidence-qualified observations preserve unknown and unsupported instead
  // of inventing a boolean or rectangle.
  // is distinct from false, and every result names the screen/tree revisions.
  console.log(await approve.geometry());
  console.log(await approve.visibility());
  console.log(await approve.hitTest());
  console.log(await approve.extendedState()); // application-domain JSON, if published
  const receipt = await approve.activate(); // 'click' | 'focus-enter' | 'focus-space'
  console.log(receipt.strategy);

  await terminal.locator('dialog button#reject').click();
}

// Stable refs can be turned back into locators across later frames.
const target = await terminal.getByRole('button').first().resolve();
if (target.identity === 'stable') await terminal.locatorForRef(target.ref).click();

// Keyboard, paste and resize honor the modes the child actually enabled.
await terminal.press('Control+K Control+U');
await terminal.paste('multi\nline');
await terminal.resize({ columns: 80, rows: 24 });

try {
  await terminal.waitForText('never', { timeout: 500 });
} catch (error) {
  if (error instanceof TermwrightError) console.log(error.code, error.toString());
}

await terminal.signal('INT');
console.log(await terminal.waitForExit());
await terminal.close();
```

## What the driver guarantees

- **Revisions, never sleeps.** Every wait is driven by a screen revision, a
  semantic revision or a process event. `waitForStable` also knows whether a
  render is still unpaired.
- **Frame↔tree pairing.** A semantic revision becomes observable only when both
  its tree (semantic socket) and its render-commit marker (private OSC 8487 in
  stdout, BEL-terminated and MAC-signed with the session token) have arrived.
  Superseded or half-delivered revisions are dropped with a diagnostic.
- **Strict locators.** Zero matches wait until the deadline; more than one fails
  with bounded candidates. A semantic ref such as `n8@42` re-resolves across
  revisions only when the probe provides stable identity. Frame-local semantic
  refs are refused, grid refs remain revision-bound, and a removed stable node
  raises `stale-snapshot`.
- **Typed failures.** `timeout`, `stale-snapshot`, `ambiguous-locator`,
  `unsupported-action`, `history-truncated`, `protocol-violation`, `capacity`,
  `process-exited`, `session-closed` — each with a screen excerpt, candidates
  and a suggestion.
- **Honest degradation.** No mouse tracking means `click()` fails with
  `unsupported-action` instead of sending bytes nobody reads. Semantic pointer
  actions also require negotiated `absolute-bounds` and proof of the exact
  pointer recipient. Legacy paint-order knowledge is not that proof. No
  semantic tree means no invented roles.
- **Dormant by default.** The endpoint and token are injected as
  `TERMWRIGHT_ENDPOINT` / `TERMWRIGHT_TOKEN` / `TERMWRIGHT_PROTOCOL`; without
  them a conforming probe or adapter opens nothing and the run is byte-identical.

## Terminal profiles

A session counts characters according to a terminal profile, and records which
one it used:

```ts
const terminal = await launchTerminal({
  command: ['node', 'app.js'],
  terminalProfile: 'iterm2-ambiguous-wide', // 'default' | 'kitty' | 'iterm2-ambiguous-wide'
});
console.log(terminal.capabilities().terminalProfile);
```

The profile decides whether an ambiguous character takes one column or two, and
whether ❤️ is one column or two — the differences that make a bordered layout
line up or drift. Emulators are built by `@termwright/vt`, so a replay and a
screenshot of a session count exactly as the session did. See that package for
what each profile answers.

## The child's environment

`envMode` defaults to `'replace'`: the child gets `PATH`, `HOME`, `LANG`,
`LC_ALL`, `SHELL`, `TMPDIR`, `USER`, `TERM`, whatever you pass in `env`, and the
termwright handshake variables — nothing else. The tokens and cloud credentials
in a test runner's environment are not the application under test's business.
Pass `envMode: 'inherit'` when the program really needs the full environment.

## Waiting for a prompt

`waitForReady()` prefers OSC 133 shell-integration marks (`A` prompt start,
`B` input start, `C` command start, `D` finished) — the same marks VS Code,
iTerm2, WezTerm and fish already emit. When a program emits none, it falls back
to "the screen settled", which is a heuristic and is reported as one — by code,
not by prose: a diagnostic entry of `ready-shell-integration` means the program
said it was at a prompt, `ready-settled-screen` means the driver guessed from
silence.

## Seeing what the driver is doing

`TERMWRIGHT_DEBUG=1` (or `debug: true` when launching) streams a live log to
stderr — the terminal equivalent of Playwright's `DEBUG=pw:api`:

```
  tw:api  [c87be6be]   0.229s getByRole("button", {"name":"Approve"}) → getByRole("button", name=~"Approve")
  tw:api  [c87be6be]   0.229s locator.click() started
  tw:sem  [c87be6be]   0.251s semantic revision 1 published (tree and marker paired)
  tw:api  [c87be6be]   0.253s locator.click() succeeded in 24 ms
  tw:wait [c87be6be]   0.455s locator.resolve({"timeout":200}) failed after 202 ms: TimeoutError [timeout]: …
```

Categories are `api` (calls), `wait` (what was awaited, how long, how it ended),
`vt` and `sem` (revisions), `diag` (diagnostics). `TERMWRIGHT_DEBUG=all` adds
`io` lines with the raw PTY traffic. The session token is never printed, and
`paste`/`write` payloads are logged by size only. Switched off, nothing is
wrapped and no listener is registered.

## Incremental trees

An adapter that offers deltas gets them by default: a semantic tree changes on
nearly every keystroke, and sending the whole thing each time is what makes the
semantic channel expensive. The driver composes each delta onto the tree it
holds and pairs the result with its render marker exactly as it would a full
snapshot.

When a delta cannot be composed — a base revision the driver never held, a node
it does not know — the driver asks for a full tree (`get-tree`) and ignores
further deltas until it arrives. That is reported as `delta-resync`, not as a
dropped revision: nothing was lost, and a repair should not read like damage.
The last good tree stays observable throughout.

`treeUpdates: 'snapshots'` declines deltas from an adapter that offers them —
the switch to reach for when a replay and a live session disagree and the delta
path is a suspect.

Evidence-qualified geometry, visibility and exact pointer ownership use
`termwright/2`, which is the default. `semanticProtocol: 'termwright/1'` is an
explicit compatibility mode for an older producer. V1 never enables pointer
actions from unqualified bounds. V2 always uses full snapshots; the driver
never applies v1 delta semantics to qualified observations.

## Knowing when the verdict is final

`capabilities()` answers immediately with what is known so far. Three things can
still be pending right after launch: the negotiation window, the grace a slow
adapter gets to attach after it, and the first tree of an adapter that did
attach. When a caller needs to branch on `semanticTree`, it should wait for all
three instead of polling:

```ts
const capabilities = await terminal.settled();
if (capabilities.semanticTree) {
  // the tree is published, not merely promised
  await terminal.getByRole('button', { name: 'Approve' }).click();
}
```

An adapter that attaches and then publishes nothing fails the wait with a
timeout rather than reporting a semantic session whose tree never arrived.

## Following the program's own log

A TUI's real diagnostics go to a file, not to the screen — the screen is busy
drawing. Point the session at that file and its lines land on the same timeline
as everything else:

```ts
const terminal = await launchTerminal({
  command: ['node', 'app.js'],
  logs: [{ path: '/tmp/app.log', label: 'app' }],
});
terminal.events.on('app-log', (entry) => console.log(entry.label, entry.path, entry.line));
```

A file that does not exist yet is waited for (programs create their log on first
write); one that already exists is followed from its current end, so a session
never replays a previous run. Truncation and rotation restart the tail instead
of failing, with a `log-source` diagnostic saying why.

An instrumented application can also publish **structured** records over the
semantic channel: an adapter that announces the `logs` capability is granted a
rate budget in the handshake and its records arrive on the same event with
`source: 'adapter'` and a `record` instead of a `line`. Records carry a
wall-clock timestamp — the only clock both sides can agree on — which the driver
rebases onto the session timeline using the offset measured at the handshake,
clamped so a skewed clock cannot place a record in the future. Record sequence numbers must strictly increase within a session: a gap means the
adapter dropped records at the source, and a repeated or rewound number means it
lost track of its counter — the first is reported, the second is refused, both
as `log-dropped`. Neither closes the channel.

`timeMs` is when the driver *read* the line, not when the program wrote it —
they differ by up to one poll interval, so treat it as an upper bound. Bounded
throughout: lines longer than 4 KiB are truncated with an ellipsis, and a source
that outruns 250 lines per 250 ms has the rest dropped and counted in a
`log-dropped` diagnostic rather than drowning the session.

## When the program dies on its own

A child that exits on a signal, or with a non-zero code, without the harness
asking for it leaves a `CrashReport`:

```ts
const status = await terminal.waitForExit();
const report = terminal.crashReport(); // null for a clean exit, close() or signal()
console.log(report?.screenTail.join('\n')); // the stack trace or panic
console.log(report?.recentInputs);          // what was sent just before
console.log(report?.lastSemanticTree);      // the last paired revision, if any
```

It is also delivered as a `crash` event (emitted just before `exit`), and any
wait that can no longer make progress fails with `process-exited` carrying a
short excerpt of the same tail.

The exit is published only after the dying output has been parsed, so the trace
is in the report rather than still in flight. Everything is bounded: 50 lines
and 16 KiB of tail, 20 inputs, 20 diagnostics. Pastes are recorded by size only,
but the screen tail is deliberately unscrubbed — it is what the terminal showed,
so treat a crash report like a screenshot when storing or forwarding it.

## Diagnostics

Entries that stand for several things carry a `count`, so a caller never has to
parse the message text: summing `count` over `log-dropped` answers "how many log
entries never reached me". A repeated log record carries none — a duplicate is
not a loss.

`terminal.diagnostics()` returns the bounded, oldest-first log of what the
session decided on its own — negotiation timeouts, superseded or expired
revisions, unverified markers, advisory `revision-commit` messages, protocol
violations. The same entries arrive live as `diagnostic` session events, so a
conformance suite can assert on failure modes directly instead of inferring them.

## Timeout classes

`action`, `text`, `idle`, `ready`, `exit` — defaults are 5 s / 5 s / 2 s / 10 s /
10 s, overridable per call, per launch (`timeouts: { action: 15_000 }`) and per
environment (`TERMWRIGHT_TIMEOUT_ACTION` and friends).

## Testing this package

```sh
pnpm build && pnpm typecheck && pnpm test
```

Integration tests drive real pseudo-terminals against the fixtures in
`test-fixtures/` (including `semantic-app.mjs`, a hand-written adapter that
performs the full handshake). They skip themselves where no PTY can be opened,
or with `TERMWRIGHT_SKIP_PTY=1`.
