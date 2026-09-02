package protocol

import (
	"bytes"
	"errors"
	"net"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

type controlledConn struct {
	started chan struct{}
	release chan struct{}
	fail    error
	once    sync.Once
	mu      sync.Mutex
	writes  [][]byte
}

func (c *controlledConn) Read([]byte) (int, error) { return 0, net.ErrClosed }
func (c *controlledConn) Write(value []byte) (int, error) {
	c.once.Do(func() { close(c.started) })
	<-c.release
	if c.fail != nil {
		return 0, c.fail
	}
	c.mu.Lock()
	c.writes = append(c.writes, append([]byte(nil), value...))
	c.mu.Unlock()
	return len(value), nil
}
func (c *controlledConn) Close() error                     { return nil }
func (c *controlledConn) LocalAddr() net.Addr              { return stubAddr("local") }
func (c *controlledConn) RemoteAddr() net.Addr             { return stubAddr("remote") }
func (c *controlledConn) SetDeadline(time.Time) error      { return nil }
func (c *controlledConn) SetReadDeadline(time.Time) error  { return nil }
func (c *controlledConn) SetWriteDeadline(time.Time) error { return nil }

type stubAddr string

func (a stubAddr) Network() string { return string(a) }
func (a stubAddr) String() string  { return string(a) }

func queuedTestClient(conn net.Conn) *Client {
	c := New("unused", testToken, Options{AdapterName: "queue-test", AdapterVersion: "1", WriteTimeout: -1})
	c.conn = conn
	c.sessionID = testSession
	c.marker = true
	return c
}

func TestPublicationQueueIsBoundedAndDoesNotConsumeDroppedRevision(t *testing.T) {
	conn := &controlledConn{started: make(chan struct{}), release: make(chan struct{})}
	client := queuedTestClient(conn)
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}

	first, err := queue.Publish(sampleSnapshot())
	if err != nil || first == "" {
		t.Fatalf("first admission: marker=%q err=%v", first, err)
	}
	<-conn.started // worker owns the first job and is blocked in transport
	second, err := queue.Publish(sampleSnapshot())
	if err != nil || second == "" {
		t.Fatalf("second admission: marker=%q err=%v", second, err)
	}
	if marker, err := queue.Publish(sampleSnapshot()); !errors.Is(err, ErrPublicationQueueFull) || marker != "" {
		t.Fatalf("full queue returned marker=%q err=%v", marker, err)
	}
	if client.revision != 2 || queue.Dropped() != 1 {
		t.Fatalf("drop consumed a revision: revision=%d drops=%d", client.revision, queue.Dropped())
	}
	close(conn.release)
	queue.Fail("test-complete", "close")
	<-queue.Done()
	conn.mu.Lock()
	wire := bytes.Join(conn.writes, nil)
	conn.mu.Unlock()
	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	frames, decodeErr := decoder.Push(wire)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	typeOf := func(frame Frame) string {
		value, _ := frame.Value.(map[string]any)
		name, _ := value["type"].(string)
		return name
	}
	if len(frames) < 4 || typeOf(frames[0]) != "semantic-full" || typeOf(frames[1]) != "revision-commit" || typeOf(frames[2]) != "semantic-full" || typeOf(frames[3]) != "revision-commit" {
		t.Fatalf("publication order changed: %#v", frames)
	}
}

