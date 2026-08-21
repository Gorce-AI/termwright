---
title: Examples
description: Tested example projects for generic terminal applications, Ink, Textual, and tview.
---

These examples run in the repository test pipeline. Start with the generic
example, then choose the framework closest to your application.

| Example | What it demonstrates |
| --- | --- |
| [Getting started](https://github.com/gorce-ai/termwright/tree/main/examples/getting-started) | Generic Node CLI, real keyboard input, text assertions, and no semantic integration. |
| [Ink todo](https://github.com/gorce-ai/termwright/tree/main/examples/ink-todo) | End-to-end and component tests, semantic locators, fixtures, and cell and semantic snapshots. |
| [Textual notes](https://github.com/gorce-ai/termwright/tree/main/examples/textual-notes) | Python application launched through the Textual integration with semantic assertions. |
| [tview menu](https://github.com/gorce-ai/termwright/tree/main/examples/tview-menu) | Instrumented Go build, semantic navigation, and snapshots. |

## Run an example

From the repository root:

```sh
pnpm install
pnpm --filter @termwright-examples/getting-started test
```

Each example has its own package scripts and checked-in fixture application.
The root CI runs the examples to catch public API and integration drift.

For frameworks without a standalone example project, use the complete test on
the corresponding [framework integration](../../adapters/) page. Those pages
also state which geometry, visibility, and pointer capabilities the framework
can provide.
