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
	h, err := r.Register(Provider{ID: "router", Version: "1", Method: "native", Capabilities: []string{"pointer-regions", "hit-test"}, Observe: func(Context) (Observation, error) { return Observation{}, nil }})
	if err != nil {
		t.Fatal(err)
	}
	lease, err := r.Freeze()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := r.Register(Provider{ID: "late", Version: "1", Method: "declared"}); err == nil {
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

func TestIndependentRegionAndHitTestProvidersCompose(t *testing.T) {
	r := NewRegistry()
	if _, err := r.Register(Provider{
		ID: "regions", Version: "1", Method: "declared", Capabilities: []string{"pointer-regions"},
		Observe: func(Context) (Observation, error) {
			return Observation{PointerRegions: []protocol.ProviderPointerRegion{testRegion()}}, nil
		},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := r.Register(Provider{
		ID: "router", Version: "2", Method: "native", Capabilities: []string{"hit-test"},
		Observe: func(Context) (Observation, error) {
			return Observation{HitTest: func(column, row int) string {
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
		if _, err := r.Register(Provider{ID: "invalid", Version: "1", Method: "native", Capabilities: capabilities}); err == nil {
			t.Fatalf("accepted invalid capabilities %#v", capabilities)
		}
	}
	if _, err := r.Register(Provider{
		ID: "regions", Version: "1", Method: "declared", Capabilities: []string{"pointer-regions"},
		Observe: func(Context) (Observation, error) {
			return Observation{PointerRegions: []protocol.ProviderPointerRegion{testRegion()}, HitTest: func(int, int) string { return "" }}, nil
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
