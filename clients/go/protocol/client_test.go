package protocol

import (
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

const (
	testToken   = "test-token"
	testSession = "s-42"
)

// payloadOf returns what a VT parser would hand an OSC handler. Only the
// introducer is stripped: VerifyMarkerPayload tolerates the trailing
// terminator, and leaving it on exercises that tolerance.
func payloadOf(t *testing.T, marker string) string {
	t.Helper()
	introducer := fmt.Sprintf("\x1b]%d;", MarkerOSCCode)
	if !strings.HasPrefix(marker, introducer) {
		t.Fatalf("marker %q does not open with %q", marker, introducer)
	}
	return strings.TrimPrefix(marker, introducer)
}

// fakeDriver is the driver end of the channel: it completes the handshake and
// records what the adapter sends.
type fakeDriver struct {
	listener net.Listener
	mu       sync.Mutex
	frames   []map[string]any
	conn     net.Conn
	arrived  chan struct{}
	logs     *LogBudget
	// subscribe is what the handshake asks the adapter to push; empty means
	// the driver's default of whole snapshots.
	subscribe string
}

func startFakeDriver(t *testing.T) *fakeDriver {
	return startFakeDriverWithLogs(t, nil)
}

// startFakeDriverWithSubscribe asks the adapter for diffs rather than whole
// trees, which is the only mode in which the full-snapshot obligation means
// anything.
func startFakeDriverWithSubscribe(t *testing.T, subscribe string) *fakeDriver {
	driver := startFakeDriverWithLogs(t, nil)
	driver.subscribe = subscribe
	return driver
}

// startFakeDriverWithLogs grants a log budget in the handshake. A nil budget
// means the ack carries no `logs` field at all, which is what tells an adapter
// that logs are disabled.
func startFakeDriverWithLogs(t *testing.T, budget *LogBudget) *fakeDriver {
	t.Helper()
	path := filepath.Join(shortTempDir(t), "s")
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatalf("listening on %s: %v", path, err)
	}
	driver := &fakeDriver{listener: listener, arrived: make(chan struct{}, 256), logs: budget}
	go driver.serve(t)
	t.Cleanup(func() { _ = listener.Close() })
	return driver
}

// shortTempDir keeps the socket path inside the 104-byte sockaddr_un limit,
// which t.TempDir() blows through on macOS by embedding the test name.
func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("/tmp", "tw")
	if err != nil {
		t.Fatalf("creating a socket directory: %v", err)
	}
	t.Cleanup(func() { _ = os.RemoveAll(dir) })
	return dir
}

func (d *fakeDriver) endpoint() string { return d.listener.Addr().String() }

func (d *fakeDriver) serve(t *testing.T) {
	conn, err := d.listener.Accept()
	if err != nil {
		return
	}
	d.mu.Lock()
	d.conn = conn
	d.mu.Unlock()

	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	buffer := make([]byte, 64*1024)
	for {
		n, err := conn.Read(buffer)
		if n > 0 {
			frames, decodeErr := decoder.Push(buffer[:n])
			if decodeErr != nil {
				return
			}
			for _, frame := range frames {
				message, _ := frame.Value.(map[string]any)
				if message["type"] == "hello" {
					d.record(message)
					subscribe := d.subscribe
					if subscribe == "" {
						subscribe = "snapshots"
					}
					d.send(HelloAck{
						Type:      "hello-ack",
						Protocol:  ProtocolID,
						SessionID: testSession,
						Limits:    DefaultLimits,
						Subscribe: subscribe,
						Marker:    MarkerConfig{Enabled: true},
						Logs:      d.logs,
					})
					continue
				}
				d.record(message)
			}
		}
		if err != nil {
			return
		}
	}
}

func (d *fakeDriver) record(message map[string]any) {
	d.mu.Lock()
	d.frames = append(d.frames, message)
	d.mu.Unlock()
	select {
	case d.arrived <- struct{}{}:
	default:
	}
}

func (d *fakeDriver) send(message any) {
	d.mu.Lock()
	conn := d.conn
	d.mu.Unlock()
	if conn == nil {
		return
	}
	frame, err := EncodeFrame(message, DefaultLimits.MaxFrameBytes)
	if err != nil {
		return
	}
	_, _ = conn.Write(frame)
}

