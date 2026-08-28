package tea

import (
	"bytes"
	"context"
	"io"
	"reflect"
	"runtime"
	"sync"
	"testing"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

type termwrightWalkLeaf struct {
	Value  string
	hidden struct{ Secret string }
}

type termwrightWalkBranch struct {
	Same termwrightWalkLeaf
}

type termwrightWalkDeep struct {
	Next *termwrightWalkDeep
}

type termwrightWalkModel struct {
	Left    termwrightWalkBranch
	Right   termwrightWalkBranch
	Scalar  int
	Deep    *termwrightWalkDeep
	private struct{ Child termwrightWalkLeaf }
}

type termwrightRenderModel struct{ Scalar int }

func (termwrightRenderModel) Init() Cmd                 { return nil }
func (m termwrightRenderModel) Update(Msg) (Model, Cmd) { return m, nil }
func (termwrightRenderModel) View() View                { return View{Content: "CONCURRENT-FRAME"} }

type termwrightRecoveryModel struct{ Text string }

func (termwrightRecoveryModel) Init() Cmd                 { return nil }
func (m termwrightRecoveryModel) Update(Msg) (Model, Cmd) { return m, nil }
func (m termwrightRecoveryModel) View() View              { return View{Content: m.Text} }

type termwrightEventLoopModel struct {
	Text    string
	updates *int
	views   *int
}

func (termwrightEventLoopModel) Init() Cmd { return nil }
func (m termwrightEventLoopModel) Update(Msg) (Model, Cmd) {
	*m.updates++
	return m, nil
}
func (m termwrightEventLoopModel) View() View {
	*m.views++
	return View{Content: m.Text}
}

func TestTermwrightWalkerPreservesStructureAndDeclaresOpaqueGaps(t *testing.T) {
	deep := &termwrightWalkDeep{}
	cursor := deep
	for index := 0; index < 10; index++ {
		cursor.Next = &termwrightWalkDeep{}
		cursor = cursor.Next
	}
	model := termwrightWalkModel{Scalar: 7, Deep: deep}
	probe := &termwrightProbeState{ids: make(map[string]string)}
	candidates := make([]termwrightCandidate, 0)
	probe.walk(reflect.ValueOf(model), "root", "root", "", &candidates, 0)
	rootID := probe.identity("root")
	snapshot := &protocol.Snapshot{
		RootIDs: []string{rootID},
		Nodes:   []protocol.Node{{ID: rootID, Role: protocol.RoleApplication, Name: "app"}},
	}
	if duplicate := probe.appendCandidates(snapshot, rootID, candidates); duplicate != "" {
		t.Fatalf("unexpected duplicate key %q", duplicate)
	}
	byID := make(map[string]protocol.Node, len(snapshot.Nodes))
	for _, node := range snapshot.Nodes {
		if _, exists := byID[node.ID]; exists {
			t.Fatalf("duplicate session identity %q", node.ID)
		}
		byID[node.ID] = node
	}
	var leftID, rightID string
	sameParents := make(map[string]struct{})
	reasons := make(map[string]int)
	for _, node := range snapshot.Nodes {
		switch node.Name {
		case "Left":
			leftID = node.ID
		case "Right":
			rightID = node.ID
		case "Same":
			sameParents[node.ParentID] = struct{}{}
		}
		if reason, ok := node.Extended["opaqueReason"].(string); ok {
			reasons[reason]++
			if !node.OpaqueChildren || node.FrameworkType != "opaque-container" ||
				node.Extended["degradedCapability"] != "custom-container-enumeration" {
				t.Fatalf("opaque node did not declare its degradation: %+v", node)
			}
		}
	}
	if leftID == "" || rightID == "" || leftID == rightID {
		t.Fatalf("nested containers lost identity: left=%q right=%q", leftID, rightID)
	}
	if len(sameParents) != 2 {
		t.Fatalf("duplicate nested field names collapsed parents: %v", sameParents)
	}
	if _, ok := sameParents[leftID]; !ok {
		t.Fatalf("left nested child lost parent: %v", sameParents)
	}
	if _, ok := sameParents[rightID]; !ok {
		t.Fatalf("right nested child lost parent: %v", sameParents)
	}
	for _, reason := range []string{"non-struct", "private-field", "depth-limit"} {
		if reasons[reason] == 0 {
			t.Fatalf("walker silently omitted %s; reasons=%v", reason, reasons)
		}
	}
}

func TestTermwrightConcurrentModelObservationRefusesWithoutWaiting(t *testing.T) {
	probe := &termwrightProbeState{}
	probe.rendering.Store(true)
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})
	writer := &termwrightCapturedWriter{}
	renderer := newCursedRenderer(writer, nil, 80, 24)
	program := &Program{renderer: renderer, width: 80, height: 24}
	done := make(chan struct{})
	go func() {
		termwrightRenderAndObserve(program, termwrightRenderModel{})
		close(done)
	}()
	<-done
	if renderer.view.Content != "CONCURRENT-FRAME" {
		t.Fatalf("refused observation did not preserve visual render: %+v", renderer.view)
	}
	failure := probe.failure.Load()
	if failure == nil || failure.code != "adapter-guarantee-violation" {
		t.Fatalf("overlap did not fail closed: %+v", failure)
	}
	probe.rendering.Store(false)
}

