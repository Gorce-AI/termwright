package protocol

import "fmt"

// ProbeIdentityKind says whether a probe's object identities may be
// correlated across frames.
type ProbeIdentityKind string

const (
	// ProbeIdentityStable means an identity names the same object throughout
	// the semantic session.
	ProbeIdentityStable ProbeIdentityKind = "stable"
	// ProbeIdentityFrameLocal means an identity is meaningful only in the frame
	// that carries it.
	ProbeIdentityFrameLocal ProbeIdentityKind = "frame-local"
)

// ProbeCapability is an optional fact a framework probe can observe. This is
// deliberately a different closed set from Capability: the latter negotiates
// semantic wire traffic, while this one describes the framework observation
// behind that traffic.
type ProbeCapability string

// ProbeInjectionTier is the strongest attachment mechanism engaged by a run.
type ProbeInjectionTier string

const (
	ProbeTierT0 ProbeInjectionTier = "T0"
	ProbeTierT1 ProbeInjectionTier = "T1"
	ProbeTierT2 ProbeInjectionTier = "T2"
	ProbeTierT3 ProbeInjectionTier = "T3"
)

// ProbeSemanticClass reports whether framework geometry is available.
type ProbeSemanticClass string

const (
	ProbeSemanticClassA ProbeSemanticClass = "A"
	ProbeSemanticClassB ProbeSemanticClass = "B"
)

// SessionCapabilityID is the closed vocabulary used for named degradation.
type SessionCapabilityID string

var validSessionCapabilities = map[SessionCapabilityID]struct{}{
	"semantic-tree": {}, "stable-identity": {}, "intended-geometry": {},
	"inactive-screen-tree": {}, "custom-container-enumeration": {},
	"clipped-geometry": {}, "painted-region": {}, "pointer-geometry": {},
	"pointer-hit-testing": {}, "focus": {}, "scroll": {}, "render-order": {},
	"action-strategies": {}, "keyboard-input": {}, "pointer-input": {},
	"focus-input": {}, "paired-revisions": {},
}

// ProbeInstrumentation describes the concrete runtime attachment, not a registry target.
type ProbeInstrumentation struct {
	HighestTier          ProbeInjectionTier    `json:"highestTier"`
	SemanticClass        ProbeSemanticClass    `json:"semanticClass"`
	DegradedCapabilities []SessionCapabilityID `json:"degradedCapabilities"`
}

const (
	ProbeCapStableIdentity ProbeCapability = "stable-identity"
	ProbeCapIntendedRect   ProbeCapability = "intended-rect"
	ProbeCapVisibleRect    ProbeCapability = "visible-rect"
	ProbeCapOperations     ProbeCapability = "operations"
	ProbeCapAnnotations    ProbeCapability = "annotations"
	ProbeCapFrameBegin     ProbeCapability = "frame-begin"
	ProbeCapPaintOrder     ProbeCapability = "paint-order"
)

const maxProbeInfoStringLength = 128

var probeCapabilitySet = map[ProbeCapability]struct{}{
	ProbeCapStableIdentity: {},
	ProbeCapIntendedRect:   {},
	ProbeCapVisibleRect:    {},
	ProbeCapOperations:     {},
	ProbeCapAnnotations:    {},
	ProbeCapFrameBegin:     {},
	ProbeCapPaintOrder:     {},
}

// ProbeInfo is the optional self-description carried by a probe in hello.
// Hand-written adapters leave it nil.
type ProbeInfo struct {
	Framework        string                `json:"framework"`
	FrameworkVersion string                `json:"frameworkVersion,omitempty"`
	ProbeVersion     string                `json:"probeVersion"`
	IdentityKind     ProbeIdentityKind     `json:"identityKind"`
	Capabilities     []ProbeCapability     `json:"capabilities"`
	Instrumentation  *ProbeInstrumentation `json:"instrumentation,omitempty"`
}

// ValidProbeCapability reports whether capability is part of the current probe
// capability vocabulary.
func ValidProbeCapability(capability ProbeCapability) bool {
	_, ok := probeCapabilitySet[capability]
	return ok
}

