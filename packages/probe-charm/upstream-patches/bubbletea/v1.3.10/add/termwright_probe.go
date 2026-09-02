package tea

// Build-time instrumentation injected by termwright into a private copy of
// Bubble Tea v1. Upstream never sees this file.
//
// Charm is shaped nothing like tview, and the difference decides everything
// here. There is no widget tree to walk: the application's state is a struct
// the *user* defined, and the components inside it belong to a different
// module (`charm.land/bubbles/v2`). Being inside `tea` therefore buys the
// frame hook and nothing else — a Bubbles component's unexported fields are as
// far away from here as they are from an external adapter.
//
// So this probe reflects over the user's model, recognises Bubbles components
// by type, and reads them through their **public getters**: `Value()`,
// `Focused()`, `Title()`, `SelectedRow()`. That covers role, name, value and
// focus, which is most of what a test addresses. What it cannot reach — a
// spinner's frame index, a filepicker's selection, a textinput's horizontal
// offset — has no getter at all, and reaching it needs a second patch set
// against Bubbles itself. That is a separate decision, not an oversight.
//
// Geometry is absent on purpose. The frame is one styled string by the time it
// reaches the renderer, and Lip Gloss has already destroyed the mapping from
// fragment to screen region (see docs/architecture/audit/charm.md §3). v2 has
// two channels that could restore it — the layer compositor and per-cell OSC 8
// parameters — and until one is wired the probe reports component and value
// without a position rather than inventing coordinates.

import (
	"errors"
	"io"
	"reflect"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"

	"github.com/gorce-ai/termwright/clients/go/annotate"
	"github.com/gorce-ai/termwright/clients/go/evidence"
	"github.com/gorce-ai/termwright/clients/go/protocol"
)

const (
	probeName        = "termwright-probe-charm"
	probeVersion     = "0.4.0"
	frameworkVersion = "v1.3.10"
)

const (
	termwrightProbeModeUnknown uint32 = iota
	termwrightProbeModeDormant
	termwrightProbeModeActive
)

type termwrightProbeState struct {
	client      *protocol.Client
	publisher   atomic.Pointer[protocol.PublicationQueue]
	publication atomic.Pointer[termwrightPublication]

	ids               map[string]string
	nextID            int
	rendering         atomic.Bool
	nextFrame         atomic.Uint64
	renderers         sync.Map
	ready             chan struct{}
	shutdown          sync.Once
	recoveryStopOnce  sync.Once
	recoveryAdmission sync.RWMutex
	recoveryWorkers   sync.WaitGroup
	recoveryStop      chan struct{}
	closed            atomic.Bool
	frames            atomic.Uint64
	dropped           atomic.Uint64
	failed            atomic.Bool
	failure           atomic.Pointer[termwrightFailure]
}

type termwrightFailure struct {
	code    string
	message string
}

type termwrightPublication struct {
	try            func(*protocol.Snapshot) (string, error)
	readyAfterDrop func() <-chan struct{}
	readyAfterBusy func() <-chan struct{}
}

type termwrightStagedFrame struct {
	sequence uint64
	program  *Program
	view     string
	snapshot *protocol.Snapshot
}

// termwrightRendererState isolates admission and recovery bookkeeping per
// renderer. The flush hook already owns standardRenderer.mu; it must never
// contend with an unrelated renderer or a recovery worker after terminal
// output has been committed.
type termwrightRendererState struct {
	latest     atomic.Pointer[termwrightStagedFrame]
	queued     atomic.Pointer[termwrightStagedFrame]
	published  atomic.Uint64
	recovering atomic.Bool
}

type termwrightRecoveryMsg struct {
	renderer *standardRenderer
}

var (
	termwrightLifecycleMu        sync.Mutex
	termwrightProbeMode          atomic.Uint32
	termwrightOutputCommitActive atomic.Bool
	termwrightActiveRuns         int
	termwrightProbe              *termwrightProbeState
)

// termwrightProbeForRender is the complete dormant render-path check. Once
// Program.Run has found no configured probe, every later frame is one atomic
// load: no environment reads, allocation, lifecycle lock, goroutine or socket.
func termwrightProbeForRender() *termwrightProbeState {
	if termwrightProbeMode.Load() != termwrightProbeModeActive {
		return nil
	}
	return termwrightProbe
}