func TestPublicationQueueSignalsCapacityAfterARejectedRevision(t *testing.T) {
	conn := &controlledConn{started: make(chan struct{}), release: make(chan struct{})}
	client := queuedTestClient(conn)
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	if marker, publishErr := queue.Publish(sampleSnapshot()); publishErr != nil || marker == "" {
		t.Fatalf("first admission: marker=%q err=%v", marker, publishErr)
	}
	<-conn.started
	if marker, publishErr := queue.Publish(sampleSnapshot()); publishErr != nil || marker == "" {
		t.Fatalf("second admission: marker=%q err=%v", marker, publishErr)
	}
	if marker, publishErr := queue.Publish(sampleSnapshot()); marker != "" || !errors.Is(publishErr, ErrPublicationQueueFull) {
		t.Fatalf("full admission returned marker=%q err=%v", marker, publishErr)
	}
	ready := queue.ReadyAfterDrop()
	select {
	case <-ready:
		t.Fatal("capacity edge fired before the worker dequeued the queued revision")
	default:
	}

	close(conn.release)
	<-ready
	if marker, publishErr := queue.Publish(sampleSnapshot()); publishErr != nil || marker == "" {
		t.Fatalf("post-capacity admission: marker=%q err=%v", marker, publishErr)
	}
	queue.Shutdown()
	if queue.Dropped() != 1 || client.Revision() != 3 {
		t.Fatalf("recovery counters: dropped=%d revision=%d, want 1/3", queue.Dropped(), client.Revision())
	}
}

func TestPublicationQueueReadyAfterDropNeverWaitsForQueueOwnership(t *testing.T) {
	release := make(chan struct{})
	close(release)
	client := queuedTestClient(&controlledConn{started: make(chan struct{}), release: release})
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	queue.mu.Lock()
	ready := queue.ReadyAfterDrop()
	select {
	case <-ready:
	default:
		t.Fatal("idle capacity edge was not already ready")
	}
	queue.mu.Unlock()
	queue.Shutdown()
}

func TestPublicationWorkerFailureFailsClosedWithoutLaterMarker(t *testing.T) {
	conn := &controlledConn{started: make(chan struct{}), release: make(chan struct{}), fail: errors.New("broken writer")}
	client := queuedTestClient(conn)
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	marker, err := queue.Publish(sampleSnapshot())
	if err != nil || marker == "" {
		t.Fatalf("admission failed: marker=%q err=%v", marker, err)
	}
	<-conn.started
	close(conn.release)
	<-queue.Done()
	if !queue.Failed() {
		t.Fatal("worker failure was not recorded")
	}
	if marker, err := queue.Publish(sampleSnapshot()); !errors.Is(err, ErrPublicationWorkerFailed) || marker != "" {
		t.Fatalf("failed worker admitted a later marker=%q err=%v", marker, err)
	}
}

func TestPublicationQueueShutdownDrainsOneFrameBeforeReturning(t *testing.T) {
	release := make(chan struct{})
	close(release)
	conn := &controlledConn{started: make(chan struct{}), release: release}
	client := queuedTestClient(conn)
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	marker, err := queue.Publish(sampleSnapshot())
	if err != nil || marker == "" {
		t.Fatalf("admission failed: marker=%q err=%v", marker, err)
	}

	queue.Shutdown()

	conn.mu.Lock()
	wire := bytes.Join(conn.writes, nil)
	conn.mu.Unlock()
	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	frames, decodeErr := decoder.Push(wire)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if len(frames) != 2 {
		t.Fatalf("shutdown did not drain snapshot+commit: %#v", frames)
	}
	if marker, err := queue.Publish(sampleSnapshot()); !errors.Is(err, ErrPublicationQueueClosed) || marker != "" {
		t.Fatalf("shutdown admitted a last-frame marker=%q err=%v", marker, err)
	}
	if client.Revision() != 1 {
		t.Fatalf("shutdown refusal consumed revision %d", client.Revision())
	}
}

func TestPublicationQueueTryPublishNeverWaitsForLifecycleOrAdmissionLocks(t *testing.T) {
	release := make(chan struct{})
	close(release)
	client := queuedTestClient(&controlledConn{started: make(chan struct{}), release: release})
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	queue.mu.Lock()
	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker != "" || !errors.Is(publishErr, ErrPublicationQueueBusy) {
		t.Fatalf("lifecycle contention returned marker=%q err=%v", marker, publishErr)
	}
	queue.mu.Unlock()

	client.publishMu.Lock()
	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker != "" || !errors.Is(publishErr, ErrPublicationQueueBusy) {
		t.Fatalf("admission contention returned marker=%q err=%v", marker, publishErr)
	}
	client.publishMu.Unlock()

	client.mu.Lock()
	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker != "" || !errors.Is(publishErr, ErrPublicationQueueBusy) {
		t.Fatalf("client lifecycle contention returned marker=%q err=%v", marker, publishErr)
	}
	client.mu.Unlock()
	if client.Revision() != 0 {
		t.Fatalf("busy refusal consumed revision %d", client.Revision())
	}
	queue.Shutdown()
}

