---
title: Textual
description: Run a Python Textual application with semantic locators, geometry, and exact hit testing.
---

The Python probe observes an ordinary Textual application. Use it when tests
need widgets, roles, names, state, geometry, or pointer targeting.

## Install and launch

```sh
pip install termwright
# Or install Textual with the SDK:
pip install "termwright[textual]"
```

```sh
python -m termwright_probe -- python app.py
```

```ts
const app = await terminal.launch({
  command: ['python', '-m', 'termwright_probe', '--', 'python', appPath],
});
await app.getByRole('button', {name: 'Approve'}).click();
await expect(app.getByRole('status')).toHaveText('Approved');
```

Python 3.9 and newer are supported. Injection is dormant without a Termwright
endpoint and token.

## Annotate a custom widget

```python
from termwright.textual import semantic

@semantic(role="button", name="Deploy", test_id="deploy")
class DeployWidget(Widget):
    pass
```

Annotations add application intent. They do not replace observed text, focus,
geometry, or visibility.

## Supported behavior

Textual 8.2 is verified. The probe observes stable widget identity, intended
and clipped geometry, ancestor display, focus, native widget state, and exact
fresh-pointer ownership through `Screen.get_widget_at()`. Active mouse capture
is outside that contract.

See [Framework compatibility](../../reference/compatibility/) for current versions.
