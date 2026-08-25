package tview

// Tests for the injected probe. They ship with the patch set and run inside
// the instrumented copy, which is the only place the probe's internals exist.
//
// The one that matters is the stalled driver: publication happens under the
// application's write lock, so a driver that stops reading must cost frames
// and never the application's ability to draw.

import (
	"bytes"
	"encoding/binary"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/gdamore/tcell/v2"

	"github.com/gorce-ai/termwright/clients/go/annotate"
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
		// Keep this test independent of the host kernel's default socket
		// capacity. Linux CI otherwise accepted every test frame, so the test
		// reported a skip without exercising the write deadline at all.
		if unix, ok := conn.(*net.UnixConn); ok {
			if err := unix.SetReadBuffer(4 * 1024); err != nil {
				return
			}
		}

		// Read exactly the hello frame. A broad Read may also consume the first
		// snapshot when the client writes it immediately after the handshake.
		// That accidentally frees the receive buffer and makes this test depend
		// on scheduler timing instead of exercising the stalled-writer path.
		header := make([]byte, protocol.FrameHeaderBytes)
		if _, err := io.ReadFull(conn, header); err != nil {
			return
		}
		bodyLength := int(binary.BigEndian.Uint32(header))
		if bodyLength <= 0 || bodyLength > protocol.DefaultLimits.MaxFrameBytes {
			return
		}
		if _, err := io.ReadFull(conn, make([]byte, bodyLength)); err != nil {
			return
		}
		ack, _ := protocol.EncodeFrame(map[string]any{
			"type": "hello-ack", "protocol": protocol.ProtocolID, "sessionId": "s-1",
			"limits": protocol.DefaultLimits, "subscribe": "snapshots",
			"marker": map[string]any{"enabled": true},
		}, protocol.DefaultLimits.MaxFrameBytes)
		_, _ = conn.Write(ack)

		<-driver.resume
		buffer := make([]byte, 64*1024)
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
	var startErr error
	probe.start.Do(func() { startErr = probe.client.Start(protocol.DialTimeout) })
	if startErr != nil {
		t.Fatal(startErr)
	}
	probe.ready.Store(true)

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
type markerTTY struct {
	bytes.Buffer
	sync.Mutex
}

func (t *markerTTY) Write(data []byte) (int, error) {
	t.Lock()
	defer t.Unlock()
	return t.Buffer.Write(data)
}
func (t *markerTTY) Read([]byte) (int, error)              { return 0, io.EOF }
func (t *markerTTY) Close() error                          { return nil }
func (t *markerTTY) Start() error                          { return nil }
func (t *markerTTY) Stop() error                           { return nil }
func (t *markerTTY) Drain() error                          { return nil }
func (t *markerTTY) NotifyResize(func())                   {}
func (t *markerTTY) WindowSize() (tcell.WindowSize, error) { return tcell.WindowSize{}, nil }
func (t *markerTTY) String() string {
	t.Lock()
	defer t.Unlock()
	return t.Buffer.String()
}

type markerScreen struct {
	tcell.Screen
	tty *markerTTY
}

func (s *markerScreen) Tty() (tcell.Tty, bool) { return s.tty, true }

func sampleApplication(t *testing.T) (*Application, *markerScreen, *List) {
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
	return app, &markerScreen{Screen: screen, tty: &markerTTY{}}, list
}

// churn rewrites every label so each attempted publication represents a new
// application frame rather than repeatedly publishing one fixture state.
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

func TestTermwrightValuePreservesEmptyAndWithholdsMaskedInput(t *testing.T) {
	public := termwrightValue(NewInputField().SetText(""))
	if public == nil || public.Status != "known" || public.Value == nil || *public.Value != "" || public.Sensitivity != "public" {
		t.Fatalf("empty public value lost its observation semantics: %#v", public)
	}
	masked := termwrightValue(NewInputField().SetText("sentinel-secret").SetMaskCharacter('*'))
	if masked == nil || masked.Status != "withheld" || masked.Value != nil || masked.Sensitivity != "sensitive" {
		t.Fatalf("masked input leaked or lost withholding evidence: %#v", masked)
	}
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
	for attempt := 0; attempt < 400 && probe.timedOut.Load() == 0; attempt++ {
		churn(list, attempt)
		probe.afterFrame(app, screen)
	}
	elapsed := time.Since(started)

	if probe.timedOut.Load() == 0 {
		t.Fatal("the bounded socket accepted every frame; the stalled-driver path was not exercised")
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

	_ = driver
}

func TestAFailedPublishWritesNoMarker(t *testing.T) {
	// A marker names a revision. Writing one for a tree that never arrived
	// makes the driver wait for it and then blame the adapter's timing.
	path := filepath.Join(shortDir(t), "s")
	_ = startStalledDriver(t, path)
	probe := probeAgainst(t, path)
	app, screen, list := sampleApplication(t)

	for attempt := 0; attempt < 400 && probe.timedOut.Load() == 0; attempt++ {
		churn(list, attempt)
		probe.afterFrame(app, screen)
	}
	written := screen.tty.String()

	if probe.timedOut.Load() == 0 {
		t.Fatal("the bounded socket accepted every frame; the failed-publish path was not exercised")
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

func TestMarkerCounterRecognisesOnlyTermwrightOSCMarkers(t *testing.T) {
	text := "plain\x1b]0;window title\x07" +
		"\x1b]8487;twm;1;first\x07between" +
		"\x1b]8487;twm;2;second\x07"
	if markers := countMarkers(text); markers != 2 {
		t.Fatalf("counted %d Termwright markers, want 2", markers)
	}
}

func TestAnnotationsResolveKeysAfterTheWholeRetainedTreeIsKnown(t *testing.T) {
	annotate.Reset()
	t.Cleanup(annotate.Reset)

	control := NewButton("Save")
	label := NewTextView().SetText("Release name")
	help := NewTextView().SetText("Use a unique name")
	annotate.Tag(control, annotate.Semantics{
		Name:        "Save release",
		Actions:     []protocol.Action{protocol.ActionActivate, protocol.ActionActivate, protocol.Action("invalid")},
		LabelledBy:  []annotate.SemanticKey{"release-label"},
		DescribedBy: []annotate.SemanticKey{"release-help", "missing"},
	})
	annotate.Tag(label, annotate.Semantics{Key: "release-label"})
	annotate.Tag(help, annotate.Semantics{Key: "release-help"})

	// The control deliberately comes first. A one-pass resolver would miss
	// both targets because neither has been walked yet.
	root := NewFlex().SetDirection(FlexRow).
		AddItem(control, 1, 0, false).
		AddItem(label, 1, 0, false).
		AddItem(help, 1, 0, false)
	app := NewApplication()
	app.root = root
	root.SetRect(0, 0, 40, 3)

	probe := &termwrightProbeState{ids: make(map[Primitive]string)}
	snapshot, duplicateKey := probe.snapshot(app, 40, 3)
	if duplicateKey != "" {
		t.Fatalf("unexpected duplicate key: %q", duplicateKey)
	}
	controlID := probe.identity(control)
	labelID := probe.identity(label)
	helpID := probe.identity(help)

	var node *protocol.Node
	for index := range snapshot.Nodes {
		if snapshot.Nodes[index].ID == controlID {
			node = &snapshot.Nodes[index]
			break
		}
	}
	if node == nil {
		t.Fatal("annotated control was not published")
	}
	if strings.Join(node.LabelledBy, ",") != labelID || strings.Join(node.DescribedBy, ",") != helpID {
		t.Fatalf("relations were not resolved by key: labelledBy=%v describedBy=%v", node.LabelledBy, node.DescribedBy)
	}
	if len(node.Actions) != 1 || node.Actions[0] != protocol.ActionActivate {
		t.Fatalf("actions were not closed and deduplicated: %v", node.Actions)
	}
	if len(node.InputRecipes) != 1 || node.InputRecipes[0].Action != "activate" ||
		!node.InputRecipes[0].RequiresFocus || len(node.InputRecipes[0].Steps) != 1 ||
		node.InputRecipes[0].Steps[0].Kind != "press" || node.InputRecipes[0].Steps[0].Key != "Enter" {
		t.Fatalf("button activation recipe did not match the exact InputHandler: %+v", node.InputRecipes)
	}
	if node.PX["inputRecipes"] != protocol.ProvenanceFramework {
		t.Fatalf("input recipe provenance = %q, want framework", node.PX["inputRecipes"])
	}
	if node.P != protocol.ProvenanceFramework {
		t.Fatalf("node-wide provenance = %q, want framework", node.P)
	}
	for _, field := range []string{"name", "actions", "labelledBy", "describedBy"} {
		if node.PX[field] != protocol.ProvenanceAnnotation {
			t.Fatalf("%s provenance = %q, want annotation (all px=%v)", field, node.PX[field], node.PX)
		}
	}
	if node.Geometry.Displayed.Status != "known" || node.Role != protocol.RoleButton || node.PX["role"] != protocol.ProvenanceRecognizer {
		t.Fatalf("annotation replaced framework/recognizer facts: %+v", node)
	}
}

func TestDuplicateSemanticKeysFailClosed(t *testing.T) {
	annotate.Reset()
	t.Cleanup(annotate.Reset)

	control := NewButton("Save")
	first := NewTextView().SetText("First")
	second := NewTextView().SetText("Second")
	annotate.Tag(control, annotate.Semantics{LabelledBy: []annotate.SemanticKey{"duplicate"}})
	annotate.Tag(first, annotate.Semantics{Key: "duplicate"})
	annotate.Tag(second, annotate.Semantics{Key: "duplicate"})

	root := NewFlex().
		AddItem(control, 1, 0, false).
		AddItem(first, 1, 0, false).
		AddItem(second, 1, 0, false)
	app := NewApplication()
	app.root = root
	root.SetRect(0, 0, 30, 1)
	probe := &termwrightProbeState{ids: make(map[Primitive]string)}
	snapshot, duplicateKey := probe.snapshot(app, 30, 1)
	if duplicateKey != "duplicate" {
		t.Fatalf("duplicate semantic key was not rejected: %q", duplicateKey)
	}
	if len(snapshot.Nodes) == 0 {
		t.Fatal("fixture did not exercise the semantic walk")
	}
}

func TestSnapshotReportsOnlyObservableTviewGeometry(t *testing.T) {
	root := NewFlex()
	button := NewButton("Approve")
	hidden := NewButton("Hidden")
	root.AddItem(button, 1, 0, false).AddItem(hidden, 1, 0, false)
	root.SetRect(75, 23, 10, 2)
	button.SetRect(75, 23, 10, 1)
	hidden.SetRect(75, 24, 10, 1)

	app := NewApplication()
	app.root = root
	probe := &termwrightProbeState{ids: make(map[Primitive]string)}
	snapshot, duplicateKey := probe.snapshot(app, 80, 24)
	if duplicateKey != "" {
		t.Fatalf("unexpected duplicate key: %q", duplicateKey)
	}

	if snapshot.V != 2 || snapshot.CoordinateSpace.Status != "known" || snapshot.HitGrid.Status != "unsupported" {
		t.Fatalf("snapshot does not carry required v2 observations: %+v", snapshot)
	}
	for index, node := range snapshot.Nodes {
		if node.Geometry.Displayed.Status == "" {
			t.Fatalf("node %d has no geometry observation: %+v", index, node)
		}
	}
	geometry := snapshot.Nodes[1].Geometry
	if geometry.Displayed.Status != "known" || geometry.Displayed.Value == nil || !*geometry.Displayed.Value {
		t.Fatalf("displayed observation = %+v", geometry.Displayed)
	}
	if geometry.IntendedRect.Value == nil || *geometry.IntendedRect.Value != (protocol.Rect{Row: 23, Column: 75, Width: 10, Height: 1}) {
		t.Fatalf("intended rect = %+v", geometry.IntendedRect)
	}
	if geometry.VisibleRect.Status != "unsupported" || geometry.VisibleRect.Capability != string(protocol.CapClippedGeometry) {
		t.Fatalf("visible rect = %+v", geometry.VisibleRect)
	}
}

func countMarkers(text string) int {
	count := 0
	const prefix = "\x1b]8487;twm;"
	for index := 0; index+len(prefix) <= len(text); index++ {
		if text[index:index+len(prefix)] == prefix {
			count++
			index += len(prefix) - 1
		}
	}
	return count
}

// shortDir keeps a unix socket path under the platform limit, which the
// default temporary directory on macOS routinely exceeds.
func shortDir(t *testing.T) string {
	t.Helper()
	base := "/tmp"
	if runtime.GOOS == "windows" {
		base = ""
	}
	dir, err := os.MkdirTemp(base, "tw")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}
