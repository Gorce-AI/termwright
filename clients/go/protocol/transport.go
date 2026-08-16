package protocol

import "strings"

// isPipePath reports whether the endpoint names a Windows pipe. Both prefixes
// are accepted because either can appear depending on how the path was built.
//
// This lives outside the per-platform transport files on purpose: the
// diagnostic log names the transport it is about to use on every platform, and
// a POSIX run that was handed a pipe path is exactly the case worth reading in
// the log afterwards.
func isPipePath(endpoint string) bool {
	return strings.HasPrefix(endpoint, `\\.\pipe\`) || strings.HasPrefix(endpoint, `\\?\pipe\`)
}
