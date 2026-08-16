//go:build !windows

package protocol

import (
	"net"
	"time"
)

// dialEndpoint opens the driver's endpoint.
//
// Everywhere but Windows the driver listens on a unix socket inside a private
// temporary directory, so that is the only transport compiled in here. A
// Windows-style pipe path reaching this build simply fails to dial, which the
// caller already treats as "no side channel" rather than as an error worth
// taking the application down for.
func dialEndpoint(endpoint string, timeout time.Duration) (net.Conn, error) {
	return net.DialTimeout("unix", endpoint, timeout)
}
