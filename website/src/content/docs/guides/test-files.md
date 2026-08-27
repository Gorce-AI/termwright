---
title: Test files and isolation
description: Seed files, copy project templates, and control the private working directory used by each test.
---

Each Termwright test gets a private temporary working directory. Declare the
files your application needs in `terminal.launch()`; Termwright writes them
before starting the process and removes the directory after the test.

## Seed files before launch

Use an absolute path for the program itself. Relative commands resolve from the
private working directory, not from the repository:

```ts
import { fileURLToPath } from 'node:url';

const editor = fileURLToPath(new URL('../editor.js', import.meta.url));

const app = await terminal.launch({
  command: [process.execPath, editor],
  files: {
    'config.json': JSON.stringify({ theme: 'dark' }),
    'notes/todo.md': '- write tests\n',
  },
});
```

Parent directories are created automatically. Pass a `Uint8Array` to write
binary data. Paths that escape the private directory are rejected.

## Copy a project template

Use `template` when a test needs an existing directory tree:

```ts
const app = await terminal.launch({
  command: [process.execPath, editor],
  template: 'test/fixtures/editor-project',
  files: { 'config.json': JSON.stringify({ theme: 'light' }) },
});
```

Declared `files` are written after the template is copied, so they can replace
specific template files.

## Use an explicit working directory

Set `cwd` only when the application must run against a real project directory:

```ts
const app = await terminal.launch({
  command: [process.execPath, editor],
  cwd: projectDirectory,
});
```

An explicit `cwd` gives up file-system isolation for that session. Tests can
then observe or change shared files, so prefer `files` or `template` for normal
cases.

## Environment isolation

The test fixture starts with a minimal inherited environment and adds the
variables declared in `env`. This avoids leaking credentials or machine-local
configuration into the child process.

```ts
const app = await terminal.launch({
  command: [process.execPath, editor],
  env: { EDITOR_MODE: 'test' },
});
```

Use the explicit environment inheritance option only when the application
requires it. See [Configuration](../../reference/configuration/) for precedence
and environment options.

## Cleanup

The fixture tracks every launched session. It closes processes and removes the
private directory after the case, including when an assertion fails. Call
`close()` yourself only when process shutdown is part of the behavior under
test.

For reusable setup around these launches, see [Extend test fixtures](../fixtures/).
