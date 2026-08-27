package protocol

import (
	"encoding/json"
	"strings"
	"testing"
)

func testProbeInfo() *ProbeInfo {
	return &ProbeInfo{
		Framework:        "example-go-tui",
		FrameworkVersion: "v1.2.3",
		ProbeVersion:     "0.1.0",
		IdentityKind:     ProbeIdentityStable,
		Capabilities:     []ProbeCapability{ProbeCapStableIdentity, ProbeCapAnnotations},
		Instrumentation: &ProbeInstrumentation{
			HighestTier: ProbeTierT3, SemanticClass: ProbeSemanticClassB,
			DegradedCapabilities: []SessionCapabilityID{"intended-geometry", "clipped-geometry"},
		},
	}
}

func TestProbeInfoUsesTheNormativeWireShape(t *testing.T) {
	hello, err := newHello("token", "probe-tview", "0.1.0", []Capability{CapTree}, testProbeInfo())
	if err != nil {
		t.Fatalf("building hello: %v", err)
	}
	body, err := json.Marshal(hello)
	if err != nil {
		t.Fatalf("marshalling hello: %v", err)
	}

	want := `"probe":{"framework":"example-go-tui","frameworkVersion":"v1.2.3","probeVersion":"0.1.0","identityKind":"stable","capabilities":["stable-identity","annotations"],"instrumentation":{"highestTier":"T3","semanticClass":"B","degradedCapabilities":["intended-geometry","clipped-geometry"]}}`
	if !strings.Contains(string(body), want) {
		t.Fatalf("hello did not carry ProbeInfo in the normative shape:\n%s", body)
	}
}

func TestHandWrittenAdapterOmitsProbeInfo(t *testing.T) {
	hello, err := NewHello("token", "adapter", "0.1.0", []Capability{CapTree})
	if err != nil {
		t.Fatalf("building hello: %v", err)
	}
	body, err := json.Marshal(hello)
	if err != nil {
		t.Fatalf("marshalling hello: %v", err)
	}
	if strings.Contains(string(body), `"probe"`) {
		t.Fatalf("a hand-written adapter acquired probe metadata: %s", body)
	}
}

func TestProbeWithNoOptionalCapabilitiesSendsAnEmptyArray(t *testing.T) {
	probe := testProbeInfo()
	probe.Capabilities = nil
	hello, err := newHello("token", "probe", "0.1.0", []Capability{CapTree}, probe)
	if err != nil {
		t.Fatalf("building hello: %v", err)
	}
	body, err := json.Marshal(hello)
	if err != nil {
		t.Fatalf("marshalling hello: %v", err)
	}
	if !strings.Contains(string(body), `"capabilities":[]`) {
		t.Fatalf("an empty capability list was not encoded as an array: %s", body)
	}
}

func TestProbeInfoIsValidatedBeforeItReachesTheWire(t *testing.T) {
	tests := []struct {
		name  string
		probe *ProbeInfo
	}{
		{name: "missing framework", probe: &ProbeInfo{ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityStable}},
		{name: "missing probe version", probe: &ProbeInfo{Framework: "tview", IdentityKind: ProbeIdentityStable}},
		{name: "unknown identity", probe: &ProbeInfo{Framework: "tview", ProbeVersion: "0.1.0", IdentityKind: "session-ish"}},
		{name: "unknown capability", probe: &ProbeInfo{Framework: "tview", ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityStable, Capabilities: []ProbeCapability{"telepathy"}}},
		{name: "fabricated stability", probe: &ProbeInfo{Framework: "charm", ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityFrameLocal, Capabilities: []ProbeCapability{ProbeCapStableIdentity}}},
		{name: "unknown injection tier", probe: &ProbeInfo{Framework: "charm", ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityFrameLocal, Instrumentation: &ProbeInstrumentation{HighestTier: "T4", SemanticClass: ProbeSemanticClassA}}},
		{name: "class B missing geometry", probe: &ProbeInfo{Framework: "charm", ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityFrameLocal, Instrumentation: &ProbeInstrumentation{HighestTier: ProbeTierT3, SemanticClass: ProbeSemanticClassB, DegradedCapabilities: []SessionCapabilityID{"intended-geometry"}}}},
		{name: "duplicate degradation", probe: &ProbeInfo{Framework: "charm", ProbeVersion: "0.1.0", IdentityKind: ProbeIdentityFrameLocal, Instrumentation: &ProbeInstrumentation{HighestTier: ProbeTierT3, SemanticClass: ProbeSemanticClassA, DegradedCapabilities: []SessionCapabilityID{"scroll", "scroll"}}}},
	}

	for _, testCase := range tests {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := newHello("token", "probe", "0.1.0", []Capability{CapTree}, testCase.probe); err == nil {
				t.Fatal("invalid ProbeInfo was accepted")
			}
		})
	}
}

func TestProbeInfoCapabilitiesAreCopiedIntoHello(t *testing.T) {
	probe := testProbeInfo()
	hello, err := newHello("token", "probe", "0.1.0", []Capability{CapTree}, probe)
	if err != nil {
		t.Fatalf("building hello: %v", err)
	}
	probe.Capabilities[0] = ProbeCapPaintOrder
	probe.Instrumentation.DegradedCapabilities[0] = "scroll"
	if hello.Probe.Capabilities[0] != ProbeCapStableIdentity {
		t.Fatal("mutating Options.Probe changed a handshake already built")
	}
	if hello.Probe.Instrumentation.DegradedCapabilities[0] != "intended-geometry" {
		t.Fatal("mutating Options.Probe instrumentation changed a handshake already built")
	}
}

func TestProbeInfoAcceptsNarrowDegradationVocabulary(t *testing.T) {
	probe := testProbeInfo()
	probe.Instrumentation.SemanticClass = ProbeSemanticClassA
	probe.Instrumentation.DegradedCapabilities = []SessionCapabilityID{
		"inactive-screen-tree",
		"custom-container-enumeration",
	}
	if _, err := newHello("token", "probe", "0.1.0", []Capability{CapTree}, probe); err != nil {
		t.Fatalf("valid narrow degradation was rejected: %v", err)
	}
}

func TestParseAdapterMessageValidatesProbeInfo(t *testing.T) {
	message := map[string]any{
		"type":         "hello",
		"protocol":     ProtocolID,
		"token":        "token",
		"adapter":      map[string]any{"name": "probe-charm", "version": "0.1.0"},
		"capabilities": []any{"tree", "states", "render-revisions"},
		"probe": map[string]any{
			"framework":        "charm",
			"frameworkVersion": "v2.0.8",
			"probeVersion":     "0.1.0",
			"identityKind":     "frame-local",
			"capabilities":     []any{"annotations"},
			"instrumentation": map[string]any{
				"highestTier": "T3", "semanticClass": "B",
				"degradedCapabilities": []any{"intended-geometry", "clipped-geometry"},
			},
		},
	}
	if _, err := ParseAdapterMessage(message, DefaultLimits); err != nil {
		t.Fatalf("valid probe hello was rejected: %v", err)
	}

	message["probe"].(map[string]any)["surmise"] = true
	if _, err := ParseAdapterMessage(message, DefaultLimits); ParseCode(err) != "malformed" {
		t.Fatalf("unknown probe field produced %q, want malformed", ParseCode(err))
	}
}