func TestPublicationQueueReadyAfterBusyWaitsForEveryAdmissionOwner(t *testing.T) {
	for _, hold := range []struct {
		name   string
		lock   func(*PublicationQueue)
		unlock func(*PublicationQueue)
	}{
		{"queue", func(q *PublicationQueue) { q.mu.Lock() }, func(q *PublicationQueue) { q.mu.Unlock() }},
		{"publisher", func(q *PublicationQueue) { q.client.publishMu.Lock() }, func(q *PublicationQueue) { q.client.publishMu.Unlock() }},
		{"client", func(q *PublicationQueue) { q.client.mu.Lock() }, func(q *PublicationQueue) { q.client.mu.Unlock() }},
	} {
		t.Run(hold.name, func(t *testing.T) {
			release := make(chan struct{})
			close(release)
			client := queuedTestClient(&controlledConn{started: make(chan struct{}), release: release})
			queue, err := NewPublicationQueue(client, 1)
			if err != nil {
				t.Fatal(err)
			}
			hold.lock(queue)
			ready := queue.ReadyAfterBusy()
			select {
			case <-ready:
				t.Fatal("busy edge closed while its admission owner was still active")
			default:
			}
			hold.unlock(queue)
			<-ready
			queue.Shutdown()
		})
	}
}

func TestPublicationQueueTryPublishPerformsNoSynchronousDebugIO(t *testing.T) {
	path := filepath.Join(t.TempDir(), "adapter.log")
	debug := OpenDebugLog(path, "queue-test")
	if debug == nil {
		t.Fatal("debug log did not open")
	}
	t.Cleanup(debug.Close)
	initial, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}

	release := make(chan struct{})
	conn := &controlledConn{started: make(chan struct{}), release: release}
	client := queuedTestClient(conn)
	client.options.Debug = debug
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}

	invalid := sampleSnapshot()
	invalid.Columns = 0
	if marker, publishErr := queue.TryPublish(invalid); marker != "" || publishErr == nil {
		t.Fatalf("invalid snapshot returned marker=%q err=%v", marker, publishErr)
	}
	if current, readErr := os.ReadFile(path); readErr != nil || !bytes.Equal(current, initial) {
		t.Fatalf("render-path validation performed debug I/O: err=%v before=%q after=%q", readErr, initial, current)
	}

	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker == "" || publishErr != nil {
		t.Fatalf("first admission: marker=%q err=%v", marker, publishErr)
	}
	<-conn.started
	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker == "" || publishErr != nil {
		t.Fatalf("second admission: marker=%q err=%v", marker, publishErr)
	}
	if marker, publishErr := queue.TryPublish(sampleSnapshot()); marker != "" || !errors.Is(publishErr, ErrPublicationQueueFull) {
		t.Fatalf("full admission returned marker=%q err=%v", marker, publishErr)
	}
	if current, readErr := os.ReadFile(path); readErr != nil || !bytes.Equal(current, initial) {
		t.Fatalf("render-path queue refusal performed debug I/O: err=%v before=%q after=%q", readErr, initial, current)
	}
	close(release)
	queue.Shutdown()
}

