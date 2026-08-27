---
title: Framework integrations
description: Decide whether your terminal application needs a framework integration and choose the supported one.
---

Every terminal application can be tested through its rendered screen and PTY.
A framework integration additionally publishes elements with roles, names,
state, relationships, and the physical facts that framework can observe.

## Do you need an integration?

| You want to test                                                           | Integration required?                                |
| -------------------------------------------------------------------------- | ---------------------------------------------------- |
| Rendered text, cells, colors, keyboard input, paste, resize, exit, signals | No                                                   |
| `getByRole()`, `getByLabel()`, semantic state, semantic snapshots          | Yes                                                  |
| Semantic pointer actions                                                   | Yes, and the framework must expose exact hit testing |
| Framework-specific values or relationships                                 | Usually; annotations may also be needed              |

Start without an integration if screen-level behavior is enough. Add one when
semantic locators make the test clearer or when you need framework state.

## Choose your framework

| Framework                          | Integration                                   | Semantic identity      | Viewport visibility | Exact pointer recipient |
| ---------------------------------- | --------------------------------------------- | ---------------------- | ------------------- | ----------------------- |
| [Ink](ink/)                        | `@termwright/probe-ink`                       | stable                 | unsupported         | unsupported             |
| [OpenTUI](opentui/)                | `@termwright/probe-opentui`                   | stable                 | unsupported         | unsupported             |
| [Textual](textual/)                | Python `termwright` probe                     | stable                 | supported           | supported               |
| [tview](tview/)                    | `@termwright/probe-tview` instrumented build  | stable                 | unsupported         | unsupported             |
| [Ratatui](ratatui/)                | `termwright-probe-ratatui` instrumented build | frame-local by default | unsupported         | unsupported             |
| [Bubble Tea / Bubbles](bubbletea/) | `@termwright/probe-charm` instrumented build  | frame-local by default | unsupported         | unsupported             |

The generated [compatibility reference](../reference/compatibility/) is the
source of truth for exact versions, runtimes, packages, and limitations.

## What integration changes

A framework integration observes runtime state and publishes a semantic tree. It
does not replace rendering or call application callbacks for test actions.
Keyboard and pointer input still cross the PTY boundary.

The integration mechanism remains dormant without the Termwright endpoint and
token. A normal application launch does not connect or publish semantic data.

## Add application intent only when needed

Some frameworks discard application-specific names, roles, or relationships.
Their annotation SDKs can add those facts. Annotations cannot override physical
facts such as current bounds, focus, clipping, or pointer ownership.

Prefer framework-native accessibility metadata first. Add a Termwright
annotation when the framework does not retain the intent you need.
The annotation `name` is the accessible name used by role locators. Choose a
portable role such as `dialog`, `textbox`, `button`, `list`, `listitem`,
`status`, or `alert` when it describes the application contract. Integrations
must not infer an interactive role only because rendered text looks like a
control.

## Verify the integration

Write one test that waits for the initial screen and asserts an element by
role:

```ts
const app = await terminal.launch({ command });
await app.waitForText('Permission required');
await expect(app.getByRole('button', { name: 'Approve' })).toBeAttached();
```

Then inspect `await app.settled()` or the Runner inspector. Do not infer a
working integration from the package being installed; the launch command must
actually enable it.

## Add another framework

Read [Writing a framework integration](writing-an-adapter/) after confirming
that none of the supported integrations applies. That page is for probe and
adapter authors and includes the protocol, lifecycle, validation, capability,
and conformance requirements.