func TestTermwrightFrameStagingContentionFailsClosedWithoutWaiting(t *testing.T) {
	probe := &termwrightProbeState{ids: make(map[string]string), latest: make(map[*cursedRenderer]*termwrightStagedFrame), queued: make(map[*cursedRenderer]*termwrightStagedFrame), published: make(map[*cursedRenderer]uint64)}
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})
	writer := &termwrightCapturedWriter{}
	renderer := newCursedRenderer(writer, nil, 80, 24)
	program := &Program{renderer: renderer, width: 80, height: 24}
	probe.frameMu.Lock()
	done := make(chan struct{})
	go func() {
		termwrightRenderAndObserve(program, termwrightRenderModel{})
		close(done)
	}()
	<-done
	probe.frameMu.Unlock()
	if renderer.view.Content != "CONCURRENT-FRAME" {
		t.Fatalf("contended staging did not preserve visual render: %+v", renderer.view)
	}
	if failure := probe.failure.Load(); failure == nil || failure.code != "adapter-guarantee-violation" {
		t.Fatalf("contended staging did not fail closed: %+v", failure)
	}
}

type termwrightShortWriter struct{}

type termwrightCapturedWriter struct {
	bytes.Buffer
	writes  [][]byte
	onWrite func()
}

func (w *termwrightCapturedWriter) Write(value []byte) (int, error) {
	w.writes = append(w.writes, append([]byte(nil), value...))
	if callback := w.onWrite; callback != nil {
		w.onWrite = nil
		callback()
	}
	return w.Buffer.Write(value)
}

type termwrightBlockingWriter struct {
	bytes.Buffer
	entered chan struct{}
	release chan struct{}
	once    sync.Once
}

func (w *termwrightBlockingWriter) Write(value []byte) (int, error) {
	w.once.Do(func() {
		close(w.entered)
		<-w.release
	})
	return w.Buffer.Write(value)
}

func (termwrightShortWriter) Write(value []byte) (int, error) {
	if len(value) == 0 {
		return 0, nil
	}
	return len(value) - 1, nil
}

func TestTermwrightRendererFailureClosesSemanticChannel(t *testing.T) {
	renderer := &cursedRenderer{}
	frame := &termwrightStagedFrame{sequence: 1}
	probe := &termwrightProbeState{
		queued: map[*cursedRenderer]*termwrightStagedFrame{renderer: frame},
	}
	previous := termwrightProbe
	termwrightProbe = probe
	t.Cleanup(func() { termwrightProbe = previous })

	termwrightAfterRendererFlush(renderer, false)

	if probe.queued[renderer] != nil {
		t.Fatal("failed renderer output left staged semantics for a later flush")
	}
	failure := probe.failure.Load()
	if failure == nil || failure.code != "adapter-guarantee-violation" || failure.message != "Bubble Tea renderer did not commit the complete terminal frame" {
		t.Fatalf("renderer failure was not terminal: %+v", failure)
	}
	if probe.dropped.Load() != 1 {
		t.Fatalf("dropped frames = %d, want 1", probe.dropped.Load())
	}
}

func TestTermwrightShortMarkerWriteClosesSemanticChannel(t *testing.T) {
	probe := &termwrightProbeState{}
	if probe.writeMarker(termwrightShortWriter{}, "marker") {
		t.Fatal("short marker write reported success")
	}
	if failure := probe.failure.Load(); failure == nil || failure.code != "adapter-guarantee-violation" || probe.frames.Load() != 0 || probe.dropped.Load() != 1 {
		t.Fatalf("short write did not fail closed: failure=%+v frames=%d dropped=%d", failure, probe.frames.Load(), probe.dropped.Load())
	}
}

