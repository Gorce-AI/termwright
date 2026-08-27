// Package tviewprobe exposes the single application-side opt-in for tview.
package tviewprobe

import (
	"os"

	"github.com/gorce-ai/termwright/clients/go/probehost"
	"github.com/rivo/tview"
)

var noProbe = func() {}

// Attach installs semantic observation and returns an idempotent drain.
//
// Use it as one line immediately before Run:
//
//	defer tviewprobe.Attach(app, root)()
//
// Without a Termwright session this returns before consulting the injected
// registry: no client, goroutine, channel, socket, or framework hook exists.
func Attach(app *tview.Application, root tview.Primitive) func() {
	if os.Getenv("TERMWRIGHT_ENDPOINT") == "" || os.Getenv("TERMWRIGHT_TOKEN") == "" {
		return noProbe
	}
	cleanup, err := probehost.Attach("tview", app, root)
	if err != nil {
		panic(err)
	}
	return cleanup
}
