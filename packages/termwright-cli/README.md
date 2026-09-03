# Termwright

Test interactive command-line applications through a real terminal.

Termwright starts your program in a pseudoterminal, sends keyboard and mouse
input, and asserts the rendered terminal screen. When a test fails, it keeps a
trace you can replay in the desktop Runner.

## Install

Termwright supports Node.js 22 and 24 on macOS 13.5+ (x64/arm64), Windows 10
1809+ or Server 2019+ (x64/arm64), and glibc 2.35+ Linux (x64/arm64).

```sh
npm install --save-dev termwright
```

Vitest is included and managed by Termwright. Do not install a matching Vitest
version just to run Termwright tests.

## Write a test

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const program = fileURLToPath(new URL('../app.js', import.meta.url));

test('approves a command', async ({ terminal }) => {
  const app = await terminal.launch({ command: [process.execPath, program] });

  await app.waitForText('Permission required');
  await app.press('Enter');

  await expect(app).toHaveText('running: ls -la');
});
```

Run it with:

```sh
npx termwright test
```

The application does not need a Termwright dependency. This black-box mode
works for any terminal program and can assert text, cells, process exit, and
keyboard behavior. Mouse assertions also require the application to enable
terminal mouse reporting.

## Add semantic locators

Integrations for Ink, OpenTUI, Textual, tview, Bubble Tea, and Ratatui can expose
roles, labels, state, and framework-owned geometry:

```ts
const approve = app.getByRole('button', { name: 'Approve' });
await expect(approve).toBeAttached();
```

Visibility and pointer support differ by framework. Termwright does not infer a
button from decorated text or guess where a mouse event will go. Check the
[framework integration guide](https://gorce-ai.github.io/termwright/adapters/)
before relying on semantic actions.

## Inspect a failure

```sh
npx termwright ui
```

The Runner shows the terminal, application logs, semantic state, and test steps
from a failed attempt. Retained traces can also be opened directly:

```sh
npx termwright ui --trace path/to/test.twtrace
```

## Documentation

- [Install and run your first test](https://gorce-ai.github.io/termwright/getting-started/)
- [Write terminal tests](https://gorce-ai.github.io/termwright/writing-tests/)
- [Choose locators](https://gorce-ai.github.io/termwright/guides/locators/)
- [Debug a failed test](https://gorce-ai.github.io/termwright/tools/debugging/)
- [Supported platforms and limitations](https://gorce-ai.github.io/termwright/reference/limitations/)

Termwright is released under the MIT license. Source and contribution guidance
are available in the [GitHub repository](https://github.com/Gorce-AI/termwright).
