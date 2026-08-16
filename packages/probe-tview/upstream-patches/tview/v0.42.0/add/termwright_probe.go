package tview

// Build-time instrumentation injected by termwright into a private copy of
// tview. Upstream never sees this file; it exists only in the copy a
// termwright-driven build compiles against.
//
// Being inside the package is the whole point: the semantic state a test wants
// — a button's label, a list's selection, a page's visibility — lives in
// unexported fields that no external adapter can read without reflection.
//
// Two rules from the Phase 0 audit (docs/architecture/audit/tview.md §1–2) are
// load-bearing here, and breaking either turns a working application into a
// hang:
//
//  1. The hook runs inside Application.draw(), which holds the application's
//     write lock for the whole frame. Anything that waits on the event loop —
//     QueueUpdate, QueueUpdateDraw, Draw, SetFocus, Stop — deadlocks, because
//     the loop is the goroutine currently inside draw(). Publication is
//     therefore a non-blocking send and nothing else.
//  2. Reading primitive state from here is safe, and only from here (or from
//     an input handler): every other goroutine racing GetRect is a data race
//     against the layout the parents assign during the draw.

import (
	"os"
	"sync/atomic"

	"github.com/gdamore/tcell/v2"
)

// frameEvent is one observation, handed to the publisher goroutine.
//
// Deliberately a value, not a pointer into the widget tree: the moment the
// hook returns, the application is free to mutate everything it just showed us.
type frameEvent struct {
	frame   uint64
	columns int
	rows    int
	objects int
}

// termwrightProbeState is nil for an uninstrumented run, which is every run
// that does not carry the handshake variables.
type termwrightProbeState struct {
	frames  atomic.Uint64
	events  chan frameEvent
	dropped atomic.Uint64
	debug   bool
}

var termwrightProbe = newTermwrightProbe()

// newTermwrightProbe honours the dormant rule: without an endpoint and a token
// the copy behaves exactly like upstream — no channel, no goroutine, no
// allocation beyond this nil.
func newTermwrightProbe() *termwrightProbeState {
	if os.Getenv("TERMWRIGHT_ENDPOINT") == "" || os.Getenv("TERMWRIGHT_TOKEN") == "" {
		return nil
	}
	p := &termwrightProbeState{
		// Bounded on purpose. A slow consumer must cost frames, never the
		// application's frame rate; the drop count is what later obliges the
		// producer to send a full snapshot rather than the next delta.
		events: make(chan frameEvent, 64),
		debug:  os.Getenv("TERMWRIGHT_DEBUG") != "",
	}
	go p.run()
	return p
}

// termwrightAfterFrame is called from draw(), after screen.Show() has flushed
// the frame's bytes.
//
// The position matters: the render-commit marker must follow the bytes it
// describes, and afterDraw — the hook an out-of-package adapter has to use —
// runs *before* the flush. That one-statement difference is the reason this
// copy exists rather than a SetAfterDrawFunc.
func termwrightAfterFrame(a *Application, screen tcell.Screen) {
	p := termwrightProbe
	if p == nil || screen == nil {
		return
	}

	columns, rows := screen.Size()
	frame := p.frames.Add(1)

	event := frameEvent{
		frame:   frame,
		columns: columns,
		rows:    rows,
		objects: termwrightCountObjects(a.root),
	}

	select {
	case p.events <- event:
	default:
		// The application keeps its frame rate; the consumer loses this one.
		p.dropped.Add(1)
	}
}

// termwrightCountObjects walks what the tree exposes today.
//
// A placeholder for the full walk, kept honest: it counts only what it can
// actually reach, so a number that looks wrong is a missing container rather
// than an invented one.
func termwrightCountObjects(root Primitive) int {
	if root == nil {
		return 0
	}
	count := 1
	for _, child := range termwrightChildren(root) {
		count += termwrightCountObjects(child)
	}
	return count
}

// termwrightChildren enumerates a container's children from inside the package.
//
// Grid is the case that proves the approach: its `items` field is unexported
// and it ships no accessor, so an out-of-package adapter cannot walk a Grid at
// all and has to be handed a callback. Here it is three lines.
func termwrightChildren(p Primitive) []Primitive {
	switch c := p.(type) {
	case *Flex:
		children := make([]Primitive, 0, len(c.items))
		for _, item := range c.items {
			if item.Item != nil {
				children = append(children, item.Item)
			}
		}
		return children
	case *Grid:
		children := make([]Primitive, 0, len(c.items))
		for _, item := range c.items {
			if item.Item != nil {
				children = append(children, item.Item)
			}
		}
		return children
	case *Pages:
		children := make([]Primitive, 0, len(c.pages))
		for _, page := range c.pages {
			if page.Item != nil {
				children = append(children, page.Item)
			}
		}
		return children
	case *Frame:
		if c.primitive != nil {
			return []Primitive{c.primitive}
		}
	case *Form:
		children := make([]Primitive, 0, len(c.items)+len(c.buttons))
		for _, item := range c.items {
			children = append(children, item)
		}
		for _, button := range c.buttons {
			children = append(children, button)
		}
		return children
	case *Modal:
		if c.frame != nil {
			return []Primitive{c.frame}
		}
	}
	return nil
}

// run drains observations away from the draw path.
func (p *termwrightProbeState) run() {
	for event := range p.events {
		if p.debug {
			// Until the transport lands, stderr is the only consumer. It is
			// also how the end-to-end test proves the seam fires per frame.
			os.Stderr.WriteString(termwrightFormatFrame(event, p.dropped.Load()))
		}
	}
}

// termwrightFormatFrame renders one line; kept separate so a test can assert
// on it without a running application.
func termwrightFormatFrame(event frameEvent, dropped uint64) string {
	return "termwright: frame=" + itoa(int(event.frame)) +
		" size=" + itoa(event.columns) + "x" + itoa(event.rows) +
		" objects=" + itoa(event.objects) +
		" dropped=" + itoa(int(dropped)) + "\n"
}

// itoa avoids pulling strconv into the copy for one call site, which would
// widen the patch for no benefit.
func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	negative := value < 0
	if negative {
		value = -value
	}
	var buffer [20]byte
	position := len(buffer)
	for value > 0 {
		position--
		buffer[position] = byte('0' + value%10)
		value /= 10
	}
	if negative {
		position--
		buffer[position] = '-'
	}
	return string(buffer[position:])
}
