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
  `revision-expired`, which points the blame at the adapter's timing rather
  than at the driver that stopped reading.
- **A dropped frame demands a full snapshot next.** The probe has lost part of
  its own fact stream, so a later delta would be based on a revision the driver
  never received. That is the producer obligation from D5, and the client keeps
  the flag until a whole tree is actually built.
- **The role mapping mirrors the hand-written adapter's.** Two instrumentations
  of the same application must describe it the same way, or every conformance
  snapshot forks.

## Testing the probe

The Go tests ship inside the patch set, because they need the probe's
internals, and the TypeScript suite runs them against a freshly patched copy.
Two of them are worth understanding before changing:

- `TestAStalledDriverCostsFramesAndNotTheApplication` only means something if
  the driver really stalls. Two ways it silently stops testing anything: a tree
  too small to fill a socket buffer, and a tree that does not change between
  frames — the session subscribes to diffs, and an unchanged tree produces a
  delta of nearly nothing. The fixture therefore rewrites every label each
  round. Confirmed by sabotage: with the write deadline disabled the test hangs
  and fails on the Go test timeout.
- The TypeScript wrapper asserts the Go tests did not **skip**. A skipped stall
  test looks identical to a passing one in a summary line.

## Not covered yet

- Windows. Nothing here has run on ConPTY, and the named-pipe endpoint path in
  the client is untested from this probe.
- tview versions other than v0.42.0. The patch set is per version by design;
  a second version means a second directory and a second set of checksums.
- The zero-config fixture that builds and runs a real application end to end
  under the driver. The pieces are proven separately — the copy compiles, an
  application builds through the generated workspace, the canary confirms which
  copy compiled — but the whole path has not yet been walked in one test.
