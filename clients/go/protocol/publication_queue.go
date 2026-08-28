package protocol

import (
	"errors"
	"fmt"
	"sync"
	"sync/atomic"
)

// ErrPublicationQueueFull means a complete revision was dropped before it
// acquired a revision number. The render must not emit a marker for it.
var ErrPublicationQueueFull = errors.New("termwright: semantic publication queue full")

// ErrPublicationQueueBusy means a render-thread caller refused to wait behind
// concurrent lifecycle or publication ownership. No revision was consumed.
var ErrPublicationQueueBusy = errors.New("termwright: semantic publication queue busy")

// ErrPublicationQueueClosed means lifecycle shutdown has closed admission.
// It is distinct from a transport failure: both reject markers, but only the
// latter means an admitted publication may have failed on the wire.
var ErrPublicationQueueClosed = errors.New("termwright: semantic publication queue closed")

// ErrPublicationWorkerFailed means the ordered transport worker failed. The
// session is fail-closed and will admit no later revisions.
var ErrPublicationWorkerFailed = errors.New("termwright: semantic publication worker failed")

// PublicationQueue keeps transport I/O off a framework render thread.
//
// Publish still validates and encodes the whole snapshot+commit pair before a
// single non-blocking queue admission. Consequently a returned marker always
// names a complete admitted revision, queue pressure creates no revision gap,
// and only the worker can touch the socket for semantic publication.
type PublicationQueue struct {
	client *Client
	jobs   chan *preparedPublication
	done   chan struct{}

	mu           sync.Mutex
	closed       bool
	fatalCode    string
	fatalMessage string
	failed       atomic.Bool
	drops        atomic.Uint64
	saturated    bool
	ready        atomic.Pointer[publicationReadiness]
}

type publicationReadiness struct{ done chan struct{} }

// NewPublicationQueue starts one ordered worker for a connected client.
// Capacity must be positive. Construct it only after Client.Start succeeds;
// dormant applications therefore allocate no channel and start no goroutine.
func NewPublicationQueue(client *Client, capacity int) (*PublicationQueue, error) {
	if client == nil {
		return nil, errors.New("termwright: publication queue requires a client")
	}
	if capacity <= 0 {
		return nil, errors.New("termwright: publication queue capacity must be positive")
	}
	client.publishMu.Lock()
	client.mu.Lock()
	connected := client.sessionID != "" && !client.closed && client.conn != nil
	alreadyOwned := client.queuedPublisher
	if connected && !alreadyOwned {
		client.queuedPublisher = true
	}
	client.mu.Unlock()
	client.publishMu.Unlock()
	if !connected {
		return nil, errors.New("termwright: publication queue requires a connected client")
	}
	if alreadyOwned {
		return nil, ErrPublicationQueueOwnsClient
	}
	ready := &publicationReadiness{done: make(chan struct{})}
	close(ready.done)
	queue := &PublicationQueue{
		client: client,
		jobs:   make(chan *preparedPublication, capacity),
		done:   make(chan struct{}),
	}
	queue.ready.Store(ready)
	go queue.run()
	return queue, nil
}

// Publish validates, encodes and atomically admits one revision without
// waiting for transport I/O. An empty marker with nil error retains Client's
// dormant/no-marker convention.
func (q *PublicationQueue) Publish(snapshot *Snapshot) (string, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return q.publishLocked(snapshot, false)
}

// TryPublish is the render-loop variant of Publish. It never waits for the
// queue or its single publication owner: concurrent shutdown/failure or an
// overlapping admission is a typed refusal before a marker can be returned.
func (q *PublicationQueue) TryPublish(snapshot *Snapshot) (string, error) {
	if !q.mu.TryLock() {
		return "", ErrPublicationQueueBusy
	}
	defer q.mu.Unlock()
	return q.publishLocked(snapshot, true)
}

func (q *PublicationQueue) publishLocked(snapshot *Snapshot, nonBlocking bool) (string, error) {
	if nonBlocking && !q.client.publishMu.TryLock() {
		return "", ErrPublicationQueueBusy
	}
	if !nonBlocking {
		q.client.publishMu.Lock()
	}
	defer q.client.publishMu.Unlock()
	if q.failed.Load() {
		return "", ErrPublicationWorkerFailed
	}
	if q.closed {
		return "", ErrPublicationQueueClosed
	}
	var prepared *preparedPublication
	var err error
	if nonBlocking {
		prepared, err = q.client.tryPreparePublication(snapshot)
	} else {
		prepared, err = q.client.preparePublication(snapshot)
	}
	if err != nil || prepared == nil {
		return "", err
	}
	if nonBlocking && !q.client.mu.TryLock() {
		return "", ErrPublicationQueueBusy
	}
	if !nonBlocking {
		q.client.mu.Lock()
	}
	if q.client.sessionID == "" || q.client.closed || q.client.conn == nil {
		q.client.mu.Unlock()
		return "", ErrPublicationQueueClosed
	}
	if prepared.revision != q.client.revision+1 {
		q.client.mu.Unlock()
		return "", ErrPublicationQueueBusy
	}
	select {
	case q.jobs <- prepared:
		q.client.revision = prepared.revision
		q.client.mu.Unlock()
		return prepared.marker, nil
	default:
		q.client.mu.Unlock()
		q.drops.Add(1)
		if !q.saturated {
			q.saturated = true
			q.ready.Store(&publicationReadiness{done: make(chan struct{})})
		}
		return "", ErrPublicationQueueFull
	}
}

