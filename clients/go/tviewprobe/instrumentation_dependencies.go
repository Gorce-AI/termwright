//go:build termwright_instrumented

package tviewprobe

// These compile-time-only references make the injected unit's dependencies
// visible to `go mod tidy` without initializing protocol/evidence packages in
// an ordinary production import of tviewprobe. The build launcher injects the
// real unit into package tview; applications never need to enable this tag.
import (
	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/evidence"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

type termwrightBuildDependencies struct {
	annotation annotate.Semantics
	evidence   evidence.Context
	capability protocol.Capability
}
