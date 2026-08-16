// Package termwright publishes a tview application's widget tree to the
// termwright terminal test driver.
//
// Attach it once, next to your Run call:
//
//	app := tview.NewApplication()
//	session, _ := termwright.Attach(app, root)
//	defer session.Close()
//	app.SetRoot(root, true).Run()
//
// Dormant rule: without TERMWRIGHT_ENDPOINT and TERMWRIGHT_TOKEN in the
// environment Attach returns (nil, nil) — no socket is opened, no marker is
// written, and the application renders exactly the bytes it would have
// rendered anyway. A nil *Session is safe to Close.
package termwright

import (
	"io"
	"os"
	"sync"

	"github.com/gdamore/tcell/v2"
	"github.com/rivo/tview"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// AdapterName identifies this adapter in the handshake.
const AdapterName = "termwright-tview"

// AdapterVersion is this adapter's version.
const AdapterVersion = "0.1.0"

// ChildrenFunc enumerates a primitive's children. Return nil to fall back to
// the built-in enumeration, which covers Flex, Pages, Form, Frame, List and
// DropDown.
type ChildrenFunc func(tview.Primitive) []tview.Primitive

// Describer overrides the role and name derived from a primitive's type.
// Return ok == false to keep the derived values.
type Describer func(tview.Primitive) (role protocol.Role, name string, ok bool)

// TestIDFunc supplies the author-chosen test id for a primitive, or "" to
// leave it unset.
//
// tview exposes no identifier of its own — a Box title is display text, not an
// id — so an annotation is the only source there is. Without one, tests can
// address a widget by role and name but never by a stable handle that survives
// its label being rewritten.
type TestIDFunc func(tview.Primitive) string

// Option configures Attach.
type Option func(*config)

type config struct {
	screen       tcell.Screen
	markerWriter io.Writer
	children     ChildrenFunc
	describe     Describer
	adapterName  string
	version      string
	capabilities []protocol.Capability
	testID       TestIDFunc
}

// WithScreen supplies the screen to draw on, instead of letting Attach create
// one. Pass a tcell.SimulationScreen to drive the app from a test.
func WithScreen(screen tcell.Screen) Option {
	return func(c *config) { c.screen = screen }
}

// WithMarkerWriter redirects the render-commit marker, which defaults to
// os.Stdout.
func WithMarkerWriter(writer io.Writer) Option {
	return func(c *config) { c.markerWriter = writer }
}

// WithChildren adds an enumeration hook for container types this package
// cannot walk on its own, such as Grid, which exposes no item accessor.
func WithChildren(fn ChildrenFunc) Option {
	return func(c *config) { c.children = fn }
}

// WithDescriber overrides roles and names per primitive.
func WithDescriber(fn Describer) Option {
	return func(c *config) { c.describe = fn }
}

// WithTestIDs supplies test ids for primitives, which tview cannot provide on
// its own. Return "" for anything that should not carry one.
//
//	termwright.WithTestIDs(func(p tview.Primitive) string {
//	    switch p {
//	    case approve: return "approve"
//	    case reject:  return "reject"
//	    }
//	    return ""
//	})
//
// Session.SetTestID is the imperative equivalent for code that builds its
// widgets far from the Attach call.
func WithTestIDs(fn TestIDFunc) Option {
	return func(c *config) { c.testID = fn }
}

// WithLogs announces the `logs` capability, which is what makes the driver
// grant a log budget. Pair it with protocol.NewSlogHandler to forward the
// application's own slog records.
func WithLogs() Option {
	return func(c *config) { c.capabilities = protocol.CapabilitiesWithLogs }
}

// WithAdapterIdentity overrides the name and version sent in the handshake,
// for a framework built on top of tview.
func WithAdapterIdentity(name, version string) Option {
	return func(c *config) { c.adapterName, c.version = name, version }
}

// Session is a live semantic session bound to one tview application.
// A nil *Session is inert: every method is safe to call.
type Session struct {
	app    *tview.Application
	root   tview.Primitive
	client *protocol.Client
	config config

	mu      sync.Mutex
	pending string
	ids     map[tview.Primitive]string
	testIDs map[tview.Primitive]string
	nextID  int
	closed  bool
}

// SetTestID annotates one primitive with an author-chosen test id, which is
// published as `testId` and is what a test addresses when a label may change.
// An empty id removes the annotation. Safe to call at any time; the next frame
// carries it.
func (s *Session) SetTestID(primitive tview.Primitive, id string) {
	if s == nil {
		return
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.testIDs == nil {
		s.testIDs = map[tview.Primitive]string{}
	}
	if id == "" {
		delete(s.testIDs, primitive)
		return
	}
	s.testIDs[primitive] = id
}

// testIDFor resolves the annotation: the explicit registry first, then the
// resolver supplied to Attach. tview has no native identifier to fall back to.
func (s *Session) testIDFor(primitive tview.Primitive) string {
	s.mu.Lock()
	registered, ok := s.testIDs[primitive]
	s.mu.Unlock()
	if ok {
		return registered
	}
	if s.config.testID != nil {
		return s.config.testID(primitive)
	}
	return ""
}

// Attach publishes app's tree after every committed frame.
//
// It returns (nil, nil) when the process is not instrumented, so the usual
// call site needs no branch. The error is non-nil only when a screen was
// needed and could not be created.
//
// Attach installs an after-draw hook and wraps the screen, so call it before
// SetAfterDrawFunc or SetScreen if you use those yourself.
func Attach(app *tview.Application, root tview.Primitive, options ...Option) (*Session, error) {
	settings := config{markerWriter: os.Stdout, adapterName: AdapterName, version: AdapterVersion}
	for _, option := range options {
		option(&settings)
	}

	client := protocol.FromEnv(protocol.Options{
		AdapterName:    settings.adapterName,
		AdapterVersion: settings.version,
		Capabilities:   settings.capabilities,
	})
	if client == nil {
		return nil, nil // dormant: not instrumented
	}

	if settings.screen == nil {
		screen, err := tcell.NewScreen()
		if err != nil {
			return nil, err
		}
		settings.screen = screen
	}

	session := &Session{
		app:     app,
		root:    root,
		client:  client,
		config:  settings,
		ids:     make(map[tview.Primitive]string),
		testIDs: make(map[tview.Primitive]string),
	}

	app.SetScreen(&commitScreen{Screen: settings.screen, session: session})
	app.SetAfterDrawFunc(session.afterDraw)

	// The handshake must not block the first frame, so it runs off to the side
	// and publishing stays a no-op until it completes. That leaves a gap: tview
	// has usually drawn the first frame by then, and an idle application never
	// draws again, so without a nudge the first tree would only appear once the
	// user pressed a key. Force one redraw as soon as the session is live.
	go func() {
		if err := client.Start(protocol.DialTimeout); err != nil {
			return
		}
		// Blocks until the application's event loop runs this; an Attach whose
		// app is never run parks this goroutine, which costs nothing else.
		app.QueueUpdateDraw(func() {})
	}()

	return session, nil
}

// Client exposes the underlying protocol client (session id, revision,
// negotiated limits). Returns nil for a dormant session.
func (s *Session) Client() *protocol.Client {
	if s == nil {
		return nil
	}
	return s.client
}

// Close ends the semantic session. The application keeps running.
func (s *Session) Close() error {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	s.closed = true
	s.mu.Unlock()
	return s.client.Close()
}

// afterDraw builds and publishes the tree. It runs before the frame is
// flushed, so the marker it produces is held back until commitScreen.Show has
// pushed the bytes out.
func (s *Session) afterDraw(screen tcell.Screen) {
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed || !s.client.Connected() {
		return
	}

	columns, rows := screen.Size()
	if columns <= 0 || rows <= 0 {
		return
	}
	snapshot := s.buildSnapshot(columns, rows)

	marker, err := s.client.Publish(snapshot)
	if err != nil || marker == "" {
		return
	}
	s.mu.Lock()
	s.pending = marker
	s.mu.Unlock()
}

// takePending returns and clears the marker awaiting the flush.
func (s *Session) takePending() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	marker := s.pending
	s.pending = ""
	return marker
}

// commitScreen writes the render-commit marker immediately after the frame it
// commits has been flushed. The marker is a commit signal for the bytes that
// precede it, so emitting it any earlier would let the driver act on a paint
// that has not landed.
type commitScreen struct {
	tcell.Screen
	session *Session
}

func (c *commitScreen) Show() {
	c.Screen.Show()
	c.flushMarker()
}

func (c *commitScreen) Sync() {
	c.Screen.Sync()
	c.flushMarker()
}

func (c *commitScreen) flushMarker() {
	marker := c.session.takePending()
	if marker == "" {
		return
	}
	writer := c.session.config.markerWriter
	if writer == nil {
		return
	}
	_, _ = io.WriteString(writer, marker)
}
