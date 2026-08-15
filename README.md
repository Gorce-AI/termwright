# termwright

**Playwright for the terminal.** A real pseudo-terminal and a standards-grade VT
emulator observe any program exactly; an application-published **semantic tree**
— the terminal analogue of an accessibility tree — gives you
`getByRole('button', { name: 'Approve' })` instead of scraping the screen.

📖 **[Documentation](https://gorce-ai.github.io/termwright/)** ·
[Getting started](https://gorce-ai.github.io/termwright/getting-started/) ·
[Why not tmux?](https://gorce-ai.github.io/termwright/guides/why-not-tmux/)

```ts
import {expect, test} from '@termwright/test';

test('asks before running a command', async ({terminal}) => {
  const app = await terminal.launch({command: ['node', 'agent.js']});
  await app.waitForText('Permission required');

  await app.getByRole('button', {name: 'Approve'}).activate();

  await expect(app.getByRole('dialog')).not.toBeVisible();
  await expect(app).toHaveText('running: ls -la');
});
```

Every action goes through the pseudo-terminal: a click is a real mouse report, a
keystroke is real bytes. There is no callback back-channel into the application,
so a test that passes is evidence the program works.

## Three things nobody else has

- **Semantic YAML snapshots** — the accessibility tree serialized as reviewable
  YAML, matched partially. A snapshot breaks when meaning changes, not when
  whitespace does.
- **Failure forensics** — a self-contained HTML report with a visual diff, a
  semantic diff in plain sentences, and an embedded recording positioned on the
  failing step. Recording is on by default.
- **Incremental semantic diffs for agents** — `capture_since` returns the rows
  *and the semantic subtrees* that changed, so an agent stops re-reading screens
  it has already seen.

One driver serves three consumers: deterministic tests (a Vitest preset), AI
agents (MCP), and an interactive runner with live preview and time travel.

## Packages

| Package | Purpose |
|---|---|
| [`@termwright/protocol`](packages/protocol) | Schemas, limits, roles, framing, handshake, marker, validation |
| [`@termwright/driver`](packages/driver) | PTY + VT, sessions, screen model, locators, actions, waits, typed errors |
| [`@termwright/test`](packages/test) | Vitest preset: fixtures, matchers, semantic and cell snapshots, report |
| [`@termwright/ink`](packages/ink) | Semantic adapter for Ink 7 |
| [`@termwright/ink-testing`](packages/ink-testing) | `mountInk` (in-process) and `launchInkFixture` (real pty) |
| [`@termwright/opentui`](packages/opentui) | Semantic adapter for OpenTUI |
| [`@termwright/mcp`](packages/mcp) | MCP server over the public driver API |
| [`@termwright/trace`](packages/trace) | The `.twtrace` format: writer, reader, HTML report |
| [`@termwright/screenshot`](packages/screenshot) | SVG with embedded glyph outlines, PNG through resvg, no browser |
| [`@termwright/ui`](packages/ui) | Interactive runner: live view, inspector, time travel, recorder |
| [`@termwright/conformance`](packages/conformance) | Fixtures and the reusable adapter contract suite |
| [`termwright`](packages/termwright-cli) | Umbrella package and CLI |

Other registries, same repository — see [`clients/`](clients):

| Package | Registry | Contents |
|---|---|---|
| `termwright` | PyPI | protocol client + Textual adapter |
| `github.com/gorce-ai/termwright/clients/go` | Go modules | protocol client + tview adapter |
| `termwright-protocol` | crates.io | protocol client |

Working examples, written against the public API only, live in
[`examples/`](examples).

## Honest about what it cannot see

A program without a termwright adapter is still fully testable — text, cells,
colours, modes, scrollback, mouse, paste, resize — and every diagnostic says
`semanticTree: false` rather than inventing roles. Frameworks that compose
strings instead of retaining a widget tree (Bubble Tea with Lip Gloss joins)
degrade to that generic mode on purpose, and the
[adapter overview](https://gorce-ai.github.io/termwright/adapters/) says which is
which before you adopt anything.

Alpine/musl is not supported (use `node:22-slim`), and the
[limitations page](https://gorce-ai.github.io/termwright/reference/limitations/)
lists what is untested rather than burying it.

## Development

```sh
pnpm install
pnpm -r --filter './packages/*' run build
pnpm -r --filter './packages/*' run typecheck
pnpm -r --filter './packages/*' run test
```

Cross-package contracts are normative in [`CONTRACTS.md`](CONTRACTS.md); changes
to them are logged in [`CHANGELOG-contracts.md`](CHANGELOG-contracts.md). See
[`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request, and
[`RELEASING.md`](RELEASING.md) for how versions ship — every publish is a
manual, approved pipeline; nothing releases on a merge.

## License

[MIT](LICENSE) © gorce-ai