func newTermwrightProbe() *termwrightProbeState {
	client := protocol.FromEnv(protocol.Options{
		AdapterName:    probeName,
		AdapterVersion: probeVersion,
		Probe: &protocol.ProbeInfo{
			Framework:        "charm",
			FrameworkVersion: frameworkVersion,
			ProbeVersion:     probeVersion,
			// Bubble Tea copies application models through Update; a synthetic
			// field path is useful inside one frame but is not object identity.
			IdentityKind: protocol.ProbeIdentityFrameLocal,
			Capabilities: []protocol.ProbeCapability{
				protocol.ProbeCapAnnotations,
			},
			Instrumentation: &protocol.ProbeInstrumentation{
				HighestTier:   protocol.ProbeTierT3,
				SemanticClass: protocol.ProbeSemanticClassB,
				DegradedCapabilities: []protocol.SessionCapabilityID{
					"intended-geometry", "clipped-geometry", "custom-container-enumeration",
				},
			},
		},
		// Charm publishes a tree, observable component state, descriptive action
		// hints and a marker for each accepted revision. Actions still execute
		// through terminal input; annotations never install callbacks.
		Capabilities: []protocol.Capability{
			protocol.CapTree,
			protocol.CapStates,
			protocol.CapFocusState,
			protocol.CapActions,
			protocol.CapRenderRevisions,
		},
		// Socket deadlines are worker watchdogs only. The renderer flush hook
		// performs bounded non-blocking admission and no socket I/O.
		WriteTimeout:      protocol.DefaultWriteTimeout,
		EvidenceProviders: evidence.DefaultRegistry(),
	})
	if client == nil {
		return nil
	}
	p := &termwrightProbeState{
		client:       client,
		ids:          make(map[string]string),
		ready:        make(chan struct{}),
		recoveryStop: make(chan struct{}),
	}
	go func() {
		defer close(p.ready)
		if client.Start(protocol.DialTimeout) != nil {
			return
		}
		publisher, err := protocol.NewPublicationQueue(client, 2)
		if err != nil {
			return
		}
		p.publisher.Store(publisher)
		p.publication.Store(&termwrightPublication{
			try:            publisher.TryPublish,
			readyAfterDrop: publisher.ReadyAfterDrop,
			readyAfterBusy: publisher.ReadyAfterBusy,
		})
		if p.failed.Load() {
			p.flushSemanticFailure()
			return
		}
		p.replayLatestFrames()
	}()
	return p
}

func (p *termwrightProbeState) rendererState(renderer *standardRenderer) *termwrightRendererState {
	if renderer == nil {
		return nil
	}
	if state, ok := p.renderers.Load(renderer); ok {
		return state.(*termwrightRendererState)
	}
	state := &termwrightRendererState{}
	actual, _ := p.renderers.LoadOrStore(renderer, state)
	return actual.(*termwrightRendererState)
}

func (p *termwrightProbeState) publish(renderer *standardRenderer, writer io.Writer, frame *termwrightStagedFrame) bool {
	if p.failed.Load() {
		return false
	}
	publication := p.publication.Load()
	if publication == nil {
		return false
	}
	marker, err := publication.try(frame.snapshot)
	if err != nil || marker == "" {
		p.dropped.Add(1)
		if errors.Is(err, protocol.ErrPublicationQueueFull) {
			p.requestAuthoritativeReplay(renderer, publication.readyAfterDrop)
			return false
		}
		if errors.Is(err, protocol.ErrPublicationQueueBusy) {
			p.requestAuthoritativeReplay(renderer, publication.readyAfterBusy)
			return false
		}
		message := "Bubble Tea rendered a frame that semantic publication did not admit"
		if err != nil {
			message += ": " + err.Error()
		}
		p.failSemantic("semantic-publication-refused", message)
		return false
	}
	return p.writeMarker(writer, marker)
}

// requestAuthoritativeReplay turns a transient non-blocking admission refusal
// into a fresh framework-owned render. The rejected snapshot receives neither
// a revision nor a marker. Once admission can make progress, a private message
// re-enters Bubble Tea's event loop, where the current model is observed again
// before the renderer baseline is invalidated and flushed with a new marker.
func (p *termwrightProbeState) requestAuthoritativeReplay(renderer *standardRenderer, readiness func() <-chan struct{}) {
	if renderer == nil || readiness == nil || p.recoveryStop == nil {
		return
	}
	// Add must complete while shutdown is excluded from reaching Wait. TryRLock
	// keeps this renderer callback non-blocking; a pending shutdown owns the
	// final unpublished-frame diagnostic instead of admitting another worker.
	if !p.recoveryAdmission.TryRLock() {
		return
	}
	defer p.recoveryAdmission.RUnlock()
	state := p.rendererState(renderer)
	if p.closed.Load() || !state.recovering.CompareAndSwap(false, true) {
		return
	}
	p.recoveryWorkers.Add(1)
	ready := readiness()

	go func() {
		defer p.recoveryWorkers.Done()
		select {
		case <-ready:
		case <-p.recoveryStop:
			state.recovering.Store(false)
			return
		}

		frame := state.latest.Load()
		if !p.closed.Load() && frame != nil && frame.program != nil {
			frame.program.Send(termwrightRecoveryMsg{renderer: renderer})
		} else {
			state.recovering.Store(false)
		}
	}()
}

func (p *termwrightProbeState) beginRecoveryRender(renderer *standardRenderer) bool {
	state := p.rendererState(renderer)
	state.recovering.Store(false)
	frame := state.latest.Load()
	return !p.closed.Load() && frame != nil && frame.sequence > state.published.Load()
}

// termwrightTryBeginOutputCommit makes FRAME -> MARKER atomic without ever
// waiting in a renderer. Contention means two renderer outputs could otherwise
// interleave on one PTY, so the losing flush is deferred and semantics fail
// closed. Its renderer retains the pending view and can paint it on a later
// tick; guessing a marker across the overlap would be worse than no tree.
type termwrightOutputCommitGuard struct {
	proceed  bool
	admitted bool
}

func termwrightTryBeginOutputCommit() termwrightOutputCommitGuard {
	p := termwrightProbeForRender()
	if p == nil || p.closed.Load() {
		return termwrightOutputCommitGuard{proceed: true}
	}
	if termwrightOutputCommitActive.CompareAndSwap(false, true) {
		return termwrightOutputCommitGuard{proceed: true, admitted: true}
	}
	p.requestSemanticFailure(
		"adapter-guarantee-violation",
		"Bubble Tea semantic probe unavailable: concurrent renderer flushes cannot preserve one causal frame-to-marker order",
	)
	return termwrightOutputCommitGuard{}
}