func TestPublicationQueueExclusivelyOwnsRevisionAndWireOrdering(t *testing.T) {
	release := make(chan struct{})
	close(release)
	conn := &controlledConn{started: make(chan struct{}), release: release}
	client := queuedTestClient(conn)
	queue, err := NewPublicationQueue(client, 1)
	if err != nil {
		t.Fatal(err)
	}
	if marker, err := client.Publish(sampleSnapshot()); !errors.Is(err, ErrPublicationQueueOwnsClient) || marker != "" {
		t.Fatalf("direct publish raced queue ownership: marker=%q err=%v", marker, err)
	}
	if _, err := NewPublicationQueue(client, 1); !errors.Is(err, ErrPublicationQueueOwnsClient) {
		t.Fatalf("second queue claimed one client: %v", err)
	}
	queue.Shutdown()
}

func TestPublicationQueuesAreIndependentAcrossClientsAndRestart(t *testing.T) {
	openRelease := func() chan struct{} {
		release := make(chan struct{})
		close(release)
		return release
	}
	firstClient := queuedTestClient(&controlledConn{started: make(chan struct{}), release: openRelease()})
	secondClient := queuedTestClient(&controlledConn{started: make(chan struct{}), release: openRelease()})
	first, err := NewPublicationQueue(firstClient, 1)
	if err != nil {
		t.Fatal(err)
	}
	second, err := NewPublicationQueue(secondClient, 1)
	if err != nil {
		t.Fatal(err)
	}
	if marker, err := first.Publish(sampleSnapshot()); err != nil || marker == "" {
		t.Fatalf("first client admission: marker=%q err=%v", marker, err)
	}
	if marker, err := second.Publish(sampleSnapshot()); err != nil || marker == "" {
		t.Fatalf("second client admission: marker=%q err=%v", marker, err)
	}
	first.Shutdown()
	if marker, err := second.Publish(sampleSnapshot()); err != nil || marker == "" {
		t.Fatalf("first shutdown affected second client: marker=%q err=%v", marker, err)
	}
	second.Shutdown()

	// A restarted framework run owns a fresh Client. Ownership is session-local
	// and the previous queue's shutdown cannot poison the replacement session.
	restartedClient := queuedTestClient(&controlledConn{started: make(chan struct{}), release: openRelease()})
	restarted, err := NewPublicationQueue(restartedClient, 1)
	if err != nil {
		t.Fatalf("replacement client could not acquire a queue: %v", err)
	}
	if marker, err := restarted.Publish(sampleSnapshot()); err != nil || marker == "" {
		t.Fatalf("replacement client admission: marker=%q err=%v", marker, err)
	}
	restarted.Shutdown()
}

func TestConcurrentAdmissionsKeepOneRevisionOrder(t *testing.T) {
	release := make(chan struct{})
	close(release)
	conn := &controlledConn{started: make(chan struct{}), release: release}
	client := queuedTestClient(conn)
	const publications = 16
	queue, err := NewPublicationQueue(client, publications)
	if err != nil {
		t.Fatal(err)
	}
	errorsByAttempt := make(chan error, publications)
	var callers sync.WaitGroup
	for attempt := 0; attempt < publications; attempt++ {
		callers.Add(1)
		go func() {
			defer callers.Done()
			marker, publishErr := queue.Publish(sampleSnapshot())
			if publishErr != nil {
				errorsByAttempt <- publishErr
				return
			}
			if marker == "" {
				errorsByAttempt <- errors.New("concurrent admission returned no marker")
			}
		}()
	}
	callers.Wait()
	close(errorsByAttempt)
	for publishErr := range errorsByAttempt {
		t.Error(publishErr)
	}
	queue.Shutdown()
	if client.Revision() != publications {
		t.Fatalf("concurrent revision=%d, want %d", client.Revision(), publications)
	}
	conn.mu.Lock()
	wire := bytes.Join(conn.writes, nil)
	conn.mu.Unlock()
	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	frames, decodeErr := decoder.Push(wire)
	if decodeErr != nil {
		t.Fatal(decodeErr)
	}
	if len(frames) != publications*2 {
		t.Fatalf("wire frames=%d, want %d", len(frames), publications*2)
	}
}
