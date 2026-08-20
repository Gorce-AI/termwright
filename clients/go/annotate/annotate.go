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

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

// SemanticKey is an author-owned identity used to relate semantic nodes.
//
// It is deliberately framework-neutral. In particular, the annotation SDK
// cannot mention tview.Primitive without making every Go application depend on
// tview (and creating the wrong dependency direction for the injected probe).
// Keys also avoid retaining related widgets merely because another widget
// points at them. A probe resolves keys only among nodes present in the same
// snapshot; missing or duplicate keys are ignored rather than producing a
// dangling wire reference.
type SemanticKey string

// Semantics is what an author knows and a probe cannot see.
//
// Every field is optional. Supplying only a `TestID`, or only a `Role`, is
// normal: the probe fills in everything it can observe, and this is merged on
// top of it for the facts it cannot.
type Semantics struct {
	// Key gives this semantic element an author-owned identity. Immediate-mode
	// frameworks may use a unique key to keep the node id stable across copied
	// model values; retained frameworks use it as a relation target.
	Key SemanticKey

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

	// Domain carries JSON application state a probe has no portable vocabulary
	// for: "sync": "pending", "retryCount": 2, "overdue": true. It is
	// reported under the semantic node's separate `extended` namespace and is
	// never promoted to a framework state flag.
	Domain map[string]any

	// Actions are descriptive input capabilities from the protocol's closed
	// set. They never install or invoke a callback; input still travels through
	// the terminal like it does without instrumentation.
	Actions []protocol.Action

	// LabelledBy and DescribedBy refer to other annotated nodes by SemanticKey.
	// Resolution happens after the complete tree is observed, so declaration
	// order does not matter and a missing target cannot invalidate a snapshot.
	LabelledBy  []SemanticKey
	DescribedBy []SemanticKey
}

// clone returns a deep copy that later mutation of the caller's JSON
// containers cannot change.
func (s Semantics) clone() Semantics {
	if s.Domain != nil {
		domain := make(map[string]any, len(s.Domain))
		for key, value := range s.Domain {
			domain[key] = cloneDomainValue(value)
		}
		s.Domain = domain
	}
	if s.Actions != nil {
		s.Actions = append([]protocol.Action(nil), s.Actions...)
	}
	if s.LabelledBy != nil {
		s.LabelledBy = append([]SemanticKey(nil), s.LabelledBy...)
	}
	if s.DescribedBy != nil {
		s.DescribedBy = append([]SemanticKey(nil), s.DescribedBy...)
	}
	return s
}

func cloneDomainValue(value any) any {
	if value == nil {
		return nil
	}
	reflected := reflect.ValueOf(value)
	switch reflected.Kind() {
	case reflect.Map:
		if reflected.Type().Key().Kind() != reflect.String {
			return value
		}
		copy := make(map[string]any, reflected.Len())
		iterator := reflected.MapRange()
		for iterator.Next() {
			copy[iterator.Key().String()] = cloneDomainValue(iterator.Value().Interface())
		}
		return copy
	case reflect.Array, reflect.Slice:
		copy := make([]any, reflected.Len())
		for index := range reflected.Len() {
			copy[index] = cloneDomainValue(reflected.Index(index).Interface())
		}
		return copy
	default:
		return value
	}
}

// IsZero reports whether an annotation says anything at all.
func (s Semantics) IsZero() bool {
	return s.Key == "" && s.Role == "" && s.Name == "" && s.TestID == "" &&
		s.Description == "" && len(s.Domain) == 0 && len(s.Actions) == 0 &&
		len(s.LabelledBy) == 0 && len(s.DescribedBy) == 0
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
