// Package annotate lets an application tell termwright what its widgets mean.
//
// A probe observes facts: this is a button, it holds this text, it has the
// focus, it was drawn here. What a probe cannot know is intent — that this
// button is the "Confirm deletion" one, that this list is the inbox, that a
// row is in the "overdue" state your domain cares about. Those are the things
// an author supplies here.
//
// Three rules shape the API, and each is a refusal rather than a feature:
//
//  1. **Annotations add what the probe cannot observe, never override what it
//     can.** There is deliberately no way to state bounds, focus or rendered
//     text. An author may name a thing; an author may not declare where it is
//     on screen, because the screen is the authority on that and a stale
//     annotation would turn a passing test into a lie.
//  2. **Nothing reaches the terminal.** Annotations travel on the semantic
//     side-channel only. An instrumented run and an uninstrumented one paint
//     the same bytes, and adding an annotation cannot change that.
//  3. **Dormant by default.** Without a driver attached the calls here are a
//     map write and nothing else — no socket, no output, no behaviour change.
//     Shipping annotations in production costs one import.
package annotate

import (
	"reflect"
	"runtime"
	"sync"
	"unsafe"
)

// Semantics is what an author knows and a probe cannot see.
//
// Every field is optional. Supplying only a `TestID`, or only a `Role`, is
// normal: the probe fills in everything it can observe, and this is merged on
// top of it for the facts it cannot.
type Semantics struct {
	// Role overrides the role a probe inferred from the widget type. Use it
	// when the framework's type is not what the widget means — a Box used as a
	// dialog, a TextView used as a status line.
	Role string

	// Name is the accessible name. It wins over text scraped from the widget,
	// which is often decorated for layout.
	Name string

	// TestID is a stable handle that survives copy edits. A test written
	// against it does not break when someone rewords a label.
	TestID string

	// Description is longer context, surfaced in failure diagnostics rather
	// than used for matching.
	Description string

	// Domain carries application-specific state a probe has no vocabulary for:
	// "sync": "pending", "severity": "warning". Keys and values are free-form
	// strings, reported verbatim and never interpreted.
	Domain map[string]string
}

// clone returns a copy that later mutation of the caller's map cannot change.
func (s Semantics) clone() Semantics {
	if s.Domain == nil {
		return s
	}
	domain := make(map[string]string, len(s.Domain))
	for key, value := range s.Domain {
		domain[key] = value
	}
	s.Domain = domain
	return s
}

// IsZero reports whether an annotation says anything at all.
func (s Semantics) IsZero() bool {
	return s.Role == "" && s.Name == "" && s.TestID == "" && s.Description == "" && len(s.Domain) == 0
}

// Provider is the second way to annotate, and the idiomatic one for frameworks
// with no stable widget identity.
//
// A model or component implements it and returns its own semantics; the probe
// asks. Nothing is registered, nothing has to be released, and the compiler
// checks the wiring — which is what makes it the right shape for Bubble Tea,
// where components are values that get copied on every update and a registry
// keyed by address would be meaningless.
type Provider interface {
	TermwrightSemantics() Semantics
}

// registry maps a widget's address to what its author said about it.
//
// Nothing here retains the widget. A long-running TUI creates and discards
// widgets for as long as it runs, and an instrumentation library that pins
// every one of them forever is worse than no instrumentation. The entry is
// removed by a cleanup attached to the object itself, which also closes the
// address-reuse hole: the slot is freed before the allocator can hand that
// address to something else.
var registry sync.Map // map[uintptr]Semantics

// Tag records what `object` means.
//
// Generic over a pointer on purpose: the compiler then rejects `Tag(myStruct,
// …)` at the call site rather than leaving a silently useless annotation
// keyed by a copy.
//
// Calling Tag twice for the same object replaces the annotation; calling it
// with an empty Semantics is the same as Untag.
func Tag[T any](object *T, meta Semantics) {
	if object == nil {
		return
	}
	address := uintptr(unsafe.Pointer(object))
	if meta.IsZero() {
		registry.Delete(address)
		return
	}
	registry.Store(address, meta.clone())
	// Freed when the widget is, so neither the map nor the application grows.
	runtime.AddCleanup(object, func(key uintptr) { registry.Delete(key) }, address)
}

// Untag forgets an object, for an application that wants the entry gone before
// the garbage collector gets to it.
func Untag[T any](object *T) {
	if object == nil {
		return
	}
	registry.Delete(uintptr(unsafe.Pointer(object)))
}

// Lookup returns what an author said about `object`.
//
// Takes `any` rather than a typed pointer because its caller is a probe
// holding a framework interface — a `tview.Primitive`, say — and not the
// concrete type. A non-pointer argument simply finds nothing.
func Lookup(object any) (Semantics, bool) {
	if object == nil {
		return Semantics{}, false
	}
	value := reflect.ValueOf(object)
	switch value.Kind() {
	case reflect.Pointer, reflect.UnsafePointer:
	default:
		return Semantics{}, false
	}
	if value.IsNil() {
		return Semantics{}, false
	}
	stored, ok := registry.Load(value.Pointer())
	if !ok {
		return Semantics{}, false
	}
	return stored.(Semantics).clone(), true
}

// Count reports how many annotations are live, for tests and diagnostics.
func Count() int {
	total := 0
	registry.Range(func(_, _ any) bool {
		total++
		return true
	})
	return total
}

// Reset drops every annotation. For tests; an application has no reason to.
func Reset() {
	registry.Range(func(key, _ any) bool {
		registry.Delete(key)
		return true
	})
}
