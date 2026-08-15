package protocol

import (
	"encoding/json"
	"fmt"
)

// ProtocolID is the wire protocol identifier both sides must agree on.
const ProtocolID = "termwright/1"

// ProtocolVersion is the current major version.
const ProtocolVersion = 1

// maxIdentifierLength bounds tokens, ids and free-text error messages.
const maxIdentifierLength = 1024

// Hello is the adapter's handshake: sent exactly once, before anything else.
type Hello struct {
	Type         string       `json:"type"`
	Protocol     string       `json:"protocol"`
	Token        string       `json:"token"`
	Adapter      AdapterInfo  `json:"adapter"`
	Capabilities []Capability `json:"capabilities"`
}

// AdapterInfo identifies the adapter implementation to the driver.
type AdapterInfo struct {
	Name    string `json:"name"`
	Version string `json:"version"`
}

// HelloAck is the driver's reply: the session id, the negotiated limits, what
// to push, and whether markers are wanted.
type HelloAck struct {
	Type      string       `json:"type"`
	Protocol  string       `json:"protocol"`
	SessionID string       `json:"sessionId"`
	Limits    Limits       `json:"limits"`
	Subscribe string       `json:"subscribe"`
	Marker    MarkerConfig `json:"marker"`
}

// MarkerConfig says whether the adapter should emit render markers.
type MarkerConfig struct {
	Enabled bool `json:"enabled"`
}

// RevisionCommit announces that a render was committed to the terminal.
type RevisionCommit struct {
	Type     string `json:"type"`
	Revision int64  `json:"revision"`
}

// SnapshotMessage carries a full tree for one revision.
type SnapshotMessage struct {
	Type     string    `json:"type"`
	Snapshot *Snapshot `json:"snapshot"`
}

// GetTree is the driver asking for a tree: the latest, or a held revision.
type GetTree struct {
	Type      string `json:"type"`
	RequestID int64  `json:"requestId"`
	Revision  *int64 `json:"revision,omitempty"`
}

// GetTreeResult answers a GetTree with exactly one of a snapshot or an error.
type GetTreeResult struct {
	Type      string          `json:"type"`
	RequestID int64           `json:"requestId"`
	Snapshot  json.RawMessage `json:"snapshot,omitempty"`
	Error     string          `json:"error,omitempty"`
}

// ProtocolErrorMessage is terminal: the sender closes after emitting it.
type ProtocolErrorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewHello builds a handshake message, refusing unknown capabilities locally.
func NewHello(token, name, version string, capabilities []Capability) (*Hello, error) {
	for _, capability := range capabilities {
		if !ValidCapability(capability) {
			return nil, violation("marker-argument", "unknown capability %q", capability)
		}
	}
	return &Hello{
		Type:         "hello",
		Protocol:     ProtocolID,
		Token:        token,
		Adapter:      AdapterInfo{Name: name, Version: version},
		Capabilities: capabilities,
	}, nil
}

// ParseError reports why a message was refused, in the wire taxonomy:
// bad-version, malformed or limit-exceeded.
type ParseError struct {
	Code   string
	Detail string
}

func (e *ParseError) Error() string { return e.Code + ": " + e.Detail }

// ParseCode returns the code of a *ParseError, or "" otherwise.
func ParseCode(err error) string {
	if e, ok := err.(*ParseError); ok {
		return e.Code
	}
	return ""
}

func malformed(format string, args ...any) *ParseError {
	return &ParseError{Code: "malformed", Detail: fmt.Sprintf(format, args...)}
}

var errorCodes = map[string]struct{}{
	"bad-token": {}, "bad-version": {}, "malformed": {}, "limit-exceeded": {}, "internal": {},
}

func project(value any, limits Limits) (any, *ParseError) {
	projected, err := ProjectDTO(value, limits.MaxDepth)
	if err != nil {
		if ViolationCode(err) == "dto-depth" {
			return nil, &ParseError{Code: "limit-exceeded", Detail: err.Error()}
		}
		return nil, malformed("%s", err.Error())
	}
	return projected, nil
}

