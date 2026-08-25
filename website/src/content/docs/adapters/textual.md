---
title: Textual
description: Run a Python Textual application with semantic locators, geometry, and exact hit testing.
---

The Python integration observes an ordinary Textual application. Use it when tests
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

The launcher uses CPython's `sitecustomize` startup hook and exercises scripts,
`python -m`, console entry points, `uv run`, and `poetry run` in real subprocess
tests. `python -S` disables `site`, while `python -E` ignores `PYTHONPATH`; both
therefore bypass this hook by design. If semantic capabilities are required,
Termwright reports `probe-attach-failed` at startup instead of silently running
the test as a generic terminal session.

## Use Textual Pilot for widget tests

Textual Pilot and Termwright cover different layers. Keep Pilot for fast,
in-process widget tests that need access to the Python app object. Use
Termwright for end-to-end tests that need the real terminal boundary, signals,
exit behavior, retained traces, or the same external interface users run.

The same project can use both: Pilot for the widget-level suite and Termwright
for the end-to-end lane.

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

Textual 8.2.8 is verified. The integration observes stable widget identity, intended
and clipped geometry, ancestor display, focus, native widget state, and exact
fresh-pointer ownership through `Screen.get_widget_at()`. Active mouse capture
is outside that contract.

See [Framework compatibility](../../reference/compatibility/) for current versions.
