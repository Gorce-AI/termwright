// Command permission is an ordinary tview app used by the zero-config probe
// conformance suite.
//
// Run it directly to see the UI; run it under the driver to see the semantics.
// Either way the screen is identical — that is the point of the dormant rule.
//
// Contract the conformance suite drives it by:
//
//   - "Permission required" proves the first frame reached the terminal
//   - Tab moves focus, and the status line becomes "focus: reject"
//   - Ctrl+C quits with exit code 0 from any focus position
//
// Quitting is bound to Ctrl+C rather than "q", which the reason field would
// swallow once it holds the focus.
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

	prompt := tview.NewTextView().SetText("Permission required")
	status := tview.NewTextView().SetText("focus: approve")
	approve := tview.NewButton("Approve")
	reject := tview.NewButton("Reject")
	reason := tview.NewInputField().SetLabel("Reason ")

	root := tview.NewFlex().SetDirection(tview.FlexRow).
		AddItem(prompt, 1, 0, false).
		AddItem(approve, 1, 0, true).
		AddItem(reject, 1, 0, false).
		AddItem(reason, 1, 0, false).
		AddItem(status, 1, 0, false)

	focusOrder := []tview.Primitive{approve, reject, reason}
	names := []string{"approve", "reject", "reason"}
	current := 0

	app.SetInputCapture(func(event *tcell.EventKey) *tcell.EventKey {
		switch {
		case event.Key() == tcell.KeyTab:
			current = (current + 1) % len(focusOrder)
			app.SetFocus(focusOrder[current])
			status.SetText("focus: " + names[current])
			return nil
		case event.Rune() == 'q' && current != 2: // 'q' types normally in the field
			app.Stop()
			return nil
		}
		return event
	})

	app.SetRoot(root, true).SetFocus(approve)
	defer tviewprobe.Attach(app, root)()
	if err := app.Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
