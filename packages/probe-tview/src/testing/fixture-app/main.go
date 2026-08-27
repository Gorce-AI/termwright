// A plain tview application with the doctrine's single public Attach line.
// It has no build tag, wrapper widget, constructor replacement, or probe-only
// lifecycle framework.
package main

import (
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
	"github.com/gorce-ai/termwright/clients/go/tviewprobe"
	"github.com/rivo/tview"
)

func main() {
	app := tview.NewApplication()
	if err := configureScreen(app); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}

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
			// The queued callback is one indivisible event-loop case. Both markers,
			// the state mutation and ForceDraw therefore happen before the loop can
			// accept an unrelated resize redraw. ForceDraw is tview's documented
			// synchronous draw API for code already executing in a queued update.
			go app.QueueUpdate(func() {
				completed := redraws + 1
				fmt.Fprintf(os.Stdout, "\x1b]8488;termwright-tview-fixture-sync:%d:begin\x07", completed)
				redraws = completed
				status.SetText(fmt.Sprintf("status: ready redraw:%d", completed))
				app.ForceDraw()
				fmt.Fprintf(os.Stdout, "\x1b]8488;termwright-tview-fixture-sync:%d:end\x07", completed)
			})
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

	app.SetRoot(pages, true).SetFocus(list)
	defer tviewprobe.Attach(app, pages)()
	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
