---
title: Why test through a real terminal?
description: Choose between Termwright, tmux scripts, expect, and grid-only terminal testing.
---

Use Termwright when a repeatable test needs to own a process, send terminal
input, wait for rendered state, and retain failure evidence. A small tmux or
expect script can be a better fit for one-off automation.

## Compare the approaches

| Need | tmux | expect / pexpect | Grid-only test tool | Termwright |
| --- | --- | --- | --- | --- |
| Control an already running session | Yes | No | No | No |
| Launch an isolated PTY | No | Yes | Yes | Yes |
| Model a full VT screen | Partial | No | Yes | Yes |
| Retry assertions against screen state | Manual | Pattern-based | Varies | Yes |
| Locate by role and name | No | No | No | With an integration |
| Retain terminal, actions, semantics, and logs | No | No | Varies | Yes |

## Use tmux when

- the process already runs inside a human session;
- a short shell script and a fixed delay are sufficient;
- the goal is interactive session control rather than a repeatable assertion.

tmux `send-keys` and `capture-pane` do not own application startup, environment,
terminal profile, or render completion.

## Use expect when

The application is a line-oriented prompt and response program. Expect matches
the byte stream well, but it does not model a full-screen application that
repaints existing rows.

## Use Termwright generic mode when

You need a real PTY, terminal cells, keyboard and mouse input, retries, process
isolation, traces, or reports, but do not need framework semantics.

## Add a framework integration when

A test should locate widgets by role and accessible name, inspect component
state, or assert qualified geometry. Integration capabilities differ by
framework; see the [compatibility matrix](../../reference/compatibility/).
