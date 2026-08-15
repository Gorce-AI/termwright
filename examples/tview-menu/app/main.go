// Command tview-menu is a small tview application: a menu on the left, and a
// settings form that appears when the menu asks for it.
//
// The instrumentation is one call. Without TERMWRIGHT_ENDPOINT and
// TERMWRIGHT_TOKEN in the environment, Attach returns (nil, nil): no socket is
// opened, no marker is written, and the screen is byte for byte what it would
// have been. That is why shipping it costs nothing.
//
//	go run ./app        # just a menu
package main

import (
	"fmt"
	"os"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/termwright"
)

func main() {
	app := tview.NewApplication()

	status := tview.NewTextView().SetText("status: ready")
	status.SetTitle("Status")

	name := tview.NewInputField().SetLabel("Name")
	form := tview.NewForm().AddFormItem(name)
	form.SetTitle("Settings").SetBorder(true)

	menu := tview.NewList().ShowSecondaryText(false)
	menu.SetTitle("Menu").SetBorder(true)

	pages := tview.NewPages()

	form.AddButton("Save", func() {
		status.SetText("status: saved " + name.GetText())
		pages.HidePage("settings")
		app.SetFocus(menu)
	})
	form.AddButton("Cancel", func() {
		status.SetText("status: cancelled")
		pages.HidePage("settings")
		app.SetFocus(menu)
	})

	menu.AddItem("New file", "", 0, func() { status.SetText("status: new file") })
	menu.AddItem("Settings", "", 0, func() {
		pages.ShowPage("settings")
		app.SetFocus(name)
	})
	menu.AddItem("Quit", "", 0, func() { app.Stop() })

	layout := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(menu, 7, 0, true).
		AddItem(status, 1, 0, false)

	pages.AddPage("main", layout, true, true)
	pages.AddPage("settings", form, true, false)

	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		if event.Key() == tcell.KeyEscape {
			pages.HidePage("settings")
			app.SetFocus(menu)
			return nil
		}
		return event
	})

	// Returns (nil, nil) when no driver is attached; nothing is installed then.
	session, err := termwright.Attach(app, pages)
	if err != nil {
		fmt.Fprintln(os.Stderr, "termwright:", err)
		os.Exit(1)
	}
	defer session.Close()

	// Mouse reporting is the application's decision. A driver that finds it
	// disabled refuses to click rather than sending bytes nothing will read.
	app.EnableMouse(true)

	if err := app.SetRoot(pages, true).SetFocus(menu).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
