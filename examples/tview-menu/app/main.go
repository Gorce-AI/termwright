// Command tview-menu is a small tview application: a menu on the left, and a
// settings form that appears when the menu asks for it.
//
// The application has the doctrine's single Attach opt-in. A Termwright-owned
// build adds compiler-checked probe units without editing tview; an ordinary
// `go run` has no endpoint and Attach is inert.
//
//	go run ./app        # just a menu
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

	// Mouse reporting is the application's decision. A driver that finds it
	// disabled refuses to click rather than sending bytes nothing will read.
	app.EnableMouse(true)

	app.SetRoot(pages, true).SetFocus(menu)
	defer tviewprobe.Attach(app, pages)()
	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
