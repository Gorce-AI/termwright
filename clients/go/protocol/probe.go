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

const (
	ProbeCapStableIdentity ProbeCapability = "stable-identity"
	ProbeCapVisibleRect    ProbeCapability = "visible-rect"
	ProbeCapOperations     ProbeCapability = "operations"
	ProbeCapAnnotations    ProbeCapability = "annotations"
	ProbeCapFrameBegin     ProbeCapability = "frame-begin"
	ProbeCapPaintOrder     ProbeCapability = "paint-order"
)

const maxProbeInfoStringLength = 128

var probeCapabilitySet = map[ProbeCapability]struct{}{
	ProbeCapStableIdentity: {},
	ProbeCapVisibleRect:    {},
	ProbeCapOperations:     {},
	ProbeCapAnnotations:    {},
	ProbeCapFrameBegin:     {},
	ProbeCapPaintOrder:     {},
}

// ProbeInfo is the optional self-description carried by a probe in hello.
// Hand-written adapters leave it nil.
type ProbeInfo struct {
	Framework        string            `json:"framework"`
	FrameworkVersion string            `json:"frameworkVersion,omitempty"`
	ProbeVersion     string            `json:"probeVersion"`
	IdentityKind     ProbeIdentityKind `json:"identityKind"`
	Capabilities     []ProbeCapability `json:"capabilities"`
}

// ValidProbeCapability reports whether capability is part of the v1 probe
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

	checked := *info
	checked.Capabilities = capabilities
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
		[]string{"frameworkVersion"},
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

	_, err := checkedProbeInfo(&ProbeInfo{
		Framework:        framework,
		FrameworkVersion: frameworkVersion,
		ProbeVersion:     probeVersion,
		IdentityKind:     ProbeIdentityKind(identity),
		Capabilities:     capabilities,
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
