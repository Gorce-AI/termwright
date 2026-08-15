"""A small Textual notebook: a list of notes, a field to add one, and a modal
confirmation before anything is deleted.

The instrumentation is one call. Without TERMWRIGHT_ENDPOINT and
TERMWRIGHT_TOKEN in the environment ``enable_semantics`` returns ``None``: no
socket is opened, no marker is written, and the screen is byte for byte what it
would have been.

    python3 app/notes_app.py        # just a notebook
"""

from __future__ import annotations

from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import Button, Input, Label, ListItem, ListView

from termwright import enable_semantics

INITIAL = ["buy milk", "call the bank", "write the release notes"]


class NoteItem(ListItem):
    """One note.

    The subclass exists to keep the note's text as data — reading it back out
    of the rendered ``Label`` is how the delete path used to break. It needs no
    termwright-specific annotation: a ``listitem`` takes its accessible name
    from its contents, so ``getByRole('listitem', {name: 'buy milk'})`` finds
    it as written.
    """

    def __init__(self, note: str) -> None:
        super().__init__(Label(note))
        self.note = note


class ConfirmDelete(ModalScreen[bool]):
    """Dismisses with True to delete, False to keep.

    A ``ModalScreen`` is published with the ``dialog`` role and the ``modal``
    state, so a test can scope its locators to it: ``dialog button#confirm``.
    """

    BINDINGS = [Binding("escape", "dismiss(False)", "Cancel")]

    def __init__(self, note: str) -> None:
        super().__init__()
        self.note = note

    def compose(self) -> ComposeResult:
        with Vertical(id="confirm-box"):
            yield Label(f'Delete "{self.note}"?', id="question")
            with Horizontal():
                yield Button("Delete", id="confirm", variant="error")
                # Cancel takes the focus: an Enter on a dialog nobody read
                # must not delete anything.
                yield Button("Cancel", id="cancel", variant="primary")

    def on_mount(self) -> None:
        self.query_one("#cancel", Button).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        self.dismiss(event.button.id == "confirm")


class NotesApp(App[None]):
    CSS = """
    Screen { layout: vertical; }
    ListView { height: 6; }
    #confirm-box { width: 44; height: 5; background: $panel; }
    """
    BINDINGS = [Binding("q", "quit", "Quit")]

    def compose(self) -> ComposeResult:
        with Vertical():
            yield Label("Notes", id="title")
            yield ListView(*(NoteItem(note) for note in INITIAL), id="notes")
            yield Input(placeholder="New note", id="draft")
            with Horizontal():
                yield Button("Add", id="add")
                yield Button("Delete", id="delete")
            yield Label("status: ready", id="status")

    def on_mount(self) -> None:
        # Returns None when no driver is attached; nothing is installed then.
        enable_semantics(self)
        self.query_one("#notes", ListView).focus()

    def on_button_pressed(self, event: Button.Pressed) -> None:
        if event.button.id == "add":
            self.add_note()
        elif event.button.id == "delete":
            self.confirm_delete()

    def add_note(self) -> None:
        draft = self.query_one("#draft", Input)
        text = draft.value.strip()
        if not text:
            return
        self.query_one("#notes", ListView).append(NoteItem(text))
        draft.value = ""
        self.set_status(f"added {text}")

    def confirm_delete(self) -> None:
        note = self.selected_note()
        if note is None:
            return

        def deleted(confirmed: bool | None) -> None:
            if confirmed:
                notes = self.query_one("#notes", ListView)
                index = notes.index
                if index is not None:
                    notes.pop(index)
                self.set_status(f"deleted {note}")
            else:
                self.set_status("cancelled")

        self.push_screen(ConfirmDelete(note), deleted)

    def selected_note(self) -> str | None:
        item = self.query_one("#notes", ListView).highlighted_child
        if isinstance(item, NoteItem):
            return item.note
        return None

    def set_status(self, text: str) -> None:
        self.query_one("#status", Label).update(f"status: {text}")


if __name__ == "__main__":
    NotesApp().run()