func (guard termwrightOutputCommitGuard) end() {
	if !guard.admitted {
		return
	}
	p := termwrightProbe
	if p != nil {
		p.flushSemanticFailure()
	}
	termwrightOutputCommitActive.Store(false)
}

func (p *termwrightProbeState) writeMarker(writer io.Writer, marker string) bool {
	written, writeErr := termwrightWriteMarker(writer, marker)
	if writeErr != nil || written != len(marker) {
		p.failOutput("Bubble Tea renderer output did not accept the complete revision marker")
		return false
	}
	p.frames.Add(1)
	return true
}

func (p *termwrightProbeState) failOutput(message string) {
	p.failSemantic("adapter-guarantee-violation", message)
	p.dropped.Add(1)
}

func (p *termwrightProbeState) failSemantic(code, message string) {
	p.requestSemanticFailure(code, message)
}

func (p *termwrightProbeState) requestSemanticFailure(code, message string) {
	first := p.failure.CompareAndSwap(nil, &termwrightFailure{code: code, message: message})
	p.failed.Store(true)
	if first {
		go p.flushSemanticFailure()
	}
}

func (p *termwrightProbeState) flushSemanticFailure() {
	failure := p.failure.Load()
	if failure == nil {
		return
	}
	if publisher := p.publisher.Load(); publisher != nil {
		publisher.Fail(failure.code, failure.message)
	}
}

func termwrightShutdown(p *termwrightProbeState) {
	if p == nil {
		return
	}
	termwrightLifecycleMu.Lock()
	if termwrightActiveRuns > 0 {
		termwrightActiveRuns--
	}
	last := termwrightActiveRuns == 0
	if last {
		p.recoveryAdmission.Lock()
		p.closed.Store(true)
		p.recoveryAdmission.Unlock()
	}
	termwrightLifecycleMu.Unlock()
	if !last {
		return
	}
	p.shutdown.Do(func() {
		// Revoke render-path admission before stopping the queue. The wrapper
		// owns bound queue methods and must not outlive the publisher itself.
		p.publication.Swap(nil)
		if p.recoveryStop != nil {
			p.recoveryStopOnce.Do(func() { close(p.recoveryStop) })
		}
		p.recoveryWorkers.Wait()
		<-p.ready
		pending := false
		p.renderers.Range(func(_, value any) bool {
			state := value.(*termwrightRendererState)
			frame := state.latest.Load()
			if frame != nil && frame.sequence > state.published.Load() {
				pending = true
				return false
			}
			return true
		})
		if pending && p.failure.Load() == nil {
			failure := &termwrightFailure{
				code:    "semantic-publication-refused",
				message: "Bubble Tea stopped with an authoritative semantic frame still awaiting causal publication",
			}
			if p.failure.CompareAndSwap(nil, failure) {
				p.failed.Store(true)
			}
		}
		if publisher := p.publisher.Swap(nil); publisher != nil {
			if failure := p.failure.Load(); failure != nil {
				publisher.Fail(failure.code, failure.message)
			}
			publisher.Shutdown()
		} else if p.client != nil {
			if failure := p.failure.Load(); failure != nil {
				_ = p.client.Fail(failure.code, failure.message)
			} else {
				_ = p.client.Close()
			}
		}
	})
}

func termwrightBeforeRun() *termwrightProbeState {
	if termwrightProbeMode.Load() == termwrightProbeModeDormant {
		return nil
	}
	termwrightLifecycleMu.Lock()
	p := termwrightProbe
	if p == nil || p.closed.Load() {
		p = newTermwrightProbe()
		termwrightProbe = p
	}
	if p == nil {
		termwrightProbeMode.Store(termwrightProbeModeDormant)
		termwrightLifecycleMu.Unlock()
		return nil
	}
	termwrightProbeMode.Store(termwrightProbeModeActive)
	termwrightActiveRuns++
	termwrightLifecycleMu.Unlock()
	<-p.ready
	return p
}

// termwrightAfterRendererFlush is injected into standardRenderer.flush while
// that renderer still owns r.mtx. It is the only publication boundary: the
// semantic revision and marker cannot overtake the bytes they describe.
func termwrightAfterRendererFlush(r *standardRenderer, outputOK bool) {
	p := termwrightProbe
	if p == nil {
		return
	}
	state := p.rendererState(r)
	frame := state.queued.Swap(nil)
	if frame == nil {
		return
	}
	if !outputOK {
		p.failOutput("Bubble Tea renderer did not commit the complete terminal frame")
		return
	}
	if p.publish(r, r.out, frame) {
		state.published.Store(frame.sequence)
	}
}

func (p *termwrightProbeState) queueFrame(r *standardRenderer, frame *termwrightStagedFrame, force bool) {
	r.mtx.Lock()
	r.buf.Reset()
	view := frame.view
	if view == "" {
		view = " "
	}
	_, _ = r.buf.WriteString(view)
	if force {
		r.lastRender = ""
		r.lastRenderedLines = nil
	}
	state := p.rendererState(r)
	state.latest.Store(frame)
	state.queued.Store(frame)
	r.mtx.Unlock()
}

