package tview

// Tests for the injected probe. They ship with the patch set and run inside
// the instrumented copy, which is the only place the probe's internals exist.
//
// The one that matters is the stalled driver: publication happens under the
// application's write lock, so a driver that stops reading must cost frames
// and never the application's ability to draw.

import (
	"errors"
	"net"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gdamore/tcell/v2"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// stalledDriver answers the handshake and then reads nothing until released.
type stalledDriver struct {
	listener net.Listener
	resume   chan struct{}
	conn     net.Conn
}

func startStalledDriver(t *testing.T, path string) *stalledDriver {
	t.Helper()
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	driver := &stalledDriver{listener: listener, resume: make(chan struct{})}

	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		driver.conn = conn

		buffer := make([]byte, 64*1024)
		if _, err := conn.Read(buffer); err != nil {
			return
		}
		ack, _ := protocol.EncodeFrame(map[string]any{
			"type": "hello-ack", "protocol": protocol.ProtocolID, "sessionId": "s-1",
			"limits": protocol.DefaultLimits, "subscribe": "diffs",
			"marker": map[string]any{"enabled": true},
		}, protocol.DefaultLimits.MaxFrameBytes)
		_, _ = conn.Write(ack)

		<-driver.resume
		for {
			if _, err := conn.Read(buffer); err != nil {
				return
			}
		}
	}()

	t.Cleanup(func() { _ = listener.Close() })
	return driver
}

// probeAgainst builds a probe wired to `endpoint`, without touching the
// package-level one that a real run installs.
func probeAgainst(t *testing.T, endpoint string) *termwrightProbeState {
	t.Helper()
	t.Setenv("TERMWRIGHT_ENDPOINT", endpoint)
	t.Setenv("TERMWRIGHT_TOKEN", "token")

	probe := newTermwrightProbe()
	if probe == nil {
		t.Fatal("the probe stayed dormant with the handshake variables set")
	}
	t.Cleanup(func() { _ = probe.client.Close() })

	deadline := time.Now().Add(2 * time.Second)
	for !probe.client.Connected() && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	if !probe.client.Connected() {
		t.Fatal("the handshake did not complete")
	}
	return probe
}

// sampleApplication builds a tree with enough in it to be worth publishing.
func sampleApplication(t *testing.T) (*Application, tcell.Screen, *List) {
	t.Helper()
	screen := tcell.NewSimulationScreen("UTF-8")
	if err := screen.Init(); err != nil {
		t.Fatal(err)
	}
	screen.SetSize(80, 24)
	t.Cleanup(screen.Fini)

	// Big enough that a handful of frames fills a socket buffer. A small tree
	// makes the stalled-driver test skip itself, which looks like a pass and
	// covers nothing.
	label := strings.Repeat("a reasonably long list item label ", 4)
	list := NewList().ShowSecondaryText(false)
	for index := 0; index < 400; index++ {
		list.AddItem(label+strconv.Itoa(index), "", 0, nil)
	}
	root := NewFlex().SetDirection(FlexRow).
		AddItem(NewTextView().SetText("header"), 1, 0, false).
		AddItem(list, 0, 1, true)

	app := NewApplication()
	app.root = root
	root.SetRect(0, 0, 80, 24)
	return app, screen, list
}

// churn rewrites every label, so the frame really differs from the last one.
//
// Without it the driver subscribes to diffs and an unchanged tree produces a
// delta of almost nothing — which never fills a socket buffer, so the stalled
// tests skip themselves and cover nothing while looking green.
func churn(list *List, round int) {
	suffix := strconv.Itoa(round)
	for index := 0; index < list.GetItemCount(); index++ {
		main, _ := list.GetItemText(index)
		list.SetItemText(index, main[:len(main)-len(suffixOf(main))]+suffix, "")
	}
}

// suffixOf returns the trailing digits of a label.
func suffixOf(label string) string {
	end := len(label)
	for end > 0 && label[end-1] >= '0' && label[end-1] <= '9' {
		end--
	}
	return label[end:]
}

