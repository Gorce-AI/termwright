// The same application as fixture-app, plus developer annotations.
//
// Kept separate on purpose: fixture-app must import nothing of ours, and a
// test asserts exactly that. Annotation is opt-in, so it gets its own fixture
// rather than compromising the one that proves zero-config.
package main

import (
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/annotate"
)

// badge is a primitive termwright has never heard of, which is the case the
// annotation library exists for: without an annotation it still reaches the
// tree as a named generic, and with one it says what it means.
type badge struct {
	*tview.Box
	count int
}

func newBadge(count int) *badge {
	return &badge{Box: tview.NewBox(), count: count}
}

func (b *badge) Draw(screen tcell.Screen) {
	b.Box.DrawForSubclass(screen, b)
	x, y, width, _ := b.GetInnerRect()
	for index, glyph := range fmt.Sprintf("[%d unread]", b.count) {
		if index >= width {
			break
		}
		screen.SetContent(x+index, y, glyph, nil, tcell.StyleDefault)
	}
}

func main() {
	app := tview.NewApplication()

	status := tview.NewTextView().SetText("status: ready")
	list := tview.NewList().ShowSecondaryText(false)
	list.SetTitle("Files").SetBorder(true)
	for _, name := range []string{"readme.md", "main.go", "LICENSE"} {
		list.AddItem(name, "", 0, nil)
	}

	save := tview.NewButton("Save")
	quit := tview.NewButton("Quit")

	unread := newBadge(3)
	// What the probe cannot know: that this box is a status badge, what to
	// call it, and the domain state behind it. Nothing here states where it is
	// or whether it has the focus — the probe measured those, and the library
	// offers no way to override them.
	annotate.Tag(unread, annotate.Semantics{
		Role:   "status",
		Name:   "Unread messages",
		TestID: "unread-badge",
		Domain: map[string]string{"mailbox": "inbox", "unread": "3"},
	})

	// An annotation on a widget the probe does understand: the role stays
	// button, only the name is sharpened.
	annotate.Tag(save, annotate.Semantics{Name: "Save changes", TestID: "save"})

	pages := tview.NewPages()
	form := tview.NewForm().AddInputField("Name", "", 20, nil, nil)
	form.SetTitle("Settings").SetBorder(true)

	layout := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(list, 7, 0, true).
		AddItem(save, 1, 0, false).
		AddItem(quit, 1, 0, false).
		AddItem(unread, 1, 0, false).
		AddItem(status, 1, 0, false)

	pages.AddPage("main", layout, true, true)
	pages.AddPage("settings", form, true, false)

	// Tab cycles focus, which is what a test needs in order to observe focus
	// moving at all: tview does not cycle by default.
	focusOrder := []tview.Primitive{list, save, quit}
	focused := 0

	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyTab {
			focused = (focused + 1) % len(focusOrder)
			app.SetFocus(focusOrder[focused])
			return nil
		}
		// Shortcuts only while the main page is in front. Without this the
		// global capture swallows every "s" and "q" typed into the form,
		// which is the oldest bug in TUI keybinding.
		if name, _ := pages.GetFrontPage(); name != "main" {
			return event
		}
		switch event.Rune() {
		case 'q':
			app.Stop()
			return nil
		case 's':
			pages.ShowPage("settings")
			app.SetFocus(form)
			status.SetText("status: settings")
			return nil
		}
		return event
	})

	if err := app.SetRoot(pages, true).SetFocus(list).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
