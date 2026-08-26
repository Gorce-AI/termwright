package tea

import (
	"reflect"
	"testing"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

type termwrightShortWriter struct{}

func (termwrightShortWriter) Write(value []byte) (int, error) {
	if len(value) == 0 {
		return 0, nil
	}
	return len(value) - 1, nil
}

func TestTermwrightRendererFailureClosesSemanticChannel(t *testing.T) {
	renderer := &cursedRenderer{}
	frame := &termwrightStagedFrame{sequence: 1}
	var code, detail string
	probe := &termwrightProbeState{
		queued: map[*cursedRenderer]*termwrightStagedFrame{renderer: frame},
		fail: func(gotCode, gotDetail string) error {
			code, detail = gotCode, gotDetail
			return nil
		},
	}
	previous := termwrightProbe
	termwrightProbe = probe
	t.Cleanup(func() { termwrightProbe = previous })

	termwrightAfterRendererFlush(renderer, false)

	if probe.queued[renderer] != nil {
		t.Fatal("failed renderer output left staged semantics for a later flush")
	}
	if code != "adapter-guarantee-violation" || detail != "Bubble Tea renderer did not commit the complete terminal frame" {
		t.Fatalf("renderer failure was not terminal: code=%q detail=%q", code, detail)
	}
	if probe.dropped.Load() != 1 {
		t.Fatalf("dropped frames = %d, want 1", probe.dropped.Load())
	}
}

func TestTermwrightShortMarkerWriteClosesSemanticChannel(t *testing.T) {
	var code string
	probe := &termwrightProbeState{fail: func(gotCode, _ string) error {
		code = gotCode
		return nil
	}}
	if probe.writeMarker(termwrightShortWriter{}, "marker") {
		t.Fatal("short marker write reported success")
	}
	if code != "adapter-guarantee-violation" || probe.frames.Load() != 0 || probe.dropped.Load() != 1 {
		t.Fatalf("short write did not fail closed: code=%q frames=%d dropped=%d", code, probe.frames.Load(), probe.dropped.Load())
	}
}

func TestTermwrightSemanticKeysStabiliseIDsAndResolveRelations(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string)}
	rootID := probe.identity("root")
	control := termwrightCandidate{
		identityKey: "root/old-field/control",
		node: protocol.Node{
			Role:  protocol.RoleTextbox,
			Name:  "framework name",
			Value: protocol.PublicValue("live", termwrightEvidence("instrumented")),
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
	if got.Value == nil || got.Value.Status != "known" || got.Value.Value == nil || *got.Value.Value != "live" ||
		got.State == nil || got.State.Focused == nil || !*got.State.Focused {
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

func TestTermwrightDuplicateSemanticKeysFailClosed(t *testing.T) {
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
	duplicate := probe.appendCandidates(snapshot, rootID, candidates)
	if duplicate != "duplicate" {
		t.Fatalf("duplicate semantic key was not rejected: %q", duplicate)
	}
	if len(snapshot.Nodes) != 0 {
		t.Fatalf("partial weakened snapshot escaped before fatal error: %v", snapshot.Nodes)
	}
}

func TestTermwrightGeometryDoesNotInventComponentLayout(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string)}
	snapshot := termwrightNewSnapshot(80, 24)
	rootID := probe.identity("root")
	root := protocol.Node{ID: rootID, Role: protocol.RoleApplication, Name: "app"}
	termwrightCharmGeometry(&root, true)
	snapshot.RootIDs = append(snapshot.RootIDs, rootID)
	snapshot.Nodes = append(snapshot.Nodes, root)
	probe.appendCandidates(snapshot, rootID, []termwrightCandidate{{
		identityKey: "root/input",
		node:        protocol.Node{Role: protocol.RoleTextbox, Name: "Host", P: protocol.ProvenanceFramework},
	}})

	if snapshot.V != 2 || snapshot.HitGrid.Status != "unsupported" {
		t.Fatalf("snapshot does not carry required v2 observations: %+v", snapshot)
	}
	if root.Geometry.Displayed.Status != "known" {
		t.Fatalf("root frame production was not retained: %+v", root.Geometry)
	}
	component := snapshot.Nodes[1]
	if component.Geometry.Displayed.Status != "unsupported" ||
		component.Geometry.IntendedRect.Status != "unsupported" || component.Geometry.VisibleRect.Status != "unsupported" {
		t.Fatalf("component layout was overclaimed: %+v", component.Geometry)
	}
}