// waitFor blocks until at least count frames (hello included) have arrived.
func (d *fakeDriver) waitFor(t *testing.T, count int) []map[string]any {
	t.Helper()
	deadline := time.After(2 * time.Second)
	for {
		d.mu.Lock()
		seen := len(d.frames)
		snapshot := append([]map[string]any(nil), d.frames...)
		d.mu.Unlock()
		if seen >= count {
			return snapshot
		}
		select {
		case <-d.arrived:
		case <-deadline:
			t.Fatalf("only %d frames arrived, want %d", seen, count)
		}
	}
}

func sampleSnapshot() *Snapshot {
	snapshot := NewSnapshot("ignored", 999, 80, 24)
	snapshot.RootIDs = []string{"root"}
	snapshot.Nodes = []Node{
		{ID: "root", Role: RoleDialog, Name: "Permission", Bounds: &Rect{Row: 0, Column: 0, Width: 40, Height: 2}},
		{ID: "ok", ParentID: "root", Role: RoleButton, Name: "Approve", Bounds: &Rect{Row: 1, Column: 2, Width: 9, Height: 1}},
	}
	return snapshot
}

// -- dormant rule ----------------------------------------------------------

func TestNoClientWithoutACompleteEnvironment(t *testing.T) {
	cases := []struct{ endpoint, token, protocol string }{
		{"", "", ""},
		{"/tmp/nope.sock", "", ""},
		{"", testToken, ""},
		{"/tmp/nope.sock", testToken, "termwright/9"},
	}
	for _, testCase := range cases {
		if client := fromEnvValues(testCase.endpoint, testCase.token, testCase.protocol, Options{}); client != nil {
			t.Errorf("endpoint=%q token=%q protocol=%q produced a client", testCase.endpoint, testCase.token, testCase.protocol)
		}
	}
	if client := fromEnvValues("/tmp/tw.sock", testToken, ProtocolID, Options{}); client == nil {
		t.Error("a fully instrumented environment produced no client")
	}
	qualified := fromEnvValues("/tmp/tw.sock", testToken, ProtocolV2ID, Options{})
	if qualified == nil || !qualified.QualifiedObservations() || !containsCapability(qualified.options.Capabilities, CapQualifiedObservations) {
		t.Errorf("termwright/2 did not select qualified production: %+v", qualified)
	}

	// A Windows pipe path is a real endpoint, not a reason to stay dormant:
	// the driver hands one out on win32, and which transport can open it is
	// the dialer's business, not the constructor's.
	if client := fromEnvValues(`\\.\pipe\termwright-abc`, testToken, "", Options{}); client == nil {
		t.Error("a named-pipe endpoint produced no client")
	}
}

func TestAnUnreachableEndpointFailsSoft(t *testing.T) {
	client := New(filepath.Join(shortTempDir(t), "missing"), testToken, Options{AdapterName: "go-test", AdapterVersion: "0.1.0"})
	if err := client.Start(500 * time.Millisecond); err == nil {
		t.Fatal("dialling a missing socket succeeded")
	}
	marker, err := client.Publish(sampleSnapshot())
	if marker != "" || err != nil {
		t.Errorf("publishing without a session returned %q, %v", marker, err)
	}
}

// -- handshake and publishing ---------------------------------------------

func TestHandshakeAndPublish(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), testToken, Options{
		AdapterName:    "go-test",
		AdapterVersion: "0.1.0",
		Probe:          testProbeInfo(),
	})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	defer client.Close()

	if client.SessionID() != testSession {
		t.Errorf("session id %q, want %q", client.SessionID(), testSession)
	}

	marker, err := client.Publish(sampleSnapshot())
	if err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	frames := driver.waitFor(t, 3) // hello, snapshot, revision-commit

	hello := frames[0]
	if hello["token"] != testToken {
		t.Errorf("hello carried token %v", hello["token"])
	}
	probe, ok := hello["probe"].(map[string]any)
	if !ok {
		t.Fatalf("raw hello carried no probe block: %#v", hello)
	}
	if probe["framework"] != "tview" || probe["frameworkVersion"] != "v0.42.0" {
		t.Errorf("raw hello carried the wrong framework identity: %#v", probe)
	}
	if probe["identityKind"] != "stable" {
		t.Errorf("raw hello carried identityKind %v", probe["identityKind"])
	}
	probeCapabilities, ok := probe["capabilities"].([]any)
	if !ok || len(probeCapabilities) != 2 || probeCapabilities[0] != "stable-identity" || probeCapabilities[1] != "annotations" {
		t.Errorf("raw hello carried dishonest probe capabilities: %#v", probe["capabilities"])
	}
	snapshotFrame := frames[1]
	if snapshotFrame["type"] != "snapshot" {
		t.Fatalf("second frame is %v, want a snapshot", snapshotFrame["type"])
	}
	body := snapshotFrame["snapshot"].(map[string]any)
	if body["sessionId"] != testSession || body["revision"].(float64) != 1 {
		t.Errorf("snapshot bound to %v/%v", body["sessionId"], body["revision"])
	}
	if frames[2]["type"] != "revision-commit" || frames[2]["revision"].(float64) != 1 {
		t.Errorf("third frame is %v", frames[2])
	}

	verified, ok := VerifyMarkerPayload(payloadOf(t, marker), testToken, testSession)
	if !ok || verified.Revision != 1 {
		t.Errorf("marker %q did not verify against the session", marker)
	}
}