func TestTermwrightDormantRenderLookupIsConstantAndInert(t *testing.T) {
	previousProbe, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = nil
	termwrightProbeMode.Store(termwrightProbeModeDormant)
	t.Cleanup(func() {
		termwrightProbe = previousProbe
		termwrightProbeMode.Store(previousMode)
	})
	before := runtime.NumGoroutine()
	if allocations := testing.AllocsPerRun(1000, func() {
		if termwrightProbeForRender() != nil {
			t.Fatal("dormant render lookup returned a probe")
		}
	}); allocations != 0 {
		t.Fatalf("dormant render lookup allocated %v times per call", allocations)
	}
	if after := runtime.NumGoroutine(); after > before {
		t.Fatalf("dormant render lookup started a goroutine: %d -> %d", before, after)
	}
}

func TestTermwrightRealRendererReentryFailsClosedBeforeLoserOutput(t *testing.T) {
	probe := &termwrightProbeState{}
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})
	writer := &termwrightCapturedWriter{}
	outer, loser := newCursedRenderer(writer, nil, 80, 24), newCursedRenderer(writer, nil, 80, 24)
	outer.view, loser.view = View{Content: "FRAME-A"}, View{Content: "FRAME-B"}
	writer.onWrite = func() { _ = loser.flush(false) }
	if err := outer.flush(false); err != nil {
		t.Fatalf("outer flush failed: %v", err)
	}
	if len(writer.writes) != 1 || !bytes.Contains(writer.writes[0], []byte("FRAME-A")) {
		t.Fatalf("outer renderer did not write exactly one complete frame: %q", writer.writes)
	}
	if bytes.Contains(writer.Bytes(), []byte("FRAME-B")) || loser.lastView != nil {
		t.Fatalf("reentrant loser wrote or committed its pending frame: output=%q last=%+v", writer.Bytes(), loser.lastView)
	}
	if failure := probe.failure.Load(); failure == nil || failure.code != "adapter-guarantee-violation" {
		t.Fatalf("real renderer reentry did not leave a typed fatal: %+v", failure)
	}
	if err := loser.flush(false); err != nil {
		t.Fatalf("pending loser flush failed: %v", err)
	}
	if len(writer.writes) != 2 || !bytes.Contains(writer.writes[1], []byte("FRAME-B")) {
		t.Fatalf("pending loser frame was not retained after the outer commit: %q", writer.writes)
	}
}

func TestTermwrightRealRendererPreservesRapidABA(t *testing.T) {
	beforeGoroutines := runtime.NumGoroutine()
	previousMode := termwrightProbeMode.Load()
	termwrightProbeMode.Store(termwrightProbeModeDormant)
	t.Cleanup(func() { termwrightProbeMode.Store(previousMode) })
	writer := &termwrightCapturedWriter{}
	renderer := newCursedRenderer(writer, nil, 80, 24)
	for _, frame := range []string{"FRAME-A", "FRAME-B", "FRAME-A"} {
		renderer.view = View{Content: frame}
		if err := renderer.flush(false); err != nil {
			t.Fatalf("rapid %s flush failed: %v", frame, err)
		}
	}
	if len(writer.writes) != 3 || !bytes.Contains(writer.writes[0], []byte("FRAME-A")) || !bytes.HasSuffix(writer.writes[1], []byte("B")) || !bytes.HasSuffix(writer.writes[2], []byte("A")) {
		t.Fatalf("rapid A/B/A frames did not reach the captured writer in order: %q", writer.writes)
	}
	measurement := newCursedRenderer(io.Discard, nil, 80, 24)
	toggle := false
	allocations := testing.AllocsPerRun(100, func() {
		toggle = !toggle
		if toggle {
			measurement.view = View{Content: "FRAME-A"}
		} else {
			measurement.view = View{Content: "FRAME-B"}
		}
		if err := measurement.flush(false); err != nil {
			t.Fatalf("measured dormant flush failed: %v", err)
		}
	})
	t.Logf("measured dormant full-renderer flush allocations/run: %.2f", allocations)
	if after := runtime.NumGoroutine(); after > beforeGoroutines {
		t.Fatalf("dormant full renderer changed goroutine count: %d -> %d", beforeGoroutines, after)
	}
}

