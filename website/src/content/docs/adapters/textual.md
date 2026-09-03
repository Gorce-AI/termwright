---
title: Textual
description: Use semantic locators with a Python Textual application.
---

The Textual integration exposes widgets, roles, names, state, geometry, and
pointer targets. Keep using Textual Pilot for fast in-process widget tests; use
Termwright when the launched application, real terminal, process exit, or
failure trace matters.

## Install and launch

Install the Python probe in the application's environment:

```sh
python -m pip install "termwright[textual]==0.4.1"
```

The command targets Termwright 0.4.1. Keep the Python probe on the same release
as the npm `termwright` package.

Start the application through the probe from your TypeScript test:

```ts
import { fileURLToPath } from 'node:url';
import { expect, test } from 'termwright/test';

const appPath = fileURLToPath(new URL('../app.py', import.meta.url));

test('approves the request', async ({ terminal }) => {
  const app = await terminal.launch({
    command: ['python', '-m', 'termwright_probe', '--', 'python', appPath],
  });
  const approve = app.getByRole('button', { name: 'Approve' });

  await expect(approve).toBeAttached();
  await approve.click();
  await expect(app.getByRole('status')).toHaveText('Approved');
});
```

Python 3.9 and newer are supported. The probe can also launch scripts, modules,
console entry points, `uv run`, and `poetry run`. Do not use `python -S` or
`python -E`: both disable the Python startup mechanism used to load the probe.

## Annotate a custom widget

Use an annotation when a custom widget does not expose the application meaning
needed by a test:

```python
from termwright.textual import semantic

@semantic(role="button", name="Deploy", test_id="deploy")
class DeployWidget(Widget):
    pass
```

Annotations add roles, names, relationships, and application state. Text,
focus, geometry, and visibility still come from Textual.

## Supported behavior

The integration reports the active screen's widget identity, focus, state,
layout, clipped viewport area, and mouse target. Inactive screens are absent
from the semantic tree rather than reported as hidden. Active mouse capture is
not supported.

Textual versions are accepted when the integration finds the framework
features it needs; the version in
[Framework compatibility](../../reference/compatibility/) is the measured
minimum, not an exact allowlist.
