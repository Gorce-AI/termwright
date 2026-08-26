# @termwright/probe-tview — implementation notes

Why this probe patches a copy at all, and the traps that cost time. The README
says how to use it; this is for whoever changes it, and for whoever builds the
Ratatui and Charm probes on the same mechanism.

## The boundary: which probes need a copy

A copy plus a patch set is **not** the campaign's default. It is what a
language without a load-time seam forces. JavaScript probes intercept the
module as it loads (`node:module` hook, Bun plugin), so `probe-opentui` and
`probe-ink` never touch a file on disk. Go has no equivalent, so tview is
instrumented by compiling a patched copy — and Ratatui and Charm are expected
to need the same.

That is also why `upstream-patches/` lives inside this package rather than at
the repository root: the patch set is versioned with the probe that owns it,
and there is nothing to share with the probes that have a seam.

## Traps, in the order they cost time

- **`use` in a workspace does not satisfy a versioned `require`.** The copy's
  `go.mod` requires the protocol client, and adding the client as a `use` entry
  still fails with `unknown revision clients/go/v0.0.0`. The client has to be a
  `replace`, exactly like the framework. A workspace plan therefore carries a
  *list* of replaces.
- **Copying out of the module cache needs a chmod on the directory itself.**
  Go's cache is read-only and `cp -r` carries that mode onto the destination
  directory. A patch tool then fails with `unable to unlink 'application.go':
  Permission denied` even though every file inside is writable — the message
  names a file, the cause is the container.
- **Go compares module directories after resolving symlinks.** macOS hands out
  `/var/folders/…` for `/private/var/folders/…`, and a workspace written with
  the unresolved form fails with `directory prefix . does not contain modules
  listed in go.work`. Every path is canonicalised on write.
- **A generated workspace that lists only the target module breaks a
  multi-module project.** Dropping the project's own `use` lines sends Go to
  the network for a module that exists only on disk. The generator inherits the
  existing workspace through `go work edit -json`.
- **`DiskPath` from `go work edit -json` is relative to the workspace file, not
  to the directory the command ran in.** Resolving it against the cwd yields
  `…/app/app`. The file's location comes from `go env GOWORK`, which also
  answers "is there a workspace at all" — `go work edit -json` *errors* in a
  plain project, so detecting absence by parsing that error would be fragile.
- **State that is only valid after a draw will be published as garbage.** The
  audit lists the fields; the one that bit was a scroll offset still negative
  before the first draw, which the schema rejects as not a non-negative
  integer — taking the whole snapshot down with it. Negative offsets are now
  omitted rather than clamped: "not decided yet" is not "at the top".

## Deliberate choices

- **One anchored insertion, one added file.** The patch touches `draw()` in a
  single place, after `screen.Show()`. Everything else lives in
  `termwright_probe.go`. A new tview release then usually moves the anchor
  rather than invalidating the instrumentation.
- **The insertion is after the flush, not in `afterDraw`.** `SetAfterDrawFunc`
  runs *before* `screen.Show()`, and the render-commit marker has to follow the
  bytes it describes. That one statement is the entire reason a copy exists
  instead of a hook.
- **Publication is synchronous and bounded.** It must be synchronous, because a
  marker written by another goroutine can land after the *next* frame's bytes
  and pair the tree with the wrong screen. It must be bounded, because the hook
  holds the application's write lock and an unbounded socket write freezes
  rendering whenever the driver stops reading. Both are true at once through
  the client's `WriteTimeout`.
- **A failed publish writes no marker.** A marker names a revision; emitting
  one for a tree that never arrived makes the driver wait and then report
  `revision-pairing-watchdog`, which points the blame at the adapter's timing rather
  than at the driver that stopped reading.
- **The role mapping mirrors the hand-written adapter's.** Two instrumentations
  of the same application must describe it the same way, or every conformance
  snapshot forks.

## Testing the probe

The Go tests ship inside the patch set, because they need the probe's
internals, and the TypeScript suite runs them against a freshly patched copy.
Two of them are worth understanding before changing:

- `TestAStalledDriverCostsFramesAndNotTheApplication` only means something if
  the driver really stalls. A tree too small to fill a socket buffer silently
  stops testing the intended path. The fixture therefore publishes a large
  tree and rewrites every label each round. Confirmed by sabotage: with the
  write deadline disabled the test hangs
  and fails on the Go test timeout.
- The TypeScript wrapper asserts the Go tests did not **skip**. A skipped stall
  test looks identical to a passing one in a summary line.

## The zero-config path, end to end

