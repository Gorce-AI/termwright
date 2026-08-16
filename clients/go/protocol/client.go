package protocol

import (
	"encoding/json"
	"errors"
	"math"
	"net"
	"os"
	"strings"
	"sync"
	"time"
)

// Environment variables the driver injects before spawning the child process.
const (
	EnvEndpoint = "TERMWRIGHT_ENDPOINT"
	EnvToken    = "TERMWRIGHT_TOKEN"
	EnvProtocol = "TERMWRIGHT_PROTOCOL"
)

// DefaultCapabilities is what a tree-publishing adapter with real bounds
// announces.
var DefaultCapabilities = []Capability{
	CapTree, CapBounds, CapAbsoluteBounds, CapStates, CapActions, CapRenderRevisions,
}

// CapabilitiesWithLogs adds the log channel. Announcing `logs` is what makes
// the driver grant a budget; without it the driver sends none and the adapter
// must stay silent.
var CapabilitiesWithLogs = append(append([]Capability{}, DefaultCapabilities...), CapLogs)

// snapshotHistory is how many recent revisions stay answerable by get-tree.
const snapshotHistory = 8

// DialTimeout is the default handshake budget for adapters that do not pick
// one themselves.
const DialTimeout = 5 * time.Second

// Options tune a Client. The zero value is usable.
type Options struct {
	// AdapterName and AdapterVersion identify the adapter in the handshake.
	AdapterName    string
	AdapterVersion string
	// Capabilities defaults to DefaultCapabilities.
	Capabilities []Capability
	// Limits applies until hello-ack replaces it.
	Limits *Limits
}

// Client is one semantic session: handshake, snapshot publishing, markers.
//
// The client owns the revision counter. Publish allocates the next revision,
// writes the frames, and returns the marker to emit after the render's last
// byte. It is safe for concurrent use.
type Client struct {
	endpoint string
	token    string
	options  Options

	mu          sync.Mutex
	conn        net.Conn
	limits      Limits
	sessionID   string
	revision    int64
	marker      bool
	logBudget   *LogBudget
	subscribe   string
	closed      bool
	history     map[int64]json.RawMessage
	order       []int64
	published   map[string]any
	deltasSent  int64
	snapsSent   int64
	logSeq      int64
	logBucket   *tokenBucket
	logsDropped int64

	ready chan error
	once  sync.Once
}

// New returns a client for an explicit endpoint and token.
func New(endpoint, token string, options Options) *Client {
	limits := DefaultLimits
	if options.Limits != nil {
		limits = *options.Limits
	}
	if len(options.Capabilities) == 0 {
		options.Capabilities = DefaultCapabilities
	}
	return &Client{
		endpoint:  endpoint,
		token:     token,
		options:   options,
		limits:    limits,
		subscribe: "snapshots",
		history:   make(map[int64]json.RawMessage),
		ready:     make(chan error, 1),
	}
}

// FromEnv returns a client built from TERMWRIGHT_*, or nil when the process is
// not instrumented.
//
// This is the dormant rule in one function: no endpoint or no token means no
// client, and the caller must then open nothing and emit nothing.
func FromEnv(options Options) *Client {
	endpoint := os.Getenv(EnvEndpoint)
	token := os.Getenv(EnvToken)
	return fromEnvValues(endpoint, token, os.Getenv(EnvProtocol), options)
}

