package tviewprobe

import (
	"testing"

	"github.com/rivo/tview"
)

func TestAttachIsDormantBeforeRegistryLookup(t *testing.T) {
	t.Setenv("TERMWRIGHT_ENDPOINT", "")
	t.Setenv("TERMWRIGHT_TOKEN", "")
	cleanup := Attach(tview.NewApplication(), tview.NewBox())
	cleanup()
}

func TestDormantAttachAllocatesNoRuntimeProbeState(t *testing.T) {
	t.Setenv("TERMWRIGHT_ENDPOINT", "")
	t.Setenv("TERMWRIGHT_TOKEN", "")
	application := tview.NewApplication()
	root := tview.NewBox()
	if allocations := testing.AllocsPerRun(100, func() {
		Attach(application, root)()
	}); allocations != 0 {
		t.Fatalf("dormant Attach allocated %v objects per call, want zero", allocations)
	}
}
