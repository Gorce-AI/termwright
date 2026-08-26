//go:build !windows

package main

import "github.com/rivo/tview"

func configureScreen(_ *tview.Application) error {
	return nil
}
