"""A perfectly ordinary Textual application.

The point of this file is what it does NOT contain: no import of termwright,
no adapter call, no configuration of any kind. If the
probe can get semantics out of this, it can get them out of an application
that has never heard of us.

After Textual confirms the initial message queue was processed and the screen
refreshed, it signals the test harness over a test-only file descriptor.  The
harness then exits it through the same terminal-input path in every run.  This
keeps the lifecycle causal without making the fixture aware of Termwright.
"""

import os
from typing import ClassVar

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.widgets import Button, Input, Label

READY_FD_ENV = "TERMWRIGHT_GOLDEN_READY_FD"


class PermissionApp(App):
    """One of each interesting role."""

    BINDINGS: ClassVar[list[Binding]] = [
        Binding("q", "quit", show=False, priority=True)
    ]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Button("Reject", id="reject", disabled=True)
            yield Input(placeholder="Reason", id="reason")

    def on_mount(self) -> None:
        scheduled = self.call_after_refresh(self._signal_ready)
        if not scheduled:
            raise RuntimeError("Textual refused the deterministic post-refresh signal")

    def _signal_ready(self) -> None:
        ready_fd = int(os.environ[READY_FD_ENV])
        if os.write(ready_fd, b"R") != 1:
            raise RuntimeError("could not signal the deterministic render boundary")
        os.close(ready_fd)


if __name__ == "__main__":
    PermissionApp().run()
