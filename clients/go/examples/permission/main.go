// Command permission is a tview app wired for the termwright adapter
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
//   - one ERROR is logged to the driver and never to the screen
//
// Quitting is bound to Ctrl+C rather than "q", which the reason field would
// swallow once it holds the focus.
package main

import (
	"fmt"
	"log/slog"
	"os"
	"time"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/protocol"
	"github.com/gorce-ai/termwright/clients/go/termwright"
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

	// Returns (nil, nil) when no driver is attached; nothing is installed then.
	session, err := termwright.Attach(app, root, termwright.WithLogs())
	if err != nil {
		fmt.Fprintln(os.Stderr, "termwright:", err)
		os.Exit(1)
	}
	defer session.Close()

	// Diagnostics go to the driver, never to the screen: printing here would
	// corrupt the render. Without a driver this handler is not enabled and the
	// line goes nowhere, exactly as a file logger would behave with no file.
	slog.SetDefault(slog.New(protocol.NewSlogHandler(session.Client(), nil)))

	// The handshake runs alongside the first frames, so a record emitted right
	// now would predate the session and be dropped. A real application logs
	// throughout its life and simply loses whatever precedes the channel; this
	// fixture waits so the driver has something deterministic to assert on.
	go func() {
		client := session.Client()
		if client == nil {
			return
		}
		for attempt := 0; attempt < 100 && !client.Connected(); attempt++ {
			time.Sleep(20 * time.Millisecond)
		}
		slog.Error("permission dialog opened with no policy loaded",
			"policy_path", "/etc/app/policy.json", slog.Group("io", "errno", 2))
	}()

	if err := app.SetRoot(root, true).SetFocus(approve).Run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
