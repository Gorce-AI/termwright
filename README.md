# Termwright

Termwright's certified native host supports the Node.js 22 and 24 LTS lines.
Package manifests deliberately reject intervening and future majors until the
same native-host, PTY, framework, and Windows matrix certifies them.

<p align="center">
  <img src="website/src/assets/termwright-logo.svg" alt="Termwright" width="640">
</p>

[![CI](https://github.com/Gorce-AI/termwright/actions/workflows/ci.yml/badge.svg)](https://github.com/Gorce-AI/termwright/actions/workflows/ci.yml)
[![Docs](https://github.com/Gorce-AI/termwright/actions/workflows/docs.yml/badge.svg)](https://gorce-ai.github.io/termwright/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Termwright is an end-to-end testing framework for command-line and terminal
user-interface applications. It runs programs in a real pseudo-terminal, sends
keyboard, paste, resize, and mouse input, and asserts the rendered terminal.
Framework integrations add roles, accessible names, state, geometry, and exact
pointer targeting where the framework can provide them.

## Install

```sh
npm install --save-dev termwright
```

## Write a test

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const appFile = fileURLToPath(new URL('../app.js', import.meta.url));

test('submits a permission request', async ({ terminal }) => {
  const app = await terminal.launch({
    command: [process.execPath, appFile],
  });

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('Approved');
});
```

This generic mode works for any terminal program. Add a
[framework integration](https://gorce-ai.github.io/termwright/adapters/) when a
test needs semantic locators such as `getByRole()`.

## Run tests

```sh
npx termwright test
npx termwright watch
npx termwright ui
```

All three commands use one certified Termwright host backed by exactly certified
Vitest 4.1.11. It is embedded as the generic engine, not selected or launched by
the user. Termwright owns run and attempt identity, terminal resource
budgets, cleanup, event integrity and flaky-run classification; Vitest supplies
collection, transforms, mocks, assertions and the authoring DSL.

`termwright ui` opens the desktop Runner with the test catalog, concurrent live
executions, terminal evidence, semantic inspection, run history, replay, and
recording. Use `--browser` for the browser surface or `--no-open` for a server
without a window.

## Documentation

- [Getting started](https://gorce-ai.github.io/termwright/getting-started/)
- [Writing tests](https://gorce-ai.github.io/termwright/writing-tests/)
- [Running tests](https://gorce-ai.github.io/termwright/running-tests/)
- [Runner UI](https://gorce-ai.github.io/termwright/tools/runner-ui/)
- [Framework integrations](https://gorce-ai.github.io/termwright/adapters/)
- [Examples](https://gorce-ai.github.io/termwright/guides/examples/)
- [API and CLI reference](https://gorce-ai.github.io/termwright/reference/test-api/)

The compatibility matrix lists exact supported framework versions and which
geometry, visibility, and pointer operations each integration can prove.

## Repository

Working examples live in [`examples/`](examples). Public package exports are
listed in the [package reference](https://gorce-ai.github.io/termwright/reference/packages/).
Cross-package contracts are maintained in [`CONTRACTS.md`](CONTRACTS.md).

```sh
pnpm install
pnpm check:fast
pnpm check:local
```

Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before changing the repository. Docs
changes follow [`docs/DOCUMENTATION_GUIDE.md`](docs/DOCUMENTATION_GUIDE.md).

## License

[MIT](LICENSE) © gorce-ai
