package protocol

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Opt-in diagnostic log for the adapter side, written to a file.
//
// The driver has its own live log (TERMWRIGHT_DEBUG=1, stderr, see
// packages/driver/src/debug.ts). This is the other half: what the *adapter*
// inside the application decided, which is the half that goes missing when a
// conformance run reports skips and nobody can say why the app never attached.
//
// Never stderr. The application under test owns the terminal; a stray line on
// stderr lands in the middle of a render and corrupts the very screen the
// driver is asserting on. So this log goes to a file the caller names, or
// nowhere.
//
// Never fatal. Every failure here — an unwritable path, a full disk, a closed
// file — leaves the application running and the log silently off.

// Environment variables that turn the adapter-side log on.
const (
	// EnvDebugFile names the file to append to. Preferred, because it cannot
	// collide with the driver's stderr switch.
	EnvDebugFile = "TERMWRIGHT_DEBUG_FILE"
	// EnvDebug is the driver's switch, honoured here only when it carries a
	// path rather than one of the driver's own values.
	EnvDebug = "TERMWRIGHT_DEBUG"
)

// driverSwitches are the values of TERMWRIGHT_DEBUG that mean "driver-side
// logging". That variable reaches the child process too, and if `1` turned
// this log on it would have to invent a destination for it — so only a path
// enables the adapter's log.
var driverSwitches = map[string]bool{
	"": true, "0": true, "1": true, "true": true, "false": true,
	"on": true, "off": true, "api": true, "all": true,
}

const maxDebugMessage = 400

// DebugPath returns the file this process should log to, or "" to stay silent.
// The lookup function is the environment; pass os.Getenv outside tests.
func DebugPath(lookup func(string) string) string {
	if explicit := strings.TrimSpace(lookup(EnvDebugFile)); explicit != "" {
		return explicit
	}
	raw := strings.TrimSpace(lookup(EnvDebug))
	if raw == "" || driverSwitches[strings.ToLower(raw)] {
		return ""
	}
	return raw
}

// DebugLog appends diagnostic lines to one file. A nil *DebugLog is a working
// no-op, so call sites need no guard.
type DebugLog struct {
	mu      sync.Mutex
	file    *os.File
	label   string
	started time.Time
}

// OpenDebugLog appends to path, or returns nil when it cannot. Returning nil
// rather than an error is deliberate: a diagnostic that refuses to start must
// not stop the application, and no caller has anything to do with the failure.
func OpenDebugLog(path, adapter string) *DebugLog {
	if path == "" {
		return nil
	}
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return nil
	}
	log := &DebugLog{file: file, label: fmt.Sprintf("p%d", os.Getpid()), started: time.Now()}
	log.Line("diag", fmt.Sprintf("open adapter=%s pid=%d platform=%s/%s go=%s argv0=%s",
		adapter, os.Getpid(), runtime.GOOS, runtime.GOARCH, runtime.Version(), shortPath(argv0())))
	return log
}

// DebugFromEnv opens the log named by the process environment, or returns nil.
func DebugFromEnv(adapter string) *DebugLog {
	return OpenDebugLog(DebugPath(os.Getenv), adapter)
}

// Label is the bracketed identifier on every line.
func (l *DebugLog) Label() string {
	if l == nil {
		return ""
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	return l.label
}

// SetLabel adopts the driver's session id once the handshake supplies one,
// truncated to the eight characters the driver's own log uses.
func (l *DebugLog) SetLabel(label string) {
	if l == nil || label == "" {
		return
	}
	if len(label) > 8 {
		label = label[:8]
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	l.label = label
}

// Line writes one diagnostic line. Silently does nothing once the file is gone.
func (l *DebugLog) Line(category, message string) {
	if l == nil {
		return
	}
	switch category {
	case "diag", "sem", "io", "app":
	default:
		category = "diag"
	}
	if len(message) > maxDebugMessage {
		message = message[:maxDebugMessage] + "…"
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.file == nil {
		return
	}
	seconds := fmt.Sprintf("%7.3f", time.Since(l.started).Seconds())
	if _, err := fmt.Fprintf(l.file, "  tw:%-4s [%s] %ss %s\n", category, l.label, seconds, message); err != nil {
		// The log is over; the application is not.
		_ = l.file.Close()
		l.file = nil
	}
}

// Close closes the file. Safe to call more than once, and on nil.
func (l *DebugLog) Close() {
	if l == nil {
		return
	}
	l.mu.Lock()
	file := l.file
	l.file = nil
	l.mu.Unlock()
	if file != nil {
		_ = file.Close()
	}
}

// DescribeEndpoint is how an endpoint reads in the log: its transport and its
// path. The endpoint is not a secret — the token is, and the token never
// appears here — but it is long, so it is shortened from the left, keeping the
// tail that distinguishes one session's socket from another's.
func DescribeEndpoint(endpoint string) string {
	kind := "unix"
	if isPipePath(endpoint) {
		kind = "pipe"
	}
	return kind + ":" + shortPath(endpoint)
}

func shortPath(value string) string {
	const limit = 60
	if len(value) <= limit {
		return value
	}
	return "…" + value[len(value)-(limit-1):]
}

func argv0() string {
	if len(os.Args) == 0 {
		return ""
	}
	return filepath.Base(os.Args[0])
}

// errorLabel is a one-line description of a failure: concrete type, errno and
// message.
//
// The type is always printed, even when the message repeats it. The type alone
// is what usually settles a Windows question — a *fs.PathError on a pipe path
// means the driver was never listening, while a *net.OpError from the unix
// dialler means the wrong transport was chosen for the endpoint.
func errorLabel(err error) string {
	if err == nil {
		return "<nil>"
	}
	label := fmt.Sprintf("%T: %s", err, err.Error())
	var errno syscall.Errno
	if errors.As(err, &errno) {
		label += fmt.Sprintf(" [errno %d]", int(errno))
	}
	return label
}

// onOff renders a negotiated switch the way the driver's log does.
func onOff(enabled bool) string {
	if enabled {
		return "on"
	}
	return "off"
}

// joinCapabilities renders the announced capability set for one log line.
func joinCapabilities(capabilities []Capability) string {
	parts := make([]string, 0, len(capabilities))
	for _, capability := range capabilities {
		parts = append(parts, string(capability))
	}
	return strings.Join(parts, ",")
}
