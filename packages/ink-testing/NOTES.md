# Ink testing implementation notes

The in-process backend supplies Ink with private stdin/stdout streams and the
session environment without mutating the test runner. It calls normal
`ink.render`, wrapped only by `@termwright/probe-ink/internal/testing`; that
entry point is intentionally not part of the probe's public root API.

Output produced synchronously inside `spawn()` is buffered until the driver
subscribes, mirroring a PTY kernel buffer. `applyOnlcr` reproduces PTY newline
translation. Input is delivered verbatim, matching Ink's raw mode.

The mount and fixture paths intentionally differ in process identity,
environment isolation, signals, and crash reporting. Their semantic tree,
screen, and input model remain the same. File logging is delegated to the
driver; console capture is not part of the removed Ink renderer adapter.

The probe can report Ink host identity, retained ARIA hints, rendered text and
qualified geometry. It cannot report host focus, third-party widget values, or
reliable occlusion. Tests therefore wait for painted transitions between
dependent key presses and do not turn annotations into physical state.