func TestDebugPerformanceMetricsDescribeOnlyObservedFacts(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), testToken, Options{
		AdapterName:    "go-test",
		AdapterVersion: "0.1.0",
		// A non-nil debug log enables metrics; this nil-file instance keeps the
		// test from writing outside its fake semantic connection.
		Debug: &DebugLog{},
	})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	defer client.Close()

	snapshot := sampleSnapshot()
	snapshot.Nodes = append(snapshot.Nodes, Node{
		ID: "custom", ParentID: "root", Role: RoleGeneric, Name: "",
		FrameworkType: "ApplicationWidget",
	})
	if _, err := client.Publish(snapshot); err != nil {
		t.Fatalf("publish failed: %v", err)
	}
	driver.waitFor(t, 3)

	metrics := client.PerformanceMetrics()
	if !metrics.Enabled || metrics.FullSnapshots != 1 || metrics.Deltas != 0 {
		t.Fatalf("wrong publication counters: %+v", metrics)
	}
	if metrics.SemanticBytes <= FrameHeaderBytes || metrics.SemanticNodes != 3 || metrics.UnknownFrameworkNodes != 1 {
		t.Fatalf("wrong semantic totals: %+v", metrics)
	}
	if metrics.AverageBytesPerFrame == nil || *metrics.AverageBytesPerFrame <= FrameHeaderBytes {
		t.Fatalf("missing byte average: %+v", metrics)
	}
	if metrics.AverageSerializationPerFrame == nil || *metrics.AverageSerializationPerFrame < 0 {
		t.Fatalf("missing serialization average: %+v", metrics)
	}
	if metrics.ProbeEventsPerFrame != nil || metrics.RenderCorrelationRate != nil || metrics.ParentNormalizationPerFrame != nil {
		t.Fatalf("the client invented unavailable measurements: %+v", metrics)
	}
}

func TestPerformanceMetricsStayDormantWithoutDebug(t *testing.T) {
	client := New("unused", testToken, Options{})
	metrics := client.PerformanceMetrics()
	if metrics.Enabled || metrics.AverageBytesPerFrame != nil || metrics.AverageSerializationPerFrame != nil {
		t.Fatalf("dormant metrics reported observations: %+v", metrics)
	}
}

func TestRevisionsIncreaseByOnePerPublish(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), testToken, Options{AdapterName: "go-test", AdapterVersion: "0.1.0"})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	defer client.Close()

	for expected := int64(1); expected <= 3; expected++ {
		marker, err := client.Publish(sampleSnapshot())
		if err != nil {
			t.Fatalf("publish %d failed: %v", expected, err)
		}
		verified, ok := VerifyMarkerPayload(payloadOf(t, marker), testToken, testSession)
		if !ok || verified.Revision != expected {
			t.Fatalf("marker for publish %d verified as %+v (ok=%v)", expected, verified, ok)
		}
	}

	frames := driver.waitFor(t, 7)
	var commits []float64
	for _, frame := range frames {
		if frame["type"] == "revision-commit" {
			commits = append(commits, frame["revision"].(float64))
		}
	}
	if len(commits) != 3 || commits[0] != 1 || commits[2] != 3 {
		t.Errorf("commits %v", commits)
	}
}

