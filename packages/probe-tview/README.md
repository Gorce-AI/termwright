# @termwright/probe-tview

Capability-driven semantic probing for
[tview](https://github.com/rivo/tview), without editing or copying upstream
source files.

Termwright controls the Go build and uses the official `-toolexec` hook to add
owned compilation units to the tview package and, on Windows, tcell. The
compiler checks every private-field assumption. A new upstream version is
accepted by compilation plus behavioral conformance, not by matching a source
digest.

## Install and use

```sh
npm install --save-dev @termwright/probe-tview
```

The application opts in with one line immediately before `Run`:

```go
import "github.com/gorce-ai/termwright/clients/go/tviewprobe"

app.SetRoot(root, true)
defer tviewprobe.Attach(app, root)()
if err := app.Run(); err != nil {
	panic(err)
}
```

Prepare the controlled build and pass the returned Go arguments to the build
or test command:

```ts
import { execFile } from 'node:child_process';
import { prepareInstrumentedBuild } from '@termwright/probe-tview';

const build = await prepareInstrumentedBuild({ moduleDir: 'path/to/app' });
await execFile('go', ['build', ...build.goArgs, '-o', 'app-binary', '.'], {
  cwd: build.moduleDir,
  env: build.env,
});
```

The mechanism works with ordinary module-cache dependencies, local
replacements, workspaces and vendored applications. It does not modify the
application's `go.mod`, `go.sum`, `go.work`, vendor tree, or upstream module
bytes.

## Intervention tiers

- T0 public tview/tcell APIs provide most widget hierarchy, state, geometry
  and the `Screen.Show` output boundary.
- A T1 add-only tview unit exposes sealed root, Grid, Modal, DropDown and other
  rendered state. Private-field drift is a compile error.
- On Windows a second T1 tcell unit writes the authenticated frame marker
  through the console handle used by `Show`. Unix uses the public `Tty()`
  writer.

The application screen is decorated before `Run`, and its existing public
before/after-draw hooks are chained. Those hooks arm exactly tview's final
`Show`; intermediate `Show` calls made by custom primitives or application
hooks still flush normally but cannot publish a partial semantic frame. After
the armed underlying `Show` completes, the probe reads the current
`Application.root`, admits one complete snapshot to the bounded publication
queue and writes its marker through the same screen sink. This also covers
tview's before-draw short-circuit and roots changed through `SetRoot`. It never
calls `Show` itself, never holds a process-global render mutex and never
performs socket I/O on the render goroutine. Runtime displacement of either
composed hook fails semantics closed.

A queue refusal, re-entrant `Show`, missing writer, partial marker, worker
failure or missing injected unit closes semantic publication with a typed
diagnostic. It is never hidden by a timeout increase, retry, quiet window or
stale-tree fallback.

## Optional semantics

The automatic tree does not require wrappers or per-widget annotations. An
application may add intent with the framework-neutral Go SDK:

```go
annotate.Tag(unreadBadge, annotate.Semantics{
	Key:     "unread-badge",
	Role:    "status",
	Name:    "Unread messages",
	TestID:  "unread-badge",
	Actions: []protocol.Action{protocol.ActionFocus},
})
```

Annotations can describe roles, names, ids, relationships and closed actions.
They cannot override geometry, focus, visibility, value, rendered text or
framework state. They are held in a side table and do not require replacing
tview constructors or fluent widget types.

## Dormant and unsupported modes

Without both `TERMWRIGHT_ENDPOINT` and `TERMWRIGHT_TOKEN`, `Attach` returns
before creating a client, channel, goroutine, socket or framework hook. The
instrumented and ordinary builds are required to render byte-identical output
in this mode.

A prebuilt binary cannot receive T1 units and therefore runs as explicitly
reported raw PTY. A controlled build whose capability unit fails to compile is
rejected loudly; Termwright does not create an exact-version patch profile or
silently downgrade its semantic tree.

Known declared limitations are clipped geometry for some tview containers and
enumeration of application-defined custom container children. Such nodes stay
visible as generic/opaque nodes and the reduced capability is present in run
metadata.

## Development

```sh
pnpm build
pnpm typecheck
pnpm test
cd ../../clients/go && go test -race -count=1 ./...
```

The native Linux and Windows certification rows require the relevant
toolchain and real PTY/ConPTY rather than treating their absence as a green
adapter result. Implementation invariants are recorded in
[`NOTES.md`](NOTES.md).