// Dropped counts revisions rejected locally because the bounded queue was
// full. Such revisions never consume a number and never receive a marker.
func (q *PublicationQueue) Dropped() uint64 { return q.drops.Load() }

// ReadyAfterDrop closes when a queue-full refusal has been followed by a
// worker dequeue, i.e. when another non-blocking admission can be attempted.
// Framework adapters use this causal edge to request one authoritative redraw
// outside their render callback. It is not a timer, poll or permission to
// replay the rejected revision: the next framework draw must take a fresh
// snapshot and pair it with its own output marker.
//
// When the queue has not refused an admission, the returned channel is already
// closed. Call this after observing ErrPublicationQueueFull.
func (q *PublicationQueue) ReadyAfterDrop() <-chan struct{} {
	return q.ready.Load().done
}

// ReadyAfterBusy closes after every lock that can make TryPublish return
// ErrPublicationQueueBusy has completed its current critical section. It is a
// causal admission edge for recovery coordinators, not permission to replay a
// refused snapshot: the framework must render and snapshot fresh state.
//
// The call itself only starts a waiter and returns its channel. Lock acquisition
// happens in that waiter, so render callbacks never wait for admission owners.
func (q *PublicationQueue) ReadyAfterBusy() <-chan struct{} {
	ready := make(chan struct{})
	go func() {
		q.mu.Lock()
		q.client.publishMu.Lock()
		q.client.mu.Lock()
		q.client.mu.Unlock()
		q.client.publishMu.Unlock()
		q.mu.Unlock()
		close(ready)
	}()
	return ready
}

// Failed reports an unrecoverable worker transport failure.
func (q *PublicationQueue) Failed() bool { return q.failed.Load() }

// Done closes when the ordered worker has stopped. It is primarily useful for
// deterministic shutdown and failure observation; waiting on it is never part
// of a render path.
func (q *PublicationQueue) Done() <-chan struct{} { return q.done }

// Shutdown closes admission and waits until the ordered worker has drained
// every already-admitted publication (or observed its transport failure).
// Framework lifecycle code calls this after its render loop, never from a
// render hook, so a short-lived one-frame process cannot outrun its semantics.
func (q *PublicationQueue) Shutdown() {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		close(q.jobs)
	}
	done := q.done
	q.mu.Unlock()
	<-done
}

// Fail closes semantic publication immediately and asks the worker to send a
// typed fatal after all already-admitted revisions. It never writes a socket
// from the caller's thread.
func (q *PublicationQueue) Fail(code, message string) {
	q.mu.Lock()
	if !q.closed {
		q.closed = true
		q.failed.Store(true)
		q.fatalCode = code
		q.fatalMessage = message
		q.client.options.Debug.Line("diag", code+": "+message)
		close(q.jobs)
	}
	q.mu.Unlock()
}

func (q *PublicationQueue) run() {
	defer close(q.done)
	defer q.reportDrops()
	for publication := range q.jobs {
		q.signalReadyAfterDrop()
		if err := q.client.writePublication(publication); err != nil {
			q.failed.Store(true)
			q.client.options.Debug.Line("diag", "semantic-publication-worker-failed: "+errorLabel(err))
			_ = q.client.Close()
			return
		}
		q.client.completePublication(publication)
	}
	q.mu.Lock()
	code, message := q.fatalCode, q.fatalMessage
	q.mu.Unlock()
	if code != "" {
		_ = q.client.Fail(code, message)
	} else {
		_ = q.client.Close()
	}
}

func (q *PublicationQueue) signalReadyAfterDrop() {
	q.mu.Lock()
	if q.saturated {
		q.saturated = false
		close(q.ready.Load().done)
	}
	q.mu.Unlock()
}

func (q *PublicationQueue) reportDrops() {
	drops := q.drops.Load()
	if drops == 0 {
		return
	}
	q.client.performanceDrops(drops)
	q.client.options.Debug.Line("diag", fmt.Sprintf("semantic-publication-queue-full: dropped=%d before admission", drops))
}
