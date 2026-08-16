"""A Textual app wired for the termwright adapter conformance suite.

Run it directly to see the UI; run it under the driver to see the semantics.
Either way the screen is identical — that is the point of the dormant rule.

Contract the conformance suite drives it by:

* ``Permission required`` proves the first frame reached the terminal
* ``tab`` moves focus, and ``Reject`` becomes the focused button
* ``ctrl+q`` quits with exit code 0 from any focus position

Quitting is bound to ctrl+q rather than ``q``, which the reason field would
swallow, and rather than ctrl+c, which Textual 8 binds to copy.
"""

from __future__ import annotations

import logging

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Vertical
from textual.widgets import Button, Input, Label

from termwright import enable_semantics
from termwright.client import CAPABILITIES_WITH_LOGS
from termwright.logging_bridge import install_log_handler


class PermissionApp(App):
    """Two buttons and a reason field, the smallest interesting semantic tree."""

    CSS = "Screen { layout: vertical; } Button { width: 20; }"
    BINDINGS = [
        # `priority=True` is what makes this work from any focus: without it a
        # focused Input swallows the key like any other character, which is
        # exactly what leaves an app with no way out. Declared explicitly
        # rather than relying on Textual's built-in ctrl+q, so the contract
        # this fixture promises does not depend on a framework default.
        Binding("ctrl+q", "quit", "Quit", priority=True),
        # A convenience for the common case; the reason field still takes it
        # as text, which is why it cannot be the quit key the harness uses.
        Binding("q", "quit", "Quit"),
    ]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Permission required", id="prompt")
            yield Button("Approve", id="approve", variant="success")
            yield Button("Reject", id="reject", variant="error")
            yield Input(placeholder="Reason", id="reason")
            yield Label("focus: approve", id="status")

    def on_mount(self) -> None:
        # Returns None when no driver is attached; nothing is installed then.
        semantics = enable_semantics(self, capabilities=CAPABILITIES_WITH_LOGS)
        self.query_one("#approve", Button).focus()
        if semantics is not None:
            self.call_later(self._log_once, semantics)

    async def _log_once(self, semantics) -> None:
        """Log one ERROR the screen never shows.

        A TUI cannot print diagnostics without corrupting the render, so this
        goes to the driver instead. With no driver attached the handler is
        never installed and the line goes nowhere, exactly as it would with a
        file logger and no file.
        """
        await semantics.start()
        install_log_handler(semantics.client, logging.getLogger("permission"))
        logging.getLogger("permission").error(
            "permission dialog opened with no policy loaded",
            extra={"policy_path": "/etc/app/policy.json", "io": {"errno": 2}},
        )

    def on_descendant_focus(self, event) -> None:
        """Mirror focus into the text, so a byte-level probe can see it move."""
        focused = getattr(event.widget, "id", None) or "?"
        self.query_one("#status", Label).update(f"focus: {focused}")


if __name__ == "__main__":
    PermissionApp().run()
