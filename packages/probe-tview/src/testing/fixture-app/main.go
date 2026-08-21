// A plain tview application. It imports nothing of termwright's, has no
// feature flag and no build tag: this is the "zero config" the probe has to
// work against, and the file is deliberately what a user would have written
// before they had ever heard of us.
package main

import (
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func main() {
	app := tview.NewApplication()

	status := tview.NewTextView().SetText("status: ready")
	redraws := 0
	list := tview.NewList().ShowSecondaryText(false)
	list.SetTitle("Files").SetBorder(true)
	for _, name := range []string{"readme.md", "main.go", "LICENSE"} {
		list.AddItem(name, "", 0, nil)
	}

	save := tview.NewButton("Save")
	quit := tview.NewButton("Quit")

	pages := tview.NewPages()
	form := tview.NewForm().AddInputField("Name", "", 20, nil, nil)
	form.SetTitle("Settings").SetBorder(true)

	layout := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(list, 7, 0, true).
		AddItem(save, 1, 0, false).
		AddItem(quit, 1, 0, false).
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
			status.SetText(fmt.Sprintf("status: ready redraw:%d focus:%d", redraws, focused))
			return nil
		}
		// Shortcuts only while the main page is in front. Without this the
		// global capture swallows every "s" and "q" typed into the form,
		// which is the oldest bug in TUI keybinding.
		if name, _ := pages.GetFrontPage(); name != "main" {
			return event
		}
		switch event.Rune() {
		case 'r':
			// The visible counter is an application-owned causal boundary: a
			// test observing it knows this exact input reached the event loop and
			// the requested redraw was painted, independently of PTY revisions.
			redraws++
			status.SetText(fmt.Sprintf("status: ready redraw:%d", redraws))
			app.Sync()
			return nil
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