func TestTermwrightConcurrentRealRenderersNeverInterleave(t *testing.T) {
	probe := &termwrightProbeState{}
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})
	writer := &termwrightBlockingWriter{entered: make(chan struct{}), release: make(chan struct{})}
	outer, loser := newCursedRenderer(writer, nil, 80, 24), newCursedRenderer(writer, nil, 80, 24)
	outer.view, loser.view = View{Content: "FRAME-A"}, View{Content: "FRAME-B"}
	done := make(chan error, 1)
	go func() { done <- outer.flush(false) }()
	<-writer.entered
	if err := loser.flush(false); err != nil {
		t.Fatalf("loser returned an output error: %v", err)
	}
	if loser.lastView != nil || bytes.Contains(writer.Bytes(), []byte("FRAME-B")) {
		t.Fatalf("concurrent loser wrote or committed pending bytes: output=%q last=%+v", writer.Bytes(), loser.lastView)
	}
	close(writer.release)
	if err := <-done; err != nil {
		t.Fatalf("outer flush failed: %v", err)
	}
	if !bytes.Contains(writer.Bytes(), []byte("FRAME-A")) {
		t.Fatalf("outer frame was not completed: %q", writer.Bytes())
	}
	if failure := probe.failure.Load(); failure == nil || failure.code != "adapter-guarantee-violation" {
		t.Fatalf("concurrent renderer did not fail semantics closed: %+v", failure)
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

func TestTermwrightConcurrentRunsDrainOnlyAfterLastOwner(t *testing.T) {
	ready := make(chan struct{})
	close(ready)
	probe := &termwrightProbeState{ready: ready}
	termwrightLifecycleMu.Lock()
	previousProbe, previousRuns := termwrightProbe, termwrightActiveRuns
	termwrightProbe, termwrightActiveRuns = probe, 2
	termwrightLifecycleMu.Unlock()
	t.Cleanup(func() {
		termwrightLifecycleMu.Lock()
		termwrightProbe, termwrightActiveRuns = previousProbe, previousRuns
		termwrightLifecycleMu.Unlock()
	})
	termwrightShutdown(probe)
	if probe.closed.Load() {
		t.Fatal("first of two concurrent Program owners closed the shared publisher")
	}
	termwrightShutdown(probe)
	if !probe.closed.Load() {
		t.Fatal("last Program owner did not close publication admission")
	}
}

func TestTermwrightAdmissionRecoveryCoalescesAndObservesFreshModel(t *testing.T) {
	renderer := newCursedRenderer(io.Discard, nil, 80, 24)
	program := &Program{
		ctx:      context.Background(),
		msgs:     make(chan Msg, 1),
		renderer: renderer,
		width:    80,
		height:   24,
	}
	ready := make(chan struct{})
	probe := &termwrightProbeState{
		ids:          make(map[string]string),
		latest:       make(map[*cursedRenderer]*termwrightStagedFrame),
		queued:       make(map[*cursedRenderer]*termwrightStagedFrame),
		published:    make(map[*cursedRenderer]uint64),
		recoveryStop: make(chan struct{}),
		recovering:   make(map[*cursedRenderer]bool),
	}
	probe.nextFrame.Store(1)
	probe.latest[renderer] = &termwrightStagedFrame{
		sequence: 1,
		program:  program,
		view:     View{Content: "STALE"},
	}
	readinessCalls := 0
	readiness := func() <-chan struct{} {
		readinessCalls++
		return ready
	}

	probe.requestAuthoritativeReplay(renderer, readiness)
	probe.requestAuthoritativeReplay(renderer, readiness)
	if readinessCalls != 1 {
		t.Fatalf("recovery was not coalesced: readiness called %d times", readinessCalls)
	}
	select {
	case msg := <-program.msgs:
		t.Fatalf("recovery escaped before admission became ready: %+v", msg)
	default:
	}

	close(ready)
	recovery := (<-program.msgs).(termwrightRecoveryMsg)
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})
	termwrightRecoverAndObserve(program, termwrightRecoveryModel{Text: "FRESH"}, recovery)
	probe.recoveryWorkers.Wait()

	frame := probe.latest[renderer]
	if frame == nil || frame.sequence <= 1 || frame.view.Content != "FRESH" {
		t.Fatalf("recovery reused the rejected snapshot instead of observing the current model: %+v", frame)
	}
	if renderer.lastView != nil {
		t.Fatalf("recovery did not invalidate the renderer baseline: %+v", renderer.lastView)
	}
}

