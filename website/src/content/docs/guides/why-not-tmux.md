---
title: Why not tmux?
description: The honest comparison with tmux + capture-pane, expect scripts, and grid-only test tools.
---

The everyday competitor to termwright is not another testing framework. It is
`tmux send-keys` plus `capture-pane`, glued together with `sleep`, and it is
genuinely the right tool for a one-off script. Here is where it stops being one.

## What tmux gives you, and what it costs

`capture-pane` hands you the visible text of a pane. That is a real capability,
and four things are missing from it.

**There is no event to wait for.** tmux cannot tell you that the program
finished rendering, so a script waits by sleeping. Sleeps are either too short
(flaky) or too long (a suite that takes twenty minutes). termwright waits on
screen revisions, semantic revisions and process events — the render-commit
marker means "this frame is done" is a fact, not a guess.

**Text is not meaning.** `capture-pane | grep Approve` breaks when the button
moves, when a border style changes, when the label is padded differently, or
when the word appears twice. `getByRole('button', {name: 'Approve'})` breaks
when the button stops being a button. The
[semantic YAML snapshot](../assertions/) makes that difference reviewable: a
whitespace change produces no diff at all.

**Attributes are lost.** Colours, bold, underline, cursor shape, the alternate
screen buffer, mouse-encoding modes, bracketed paste — `capture-pane` flattens
or drops them. termwright models the grid cell by cell, which is what lets a
test assert "the word ERROR is red" instead of "the word ERROR exists".

**Input is one-directional.** `send-keys` writes bytes; nothing reads back
whether the application was in a state to receive them. termwright pre-flights
an action (visible, enabled, in-viewport, mouse tracking actually enabled) and
refuses with `unsupported-action` rather than sending bytes nobody reads.

And when a tmux-driven test fails in CI, what you have is the last screen. What
termwright leaves you is a [`.twtrace`](../traces/): the whole session as a
recording with step markers, every input, and a semantic tree per revision —
plus an HTML report with a visual and semantic diff of the failing step.

## What about expect / pexpect?

`expect` is thirty years of well-earned muscle memory and it solves a different
problem well: line-oriented dialogue with a program that prints prompts. It has
no concept of a screen, so a full-screen TUI — where the program repaints the
same rows — is exactly where it stops helping.

termwright reads the same stream through a VT emulator, so "what is on row 12
right now" is answerable. A thin `send` / `expect(pattern)` compatibility shim
over the driver is planned as a migration path, not as the recommended API.

## What about grid-only test tools?

Tools like microsoft/tui-test are real test frameworks with a real pty and a
real emulator, and everything above about waiting and attributes applies to
them too. The line that separates them is the semantic tree: they observe the
grid, which is all a terminal *shows*. termwright additionally lets the
application publish what it *means*, and no other tool does that today.

That difference is opt-in. Without an adapter, termwright is a grid-only tool
with good waits and good forensics; with one, locators stop being coordinates.

## When tmux is still the right answer

- You need to observe a program you cannot launch yourself — something already
  running in someone's session.
- You are writing a five-line shell script and a `sleep 2` is genuinely fine.
- You need to *interact* with a live session for a human, not assert on it.

termwright launches the program itself, on purpose: owning the pty is what makes
input, sizing, environment and recording deterministic. If you cannot own the
process, this is not the tool.

## The honest summary

| | tmux + capture-pane | expect / pexpect | grid-only test tools | termwright |
|---|---|---|---|---|
| Real pty | yes | yes | yes | yes |
| Full VT model (colors, modes, alt screen) | partial | no | yes | yes |
| Waits on render events | no | on patterns | yes | yes |
| Locators by role and name | no | no | no | with an adapter |
| Snapshots that survive reflow | no | no | no | yes |
| Recording + failure report | no | no | partial | yes |
| Works on an already-running session | yes | no | no | no |
