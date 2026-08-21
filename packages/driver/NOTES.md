# @termwright/driver — implementation notes

## Windows: why the child died with exit code 134

First Windows CI run: every PTY test failed with `the program exited with code
134`, alongside a flood of `Error: AttachConsole failed`. Those are two separate
things, and the loud one is not the one that broke the tests.

**The failure was ours.** `envMode: 'replace'` — the secret-safe default — used a
POSIX-shaped allowlist (`PATH`, `HOME`, `LANG`, …). A Node process started
without `SystemRoot` on Windows does not report an error, it **aborts**: exit
code 134, no message, nothing on the screen to wait for. Every fixture died the
instant it started. The allowlist is now platform-aware, and `env.test.ts`
asserts on each platform that the variables a child needs to start survive the
replacement — so Windows checks the Windows branch instead of a comment
promising it works.

Windows environment names are case-insensitive and the OS chooses the casing, so
the allowlist is matched against the real keys rather than read by an assumed
spelling.

## Windows: the AttachConsole noise is teardown, not spawn

`Error: AttachConsole failed` is thrown at `conpty_console_list_agent.js:11`,
inside a process `@lydell/node-pty` **forks** from `kill()` to enumerate the
console process list. A GitHub Actions runner's session has no console to
attach to, so it throws there every time a session closes.

Worth recording because the obvious diagnosis is wrong twice over:

- **There is no winpty fallback to escape.** `WindowsPtyAgent` in
  `@lydell/node-pty` 1.1.0 unconditionally `require`s `conpty.node` and calls
  `conptyNative.startProcess`. The package is ConPTY-only; nothing chooses
  between backends.
- **There is no `useConpty` to force.** Neither the typings nor the JavaScript
  mention it — the only Windows option is `conptyInheritCursor`. Passing
  `useConpty: true` would be a no-op that looks like a fix.

The parent tolerates the throw: it waits for the agent's message and falls back
to the shell pid after a 5 s timeout. That makes it a slowness risk on Windows
rather than a correctness one — if teardown turns out to cost seconds per
session there, the fix is to stop routing Windows teardown through
`pty.kill()`, and that needs a Windows run to justify rather than a guess.

## Windows: the mouse mode is hidden, not absent

ConPTY is an emulator sitting between the child and the driver, so it consumes
the child's `CSI ? 1000/1002/1006 h` instead of forwarding it — measured by the
permeability probe in `escapes.pty.test.ts`, which also found DCS, APC and
OSC 8 dropped while private OSC (either terminator) and OSC 133 pass. That is
why the render marker rides OSC 8487.

The mouse needed a different answer, because a second probe measured the other
direction: a child whose DECSET was swallowed **still decodes a report the
driver writes**. The driver is blind, not powerless. So `mouseTracking` and
`mouseEncoding` report `'unknown'` where the platform hides them, pointer
actions refuse only on a mode known to be off, input is sent in SGR, and the
session records `mouse-mode-unverifiable` once.

`'unknown'` is not revised by a request that does arrive: that would prove only
that one arrived, and treating it as proof about the rest would report a
partial view as a complete one. If ConPTY ever starts forwarding these, the
probe table says so and the default flips deliberately.

`modesObservable` on `launchTerminal` forces the verdict, so the Windows path
is exercised on every platform — a behaviour only one OS reaches is a behaviour
only one OS tests.

## Windows: focus reporting is the same disease, catching the other way

The conformance finding read this as a mirror of the mouse: ConPTY swallows
`CSI ? 1004 h`, the driver reports `false`, and a program that asked for focus
events is refused. The CI log says otherwise. In run 31939398845 the test
`refuses focus reports the child never asked for` failed with
`Cannot read properties of undefined (reading 'code')` — `focus()` **resolved**.
The gate reads `if (!modes().focusReporting) throw`, so the mode must have been
reported enabled, for `mouse-app.mjs`, which only ever sends `?1000h` and
`?1006h` and never asks for 1004.

So the value is not missing, it is *the host's*: ConPTY reports focus reporting
as enabled whichever program is running. The harm runs the other way — the
driver sends `CSI I` to a program that will print it — and it was happening
silently. Hence `'unknown'` is defined as "this reading is the host's state and
says nothing about the child", which covers both a swallowed request and an
added one; a definition tied to the mechanism would have covered only the
mouse.

## Floods: the pairing timeout was measuring our own backlog