// replayLatestFrames closes the first-frame handshake race without publishing
// stale pending semantics. A successful handshake re-enters the ordinary
// renderer queue; its next real flush owns both the bytes and the marker.
func (p *termwrightProbeState) replayLatestFrames() {
	if !p.rendering.CompareAndSwap(false, true) {
		p.requestSemanticFailure("adapter-guarantee-violation", "Bubble Tea semantic probe unavailable: handshake replay overlapped model observation")
		return
	}
	defer p.rendering.Store(false)
	renderers := make([]*standardRenderer, 0)
	p.renderers.Range(func(key, _ any) bool {
		renderers = append(renderers, key.(*standardRenderer))
		return true
	})
	for _, renderer := range renderers {
		// flush owns the same mutex. Re-read publication state only after any
		// in-flight flush has completed, then reserve and queue under that one
		// renderer boundary so the handshake can never replay a committed frame.
		renderer.mtx.Lock()
		state := p.rendererState(renderer)
		frame := state.latest.Load()
		shouldQueue := frame != nil && frame.sequence > state.published.Load()
		if shouldQueue {
			state.queued.Store(frame)
		}
		if shouldQueue {
			renderer.buf.Reset()
			view := frame.view
			if view == "" {
				view = " "
			}
			_, _ = renderer.buf.WriteString(view)
		}
		renderer.mtx.Unlock()
	}
}

// snapshot reflects over the user's model and reports what it recognises.
func (p *termwrightProbeState) snapshot(model Model, view string, columns, rows int) (*protocol.Snapshot, annotate.SemanticKey) {
	snapshot := termwrightNewSnapshot(columns, rows)

	rootID := p.identity("root")
	snapshot.RootIDs = append(snapshot.RootIDs, rootID)
	root := protocol.Node{
		ID:            rootID,
		Role:          protocol.RoleApplication,
		Name:          termwrightTypeName(model),
		FrameworkType: termwrightTypeName(model),
		P:             protocol.ProvenanceFramework,
		PX: map[string]string{
			"role": protocol.ProvenanceRecognizer,
		},
	}
	termwrightCharmGeometry(&root, true)
	snapshot.Nodes = append(snapshot.Nodes, root)

	candidates := make([]termwrightCandidate, 0)
	p.walk(reflect.ValueOf(model), "root", "root", "", &candidates, 0)
	if p.failed.Load() {
		return nil, ""
	}
	duplicateKey := p.appendCandidates(snapshot, rootID, candidates)
	return snapshot, duplicateKey
}

type termwrightCandidate struct {
	identityKey string
	parentKey   string
	node        protocol.Node
	meta        annotate.Semantics
	annotated   bool
}

type termwrightRelations struct {
	nodeIndex   int
	labelledBy  []annotate.SemanticKey
	describedBy []annotate.SemanticKey
}

// appendCandidates is the second pass. Provider methods are evaluated only
// once in walk; after the complete set is known, unique author keys can safely
// become stable ids and relationships can resolve in either field order.
func (p *termwrightProbeState) appendCandidates(
	snapshot *protocol.Snapshot,
	rootID string,
	candidates []termwrightCandidate,
) annotate.SemanticKey {
	counts := make(map[annotate.SemanticKey]int)
	for _, candidate := range candidates {
		if candidate.annotated && candidate.meta.Key != "" {
			counts[candidate.meta.Key]++
		}
	}
	for _, candidate := range candidates {
		if candidate.annotated && candidate.meta.Key != "" && counts[candidate.meta.Key] > 1 {
			return candidate.meta.Key
		}
	}

	keys := make(map[annotate.SemanticKey]string)
	resolvedIDs := map[string]string{"root": rootID}
	for _, candidate := range candidates {
		id := p.identity(candidate.identityKey)
		if candidate.annotated && candidate.meta.Key != "" && counts[candidate.meta.Key] == 1 {
			id = "k:" + string(candidate.meta.Key)
		}
		resolvedIDs[candidate.identityKey] = id
	}
	pending := make([]termwrightRelations, 0)
	for _, candidate := range candidates {
		keyApplied := candidate.annotated && candidate.meta.Key != "" && counts[candidate.meta.Key] == 1
		identityKey := candidate.identityKey
		candidate.node.ID = resolvedIDs[identityKey]
		if keyApplied {
			candidate.node.ID = "k:" + string(candidate.meta.Key)
		}
		candidate.node.ParentID = resolvedIDs[candidate.parentKey]
		if candidate.node.ParentID == "" {
			candidate.node.ParentID = rootID
		}
		if candidate.annotated {
			termwrightApplyAnnotation(candidate.meta, &candidate.node)
		}
		termwrightCharmGeometry(&candidate.node, false)
		if keyApplied {
			keys[candidate.meta.Key] = candidate.node.ID
			termwrightProvenance(&candidate.node, "id", protocol.ProvenanceAnnotation)
		}
		snapshot.Nodes = append(snapshot.Nodes, candidate.node)
		if candidate.annotated && (len(candidate.meta.LabelledBy) > 0 || len(candidate.meta.DescribedBy) > 0) {
			pending = append(pending, termwrightRelations{
				nodeIndex:   len(snapshot.Nodes) - 1,
				labelledBy:  candidate.meta.LabelledBy,
				describedBy: candidate.meta.DescribedBy,
			})
		}
	}
	maxRelations := protocol.DefaultLimits.MaxRelationTargets
	if p.client != nil {
		maxRelations = p.client.Limits().MaxRelationTargets
	}
	termwrightResolveRelations(snapshot, keys, pending, maxRelations)
	return ""
}