func checkedProbeInfo(info *ProbeInfo) (*ProbeInfo, error) {
	if info == nil {
		return nil, nil
	}
	if info.Framework == "" || len(info.Framework) > maxProbeInfoStringLength {
		return nil, fmt.Errorf("framework must contain 1..%d characters", maxProbeInfoStringLength)
	}
	if len(info.FrameworkVersion) > maxProbeInfoStringLength {
		return nil, fmt.Errorf("frameworkVersion must contain at most %d characters", maxProbeInfoStringLength)
	}
	if info.ProbeVersion == "" || len(info.ProbeVersion) > maxProbeInfoStringLength {
		return nil, fmt.Errorf("probeVersion must contain 1..%d characters", maxProbeInfoStringLength)
	}
	if info.IdentityKind != ProbeIdentityStable && info.IdentityKind != ProbeIdentityFrameLocal {
		return nil, fmt.Errorf("identityKind %q is not recognised", info.IdentityKind)
	}
	if len(info.Capabilities) > len(probeCapabilitySet) {
		return nil, fmt.Errorf("capabilities contains more than %d entries", len(probeCapabilitySet))
	}

	// A nil Go slice marshals as JSON null, but the wire schema requires an
	// array even when the probe has no optional capabilities.
	capabilities := make([]ProbeCapability, len(info.Capabilities))
	copy(capabilities, info.Capabilities)
	for _, capability := range capabilities {
		if !ValidProbeCapability(capability) {
			return nil, fmt.Errorf("capabilities contains unknown capability %q", capability)
		}
		if info.IdentityKind == ProbeIdentityFrameLocal && capability == ProbeCapStableIdentity {
			return nil, fmt.Errorf("a frame-local probe cannot claim %q", ProbeCapStableIdentity)
		}
	}
	var instrumentation *ProbeInstrumentation
	if info.Instrumentation != nil {
		declared := *info.Instrumentation
		if declared.HighestTier != ProbeTierT0 && declared.HighestTier != ProbeTierT1 &&
			declared.HighestTier != ProbeTierT2 && declared.HighestTier != ProbeTierT3 {
			return nil, fmt.Errorf("instrumentation highestTier %q is not recognised", declared.HighestTier)
		}
		if declared.SemanticClass != ProbeSemanticClassA && declared.SemanticClass != ProbeSemanticClassB {
			return nil, fmt.Errorf("instrumentation semanticClass %q is not recognised", declared.SemanticClass)
		}
		degraded := make([]SessionCapabilityID, len(declared.DegradedCapabilities))
		copy(degraded, declared.DegradedCapabilities)
		seen := make(map[SessionCapabilityID]struct{}, len(degraded))
		for _, capability := range degraded {
			if _, ok := validSessionCapabilities[capability]; !ok {
				return nil, fmt.Errorf("instrumentation contains unknown degraded capability %q", capability)
			}
			if _, duplicate := seen[capability]; duplicate {
				return nil, fmt.Errorf("instrumentation contains duplicate degraded capability %q", capability)
			}
			seen[capability] = struct{}{}
		}
		if declared.SemanticClass == ProbeSemanticClassB {
			_, intended := seen["intended-geometry"]
			_, clipped := seen["clipped-geometry"]
			if !intended || !clipped {
				return nil, fmt.Errorf("semantic class B requires intended-geometry and clipped-geometry degradation")
			}
		}
		declared.DegradedCapabilities = degraded
		instrumentation = &declared
	}

	checked := *info
	checked.Capabilities = capabilities
	checked.Instrumentation = instrumentation
	return &checked, nil
}

func checkProbeInfo(value any) *ParseError {
	object, ok := value.(map[string]any)
	if !ok {
		return malformed("probe: expected an object")
	}
	if problem := requireKeys(
		object,
		[]string{"framework", "probeVersion", "identityKind", "capabilities"},
		[]string{"frameworkVersion", "instrumentation"},
	); problem != nil {
		return malformed("probe: %s", problem.Detail)
	}

	framework, problem := probeInfoString(object, "framework", false)
	if problem != nil {
		return problem
	}
	probeVersion, problem := probeInfoString(object, "probeVersion", false)
	if problem != nil {
		return problem
	}
	frameworkVersion := ""
	if _, present := object["frameworkVersion"]; present {
		frameworkVersion, problem = probeInfoString(object, "frameworkVersion", true)
		if problem != nil {
			return problem
		}
	}
	identity, ok := object["identityKind"].(string)
	if !ok {
		return malformed("probe.identityKind: expected a string")
	}
	items, ok := object["capabilities"].([]any)
	if !ok || len(items) > len(probeCapabilitySet) {
		return malformed("probe.capabilities: expected a bounded array")
	}
	capabilities := make([]ProbeCapability, 0, len(items))
	for _, item := range items {
		name, isString := item.(string)
		if !isString {
			return malformed("probe.capabilities: expected strings")
		}
		capabilities = append(capabilities, ProbeCapability(name))
	}
	var instrumentation *ProbeInstrumentation
	if raw, present := object["instrumentation"]; present {
		declaration, ok := raw.(map[string]any)
		if !ok {
			return malformed("probe.instrumentation: expected an object")
		}
		if problem := requireKeys(declaration,
			[]string{"highestTier", "semanticClass", "degradedCapabilities"}, nil); problem != nil {
			return malformed("probe.instrumentation: %s", problem.Detail)
		}
		tier, tierOK := declaration["highestTier"].(string)
		semanticClass, classOK := declaration["semanticClass"].(string)
		degradedItems, degradedOK := declaration["degradedCapabilities"].([]any)
		if !tierOK || !classOK || !degradedOK || len(degradedItems) > len(validSessionCapabilities) {
			return malformed("probe.instrumentation: invalid runtime metadata shape")
		}
		degraded := make([]SessionCapabilityID, 0, len(degradedItems))
		for _, item := range degradedItems {
			name, ok := item.(string)
			if !ok {
				return malformed("probe.instrumentation.degradedCapabilities: expected strings")
			}
			degraded = append(degraded, SessionCapabilityID(name))
		}
		instrumentation = &ProbeInstrumentation{
			HighestTier: ProbeInjectionTier(tier), SemanticClass: ProbeSemanticClass(semanticClass),
			DegradedCapabilities: degraded,
		}
	}

	_, err := checkedProbeInfo(&ProbeInfo{
		Framework:        framework,
		FrameworkVersion: frameworkVersion,
		ProbeVersion:     probeVersion,
		IdentityKind:     ProbeIdentityKind(identity),
		Capabilities:     capabilities,
		Instrumentation:  instrumentation,
	})
	if err != nil {
		return malformed("probe: %v", err)
	}
	return nil
}

func probeInfoString(object map[string]any, key string, allowEmpty bool) (string, *ParseError) {
	text, ok := object[key].(string)
	if !ok {
		return "", malformed("probe.%s: expected a string", key)
	}
	if len(text) > maxProbeInfoStringLength {
		return "", malformed("probe.%s: expected at most %d characters", key, maxProbeInfoStringLength)
	}
	if !allowEmpty && text == "" {
		return "", malformed("probe.%s: expected a non-empty string", key)
	}
	return text, nil
}