A revision's two halves reach the driver by unequal roads. The tree arrives on
a socket and needs no parsing; its marker is bytes in the output stream, queued
behind every byte written before it. The flood probe in `escapes.pty.test.ts`
times each marker twice — when its bytes land, and when the emulator reaches
it — and on macOS, where no ConPTY exists, the transport added **0 ms** while
the parse queue added up to **692 ms** against a 1000 ms pairing window. Under
a heavier flood the window closes, and the driver reports `revision-expired`
for a marker it is already holding, unread.

There is a second shape of the same problem, and it needs a second question.
The conformance matrix reproduces a flood where the *terminal* is the slow
part (a pty re-encoding every byte); there the marker's bytes are not in the
driver's hands at all, the parse queue is empty, and a drain barrier sees
nothing to wait for. Measured with the throttled probe: 1.7 s median from
commit to sighting, 3.4 s at the tail.

So the expiry clock starts only once the evidence can no longer be in transit:
the emulator has parsed everything received, **and** the output stream has been
silent for `pairingTimeoutMs`. A timeout means "the other half never came" again, rather than "we were busy"
or "it is still on its way". This is why the fix is not a bigger budget or a
per-platform one: the race is platform-neutral and a budget only moves the
flood size at which it returns.

Note the boundary, which is deliberate: the quiet condition only extends the
window while output is *flowing*. A silent session whose marker turns up two
seconds later still expires on time — nothing was in transit to wait for. That
is also what keeps the rule bounded, together with `maxPending`: an endless
animation postpones expiry indefinitely but evicts at 32 halves.

The eviction path (`maxPending`) is unchanged and correct: a peer producing
revisions faster than pairs close will lose the oldest, with a diagnostic. Note
the coupling, though — publishing drops everything below, so pairing that keeps
up is also what keeps the queue short. Throughput of the emulator is a
measurement, never a contract.

## Windows: the child was told nothing about its terminal

`node-pty` sets `TERM` from the terminal name it is given — but only in
`unixTerminal.js` (`env.TERM = name`). The Windows path computes the same name
and never writes it to the environment. So on a runner whose own environment
has no `TERM` (GitHub Actions Windows), the child started with none, and
ncurses/termbox/tcell-style libraries fell back to guessing at a terminal whose
capabilities we know exactly.

`TERM=xterm-256color` and `COLORTERM=truecolor` are therefore set by the driver
in **both** env modes, before the caller's overrides. Not inherited: the child
is attached to our emulator, not to whatever terminal launched the test run, so
forwarding the parent's value would describe the wrong terminal — and on POSIX
`node-pty` was already overriding it anyway, so this makes the platforms agree
rather than introducing a new policy. An explicit `env: { TERM }` still wins,
for a caller testing their program under something else.

## Draft: where per-property provenance could live (campaign #34, question 2)

Not a proposal — variants with their measured costs, so the decision is made
against arithmetic. Sizes come from a real session (`semantic-app` fixture,
4 nodes, 870 B snapshot, **217.5 B/node**; the button node is 186 B with 8
fields). Percentages are against that button node, measured by serialising the
variant, not estimated.

**The finding that reframes the question: there is no headroom left.** At
`maxNodes` (5 000) and this sample's average node, a maximal tree is **1062 KiB
against a `maxSnapshotBytes` of 1024 KiB** — the two default limits already
contradict each other before provenance is added. Whatever encoding is chosen,
one of the two ceilings has to move, or trees have to get smaller. Worth
stating plainly rather than discovering it when a real app hits it.

| Variant | Per node | Node +% | 5 000 nodes | Notes |
|---|---|---|---|---|
| Verbose strings (`provenance: {role: 'component-recognizer', …}`) | +169 B | +91 % | 1887 KiB | Self-describing on the wire, and unaffordable. Rejected by arithmetic, not by taste |
| Per-field enum ints (`p: {r: 2, n: 3}`) | +36 B | +19 % | 1238 KiB | Readable in a debugger; still nearly doubles the overrun |
| Packed bitfield (3 bits × 8 properties in one int) | +12 B | +6 % | 1121 KiB | Cheapest that keeps provenance in the tree; unreadable without a decoder, so every consumer needs one |
| Uniform default (`p: 2`, one source for the whole node) | +6 B | +3 % | 1091 KiB | Fits the common case: most nodes get every fact from one recognizer |
| Uniform + exceptions (`p: 2, px: {name: 4}`) | +22 B | +12 % | — | The realistic shape of the one above: the exception is the interesting node, and it pays only where it occurs |
| Side channel, read lazily | 0 B | 0 % | 1062 KiB | Costs nothing in the tree and buys a different problem — see below |