func fromEnvValues(endpoint, token, protocol string, options Options) *Client {
	if endpoint == "" || token == "" {
		return nil
	}
	if protocol != "" && protocol != ProtocolID && protocol != "1" {
		return nil
	}
	if strings.HasPrefix(endpoint, `\\.\pipe\`) || strings.HasPrefix(endpoint, `\\?\pipe\`) {
		// Named pipes need a Windows-only transport; stay dormant instead of
		// half-working.
		return nil
	}
	return New(endpoint, token, options)
}

// Start dials the endpoint, sends hello and waits for hello-ack.
//
// A side-channel failure must never take the application down, so callers are
// expected to ignore the error and carry on rendering.
func (c *Client) Start(timeout time.Duration) error {
	conn, err := net.DialTimeout("unix", c.endpoint, timeout)
	if err != nil {
		c.mu.Lock()
		c.closed = true
		c.mu.Unlock()
		return err
	}

	c.mu.Lock()
	c.conn = conn
	limits := c.limits
	c.mu.Unlock()

	go c.readLoop(conn)

	hello, err := NewHello(c.token, c.options.AdapterName, c.options.AdapterVersion, c.options.Capabilities)
	if err != nil {
		c.Close()
		return err
	}
	if err := c.send(hello, limits); err != nil {
		c.Close()
		return err
	}

	select {
	case err := <-c.ready:
		if err != nil {
			c.Close()
		}
		return err
	case <-time.After(timeout):
		c.Close()
		return errors.New("termwright: timed out waiting for hello-ack")
	}
}

// Close ends the session. Safe to call more than once.
func (c *Client) Close() error {
	c.mu.Lock()
	conn := c.conn
	c.conn = nil
	c.closed = true
	c.mu.Unlock()
	c.once.Do(func() {
		select {
		case c.ready <- errors.New("termwright: session closed"):
		default:
		}
	})
	if conn != nil {
		return conn.Close()
	}
	return nil
}

// Connected reports whether the handshake completed and the link is still up.
func (c *Client) Connected() bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sessionID != "" && !c.closed && c.conn != nil
}

// SessionID is the id assigned by the driver, or "" before the handshake.
func (c *Client) SessionID() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.sessionID
}

// Revision is the last revision this client published.
func (c *Client) Revision() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.revision
}

// LogBudget is the log-channel allowance the driver granted, or nil when logs
// are disabled — which is the case unless the adapter announced `logs`.
func (c *Client) LogBudget() *LogBudget {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.logBudget
}

// Limits are the ceilings in force, as negotiated by hello-ack.
func (c *Client) Limits() Limits {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.limits
}

// Publish sends a snapshot for the next revision and returns the DCS marker
// committing it. Write that marker to stdout after the render's last byte.
//
// The snapshot's SessionID and Revision are overwritten with the session's
// own: an adapter never picks its own revision numbers. Returns "" with a nil
// error when there is no live session, so a dormant app takes no branch.
func (c *Client) Publish(snapshot *Snapshot) (string, error) {
	c.mu.Lock()
	if c.sessionID == "" || c.closed || c.conn == nil {
		c.mu.Unlock()
		return "", nil
	}
	c.revision++
	revision := c.revision
	snapshot.V = 1
	snapshot.SessionID = c.sessionID
	snapshot.Revision = revision
	limits := c.limits
	subscribe := c.subscribe
	markerEnabled := c.marker
	sessionID := c.sessionID
	c.mu.Unlock()

	if err := snapshot.Validate(limits); err != nil {
		c.mu.Lock()
		c.revision--
		c.mu.Unlock()
		return "", err
	}

	body, err := marshalCanonical(snapshot)
	if err != nil {
		return "", err
	}
	c.remember(revision, body)

	if subscribe != "revisions" {
		message, err := c.treeMessage(snapshot, subscribe, body)
		if err != nil {
			return "", err
		}
		if err := c.send(message, limits); err != nil {
			return "", err
		}
	}
	if err := c.send(RevisionCommit{Type: "revision-commit", Revision: revision}, limits); err != nil {
		return "", err
	}
	if !markerEnabled {
		return "", nil
	}
	return EncodeMarker(c.token, sessionID, revision)
}

// tokenBucket rate-limits the log channel: `burst` capacity on top of the
// sustained rate, refilled continuously. The adapter enforces its own budget
// and drops locally, which is what keeps a log storm from eating the frame
// budget the semantic tree needs.
type tokenBucket struct {
	perSecond float64
	capacity  float64
	tokens    float64
	updated   time.Time
}

func newTokenBucket(perSecond, burst int, now time.Time) *tokenBucket {
	rate := math.Max(0, float64(perSecond))
	capacity := rate + math.Max(0, float64(burst))
	return &tokenBucket{perSecond: rate, capacity: capacity, tokens: capacity, updated: now}
}

// take consumes one token, refilling first. False means "over budget".
func (b *tokenBucket) take(now time.Time) bool {
	if b.perSecond <= 0 {
		return false
	}
	elapsed := now.Sub(b.updated).Seconds()
	if elapsed < 0 {
		elapsed = 0
	}
	b.updated = now
	b.tokens = math.Min(b.capacity, b.tokens+elapsed*b.perSecond)
	if b.tokens < 1 {
		return false
	}
	b.tokens--
	return true
}

// LogsDropped counts records this adapter dropped locally, for being over
// budget or over a limit. Each one left a gap in the sequence.
func (c *Client) LogsDropped() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.logsDropped
}

// Log forwards one application log record, if the driver asked for logs.
//
// Reports whether the record went out. A record is dropped when the session is
// not live, when the driver granted no budget, when this adapter is over its
// rate, or when the record breaks a limit.
//
// Every attempt consumes a sequence number, dropped or not: the gap left in
// Seq is precisely how the driver learns records were lost here rather than in
// transit.
func (c *Client) Log(level LogLevel, message string, attrs map[string]any) bool {
	c.mu.Lock()
	if c.sessionID == "" || c.closed || c.conn == nil || c.logBucket == nil {
		c.mu.Unlock()
		return false
	}
	c.logSeq++
	record := &LogRecord{
		TS:       time.Now().UnixMilli(),
		Level:    level,
		Message:  message,
		Seq:      c.logSeq,
		Revision: c.revision,
	}
	if len(attrs) > 0 {
		record.Attrs = FlattenAttrs(attrs)
	}
	allowed := c.logBucket.take(time.Now())
	if !allowed {
		c.logsDropped++
	}
	limits := c.limits
	c.mu.Unlock()

	if !allowed {
		return false
	}
	if err := record.Validate(limits); err != nil {
		// An oversized or malformed record is dropped locally rather than
		// taking the channel down; the gap in seq reports it.
		c.mu.Lock()
		c.logsDropped++
		c.mu.Unlock()
		return false
	}
	if err := c.send(NewLogMessage(record), limits); err != nil {
		return false
	}
	return true
}

// LogRecordWith sends a record the caller built, for a bridge that already has
// a timestamp and logger name of its own.
//
// Seq is assigned here whatever the caller set, because the adapter is the
// only authority on it: the channel is open to several publishers, and two of
// them can pick the same number in good faith. A caller's own number is kept
// as the `origin.seq` attribute, which is a diagnostic rather than a promise —
// it is dropped rather than allowed to push the record over a limit.
func (c *Client) LogRecordWith(record LogRecord) bool {
	c.mu.Lock()
	if c.sessionID == "" || c.closed || c.conn == nil || c.logBucket == nil {
		c.mu.Unlock()
		return false
	}
	origin := record.Seq
	c.logSeq++
	record.Seq = c.logSeq
	if record.Revision == 0 {
		record.Revision = c.revision
	}
	if record.TS == 0 {
		record.TS = time.Now().UnixMilli()
	}
	allowed := c.logBucket.take(time.Now())
	if !allowed {
		c.logsDropped++
	}
	limits := c.limits
	c.mu.Unlock()

	if !allowed {
		return false
	}
	if origin > 0 {
		record.Attrs = withOriginSeq(record.Attrs, origin, limits, &record)
	}
	if err := record.Validate(limits); err != nil {
		c.mu.Lock()
		c.logsDropped++
		c.mu.Unlock()
		return false
	}
	return c.send(NewLogMessage(&record), limits) == nil
}

// withOriginSeq adds the publisher's own sequence number as a diagnostic, and
// backs out when doing so would cost the record: a hint is never worth turning
// a log line into a rejected frame.
func withOriginSeq(attrs map[string]any, origin int64, limits Limits, record *LogRecord) map[string]any {
	if len(attrs) >= MaxLogAttrs {
		return attrs
	}
	next := make(map[string]any, len(attrs)+1)
	for key, value := range attrs {
		next[key] = value
	}
	next["origin.seq"] = origin

	before := record.Attrs
	record.Attrs = next
	if record.Validate(limits) != nil {
		record.Attrs = before
		return attrs
	}
	record.Attrs = before
	return next
}

// treeMessage picks a delta when the driver asked for one and it is worth
// sending, and a whole tree otherwise: on the first publish there is no base,
// under a snapshots subscription no delta is wanted, and past roughly half the
// tree a patch costs more than the thing it replaces.
//
// The base advances only once a message has been built from it, so a skipped
// publish cannot leave the driver applying a delta onto a tree it never got.
func (c *Client) treeMessage(snapshot *Snapshot, subscribe string, body json.RawMessage) (any, error) {
	var wire map[string]any
	if err := json.Unmarshal(body, &wire); err != nil {
		return nil, err
	}

	c.mu.Lock()
	previous := c.published
	c.published = wire
	c.mu.Unlock()

	if subscribe == "diffs" && previous != nil {
		if delta := BuildDelta(previous, wire); delta != nil {
			c.mu.Lock()
			c.deltasSent++
			c.mu.Unlock()
			return delta, nil
		}
	}
	c.mu.Lock()
	c.snapsSent++
	c.mu.Unlock()
	return SnapshotMessage{Type: "snapshot", Snapshot: snapshot}, nil
}

// DeltasSent counts the patches this client has published.
func (c *Client) DeltasSent() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.deltasSent
}

// SnapshotsSent counts the whole trees this client has published.
func (c *Client) SnapshotsSent() int64 {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.snapsSent
}

func (c *Client) remember(revision int64, body json.RawMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.history[revision] = body
	c.order = append(c.order, revision)
	for len(c.order) > snapshotHistory {
		delete(c.history, c.order[0])
		c.order = c.order[1:]
	}
}

func (c *Client) send(message any, limits Limits) error {
	frame, err := EncodeFrame(message, limits.MaxFrameBytes)
	if err != nil {
		return err
	}
	c.mu.Lock()
	conn := c.conn
	c.mu.Unlock()
	if conn == nil {
		return nil
	}
	if _, err := conn.Write(frame); err != nil {
		c.Close()
		return err
	}
	return nil
}

func (c *Client) readLoop(conn net.Conn) {
	limits := c.Limits()
	decoder := NewDecoder(limits.MaxFrameBytes, limits.MaxDepth)
	buffer := make([]byte, 64*1024)
	for {
		n, err := conn.Read(buffer)
		if n > 0 {
			frames, decodeErr := decoder.Push(buffer[:n])
			if decodeErr != nil {
				c.Close()
				return
			}
			for _, frame := range frames {
				if !c.handle(frame) {
					return
				}
			}
		}
		if err != nil {
			c.Close()
			return
		}
	}
}

// handle processes one driver message; false means the session is over.
func (c *Client) handle(frame Frame) bool {
	message, err := ParseDriverMessage(frame.Value, c.Limits())
	if err != nil {
		_ = c.send(ProtocolErrorMessage{Type: "error", Code: "malformed", Message: err.Error()}, c.Limits())
		c.Close()
		return false
	}

	switch message["type"].(string) {
	case "hello-ack":
		var ack HelloAck
		if err := json.Unmarshal(frame.Raw, &ack); err != nil {
			c.Close()
			return false
		}
		c.mu.Lock()
		c.sessionID = ack.SessionID
		c.limits = ack.Limits
		c.marker = ack.Marker.Enabled
		c.logBudget = ack.Logs
		if ack.Logs != nil && ack.Logs.Enabled {
			c.logBucket = newTokenBucket(ack.Logs.MaxRecordsPerSecond, ack.Logs.Burst, time.Now())
		} else {
			c.logBucket = nil
		}
		c.subscribe = ack.Subscribe
		c.mu.Unlock()
		c.once.Do(func() {
			select {
			case c.ready <- nil:
			default:
			}
		})
	case "get-tree":
		var request GetTree
		if err := json.Unmarshal(frame.Raw, &request); err != nil {
			return true
		}
		c.answerGetTree(request)
	case "error":
		c.Close()
		return false
	}
	return true
}

func (c *Client) answerGetTree(request GetTree) {
	c.mu.Lock()
	wanted := c.revision
	if request.Revision != nil {
		wanted = *request.Revision
	}
	body, held := c.history[wanted]
	limits := c.limits
	c.mu.Unlock()

	result := GetTreeResult{Type: "get-tree-result", RequestID: request.RequestID}
	if held {
		result.Snapshot = body
	} else {
		result.Error = "revision is not retained"
	}
	_ = c.send(result, limits)
}