func TestGetTreeIsAnsweredFromRetainedSnapshots(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), testToken, Options{AdapterName: "go-test", AdapterVersion: "0.1.0"})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	defer client.Close()

	if _, err := client.Publish(sampleSnapshot()); err != nil {
		t.Fatal(err)
	}
	driver.waitFor(t, 3)

	revision := int64(1)
	driver.send(GetTree{Type: "get-tree", RequestID: 7, Revision: &revision})
	frames := driver.waitFor(t, 4)
	answer := frames[3]
	if answer["type"] != "get-tree-result" || answer["requestId"].(float64) != 7 {
		t.Fatalf("unexpected answer %v", answer)
	}
	if _, ok := answer["snapshot"]; !ok {
		t.Errorf("a retained revision was answered with %v", answer)
	}

	missing := int64(99)
	driver.send(GetTree{Type: "get-tree", RequestID: 8, Revision: &missing})
	frames = driver.waitFor(t, 5)
	if _, ok := frames[4]["error"]; !ok {
		t.Errorf("an unretained revision was answered with %v", frames[4])
	}
}

func TestPublishRefusesAnInvalidSnapshot(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), testToken, Options{AdapterName: "go-test", AdapterVersion: "0.1.0"})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake failed: %v", err)
	}
	defer client.Close()

	broken := NewSnapshot("ignored", 1, 80, 24)
	broken.RootIDs = []string{"root"}
	broken.Nodes = []Node{{ID: "root", Role: Role("slider"), Name: "nope"}}

	if _, err := client.Publish(broken); ValidationCode(err) != "unknown-role" {
		t.Fatalf("invalid snapshot published: %v", err)
	}
	// The rejected publish must not consume a revision.
	if client.Revision() != 0 {
		t.Errorf("revision advanced to %d despite the failure", client.Revision())
	}
}

func TestSnapshotMessageMarshalsAsAnEnvelope(t *testing.T) {
	body, err := marshalCanonical(SnapshotMessage{Type: "snapshot", Snapshot: sampleSnapshot()})
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(body, &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["type"] != "snapshot" {
		t.Errorf("envelope type is %v", parsed["type"])
	}
	if _, ok := parsed["snapshot"].(map[string]any); !ok {
		t.Error("envelope carries no snapshot object")
	}
}

// -- a driver that stops reading -------------------------------------------

// paddedSnapshot is a valid tree big enough that a few of them overflow a
// socket buffer, which is what makes a stalled reader observable.
//
// Node ids do NOT vary with the seed: only one name does. A tree whose every
// node is new is legitimately published whole, so a fixture that changed all
// the ids would produce snapshots throughout and quietly prove the opposite of
// what the obligation test claims.
func paddedSnapshot(seed int) *Snapshot {
	snapshot := NewSnapshot("ignored", 999, 80, 24)
	snapshot.RootIDs = []string{"root"}
	snapshot.Nodes = []Node{{ID: "root", Role: RoleDialog, Name: "Permission"}}
	padding := strings.Repeat("x", 4000)
	for index := 0; index < 60; index++ {
		name := padding
		if index == 0 {
			name = fmt.Sprintf("%s-%d", padding, seed)
		}
		snapshot.Nodes = append(snapshot.Nodes, Node{
			ID:       fmt.Sprintf("n%d", index),
			ParentID: "root",
			Role:     RoleText,
			Name:     name,
		})
	}
	return snapshot
}

// stalledDriver accepts a connection, completes the handshake, and then stops
// reading. The kernel's socket buffer absorbs a few frames; after that a write
// blocks, which is exactly the state a probe publishing from a render loop must
// survive.
type stalledDriver struct {
	listener net.Listener
	conn     net.Conn
	resume   chan struct{}
	read     chan []byte
}

func startStalledDriver(t *testing.T, path string) *stalledDriver {
	t.Helper()
	listener, err := net.Listen("unix", path)
	if err != nil {
		t.Fatal(err)
	}
	driver := &stalledDriver{
		listener: listener,
		resume:   make(chan struct{}),
		read:     make(chan []byte, 64),
	}
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		driver.conn = conn
		// Answer the handshake, then read nothing until released.
		buffer := make([]byte, 64*1024)
		if _, err := conn.Read(buffer); err != nil {
			return
		}
		ack, _ := EncodeFrame(map[string]any{
			"type": "hello-ack", "protocol": ProtocolID, "sessionId": "s-1",
			"limits": DefaultLimits, "subscribe": "diffs",
			"marker": map[string]any{"enabled": true},
		}, DefaultLimits.MaxFrameBytes)
		_, _ = conn.Write(ack)

		<-driver.resume
		for {
			n, err := conn.Read(buffer)
			if n > 0 {
				chunk := make([]byte, n)
				copy(chunk, buffer[:n])
				select {
				case driver.read <- chunk:
				default:
				}
			}
			if err != nil {
				return
			}
		}
	}()
	t.Cleanup(func() { _ = listener.Close() })
	return driver
}

