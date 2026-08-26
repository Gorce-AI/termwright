//go:build windows

package main

import (
	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"
)

func configureScreen(app *tview.Application) error {
	screen, err := tcell.NewConsoleScreen()
	if err != nil {
		return err
	}
	app.SetScreen(screen)
	return nil
}