// Bubble Tea exposes the completed View but not a component-to-cell mapping.
// The root is known to have produced this frame; reflected model membership
// alone does not prove that any particular component contributed to View.
func termwrightCharmGeometry(node *protocol.Node, root bool) {
	if root {
		displayed := true
		node.Geometry = protocol.NodeGeometryObservations{
			Displayed:    protocol.Observation[bool]{Status: "known", Value: &displayed, Evidence: termwrightEvidence("instrumented")},
			IntendedRect: protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapIntendedGeometry), Reason: "framework-unobservable"},
			VisibleRect:  protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"},
		}
		return
	}
	node.Geometry = protocol.NodeGeometryObservations{
		Displayed:    protocol.Observation[bool]{Status: "unsupported", Capability: "displayed", Reason: "framework-unobservable"},
		IntendedRect: protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapIntendedGeometry), Reason: "framework-unobservable"},
		VisibleRect:  protocol.Observation[protocol.Rect]{Status: "unsupported", Capability: string(protocol.CapClippedGeometry), Reason: "framework-unobservable"},
	}
}

func termwrightNewSnapshot(columns, rows int) *protocol.Snapshot {
	snapshot := protocol.NewSnapshot("", 0, columns, rows)
	snapshot.HitGrid = protocol.Observation[protocol.PointerHitGrid]{
		Status: "unsupported", Capability: "pointer-hit-grid", Reason: "framework-unobservable",
	}
	return snapshot
}

func termwrightEvidence(method string) *protocol.EvidenceProvenance {
	return &protocol.EvidenceProvenance{
		Source: "framework", Method: method, Strength: "authoritative", ProviderID: probeName,
	}
}

func termwrightResolveRelations(
	snapshot *protocol.Snapshot,
	keys map[annotate.SemanticKey]string,
	pending []termwrightRelations,
	maxRelations int,
) {
	resolve := func(references []annotate.SemanticKey) []string {
		resolved := make([]string, 0, len(references))
		seen := make(map[string]struct{}, len(references))
		for _, key := range references {
			if len(resolved) >= maxRelations {
				break
			}
			id, found := keys[key]
			if !found {
				continue
			}
			if _, duplicate := seen[id]; duplicate {
				continue
			}
			seen[id] = struct{}{}
			resolved = append(resolved, id)
		}
		return resolved
	}
	for _, relation := range pending {
		node := &snapshot.Nodes[relation.nodeIndex]
		if ids := resolve(relation.labelledBy); len(ids) > 0 {
			node.LabelledBy = ids
			termwrightProvenance(node, "labelledBy", protocol.ProvenanceAnnotation)
		}
		if ids := resolve(relation.describedBy); len(ids) > 0 {
			node.DescribedBy = ids
			termwrightProvenance(node, "describedBy", protocol.ProvenanceAnnotation)
		}
	}
}

// walk descends the user's model looking for components it knows.
//
// Depth-bounded because a user's model is arbitrary: a cyclic or deeply nested
// structure must cost a truncated tree, never the frame.
func (p *termwrightProbeState) walk(
	value reflect.Value,
	parentKey string,
	identityPath string,
	fieldName string,
	candidates *[]termwrightCandidate,
	depth int,
) {
	if !value.IsValid() {
		p.appendOpaque(candidates, parentKey, identityPath, fieldName, "invalid-value")
		return
	}
	if depth > 8 {
		p.appendOpaque(candidates, parentKey, identityPath, fieldName, "depth-limit")
		return
	}
	for value.Kind() == reflect.Pointer || value.Kind() == reflect.Interface {
		if value.IsNil() {
			p.appendOpaque(candidates, parentKey, identityPath, fieldName, "nil-reference")
			return
		}
		value = value.Elem()
	}
	if value.Kind() != reflect.Struct {
		p.appendOpaque(candidates, parentKey, identityPath, fieldName, "non-struct")
		return
	}

	// Read intent before recognition, but do not publish it yet. An idiomatic
	// annotated Bubbles component is a local type embedding the native value;
	// returning here would throw away the embedded component's value and state.
	declared, hasDeclared := termwrightDeclaredSemantics(value)

	if component := termwrightRecognise(value, fieldName); component != nil {
		if component.missingAccessor != "" {
			p.failOutput("Bubbles semantic probe unavailable: recognised " + component.frameworkType + " without injected accessor " + component.missingAccessor + "; build with prepared.goArgs")
			return
		}
		component.node.P = protocol.ProvenanceFramework
		component.node.PX = map[string]string{"role": protocol.ProvenanceRecognizer}
		*candidates = append(*candidates, termwrightCandidate{
			identityKey: identityPath + "/" + component.frameworkType, parentKey: parentKey,
			node:      component.node,
			meta:      declared,
			annotated: hasDeclared,
		})
		// A recognised component's own fields are its business; descending
		// into it would report its internals as siblings of the application's.
		return
	}

	// A declared custom component that contains no recognised Bubbles value
	// still reaches the tree as what its author says it is.
	containerParent := parentKey
	if depth > 0 {
		node := protocol.Node{
			Role:          protocol.RoleGeneric,
			Name:          fieldName,
			FrameworkType: value.Type().Name(),
			P:             protocol.ProvenanceFramework,
			PX: map[string]string{
				"role": protocol.ProvenanceRecognizer,
			},
		}
		*candidates = append(*candidates, termwrightCandidate{
			identityKey: identityPath, parentKey: parentKey,
			node:      node,
			meta:      declared,
			annotated: hasDeclared,
		})
		containerParent = identityPath
	}

	kind := value.Type()
	for index := 0; index < value.NumField(); index++ {
		field := kind.Field(index)
		// Unexported fields of the *user's* struct cannot be read without
		// unsafe, and a probe that reaches into a user's private state to
		// guess at UI is doing something it cannot justify.
		if !field.IsExported() {
			p.appendOpaque(candidates, containerParent, termwrightChildPath(identityPath, field, index), field.Name, "private-field")
			continue
		}
		p.walk(value.Field(index), containerParent, termwrightChildPath(identityPath, field, index), field.Name, candidates, depth+1)
	}
}