func requireKeys(object map[string]any, required []string, optional []string) *ParseError {
	for _, key := range required {
		if _, ok := object[key]; !ok {
			return malformed("missing field %q", key)
		}
	}
	for key := range object {
		known := false
		for _, name := range append(append([]string{}, required...), optional...) {
			if key == name {
				known = true
				break
			}
		}
		if !known {
			return malformed("unrecognized key %q", key)
		}
	}
	return nil
}

func identifier(object map[string]any, key string, allowEmpty bool) *ParseError {
	text, ok := object[key].(string)
	if !ok {
		return malformed("%s: expected a string", key)
	}
	if len(text) > maxIdentifierLength {
		return malformed("%s: expected at most %d characters", key, maxIdentifierLength)
	}
	if !allowEmpty && text == "" {
		return malformed("%s: expected a non-empty string", key)
	}
	return nil
}

func wholeNumber(object map[string]any, key string, positive bool) *ParseError {
	number, ok := object[key].(float64)
	if !ok || number != float64(int64(number)) || number > maxSafeInteger {
		return malformed("%s: expected a safe integer", key)
	}
	if positive && number <= 0 {
		return malformed("%s: expected a positive safe integer", key)
	}
	if !positive && number < 0 {
		return malformed("%s: expected a non-negative safe integer", key)
	}
	return nil
}

func checkEmbeddedSnapshot(value any, limits Limits) *ParseError {
	err := ValidateSnapshot(value, limits)
	if err == nil {
		return nil
	}
	code := ValidationCode(err)
	wire := "malformed"
	switch code {
	case "bytes", "count", "depth", "string-bytes":
		wire = "limit-exceeded"
	}
	return &ParseError{Code: wire, Detail: "snapshot " + err.Error()}
}

func checkErrorMessage(object map[string]any) *ParseError {
	if problem := requireKeys(object, []string{"type", "code", "message"}, nil); problem != nil {
		return problem
	}
	code, _ := object["code"].(string)
	if _, known := errorCodes[code]; !known {
		return malformed("code: unknown error code")
	}
	return identifier(object, "message", true)
}

func messageObject(value any) (map[string]any, string, *ParseError) {
	object, ok := value.(map[string]any)
	if !ok {
		return nil, "", malformed("unknown or missing message type")
	}
	kind, ok := object["type"].(string)
	if !ok {
		return nil, "", malformed("unknown or missing message type")
	}
	return object, kind, nil
}

func checkProtocolField(object map[string]any) *ParseError {
	if protocol, ok := object["protocol"].(string); ok && protocol != ProtocolID {
		return &ParseError{Code: "bad-version", Detail: "unsupported protocol " + protocol}
	}
	return nil
}

