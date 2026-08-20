"""A perfectly ordinary Textual application.

The point of this file is what it does NOT contain: no import of termwright,
no adapter call, no configuration of any kind. If the
probe can get semantics out of this, it can get them out of an application
that has never heard of us.

It quits itself after a moment so a test can run it to completion; that is
ordinary Textual and needs nothing of ours.
"""

from textual.app import App, ComposeResult
from textual.containers import Vertical
from textual.widgets import Button, Input, Label


class PermissionApp(App):
    """One of each interesting role."""

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve")
            yield Button("Reject", id="reject", disabled=True)
            yield Input(placeholder="Reason", id="reason")

    def on_mount(self) -> None:
        self.set_timer(0.4, self.exit)


if __name__ == "__main__":
    PermissionApp().run()
