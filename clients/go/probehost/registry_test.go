package probehost

import (
	"strings"
	"testing"
)

func TestAttachFailsClosedWhenInjectionIsMissing(t *testing.T) {
	_, err := Attach("missing-test-framework", struct{}{}, struct{}{})
	if err == nil || !strings.Contains(err.Error(), "compiler injection was not applied") {
		t.Fatalf("missing injection did not fail closed: %v", err)
	}
}