// The application must keep rendering while the driver is not reading. Before
// the write deadline existed, this test hung: a full socket buffer stopped the
// caller for as long as the driver stayed away, which for a probe means the
// application's own render loop.
func TestAWriteToAStalledDriverIsBounded(t *testing.T) {
	directory := shortTempDir(t)
	path := filepath.Join(directory, "s")
	driver := startStalledDriver(t, path)

	client := New(path, "token", Options{
		AdapterName: "test", AdapterVersion: "0.0.0",
		WriteTimeout: 100 * time.Millisecond,
	})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake: %v", err)
	}

	// Enough traffic to fill the socket buffer and then some.
	started := time.Now()
	var failure error
	for attempt := 0; attempt < 400 && failure == nil; attempt++ {
		_, failure = client.Publish(paddedSnapshot(attempt))
	}
	elapsed := time.Since(started)

	if failure == nil {
		t.Skip("the socket buffer swallowed everything; nothing was stalled")
	}
	if !errors.Is(failure, ErrWriteTimeout) {
		t.Fatalf("expected a recognisable write timeout, got %v", failure)
	}
	if elapsed > 30*time.Second {
		t.Fatalf("publishing took %s; the write was not bounded", elapsed)
	}
	// A half-written frame cannot be resynchronised, so the session is over
	// and further publishes return at once rather than retrying into a broken
	// stream.
	if client.Connected() {
		t.Error("the session survived a partially written frame")
	}
	if marker, err := client.Publish(paddedSnapshot(0)); marker != "" || err != nil {
		t.Errorf("a closed session still published: %q, %v", marker, err)
	}
	close(driver.resume)
}

// "Driver not keeping up" and "frame refused as oversized" need different
// handling, so they must be told apart without matching on message text.
func TestAnOversizedFrameIsNotAWriteTimeout(t *testing.T) {
	driver := startFakeDriver(t)
	client := New(driver.endpoint(), "token", Options{AdapterName: "test", AdapterVersion: "0.0.0"})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake: %v", err)
	}
	defer client.Close()

	huge := paddedSnapshot(0)
	huge.Nodes[0].Name = strings.Repeat("x", DefaultLimits.MaxStringBytes+1)
	_, err := client.Publish(huge)
	if err == nil {
		t.Fatal("expected the oversized snapshot to be refused")
	}
	if errors.Is(err, ErrWriteTimeout) {
		t.Fatalf("an oversized frame was reported as a slow driver: %v", err)
	}
	if code := ValidationCode(err); code == "" {
		t.Fatalf("expected a validation error carrying a code, got %T %v", err, err)
	}
}

// -- the producer's obligation after a gap ---------------------------------

func TestRequireFullSnapshotForcesAWholeTree(t *testing.T) {
	driver := startFakeDriverWithSubscribe(t, "diffs")
	client := New(driver.endpoint(), "token", Options{AdapterName: "test", AdapterVersion: "0.0.0"})
	if err := client.Start(2 * time.Second); err != nil {
		t.Fatalf("handshake: %v", err)
	}
	defer client.Close()

	if _, err := client.Publish(paddedSnapshot(1)); err != nil {
		t.Fatal(err)
	}
	if _, err := client.Publish(paddedSnapshot(2)); err != nil {
		t.Fatal(err)
	}
	if client.DeltasSent() == 0 {
		t.Fatal("the second publish was not a delta, so this test proves nothing")
	}

	// The probe lost a frame: the next tree must be whole.
	client.RequireFullSnapshot()
	if !client.FullSnapshotRequired() {
		t.Error("the obligation was not recorded")
	}
	before := client.SnapshotsSent()
	if _, err := client.Publish(paddedSnapshot(3)); err != nil {
		t.Fatal(err)
	}
	if client.SnapshotsSent() != before+1 {
		t.Error("the obligation did not produce a full snapshot")
	}
	if client.FullSnapshotRequired() {
		t.Error("the obligation was not cleared once honoured")
	}

	// And the one after it is a delta again.
	deltas := client.DeltasSent()
	if _, err := client.Publish(paddedSnapshot(4)); err != nil {
		t.Fatal(err)
	}
	if client.DeltasSent() != deltas+1 {
		t.Error("the client stopped sending deltas after honouring the obligation")
	}
}