func (p *termwrightProbeState) appendOpaque(candidates *[]termwrightCandidate, parentKey, identityPath, fieldName, reason string) {
	name := fieldName
	if name == "" {
		name = "opaque"
	}
	*candidates = append(*candidates, termwrightCandidate{identityKey: identityPath + "/opaque/" + reason, parentKey: parentKey, node: protocol.Node{Role: protocol.RoleGeneric, Name: name, FrameworkType: "opaque-container", OpaqueChildren: true, Extended: map[string]any{"degradedCapability": "custom-container-enumeration", "opaqueReason": reason}, P: protocol.ProvenanceFramework, PX: map[string]string{"role": protocol.ProvenanceRecognizer}}})
}
func termwrightChildPath(parent string, field reflect.StructField, index int) string {
	return parent + "/" + field.Name + "#" + strconv.Itoa(index)
}

// recognised is one Bubbles component the probe understood.
type recognised struct {
	frameworkType   string
	node            protocol.Node
	missingAccessor string
}

// termwrightRecognise identifies a Bubbles component by its type.
//
// Keyed on package path plus type name, because every Bubbles component is
// called `Model` and the name alone says nothing.
func termwrightRecognise(value reflect.Value, fieldName string) *recognised {
	if component := termwrightRecogniseBubbles(value, fieldName); component != nil {
		return component
	}

	// Applications cannot add methods to a type from another module. The
	// idiomatic way to give a Bubbles value TermwrightSemantics is therefore a
	// local wrapper with an anonymous embedded component. Recognise that native
	// value while applying the wrapper's annotation in walk().
	kind := value.Type()
	for index := 0; index < value.NumField(); index++ {
		field := kind.Field(index)
		if !field.Anonymous || !field.IsExported() {
			continue
		}
		embedded := value.Field(index)
		for embedded.Kind() == reflect.Pointer || embedded.Kind() == reflect.Interface {
			if embedded.IsNil() {
				break
			}
			embedded = embedded.Elem()
		}
		if embedded.IsValid() && embedded.Kind() == reflect.Struct {
			if component := termwrightRecogniseBubbles(embedded, fieldName); component != nil {
				return component
			}
		}
	}
	return nil
}

// termwrightRecogniseBubbles recognises one native Bubbles value.
func termwrightRecogniseBubbles(value reflect.Value, fieldName string) *recognised {
	kind := value.Type()
	path := kind.PkgPath()
	const bubblesModulePath = "github.com/charmbracelet/bubbles"
	if !strings.HasPrefix(path, bubblesModulePath+"/") {
		return nil
	}
	component := path[strings.LastIndex(path, "/")+1:]

	node := protocol.Node{FrameworkType: component, Name: fieldName}
	switch component {
	case "textinput", "textarea":
		node.Role = protocol.RoleTextbox
		node.State = termwrightFocusState(value)
		// A masked field's contents are not ours to publish. `Value()` returns
		// the secret whatever the widget draws, so a probe that reads it puts
		// a password into the semantic tree, the trace archive and the HTML
		// report — three places nobody expected one. The screen shows dots;
		// so does the tree.
		if termwrightEchoesPlainly(value) {
			node.Value = termwrightSensitiveValue(termwrightCallString(value, "Value"))
		} else {
			node.Value = protocol.WithheldSensitiveValue()
		}
	case "list":
		node.Role = protocol.RoleList
		if title := termwrightCallString(value, "Title"); title != nil && *title != "" {
			node.Name = *title
		}
	case "table":
		node.Role = protocol.RoleTable
		node.State = termwrightFocusState(value)
	case "progress":
		node.Role = protocol.RoleProgressBar
	case "paginator", "viewport", "filepicker":
		node.Role = protocol.RoleRegion
	case "spinner":
		node.Role = protocol.RoleStatus
	default:
		// A component this probe has not been taught still reaches the tree,
		// carrying the name Bubbles gave it.
		node.Role = protocol.RoleGeneric
	}
	missingAccessor := termwrightLibraryState(value, component, &node)

	return &recognised{frameworkType: component, node: node, missingAccessor: missingAccessor}
}

// termwrightDeclaredSemantics asks a value for its own semantics.
//
// The interface, not a registry: Bubble Tea copies components on every update,
// so an address recorded once names a copy that no longer exists. A value that
// answers for itself is always current, and the compiler checks the wiring.
func termwrightDeclaredSemantics(value reflect.Value) (annotate.Semantics, bool) {
	if provider, ok := value.Interface().(annotate.Provider); ok {
		return provider.TermwrightSemantics(), true
	}
	if value.CanAddr() {
		if provider, ok := value.Addr().Interface().(annotate.Provider); ok {
			return provider.TermwrightSemantics(), true
		}
	}
	return annotate.Semantics{}, false
}