func TestTheProbeIsDormantWithoutTheHandshakeVariables(t *testing.T) {
	t.Setenv("TERMWRIGHT_ENDPOINT", "")
	t.Setenv("TERMWRIGHT_TOKEN", "")

	if probe := newTermwrightProbe(); probe != nil {
		t.Fatal("an uninstrumented run built a probe")
	}
}

func TestAStalledDriverCostsFramesAndNotTheApplication(t *testing.T) {
	// The requirement in one test: no probe write may block the render loop
	// indefinitely, and the application must survive termwright disappearing.
	path := filepath.Join(shortDir(t), "s")
	driver := startStalledDriver(t, path)
	probe := probeAgainst(t, path)
	app, screen, list := sampleApplication(t)

	started := time.Now()
	var deltasBefore int64
	for attempt := 0; attempt < 400 && probe.timedOut.Load() == 0; attempt++ {
		churn(list, attempt)
		probe.afterFrame(app, screen)
		if probe.frames.Load() > 0 && deltasBefore == 0 {
			deltasBefore = probe.client.DeltasSent()
		}
	}
	elapsed := time.Since(started)

	if probe.timedOut.Load() == 0 {
		t.Skip("the socket buffer swallowed everything; nothing was stalled")
	}

	// Bounded: 400 frames against a driver that never reads must not take
	// anything like 400 × the deadline, because the session closes on the
	// first timeout and every later publish returns at once.
	if elapsed > 5*time.Second {
		t.Fatalf("publishing against a stalled driver took %s, which is not bounded", elapsed)
	}
	if probe.dropped.Load() == 0 {
		t.Fatal("frames were lost but nothing was counted")
	}
	// The application is still drawable: the hook returns, and it returns
	// without having held anything open.
	probe.afterFrame(app, screen)

	// And the obligation is outstanding, so the driver cannot be handed a
	// delta based on a revision it never received.
	if !probe.client.FullSnapshotRequired() {
		t.Fatal("frames were dropped without demanding a full snapshot next")
	}
	_ = driver
}

func TestAFailedPublishWritesNoMarker(t *testing.T) {
	// A marker names a revision. Writing one for a tree that never arrived
	// makes the driver wait for it and then blame the adapter's timing.
	path := filepath.Join(shortDir(t), "s")
	_ = startStalledDriver(t, path)
	probe := probeAgainst(t, path)
	app, screen, list := sampleApplication(t)

	read, write, err := os.Pipe()
	if err != nil {
		t.Fatal(err)
	}
	original := os.Stdout
	os.Stdout = write
	t.Cleanup(func() { os.Stdout = original })

	for attempt := 0; attempt < 400 && probe.timedOut.Load() == 0; attempt++ {
		churn(list, attempt)
		probe.afterFrame(app, screen)
	}
	_ = write.Close()

	buffer := make([]byte, 64*1024)
	n, _ := read.Read(buffer)
	written := string(buffer[:n])

	if probe.timedOut.Load() == 0 {
		t.Skip("the socket buffer swallowed everything; nothing was stalled")
	}
	// Whatever markers the first few successful frames wrote, the dropped
	// ones must not have added any: one marker per published revision.
	if markers := countMarkers(written); uint64(markers) != probe.frames.Load() {
		t.Fatalf("wrote %d markers for %d published frames", markers, probe.frames.Load())
	}
}

func TestTheProbeRecognisesARejectedSnapshotSeparately(t *testing.T) {
	// A snapshot refused by validation is not a driver that stopped reading,
	// and the two must not share a diagnosis.
	if errors.Is(protocol.ErrWriteTimeout, os.ErrDeadlineExceeded) {
		return
	}
	if protocol.ValidationCode(protocol.ErrWriteTimeout) != "" {
		t.Fatal("a write timeout was reported as a validation failure")
	}
}

func countMarkers(text string) int {
	count := 0
	for index := 0; index+1 < len(text); index++ {
		if text[index] == 0x1b && text[index+1] == 'P' {
			count++
		}
	}
	return count
}

// shortDir keeps a unix socket path under the platform limit, which the
// default temporary directory on macOS routinely exceeds.
func shortDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "tw")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}
