package annotate

import (
	"reflect"
	"runtime"
	"testing"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

type widget struct{ label string }

type annotatedModel struct{ state string }

func (m annotatedModel) TermwrightSemantics() Semantics {
	return Semantics{Role: "dialog", Name: "Confirm", Domain: map[string]any{"state": m.state}}
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
	domain := map[string]any{
		"sync":    "pending",
		"rollout": map[string]any{"regions": []string{"eu", "us"}},
	}
	Tag(button, Semantics{Name: "row", Domain: domain})

	// The caller keeps using its own map; the annotation must not change.
	domain["sync"] = "done"
	domain["rollout"].(map[string]any)["regions"].([]string)[0] = "changed"

	found, _ := Lookup(button)
	if found.Domain["sync"] != "pending" {
		t.Fatalf("the stored annotation followed the caller's map: %v", found.Domain)
	}
	regions := found.Domain["rollout"].(map[string]any)["regions"].([]any)
	if regions[0] != "eu" {
		t.Fatalf("the stored annotation followed a nested container: %v", found.Domain)
	}

	// And mutating what Lookup returned must not corrupt the registry either.
	found.Domain["sync"] = "corrupted"
	found.Domain["rollout"].(map[string]any)["regions"].([]any)[0] = "corrupted"
	again, _ := Lookup(button)
	if again.Domain["sync"] != "pending" {
		t.Fatalf("mutating a lookup result changed the registry: %v", again.Domain)
	}
	againRegions := again.Domain["rollout"].(map[string]any)["regions"].([]any)
	if againRegions[0] != "eu" {
		t.Fatalf("mutating a nested lookup result changed the registry: %v", again.Domain)
	}
}

func TestSemanticCollectionsAreCopied(t *testing.T) {
	t.Cleanup(Reset)

	button := &widget{}
	actions := []protocol.Action{protocol.ActionFocus, protocol.ActionActivate}
	labels := []SemanticKey{"primary-label"}
	descriptions := []SemanticKey{"help"}
	Tag(button, Semantics{
		Key:         "submit",
		Actions:     actions,
		LabelledBy:  labels,
		DescribedBy: descriptions,
	})

	actions[0] = protocol.ActionScroll
	labels[0] = "changed"
	descriptions[0] = "changed"

	found, ok := Lookup(button)
	if !ok {
		t.Fatal("the annotation was not found")
	}
	if found.Key != "submit" || !reflect.DeepEqual(found.Actions, []protocol.Action{
		protocol.ActionFocus, protocol.ActionActivate,
	}) || !reflect.DeepEqual(found.LabelledBy, []SemanticKey{"primary-label"}) ||
		!reflect.DeepEqual(found.DescribedBy, []SemanticKey{"help"}) {
		t.Fatalf("stored semantic collections followed their callers: %+v", found)
	}

	found.Actions[0] = protocol.ActionToggle
	found.LabelledBy[0] = "corrupted"
	found.DescribedBy[0] = "corrupted"
	again, _ := Lookup(button)
	if again.Actions[0] != protocol.ActionFocus || again.LabelledBy[0] != "primary-label" ||
		again.DescribedBy[0] != "help" {
		t.Fatalf("mutating Lookup result changed the registry: %+v", again)
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
	for _, name := range []string{
		"Key", "Role", "Name", "TestID", "Description", "Domain", "Actions", "LabelledBy", "DescribedBy",
	} {
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