// termwrightApplyAnnotation merges what the application declared.
//
// Only what the probe cannot observe. There is no field here for geometry or
// focus, and that is the guarantee rather than an omission.
func termwrightApplyAnnotation(meta annotate.Semantics, node *protocol.Node) {
	if meta.Role != "" {
		// Dropped when outside the closed set: a typo in an annotation is the
		// author's to fix, and exhaustive switches downstream depend on that
		// set staying closed.
		if role := protocol.Role(meta.Role); protocol.ValidRole(role) {
			node.Role = role
			termwrightProvenance(node, "role", protocol.ProvenanceAnnotation)
		}
	}
	if meta.Name != "" {
		node.Name = meta.Name
		termwrightProvenance(node, "name", protocol.ProvenanceAnnotation)
	}
	if meta.TestID != "" {
		node.TestID = meta.TestID
		termwrightProvenance(node, "testId", protocol.ProvenanceAnnotation)
	}
	if meta.Description != "" {
		node.Description = meta.Description
		termwrightProvenance(node, "description", protocol.ProvenanceAnnotation)
	}
	if len(meta.Domain) > 0 {
		node.Extended = make(map[string]any, len(meta.Domain))
		for key, value := range meta.Domain {
			node.Extended[key] = value
		}
		termwrightProvenance(node, "extended", protocol.ProvenanceAnnotation)
	}
	seenActions := make(map[protocol.Action]struct{}, len(meta.Actions))
	for _, action := range meta.Actions {
		if !protocol.ValidAction(action) {
			continue
		}
		if _, duplicate := seenActions[action]; duplicate {
			continue
		}
		seenActions[action] = struct{}{}
		node.Actions = append(node.Actions, action)
	}
	if len(node.Actions) > 0 {
		termwrightProvenance(node, "actions", protocol.ProvenanceAnnotation)
	}
}

func termwrightProvenance(node *protocol.Node, field, source string) {
	if node.PX == nil {
		node.PX = make(map[string]string)
	}
	node.PX[field] = source
}

// termwrightLibraryState reads the accessors the Bubbles patch set adds.
//
// Found by name through reflection rather than by importing Bubbles, which
// keeps the two patch sets independent. Certified private-state component
// packages require every owned accessor so a missing compiler wrapper fails
// closed instead of publishing a reduced tree.
//
// These are the facts the audit found valuable and Bubbles keeps private: a
// spinner is otherwise just a glyph, `Percent()` reports the animation's
// target rather than what is drawn, and a file picker's highlighted entry has
// no index anywhere in its public surface.
func termwrightLibraryState(value reflect.Value, component string, node *protocol.Node) string {
	required := map[string][]string{
		"spinner":    {"TermwrightFrame", "TermwrightFrameCount"},
		"progress":   {"TermwrightShownPercent", "TermwrightTargetPercent"},
		"filepicker": {"TermwrightSelectedIndex", "TermwrightEntryCount", "TermwrightSelectedName"},
		"list":       {"TermwrightStatusMessage"},
		"table":      {"TermwrightWindow", "TermwrightRowCount"},
	}
	for _, name := range required[component] {
		if !value.MethodByName(name).IsValid() {
			return name
		}
	}
	switch component {
	case "spinner":
		if frame, ok := termwrightCallInt(value, "TermwrightFrame"); ok {
			node.State = termwrightWithPosition(node.State, frame, termwrightCallIntOr(value, "TermwrightFrameCount", 0))
		}
	case "progress":
		// The drawn fraction, not the one being animated towards.
		if shown, ok := termwrightCallFloat(value, "TermwrightShownPercent"); ok {
			text := strconv.FormatFloat(shown, 'f', 3, 64)
			node.Value = termwrightSensitiveValue(&text)
		}
	case "filepicker":
		if index, ok := termwrightCallInt(value, "TermwrightSelectedIndex"); ok && index >= 0 {
			node.State = termwrightWithPosition(node.State, index, termwrightCallIntOr(value, "TermwrightEntryCount", 0))
			if name := termwrightCallString(value, "TermwrightSelectedName"); name != nil && *name != "" {
				node.Value = termwrightSensitiveValue(name)
			}
		}
	case "list":
		if message := termwrightCallString(value, "TermwrightStatusMessage"); message != nil && *message != "" {
			node.Description = *message
		}
	case "table":
		if count, ok := termwrightCallInt(value, "TermwrightRowCount"); ok {
			node.State = termwrightWithSetSize(node.State, count)
		}
	}
	return ""
}

func termwrightWithPosition(state *protocol.State, index, count int) *protocol.State {
	if state == nil {
		state = &protocol.State{}
	}
	state.PositionInSet = protocol.Int(index + 1)
	if count > 0 {
		state.SetSize = protocol.Int(count)
	}
	return state
}

func termwrightWithSetSize(state *protocol.State, count int) *protocol.State {
	if state == nil {
		state = &protocol.State{}
	}
	state.SetSize = protocol.Int(count)
	return state
}

func termwrightCallInt(value reflect.Value, name string) (int, bool) {
	method := value.MethodByName(name)
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return 0, false
	}
	if !method.Type().Out(0).ConvertibleTo(reflect.TypeOf(0)) {
		return 0, false
	}
	return int(method.Call(nil)[0].Int()), true
}

func termwrightCallIntOr(value reflect.Value, name string, fallback int) int {
	if result, ok := termwrightCallInt(value, name); ok {
		return result
	}
	return fallback
}

