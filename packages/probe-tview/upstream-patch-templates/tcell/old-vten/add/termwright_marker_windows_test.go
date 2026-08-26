//go:build windows

package tcell

import "testing"

type termwrightMarkerCapability interface {
	TermwrightWriteMarker(string) error
}

func TestTermwrightConsoleScreenExposesReachableMarkerCapability(t *testing.T) {
	screen, err := NewConsoleScreen()
	if err != nil {
		t.Fatal(err)
	}
	marker, ok := screen.(termwrightMarkerCapability)
	if !ok {
		t.Fatal("NewConsoleScreen's returned static type cannot reach the marker capability")
	}
	if err := marker.TermwrightWriteMarker("marker"); err == nil {
		t.Fatal("a console without VT output accepted an OSC marker")
	}
}
