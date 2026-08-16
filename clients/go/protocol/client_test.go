package protocol

import (
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

const (
	testToken   = "test-token"
	testSession = "s-42"
)

// fakeDriver is the driver end of the channel: it completes the handshake and
// records what the adapter sends.
type fakeDriver struct {
	listener net.Listener
	mu       sync.Mutex
	frames   []map[string]any
	conn     net.Conn
	arrived  chan struct{}
	logs     *LogBudget
}

func startFakeDriver(t *testing.T) *fakeDriver {
	return startFakeDriverWithLogs(t, nil)
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
					d.send(HelloAck{
						Type:      "hello-ack",
						Protocol:  ProtocolID,
						SessionID: testSession,
						Limits:    DefaultLimits,
						Subscribe: "snapshots",
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
		{`\\.\pipe\termwright`, testToken, ""},
	}
	for _, testCase := range cases {
		if client := fromEnvValues(testCase.endpoint, testCase.token, testCase.protocol, Options{}); client != nil {
			t.Errorf("endpoint=%q token=%q protocol=%q produced a client", testCase.endpoint, testCase.token, testCase.protocol)
		}
	}
	if client := fromEnvValues("/tmp/tw.sock", testToken, ProtocolID, Options{}); client == nil {
		t.Error("a fully instrumented environment produced no client")
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
	client := New(driver.endpoint(), testToken, Options{AdapterName: "go-test", AdapterVersion: "0.1.0"})
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

	verified, ok := VerifyMarkerPayload(marker[2:len(marker)-2], testToken, testSession)
	if !ok || verified.Revision != 1 {
		t.Errorf("marker %q did not verify against the session", marker)
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
		verified, ok := VerifyMarkerPayload(marker[2:len(marker)-2], testToken, testSession)
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
