"""A Textual app wired for the termwright adapter conformance suite.

Run it directly to see the UI; run it under the driver to see the semantics.
Either way the screen is identical — that is the point of the dormant rule.

Contract the conformance suite drives it by:

* ``Permission required`` proves the first frame reached the terminal
* ``tab`` moves focus, and ``Reject`` becomes the focused button
* ``q`` quits with exit code 0
"""

from __future__ import annotations

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.widgets import Button, Input, Label

from termwright import enable_semantics


class PermissionApp(App):
    """Two buttons and a reason field, the smallest interesting semantic tree."""

    CSS = "Screen { layout: vertical; } Button { width: 20; }"
    BINDINGS = [Binding("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve", variant="success")
            yield Button("Reject", id="reject", variant="error")
            yield Input(placeholder="Reason", id="reason")
            yield Label("focus: approve", id="status")

    def on_mount(self) -> None:
        # Returns None when no driver is attached; nothing is installed then.
        enable_semantics(self)
        self.query_one("#approve", Button).focus()

    def on_descendant_focus(self, event) -> None:
        """Mirror focus into the text, so a byte-level probe can see it move."""
        focused = getattr(event.widget, "id", None) or "?"
        self.query_one("#status", Label).update(f"focus: {focused}")


if __name__ == "__main__":
    PermissionApp().run()
