# termwright examples

Three applications and the tests that drive them. Every test here is written
the way a user writes one — public API only, no imports from termwright's
internals — so these directories double as the templates the documentation
copies from.

| Example | Application | What the tests show |
|---|---|---|
| [`ink-todo/`](ink-todo) | Ink 7 + TypeScript | end-to-end over a real PTY, plus component tests with `mountInk` |
| [`textual-notes/`](textual-notes) | Textual + Python | a TypeScript test driving a Python program |
| [`tview-menu/`](tview-menu) | tview + Go | a TypeScript test driving a Go binary |

The three suites read almost identically, which is the point: the driver
addresses an application by role and name over a language-neutral protocol, so
the framework it happens to be written in changes the first line of the test
and nothing else.

## Running them

```sh
pnpm install
pnpm --filter './examples/*' test       # all three
pnpm --filter '@termwright-examples/ink-todo' test
```

Every suite skips itself rather than failing where it cannot run: no
pseudo-terminal (`TERMWRIGHT_SKIP_PTY=1`, or a sandbox that cannot fork one),
no Go toolchain, no Python with Textual and the `termwright` package installed.

`TERMWRIGHT_DEBUG=1` streams a live log to stderr while a suite runs — every
API call with its arguments, every wait and how it ended, screen and semantic
revisions, and each diagnostic the session recorded. It is the first thing to
reach for when a test waits for something that never arrives.

A run writes `<example>/termwright-report/index.html` — the trace report, with
the recording, the visual diff and the semantic diff of every failure. The
examples keep traces only for failures (`trace: 'retain-on-failure'`);
`TERMWRIGHT_PROFILE=ci` switches to recording every test and pins the palette so
cell snapshots match between a laptop and CI.

## ink-todo

A todo list with a filter box, a list, two buttons and a modal confirmation
before anything is removed. Mouse reporting is on, so the tests click.

```sh
cd examples/ink-todo
pnpm build && pnpm start     # play with it
pnpm test
```

- `src/todo-app.tsx` — the application. `useSemantic` annotations are the whole
  instrumentation; there are no test hooks in it.
- `src/mouse.ts` — the application side of clicking: enabling mouse reporting
  and hit-testing its own measured layout.
- `tests/app.e2e.test.ts` — `launchTerminal` through the Vitest preset: role
  locators, the CSS dialect, mouse, keyboard, YAML snapshots on file and both
  snapshot oracles.
- `tests/components.test.tsx` — the dialog alone under `mountInk`, with spies
  as props and a physical click on its stdin.
- `tests/fixtures.test.ts` — a suite that composes its own `app` fixture on top
  of the preset's, seeding the app's `todos.json` with `launch({ files })` and
  asserting the saved result in teardown.

## textual-notes

A notebook: a list, a field to add to it, and a `ModalScreen` confirmation.

```sh
cd examples/textual-notes
pip install textual termwright
python3 app/notes_app.py     # play with it
pnpm test
```

`enable_semantics(self)` in `on_mount` is the entire adapter integration.

## tview-menu

A menu and a settings form.

```sh
cd examples/tview-menu
go run ./app                 # play with it
pnpm test                    # builds the binary first
```

`termwright.Attach(app, root)` next to `Run()` is the entire adapter
integration.

## What to copy

- **Let the assertion be the wait.** Every locator matcher re-probes until the
  application publishes the tree for the frame your input caused, so `press()`
  followed straight by `expect(...)` is correct and sleep-free. Actions wait for
  a slow child to attach too, so a test can act right after a screen wait. The
  one thing that never waits is a plain read — `capabilities()` in a bare
  `expect`, or a **spy**, which renders nothing and so produces no frame to wait
  for. Put a polling matcher first, and poll a spy with `vi.waitFor`.
- **Scope destructive locators.** `dialog button#confirm` keeps working the day
  someone adds a second Delete button to the toolbar; `getByRole('button',
  {name: 'Delete'})` starts failing as ambiguous.
- **A pattern is partial; a file snapshot is a fence.** An inline pattern
  asserts only what it lists, and starts at the tree's root — scope it with
  `{ within: locator }` instead of spelling out the path. A snapshot stored in
  `__snapshots__` is compared strictly, so it tells you about any change at all.
- **Assert both oracles for anything important.** A semantic snapshot is
  published by the adapter, so it can pass on a screen nobody painted. The cell
  snapshot is the second opinion.
- **Declare the files a test needs, per test.** `launch({ files })` writes them
  into the test's private directory — the program's `cwd` — before it starts, so
  no suite depends on a shared fixtures directory or on what ran before it.
- **A click needs the frame to hold still.** Matchers only read the tree, but a
  click aims at coordinates. After anything animated — a modal fading in —
  `waitForStable()` before clicking.

[`NOTES.md`](NOTES.md) has the rest: why each example is shaped the way it is,
and the traps that cost time while writing them.
