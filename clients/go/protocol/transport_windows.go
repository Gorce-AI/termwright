//go:build windows

package protocol

import (
	"net"
	"time"

	"github.com/Microsoft/go-winio"
)

// dialEndpoint opens the driver's endpoint.
//
// On Windows the driver listens on a named pipe (`\\.\pipe\termwright-<hex>`),
// which `net.Dial` cannot open — the unix-socket call that serves every other
// platform silently produced an adapter that ran but never published, because
// a failed handshake is deliberately not fatal. go-winio speaks the pipe.
//
// A unix path is still accepted here: it costs one branch, and it keeps the
// door open for a driver reached through WSL or a POSIX-emulating layer.
func dialEndpoint(endpoint string, timeout time.Duration) (net.Conn, error) {
	if !isPipePath(endpoint) {
		return net.DialTimeout("unix", endpoint, timeout)
	}
	return winio.DialPipe(endpoint, &timeout)
}
