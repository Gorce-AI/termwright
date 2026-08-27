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

Node >= 22, ESM only. Prebuilt PTY binaries ship for macOS >= 13.5,
glibc Linux at the Ubuntu 22.04 ABI floor (glibc >= 2.35), and Windows 10
version 1809 / Server 2019 or newer. Alpine/musl is not supported (use
`node:22-slim`).

## API stability

`@termwright/driver` is the supported application-test surface: terminal
launch, locators, actions, observations, value policy and typed errors.
Framework adapters and Termwright infrastructure may use the explicitly
experimental subpath:

```ts
import { createNativePtyBackend, type PtyBackend } from '@termwright/driver/experimental';
```

The experimental tier contains PTY/backend selection, terminal encoders,
selector parsing, process supervision, environment construction and resource
provider injection. It may change before the stable release and is not
re-exported from the root or from `termwright`; ordinary tests should not use it.
Framework adapters that own a backend launch it through the same tier:

```ts
import { createNativePtyBackend, launchTerminalWithBackend } from '@termwright/driver/experimental';

const terminal = await launchTerminalWithBackend({
  command: ['node', 'app.js'],
  backend: createNativePtyBackend(),
});
```

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

// Semantic locators work only when the frozen contract proves a semantic tree.
const contract = await terminal.settled();
if (contract.capabilities['semantic-tree'].status === 'supported') {
  console.log(contract.framework);
  const approve = terminal.getByRole('button', { name: 'Approve' });

  // Evidence-qualified observations preserve unknown and unsupported instead
  // of inventing a boolean or rectangle.
  // is distinct from false, and every result names the screen/tree revisions.
  console.log(await approve.geometry());
  console.log(await approve.visibility());
  console.log(await approve.hitTest());
  console.log(await approve.extendedState()); // application-domain JSON, if published
  const receipt = await approve.activate(); // 'click' | 'focus-enter' | 'focus-space'
  console.log(receipt.plan.strategy);

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

- **Causal waits, explicit heuristics.** Content and action waits are driven by
  screen/semantic revisions or process events. `waitForQuiet` is the named,
  bounded exception: it proves silence for a caller-selected interval and also
  refuses to finish while a render is still unpaired.
- **Frame↔tree pairing.** A semantic revision becomes observable only when both
  its tree (semantic socket) and its render-commit marker (private OSC 8487 in
  stdout, BEL-terminated and MAC-signed with the session token) have arrived.
  Superseded or half-delivered revisions are dropped with a diagnostic.
- **Strict locators.** Zero matches wait until the deadline; more than one fails
  with bounded candidates. A semantic ref such as `semantic:n8@42` re-resolves across
  revisions only when the probe provides stable identity. Frame-local semantic
  refs are refused, grid refs remain revision-bound, and a removed stable node
  raises `stale-snapshot`.
- **Typed failures.** Capability absence, semantic/probe attachment, current
  actionability, terminal input mode, provider loss/violation, adapter guarantee
  violation, stale observations, strict locator failures, process exit, and
  protocol failures have distinct machine-readable codes and actionable
  diagnostics.
- **Honest degradation.** No mouse tracking means `click()` fails with
  `input-mode-disabled` instead of sending bytes nobody reads. Semantic pointer
  actions require known terminal-cell geometry and proof of the exact pointer
  recipient. Paint order is not that proof. No semantic tree means no invented
  roles.
- **Authoritative input modes.** Certified PTY backends, including pinned
  passthrough ConPTY, expose DEC mouse/focus changes directly. An embedding
  that explicitly hides them may use a registered application provider for the
  production parser's revision-bound configuration. Termwright still writes
  real PTY bytes and rejects provider disagreement or loss.
- **Dormant by default.** The endpoint and token are injected as
  `TERMWRIGHT_ENDPOINT` / `TERMWRIGHT_TOKEN`; without
  them a conforming probe or adapter opens nothing and the run is byte-identical.

## Terminal profiles

A session counts characters according to a terminal profile, and records which
one it used:

```ts
const terminal = await launchTerminal({
  command: ['node', 'app.js'],
  terminalProfile: 'iterm2-ambiguous-wide', // 'default' | 'kitty' | 'iterm2-ambiguous-wide'
});
console.log(terminal.terminalProfile);
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

`waitForShellPrompt()` requires OSC 133 shell-integration marks (`A` prompt
start, `B` input start, `C` command start, `D` finished) — the same marks VS
Code, iTerm2, WezTerm and fish already emit. A program without them gets a
capability error; Termwright never upgrades silence into prompt readiness.
When silence itself is the intended heuristic, request it explicitly with
`waitForQuiet({quietMs})`.

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

## Semantic snapshots

The semantic channel uses `termwright/2` and complete evidence-qualified
snapshots. Each semantic revision is validated independently, retained, and
paired with its authenticated render marker.

`displayed`, `intendedRect`, `visibleRect`, coordinate space, and pointer
ownership remain separate observations. Missing framework evidence is
`unsupported`. `unknown` is reserved for a temporary unsettled revision or
provider refresh; a settled guaranteed fact must be `known` or `absent`,
otherwise the provider or adapter fails closed.

## Knowing when the verdict is final

There is no provisional capability read. Three things can still be pending
right after launch: negotiation, a slow adapter attach, and the first paired
tree. `settled()` resolves only after the frozen verdict is usable:

```ts
const contract = await terminal.settled();
if (contract.capabilities['semantic-tree'].status === 'supported') {
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

`timeMs` is when the driver _read_ the line, not when the program wrote it —
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
console.log(report?.recentInputs); // what was sent just before
console.log(report?.lastSemanticTree); // the last paired revision, if any
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
