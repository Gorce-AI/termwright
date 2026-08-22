package evidence

import (
	"testing"

	"github.com/gorce-ai/termwright/clients/go/protocol"
)

func testRegion() protocol.ProviderPointerRegion {
	return protocol.ProviderPointerRegion{
		RecipientID:  "reject",
		RegionBounds: protocol.Rect{Row: 1, Column: 2, Width: 3, Height: 1},
		Spans:        []protocol.ProviderPointerSpan{{Row: 1, From: 2, To: 5}},
	}
}

func TestRegistryLifecycleAndExactHitGrid(t *testing.T) {
	r := NewRegistry()
	h, err := r.RegisterPointer(PointerProvider{ID: "router", Version: "1", Method: "native", Capabilities: []string{"pointer-regions", "hit-test"}, Observe: func(Context) (PointerObservation, error) { return PointerObservation{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.RegisterPointer(PointerProvider{ID: "late", Version: "1", Method: "declared"}); err == nil {
		t.Fatal("late registration accepted")
	}
	evidence := lease.Collect("s1", 1, 2, 2)
	if len(evidence) != 1 || evidence[0].Status != "violation" {
		t.Fatalf("expected hit-test violation, got %#v", evidence)
	}
	h.Close()
	evidence = lease.Collect("s1", 2, 2, 2)
	if evidence[0].Status != "lost" {
		t.Fatalf("expected loss, got %#v", evidence[0])
	}
	lease.Close()
}

func TestScrollProviderPublishesBoundedApplicationViewportState(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterScroll(ScrollProvider{
		ID: "app.scroll", Version: "1", Method: "native",
		Observe: func(Context) ([]protocol.ProviderScrollState, error) {
			return []protocol.ProviderScrollState{{
				RecipientID: "results", Axis: "vertical", Offset: 3, Viewport: 4, Extent: 20,
			}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	frames := lease.Collect("s", 1, 80, 24)
	if len(frames) != 1 || frames[0].Status != "available" || frames[0].ScrollStates == nil || (*frames[0].ScrollStates)[0].Offset != 3 {
		t.Fatalf("unexpected scroll evidence %#v", frames)
	}
}

func TestPaintProviderPublishesProductionCellAttribution(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterPaint(PaintProvider{
		ID: "app.paint", Version: "1", Method: "native",
		Observe: func(Context) ([]protocol.ProviderPaintedRegion, error) {
			return []protocol.ProviderPaintedRegion{{
				RecipientID:  "results",
				RegionBounds: protocol.Rect{Row: 1, Column: 2, Width: 3, Height: 1},
				Spans:        []protocol.ProviderPointerSpan{{Row: 1, From: 2, To: 5}},
			}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	frames := lease.Collect("s", 1, 80, 24)
	if len(frames) != 1 || frames[0].Status != "available" || frames[0].PaintedRegions == nil || (*frames[0].PaintedRegions)[0].RecipientID != "results" {
		t.Fatalf("unexpected paint evidence %#v", frames)
	}
}

func TestInputModeProviderPublishesProductionParserConfiguration(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterInputModes(InputModeProvider{
		ID: "app.input", Version: "1", Method: "native",
		Observe: func(Context) (protocol.ProviderTerminalInputModes, error) {
			return protocol.ProviderTerminalInputModes{
				MouseTracking: "drag", MouseEncoding: "sgr", FocusReporting: "on",
			}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	frame := lease.Collect("s", 1, 80, 24)[0]
	if frame.Status != "available" || frame.InputModes == nil || frame.InputModes.MouseTracking != "drag" {
		t.Fatalf("unexpected input mode evidence %#v", frame)
	}
}

func TestIndependentRegionAndHitTestProvidersCompose(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterPointer(PointerProvider{
		ID: "regions", Version: "1", Method: "declared", Capabilities: []string{"pointer-regions"},
		Observe: func(Context) (PointerObservation, error) {
			return PointerObservation{PointerRegions: []protocol.ProviderPointerRegion{testRegion()}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.RegisterPointer(PointerProvider{
		ID: "router", Version: "2", Method: "native", Capabilities: []string{"hit-test"},
		Observe: func(Context) (PointerObservation, error) {
			return PointerObservation{HitTest: func(column, row int) string {
				if row == 1 && column >= 2 && column < 5 {
					return "reject"
				}
				return ""
			}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	frames := lease.Collect("s1", 4, 10, 3)
	if len(frames) != 2 || frames[0].Status != "available" || frames[1].Status != "available" {
		t.Fatalf("expected two available providers, got %#v", frames)
	}
	var regions, hits *protocol.ProviderRevisionEvidence
	for index := range frames {
		frame := &frames[index]
		if frame.ProviderID == "regions" {
			regions = frame
		}
		if frame.ProviderID == "router" {
			hits = frame
		}
	}
	if regions == nil || regions.PointerRegions == nil || len(*regions.PointerRegions) != 1 || regions.HitGrid != nil {
		t.Fatalf("unexpected region evidence %#v", regions)
	}
	if hits == nil || hits.PointerRegions == nil || len(*hits.PointerRegions) != 0 || hits.HitGrid == nil || len(hits.HitGrid.Regions) != 1 {
		t.Fatalf("unexpected hit-test evidence %#v", hits)
	}
}

func TestProviderDeclarationAndPublicationFailClosed(t *testing.T) {
	r := NewRegistry()
	for _, capabilities := range [][]string{nil, {"unknown"}, {"hit-test", "hit-test"}} {
		if _, err := r.RegisterPointer(PointerProvider{ID: "invalid", Version: "1", Method: "native", Capabilities: capabilities}); err == nil {
			t.Fatalf("accepted invalid capabilities %#v", capabilities)
		}
	}
	if _, err := r.RegisterPointer(PointerProvider{
		ID: "regions", Version: "1", Method: "declared", Capabilities: []string{"pointer-regions"},
		Observe: func(Context) (PointerObservation, error) {
			return PointerObservation{PointerRegions: []protocol.ProviderPointerRegion{testRegion()}, HitTest: func(int, int) string { return "" }}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, _ := r.Freeze()
	frame := lease.Collect("s", 1, 10, 3)[0]
	if frame.Status != "violation" {
		t.Fatalf("expected out-of-contract evidence violation, got %#v", frame)
	}
}

func TestActionStrategyProviderIsASeparateClosedFamily(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterActionStrategies(ActionStrategyProvider{
		ID: "app.keys", Version: "1", Method: "native",
		Observe: func(Context) ([]protocol.ProviderActionRecipes, error) {
			return []protocol.ProviderActionRecipes{{
				RecipientID: "editor",
				Recipes: []protocol.PhysicalInputRecipe{{
					Action: "setValue", RequiresFocus: true,
					Steps: []protocol.PhysicalInputRecipeStep{
						{Kind: "press", Key: "Control+U"},
						{Kind: "insert-action-value"},
					},
				}},
			}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, _ := r.Freeze()
	frame := lease.Collect("s", 3, 80, 24)[0]
	if frame.Status != "available" || frame.ActionRecipes == nil || len(*frame.ActionRecipes) != 1 {
		t.Fatalf("unexpected action strategy evidence %#v", frame)
	}
	if frame.PointerRegions == nil || len(*frame.PointerRegions) != 0 {
		t.Fatalf("action strategy family leaked pointer evidence %#v", frame)
	}
}

func TestFocusProviderPreservesAuthoritativeNone(t *testing.T) {
	r := NewRegistry()
	if _, err := r.RegisterFocus(FocusProvider{
		ID: "app.focus", Version: "1", Method: "native",
		Observe: func(context Context) (*string, error) {
			if context.Revision == 1 {
				value := "editor"
				return &value, nil
			}
			return nil, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	if got := lease.Registrations()[0].Capabilities; len(got) != 1 || got[0] != "focus-state" {
		t.Fatalf("unexpected focus registration %#v", got)
	}
	focused := lease.Collect("s", 1, 10, 3)[0].FocusState
	if focused == nil || focused.Status != "focused" || focused.RecipientID != "editor" {
		t.Fatalf("unexpected focused state %#v", focused)
	}
	none := lease.Collect("s", 2, 10, 3)[0].FocusState
	if none == nil || none.Status != "none" || none.RecipientID != "" {
		t.Fatalf("unexpected no-focus state %#v", none)
	}
}