func termwrightCallFloat(value reflect.Value, name string) (float64, bool) {
	method := value.MethodByName(name)
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return 0, false
	}
	if method.Type().Out(0).Kind() != reflect.Float64 {
		return 0, false
	}
	return method.Call(nil)[0].Float(), true
}

// termwrightCallString invokes a no-argument getter returning a string.
//
// Public getters are the only way in: Bubbles is a different module, so its
// unexported fields are unreachable from here even though this file is
// compiled into the framework.
func termwrightCallString(value reflect.Value, name string) *string {
	method := value.MethodByName(name)
	if !method.IsValid() {
		// Try the pointer receiver, which is where half of Bubbles puts them.
		if value.CanAddr() {
			method = value.Addr().MethodByName(name)
		}
	}
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return nil
	}
	if method.Type().Out(0).Kind() != reflect.String {
		return nil
	}
	result := method.Call(nil)[0].String()
	return &result
}

// termwrightViewport reads the terminal size v1 knows about.
//
// The standard renderer learns it from the resize handler; a program using a
// different renderer reports nothing, and nothing is the right answer there
// rather than a guess.
func termwrightViewport(program *Program) (int, int, bool) {
	if program == nil {
		return 0, 0, true
	}
	renderer, ok := program.renderer.(*standardRenderer)
	if !ok || renderer == nil {
		return 0, 0, true
	}
	if !renderer.mtx.TryLock() {
		return 0, 0, false
	}
	defer renderer.mtx.Unlock()
	return renderer.width, renderer.height, true
}

// termwrightEchoesPlainly reports whether the widget draws what it holds.
//
// `EchoMode` is an exported field on textinput, and anything other than
// EchoNormal means the user deliberately hid the contents.
func termwrightEchoesPlainly(value reflect.Value) bool {
	field := value.FieldByName("EchoMode")
	if !field.IsValid() || !field.CanInt() {
		// No echo mode at all — textarea, for instance — so nothing is hidden.
		return true
	}
	return field.Int() == 0 // EchoNormal
}

func termwrightSensitiveValue(value *string) *protocol.SemanticValueObservation {
	if value == nil {
		return nil
	}
	return &protocol.SemanticValueObservation{
		Status: "known", Value: value, Sensitivity: "sensitive", Evidence: termwrightEvidence("instrumented"),
	}
}

func termwrightFocusState(value reflect.Value) *protocol.State {
	method := value.MethodByName("Focused")
	if !method.IsValid() || method.Type().NumIn() != 0 || method.Type().NumOut() != 1 {
		return nil
	}
	if method.Type().Out(0).Kind() != reflect.Bool {
		return nil
	}
	if !method.Call(nil)[0].Bool() {
		return nil
	}
	return &protocol.State{Focused: protocol.Bool(true)}
}

func (p *termwrightProbeState) identity(key string) string {
	if id, ok := p.ids[key]; ok {
		return id
	}
	p.nextID++
	id := "n" + strconv.Itoa(p.nextID)
	p.ids[key] = id
	return id
}

func termwrightTypeName(value any) string {
	kind := reflect.TypeOf(value)
	if kind == nil {
		return "nil"
	}
	for kind.Kind() == reflect.Pointer {
		kind = kind.Elem()
	}
	return kind.Name()
}

func (p *termwrightProbeState) tryBeginModelObservation() bool {
	if p.rendering.CompareAndSwap(false, true) {
		return true
	}
	p.requestSemanticFailure("adapter-guarantee-violation", "Bubble Tea semantic probe unavailable: concurrent model observations cannot preserve a complete tree")
	return false
}

// termwrightRenderAndObserve captures the model at the View call, then binds it
// atomically to the standard renderer's queued bytes. Publication happens only
// from standardRenderer.flush.
func termwrightRenderAndObserve(p *Program, model Model) {
	termwrightRenderAndObserveMode(p, model, false)
}

func termwrightRecoverAndObserve(p *Program, model Model, recovery termwrightRecoveryMsg) {
	probe := termwrightProbeForRender()
	renderer, supported := p.renderer.(*standardRenderer)
	if probe == nil || !supported || renderer == nil || renderer != recovery.renderer {
		return
	}
	if !probe.beginRecoveryRender(renderer) {
		return
	}
	termwrightRenderAndObserveMode(p, model, true)
}

func termwrightRenderAndObserveMode(p *Program, model Model, force bool) {
	view := model.View()
	probe := termwrightProbeForRender()
	renderer, supported := p.renderer.(*standardRenderer)
	if probe == nil || !supported || renderer == nil {
		p.renderer.write(view)
		return
	}
	if !probe.tryBeginModelObservation() {
		p.renderer.write(view)
		return
	}
	defer probe.rendering.Store(false)
	columns, rows, viewportAvailable := termwrightViewport(p)
	if !viewportAvailable {
		probe.failSemantic("adapter-guarantee-violation", "Bubble Tea renderer viewport was contended during semantic observation")
		renderer.write(view)
		return
	}
	if columns <= 0 || rows <= 0 {
		renderer.write(view)
		return
	}
	snapshot, duplicateKey := probe.snapshot(model, view, columns, rows)
	if snapshot == nil {
		renderer.write(view)
		return
	}
	if duplicateKey != "" {
		probe.failSemantic("duplicate-semantic-key", "duplicate SemanticKey: "+string(duplicateKey))
		renderer.write(view)
		return
	}
	frame := &termwrightStagedFrame{sequence: probe.nextFrame.Add(1), program: p, view: view, snapshot: snapshot}
	probe.queueFrame(renderer, frame, force)
}