The uniform-plus-exceptions row is the one worth taking seriously if provenance
stays in the tree. It matches what the adapters already do: a node's facts
overwhelmingly come from a single source, and the cases worth inspecting are
exactly the ones where they do not. It also degrades honestly — a node with
mixed provenance costs more, which is the node someone is about to ask about.

The lazy side channel is not free, it relocates the cost. Provenance for
revision N has to be answerable *after* N is superseded, or the inspector shows
"unknown" for everything the user is looking at, so the probe has to retain
history. There is precedent: the Python client already keeps
`_SNAPSHOT_HISTORY = 8` for `get-tree`. The open question is what the retention
contract is and what an inspector shows when it falls off the end — and
"unknown" there means something different from `'unknown'` in `TerminalModes`,
which is a distinction worth not blurring.

One thing measured elsewhere argues for keeping *something* in the tree:
`TerminalModes` reports `'unknown'` inline rather than making a caller ask, and
that is what makes the refusal logic honest at the point of decision. A gate
that has to make a round trip to learn how much to trust a fact will not make
it.

## Draft: what the IR rules force onto `api.ts` (campaign #34, contract batch)

Not implemented — a list for the batch, written while the protocol types are
being built, so the driver's side of each rule is decided rather than
discovered. Each entry names the failure it prevents.

### 1. Identity: a ref is only meaningful when identity is `stable`

IR encodes identity as `{ kind: 'stable' | 'frame-local' }`, and Ratatui has no
stable identity at all. Our `ResolvedTarget.ref` is `n8@42` — a node id at a
revision — and `locatorForRef` re-resolves it later. Under frame-local
identity that re-resolution is **not** "did this node change?" but "does the
number 8 mean anything in this frame?", and the honest answer is no.

Proposed: `ResolvedTarget` gains `identity: 'stable' | 'frame-local'`, and
`locatorForRef` refuses with `capability-unavailable` for a frame-local ref,
suggesting role/name/testId instead. The failure this prevents is the worst
kind: a ref that silently resolves to a *different widget* between frames, so
a passing test asserts about something it never targeted.

Note the precedent this follows: `'unknown'` in `TerminalModes` exists because
reporting a definite value we cannot back is what makes a wrong decision look
right. Same shape, different subject.

### 2. Geometry: `rect` has to say which rectangle it is

IR separates `intendedRect` (where the object asked to draw — all Ratatui has)
from `visibleRect` (after clipping — only Textual computes it). Our
`ResolvedTarget.rect` is one unnamed rectangle used for two different jobs:
reporting bounds, and deciding *where to click*.

Those jobs have different requirements. Clicking needs the cells the user can
actually reach; `intendedRect` is not a claim to cells, because a modal, popup
or shadow may own them. Without a paint-order model, clicking the centre of an
`intendedRect` sends real input to whatever is on top and attributes the result
to the wrong widget — a test that passes while testing nothing.

Open decision for the batch, and I do not think I should make it alone: with
only an `intendedRect` and no paint order, does a pointer action refuse, or
proceed with a diagnostic? The mouse-mode precedent says "act, and say you
could not verify", but it is not the same case — there the input was known to
reach the child, and only our knowledge of the mode was missing. Here the input
lands somewhere real and may land on the wrong thing.

### 3. `frameworkType` has to reach the user, or `generic` is a downgrade

D1 keeps the closed role vocabulary and lets unknown widgets survive as
`generic` + required `frameworkType`. If the driver drops `frameworkType`,
every previously-invisible widget becomes an indistinguishable `generic` node
and the tree gets *harder* to read, not easier. It belongs on the exposed node
and in `ResolvedTarget`, and it wants a locator filter
(`getByRole('generic', { frameworkType: … })`) or the role is unusable for
selection.

### 4. Provenance is diagnostic surface, not just data

`p`/`px` are most valuable exactly when something went wrong: an assertion
failed against a name that came from a heuristic rather than an annotation.
Errors already carry `candidates: ResolvedTarget[]`; carrying provenance with
them turns "no such button" into "there is a button whose name was guessed by a
heuristic". That is a small change with a large effect on how debuggable the
zero-config model is, and it is the argument for keeping provenance in the tree
rather than behind a lazy inspector channel.

### 5. Still open, deliberately not assumed

Progressive levels (spec c: "no more binary `semanticTree`") are **not** in the
D1-D6 series. `capabilities().semanticTree` is a boolean today and the audit
lists it as delete-on-replacement, but no decision has replaced it yet. Not
touching it until one does.