func TestTermwrightAdmissionRecoveryNeverWaitsForCoalescerOwnership(t *testing.T) {
	renderer := newCursedRenderer(io.Discard, nil, 80, 24)
	probe := &termwrightProbeState{
		recoveryStop: make(chan struct{}),
		recovering:   make(map[*cursedRenderer]bool),
	}
	probe.frameMu.Lock()
	probe.requestAuthoritativeReplay(renderer, func() <-chan struct{} {
		t.Fatal("contended recovery must fail closed before creating a waiter")
		return nil
	})
	probe.frameMu.Unlock()
	if failure := probe.failure.Load(); failure == nil || failure.code != "adapter-guarantee-violation" {
		t.Fatalf("contended recovery did not fail closed without waiting: %+v", failure)
	}
}

func TestTermwrightShutdownCancelsPendingAdmissionRecovery(t *testing.T) {
	renderer := newCursedRenderer(io.Discard, nil, 80, 24)
	ready := make(chan struct{})
	started := make(chan struct{})
	close(started)
	probe := &termwrightProbeState{
		latest:       map[*cursedRenderer]*termwrightStagedFrame{renderer: {sequence: 1}},
		published:    make(map[*cursedRenderer]uint64),
		ready:        started,
		recoveryStop: make(chan struct{}),
		recovering:   make(map[*cursedRenderer]bool),
	}
	probe.requestAuthoritativeReplay(renderer, func() <-chan struct{} { return ready })

	termwrightLifecycleMu.Lock()
	previousProbe, previousRuns := termwrightProbe, termwrightActiveRuns
	termwrightProbe, termwrightActiveRuns = probe, 1
	termwrightLifecycleMu.Unlock()
	t.Cleanup(func() {
		termwrightLifecycleMu.Lock()
		termwrightProbe, termwrightActiveRuns = previousProbe, previousRuns
		termwrightLifecycleMu.Unlock()
	})
	termwrightShutdown(probe)
	if !probe.closed.Load() {
		t.Fatal("shutdown returned without closing pending recovery admission")
	}
	if failure := probe.failure.Load(); failure == nil || failure.code != "semantic-publication-refused" {
		t.Fatalf("shutdown silently discarded an unpublished final semantic frame: %+v", failure)
	}
}

func TestTermwrightPrivateRecoveryUsesTheRealEventLoopWithoutReachingUserCode(t *testing.T) {
	writer := &termwrightCapturedWriter{}
	renderer := newCursedRenderer(writer, nil, 80, 24)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	filters := 0
	program := &Program{
		ctx:      ctx,
		msgs:     make(chan Msg, 2),
		errs:     make(chan error, 1),
		renderer: renderer,
		width:    80,
		height:   24,
		filter: func(_ Model, msg Msg) Msg {
			filters++
			return msg
		},
	}
	probe := &termwrightProbeState{
		ids:        make(map[string]string),
		latest:     make(map[*cursedRenderer]*termwrightStagedFrame),
		queued:     make(map[*cursedRenderer]*termwrightStagedFrame),
		published:  make(map[*cursedRenderer]uint64),
		recovering: map[*cursedRenderer]bool{renderer: true},
	}
	probe.nextFrame.Store(1)
	probe.latest[renderer] = &termwrightStagedFrame{sequence: 1, program: program, view: View{Content: "STALE"}}
	previous, previousMode := termwrightProbe, termwrightProbeMode.Load()
	termwrightProbe = probe
	termwrightProbeMode.Store(termwrightProbeModeActive)
	t.Cleanup(func() {
		termwrightProbe = previous
		termwrightProbeMode.Store(previousMode)
	})

	updates, views := 0, 0
	model := termwrightEventLoopModel{Text: "FRESH", updates: &updates, views: &views}
	program.msgs <- termwrightRecoveryMsg{renderer: renderer}
	program.msgs <- Quit()
	returned, err := program.eventLoop(model, make(chan Cmd))
	if err != nil || returned == nil {
		t.Fatalf("event loop recovery failed: model=%+v err=%v", returned, err)
	}
	if filters != 1 || updates != 0 || views != 1 {
		t.Fatalf("private recovery leaked into user code or rendered more than once: filters=%d updates=%d views=%d", filters, updates, views)
	}
	if err := renderer.flush(false); err != nil {
		t.Fatalf("forced recovery flush failed: %v", err)
	}
	if !bytes.Contains(writer.Bytes(), []byte("FRESH")) {
		t.Fatalf("real renderer did not write the fresh recovery view: %q", writer.Bytes())
	}
}