// ParseAdapterMessage validates one adapter → driver message and returns the
// checked generic form. It never panics; failures come back as *ParseError.
func ParseAdapterMessage(value any, limits Limits) (map[string]any, error) {
	projected, parseErr := project(value, limits)
	if parseErr != nil {
		return nil, parseErr
	}
	object, kind, parseErr := messageObject(projected)
	if parseErr != nil {
		return nil, parseErr
	}

	switch kind {
	case "hello":
		if problem := checkProtocolField(object); problem != nil {
			return nil, problem
		}
		if problem := requireKeys(object, []string{"type", "protocol", "token", "adapter", "capabilities"}, nil); problem != nil {
			return nil, problem
		}
		if problem := identifier(object, "token", false); problem != nil {
			return nil, problem
		}
		adapter, ok := object["adapter"].(map[string]any)
		if !ok {
			return nil, malformed("adapter: expected an object")
		}
		if problem := requireKeys(adapter, []string{"name", "version"}, nil); problem != nil {
			return nil, problem
		}
		for _, key := range []string{"name", "version"} {
			if problem := identifier(adapter, key, false); problem != nil {
				return nil, problem
			}
		}
		capabilities, ok := object["capabilities"].([]any)
		if !ok || len(capabilities) > CapabilityCount {
			return nil, malformed("capabilities: expected a bounded array")
		}
		for _, item := range capabilities {
			name, isString := item.(string)
			if !isString || !ValidCapability(Capability(name)) {
				return nil, malformed("capabilities: unknown capability")
			}
		}
		return object, nil

	case "revision-commit":
		if problem := requireKeys(object, []string{"type", "revision"}, nil); problem != nil {
			return nil, problem
		}
		if problem := wholeNumber(object, "revision", true); problem != nil {
			return nil, problem
		}
		return object, nil

	case "snapshot":
		if problem := requireKeys(object, []string{"type", "snapshot"}, nil); problem != nil {
			return nil, problem
		}
		if problem := checkEmbeddedSnapshot(object["snapshot"], limits); problem != nil {
			return nil, problem
		}
		return object, nil

	case "get-tree-result":
		if problem := requireKeys(object, []string{"type", "requestId"}, []string{"snapshot", "error"}); problem != nil {
			return nil, problem
		}
		if problem := wholeNumber(object, "requestId", false); problem != nil {
			return nil, problem
		}
		_, hasSnapshot := object["snapshot"]
		_, hasError := object["error"]
		if hasSnapshot == hasError {
			return nil, malformed("exactly one of snapshot or error must be present")
		}
		if hasError {
			if problem := identifier(object, "error", true); problem != nil {
				return nil, problem
			}
			return object, nil
		}
		if problem := checkEmbeddedSnapshot(object["snapshot"], limits); problem != nil {
			return nil, problem
		}
		return object, nil

	case "error":
		if problem := checkErrorMessage(object); problem != nil {
			return nil, problem
		}
		return object, nil
	}
	return nil, malformed("unknown or missing message type")
}

// ParseDriverMessage validates one driver → adapter message.
func ParseDriverMessage(value any, limits Limits) (map[string]any, error) {
	projected, parseErr := project(value, limits)
	if parseErr != nil {
		return nil, parseErr
	}
	object, kind, parseErr := messageObject(projected)
	if parseErr != nil {
		return nil, parseErr
	}

	switch kind {
	case "hello-ack":
		if problem := checkProtocolField(object); problem != nil {
			return nil, problem
		}
		if problem := requireKeys(object, []string{"type", "protocol", "sessionId", "limits", "subscribe", "marker"}, nil); problem != nil {
			return nil, problem
		}
		if problem := identifier(object, "sessionId", false); problem != nil {
			return nil, problem
		}
		limitsObject, ok := object["limits"].(map[string]any)
		if !ok {
			return nil, malformed("limits: expected an object")
		}
		if problem := requireKeys(limitsObject, limitFields, nil); problem != nil {
			return nil, problem
		}
		for _, key := range limitFields {
			if problem := wholeNumber(limitsObject, key, true); problem != nil {
				return nil, problem
			}
		}
		subscribe, _ := object["subscribe"].(string)
		if subscribe != "snapshots" && subscribe != "revisions" {
			return nil, malformed("subscribe: expected 'snapshots' or 'revisions'")
		}
		marker, ok := object["marker"].(map[string]any)
		if !ok {
			return nil, malformed("marker: expected an object")
		}
		if problem := requireKeys(marker, []string{"enabled"}, nil); problem != nil {
			return nil, problem
		}
		if _, ok := marker["enabled"].(bool); !ok {
			return nil, malformed("marker.enabled: expected a boolean")
		}
		return object, nil

	case "get-tree":
		if problem := requireKeys(object, []string{"type", "requestId"}, []string{"revision"}); problem != nil {
			return nil, problem
		}
		if problem := wholeNumber(object, "requestId", false); problem != nil {
			return nil, problem
		}
		if _, ok := object["revision"]; ok {
			if problem := wholeNumber(object, "revision", true); problem != nil {
				return nil, problem
			}
		}
		return object, nil

	case "error":
		if problem := checkErrorMessage(object); problem != nil {
			return nil, problem
		}
		return object, nil
	}
	return nil, malformed("unknown or missing message type")
}

var limitFields = []string{
	"maxFrameBytes", "maxSnapshotBytes", "maxNodes", "maxDepth", "maxStringBytes",
	"maxRelationTargets", "maxQueuedFrames", "maxPendingWaiters", "maxSessions",
}