`zero-config.pty.test.ts` walks the whole thing once: a plain tview application
in `src/testing/fixture-app` — no import of ours, no flag, no build tag — is
built through the generated workspace, launched under the real driver, and
addressed by role. It asserts what the phase promised: the adapter reports
itself as `termwright-probe-tview`, `getByRole('list', {name: 'Files'})`
resolves, and a widget on a page tview has not shown is *hidden* rather than
absent, which is knowable only from inside the package.

Two things about that test worth keeping:

- It uses the driver's own API, not the Native Host's matchers. A probe
  proving itself through the host authoring surface would invert the dependency.
- It does not assert the status line after showing the settings page. tview
  draws a shown page *over* the one below it, so the text is still in the tree
  and no longer on the grid — asserting on the screen there would be asserting
  the layout, not the behaviour.

The dormancy claim is measured rather than read off the source: the same
fixture is built twice, once against untouched tview and once against the
instrumented copy, and the two screens must be byte-identical when the
handshake variables are absent.

## The three test tiers

- **A — the probe.** Go tests inside the patch set: dormancy, the stalled
  driver, the marker discipline. They need the probe's internals, so they live
  where the internals are, and the TypeScript suite runs them and asserts they
  did not skip.
- **B — the recognizer.** `recognizer.ts` restates the normalisation over Probe
  IR as a pure function, and `recognizer.test.ts` feeds it IR directly: no
  build, no toolchain, no pseudo-terminal. It exists because half the
  interesting cases — an unknown widget from a future release, a pre-layout
  scroll offset, a state the probe never reported — take one line here and a
  contrived application there. The duplication with the Go side is deliberate
  and is a contract: two implementations that disagree describe the same
  application differently.
- **C — zero-config integration.** `zero-config.pty.test.ts`: initial tree,
  focus moving, list selection, a typed value, a component appearing, and a
  real resize. Plus the golden pair, vanilla against instrumented.

Writing C found a bug in the fixture rather than in the probe, which is worth
recording because it is the oldest bug in TUI keybinding: a global
`SetInputCapture` swallowed every `s` typed into the form, so `"release"`
arrived as `"releae"`. The shortcuts now only fire while the main page is in
front.

## Annotations

A tview application holds its primitives: the same `*tview.Button` pointer is
on the grid this frame and the next. That makes identity usable as a key, so
the annotation API is a registry rather than an interface — the author does not
have to wrap or subclass anything to describe a widget they did not write.

```go
annotate.Tag(badge, annotate.Semantics{
    Key: "unread", Role: "status", Name: "Unread messages", TestID: "unread-badge",
    Actions: []protocol.Action{protocol.ActionFocus},
})
```

The probe calls `annotate.Lookup` while walking the tree and merges the result
under D2 precedence: the annotation supplies wording, the probe supplies facts.
The end-to-end fixture pins both halves — a custom `badge` primitive that no
recognizer knows is found by `getByTestId` and by `getByRole('status')`, while
a Save button annotated with a name only keeps the focus the probe observed
after `Tab`.

Two properties are worth stating because they are easy to get wrong:

- **The registry does not retain widgets.** Keying by address and holding the
  key in a `sync.Map` would keep every tagged primitive alive for the life of
  the process. Entries are removed by `runtime.AddCleanup`, and the tests check
  both directions: two hundred transient widgets are collected, and a widget
  still referenced keeps its annotation. (This puts a Go 1.24 floor on anything
  importing the package.)
- **A declaration cannot state a physical fact.** `Semantics` carries author
  identity and intent (`Key`, role/name/test id/description/domain, closed
  actions and key relationships) — no bounds, focus, visibility, value,
  rendered text or framework state. A test reflects over the field set so that
  adding one fails rather than merely being frowned upon. Unknown roles and
  actions are dropped, not guessed.
- **Relations are a bounded second pass.** `LabelledBy` and `DescribedBy` hold
  framework-neutral `SemanticKey` strings rather than target pointers. That
  avoids both an import cycle and retaining another primitive. Missing targets
  emit no reference; a duplicate non-empty key terminates the semantic session
  with `duplicate-semantic-key`. Declaration order is irrelevant.
- **Provenance remains mixed honestly.** Retained widget facts use
  `p: framework`; recognised roles and author-supplied fields are per-field
  `px` exceptions.

The annotated application lives in its own fixture. Putting the calls into the
zero-config fixture would have broken that fixture's own test, the one
asserting it imports nothing of ours — which is the test doing its job, and the
reason the two are separate.

## Not covered yet

- Windows. Nothing here has run on ConPTY, and the named-pipe endpoint path in
  the client is untested from this probe.
- tview versions other than v0.42.0. The patch set is per version by design;
  a second version means a second directory and a second set of checksums.
- Windows for the zero-config path specifically: the fixture builds and runs
  only where a pseudo-terminal opens.
