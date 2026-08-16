package annotate

import (
	"reflect"
	"runtime"
	"testing"
)

type widget struct{ label string }

type annotatedModel struct{ state string }

func (m annotatedModel) TermwrightSemantics() Semantics {
	return Semantics{Role: "dialog", Name: "Confirm", Domain: map[string]string{"state": m.state}}
}

func TestAnAnnotationIsFoundByTheObjectItDescribes(t *testing.T) {
	t.Cleanup(Reset)

	button := &widget{label: "OK"}
	other := &widget{label: "OK"}
	Tag(button, Semantics{Role: "button", Name: "Confirm deletion", TestID: "confirm"})

	found, ok := Lookup(button)
	if !ok {
		t.Fatal("the annotated widget was not found")
	}
	if found.Name != "Confirm deletion" || found.TestID != "confirm" {
		t.Fatalf("wrong annotation: %+v", found)
	}

	// Identity, not equality: another widget with identical contents is a
	// different widget, and a registry keyed by value would confuse the two.
	if _, ok := Lookup(other); ok {
		t.Fatal("an identical but distinct widget picked up someone else's annotation")
	}
}

func TestAnEmptyAnnotationRemovesTheEntry(t *testing.T) {
	t.Cleanup(Reset)

	button := &widget{}
	Tag(button, Semantics{Name: "temporary"})
	Tag(button, Semantics{})

	if _, ok := Lookup(button); ok {
		t.Fatal("an empty annotation left an entry behind")
	}
}

func TestTheDomainMapIsCopied(t *testing.T) {
	t.Cleanup(Reset)

	button := &widget{}
	domain := map[string]string{"sync": "pending"}
	Tag(button, Semantics{Name: "row", Domain: domain})

	// The caller keeps using its own map; the annotation must not change.
	domain["sync"] = "done"

	found, _ := Lookup(button)
	if found.Domain["sync"] != "pending" {
		t.Fatalf("the stored annotation followed the caller's map: %v", found.Domain)
	}

	// And mutating what Lookup returned must not corrupt the registry either.
	found.Domain["sync"] = "corrupted"
	again, _ := Lookup(button)
	if again.Domain["sync"] != "pending" {
		t.Fatalf("mutating a lookup result changed the registry: %v", again.Domain)
	}
}

func TestTheRegistryDoesNotRetainWidgets(t *testing.T) {
	// The property that decides whether this library is shippable. A TUI
	// creates and discards widgets for as long as it runs, so a registry that
	// pins them leaks the application's memory for the lifetime of the process
	// — worse than having no annotations at all.
	Reset()
	t.Cleanup(Reset)

	for index := 0; index < 200; index++ {
		Tag(&widget{}, Semantics{Name: "transient"})
	}
	if Count() == 0 {
		t.Fatal("nothing was recorded, so this test proves nothing")
	}

	// Cleanups run after collection, on a goroutine, so give them a chance.
	for attempt := 0; attempt < 20 && Count() > 0; attempt++ {
		runtime.GC()
		runtime.Gosched()
	}

	if remaining := Count(); remaining > 0 {
		t.Fatalf("%d annotations survived their widgets", remaining)
	}
}

func TestALiveWidgetKeepsItsAnnotation(t *testing.T) {
	// The other half: collection must not take annotations that are still in
	// use. Without this, the test above would pass with a registry that simply
	// dropped everything.
	t.Cleanup(Reset)

	kept := &widget{label: "kept"}
	Tag(kept, Semantics{Name: "still here"})

	for attempt := 0; attempt < 5; attempt++ {
		runtime.GC()
	}

	if _, ok := Lookup(kept); !ok {
		t.Fatal("a live widget lost its annotation")
	}
	runtime.KeepAlive(kept)
}

func TestUntagRemovesBeforeCollection(t *testing.T) {
	t.Cleanup(Reset)

	button := &widget{}
	Tag(button, Semantics{Name: "gone soon"})
	Untag(button)

	if _, ok := Lookup(button); ok {
		t.Fatal("Untag left the entry behind")
	}
	runtime.KeepAlive(button)
}

func TestLookupIgnoresNonPointers(t *testing.T) {
	t.Cleanup(Reset)

	if _, ok := Lookup(nil); ok {
		t.Fatal("nil matched something")
	}
	if _, ok := Lookup(42); ok {
		t.Fatal("an int matched something")
	}
	if _, ok := Lookup(widget{}); ok {
		t.Fatal("a value copy matched something")
	}
	var typed *widget
	if _, ok := Lookup(typed); ok {
		t.Fatal("a typed nil matched something")
	}
}

func TestAProviderReportsItsOwnSemantics(t *testing.T) {
	// The Bubble Tea shape: components are values copied on every update, so a
	// registry keyed by address would name a copy that no longer exists. The
	// component answers for itself instead.
	var provider Provider = annotatedModel{state: "confirming"}

	meta := provider.TermwrightSemantics()

	if meta.Role != "dialog" || meta.Domain["state"] != "confirming" {
		t.Fatalf("wrong semantics from the provider: %+v", meta)
	}
}

func TestSemanticsCannotStatePhysicalFacts(t *testing.T) {
	// A structural assertion rather than a behavioural one, and deliberately
	// so: the guarantee is that no author can override what the probe
	// observes, and the way to keep that guarantee is for the fields not to
	// exist. If someone adds Bounds or Focused, this fails and they have to
	// argue for it.
	fields := map[string]bool{}
	for _, name := range []string{"Role", "Name", "TestID", "Description", "Domain"} {
		fields[name] = true
	}

	value := Semantics{}
	kind := reflect.TypeOf(value)
	for index := 0; index < kind.NumField(); index++ {
		name := kind.Field(index).Name
		if !fields[name] {
			t.Fatalf("Semantics gained the field %q; physical facts belong to the probe", name)
		}
	}
	if kind.NumField() != len(fields) {
		t.Fatalf("expected %d fields, found %d", len(fields), kind.NumField())
	}
}
