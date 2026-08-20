package tea

import (
	"reflect"
	"testing"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

func TestTermwrightSemanticKeysStabiliseIDsAndResolveRelations(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string)}
	rootID := probe.identity("root")
	control := termwrightCandidate{
		identityKey: "root/old-field/control",
		node: protocol.Node{
			Role:  protocol.RoleTextbox,
			Name:  "framework name",
			Value: protocol.Text("live"),
			State: &protocol.State{Focused: protocol.Bool(true)},
			P:     protocol.ProvenanceFramework,
			PX:    map[string]string{"role": protocol.ProvenanceRecognizer},
		},
		meta: annotate.Semantics{
			Key:         "control",
			Name:        "Server host",
			Actions:     []protocol.Action{protocol.ActionFocus, protocol.ActionSetValue, protocol.ActionFocus, protocol.Action("bad")},
			LabelledBy:  []annotate.SemanticKey{"label"},
			DescribedBy: []annotate.SemanticKey{"help", "missing"},
		},
		annotated: true,
	}
	label := termwrightCandidate{
		identityKey: "root/label",
		node:        protocol.Node{Role: protocol.RoleText, Name: "Host", P: protocol.ProvenanceFramework},
		meta:        annotate.Semantics{Key: "label"}, annotated: true,
	}
	help := termwrightCandidate{
		identityKey: "root/help",
		node:        protocol.Node{Role: protocol.RoleText, Name: "DNS name", P: protocol.ProvenanceFramework},
		meta:        annotate.Semantics{Key: "help"}, annotated: true,
	}

	snapshot := &protocol.Snapshot{RootIDs: []string{rootID}}
	probe.appendCandidates(snapshot, rootID, []termwrightCandidate{control, label, help})
	got := snapshot.Nodes[0]
	if !reflect.DeepEqual(got.LabelledBy, []string{snapshot.Nodes[1].ID}) ||
		!reflect.DeepEqual(got.DescribedBy, []string{snapshot.Nodes[2].ID}) {
		t.Fatalf("key relations did not resolve after both targets: labelled=%v described=%v", got.LabelledBy, got.DescribedBy)
	}
	if !reflect.DeepEqual(got.Actions, []protocol.Action{protocol.ActionFocus, protocol.ActionSetValue}) {
		t.Fatalf("actions were not closed and deduplicated: %v", got.Actions)
	}
	if got.Value == nil || *got.Value != "live" || got.State == nil || got.State.Focused == nil || !*got.State.Focused {
		t.Fatalf("annotation replaced live framework facts: %+v", got)
	}
	for _, field := range []string{"id", "name", "actions", "labelledBy", "describedBy"} {
		if got.PX[field] != protocol.ProvenanceAnnotation {
			t.Fatalf("%s provenance = %q; px=%v", field, got.PX[field], got.PX)
		}
	}
	if got.P != protocol.ProvenanceFramework || got.PX["role"] != protocol.ProvenanceRecognizer {
		t.Fatalf("base provenance was lost: p=%q px=%v", got.P, got.PX)
	}

	// A field-path change would change the fallback identity, but the explicit
	// semantic key must keep the same node id across copied model shapes.
	control.identityKey = "root/renamed-field/control"
	next := &protocol.Snapshot{RootIDs: []string{rootID}}
	probe.appendCandidates(next, rootID, []termwrightCandidate{control, label, help})
	if next.Nodes[0].ID != got.ID {
		t.Fatalf("semantic key did not stabilise id: %q then %q", got.ID, next.Nodes[0].ID)
	}
}

func TestTermwrightDuplicateSemanticKeysStayFrameLocalAndUnresolved(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string)}
	rootID := probe.identity("root")
	candidates := []termwrightCandidate{
		{
			identityKey: "root/control",
			node:        protocol.Node{Role: protocol.RoleButton, Name: "Save", P: protocol.ProvenanceFramework},
			meta:        annotate.Semantics{LabelledBy: []annotate.SemanticKey{"duplicate"}}, annotated: true,
		},
		{
			identityKey: "root/first",
			node:        protocol.Node{Role: protocol.RoleText, Name: "First", P: protocol.ProvenanceFramework},
			meta:        annotate.Semantics{Key: "duplicate"}, annotated: true,
		},
		{
			identityKey: "root/second",
			node:        protocol.Node{Role: protocol.RoleText, Name: "Second", P: protocol.ProvenanceFramework},
			meta:        annotate.Semantics{Key: "duplicate"}, annotated: true,
		},
	}
	snapshot := &protocol.Snapshot{RootIDs: []string{rootID}}
	probe.appendCandidates(snapshot, rootID, candidates)

	if len(snapshot.Nodes[0].LabelledBy) != 0 {
		t.Fatalf("duplicate key resolved arbitrarily: %v", snapshot.Nodes[0].LabelledBy)
	}
	if snapshot.Nodes[1].ID == snapshot.Nodes[2].ID {
		t.Fatalf("duplicate semantic keys produced duplicate ids: %q", snapshot.Nodes[1].ID)
	}
	if _, annotatedID := snapshot.Nodes[1].PX["id"]; annotatedID {
		t.Fatalf("ambiguous semantic key claimed id provenance: %v", snapshot.Nodes[1].PX)
	}
}

func TestTermwrightQualifiedGeometryDoesNotInventComponentLayout(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string)}
	snapshot := termwrightNewSnapshot(80, 24, true)
	rootID := probe.identity("root")
	root := protocol.Node{ID: rootID, Role: protocol.RoleApplication, Name: "app"}
	termwrightCharmGeometry(&root, true, true)
	snapshot.RootIDs = append(snapshot.RootIDs, rootID)
	snapshot.Nodes = append(snapshot.Nodes, root)
	probe.appendCandidates(snapshot, rootID, []termwrightCandidate{{
		identityKey: "root/input",
		node:        protocol.Node{Role: protocol.RoleTextbox, Name: "Host", P: protocol.ProvenanceFramework},
	}})

	if snapshot.V != 2 || snapshot.HitGrid == nil || snapshot.HitGrid.Status != "unsupported" {
		t.Fatalf("snapshot is not honestly qualified: %+v", snapshot)
	}
	if root.Geometry == nil || root.Geometry.Displayed.Status != "known" {
		t.Fatalf("root frame production was not retained: %+v", root.Geometry)
	}
	component := snapshot.Nodes[1]
	if component.Geometry == nil || component.Geometry.Displayed.Status != "unknown" ||
		component.Geometry.IntendedRect.Status != "unsupported" || component.Geometry.VisibleRect.Status != "unsupported" {
		t.Fatalf("component layout was overclaimed: %+v", component.Geometry)
	}
	if component.Bounds != nil || component.Occlusion != "" {
		t.Fatalf("v2 component retained legacy geometry: %+v", component)
	}
}
