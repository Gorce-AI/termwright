package protocol

import (
	"fmt"
)

// ProtocolID is the wire protocol identifier both sides must agree on.
const ProtocolID = "termwright/3"

// ProtocolVersion is the current major version.
const ProtocolVersion = 3

// maxIdentifierLength bounds tokens, ids and free-text error messages.
const maxIdentifierLength = 1024

// Hello is the adapter's handshake: sent exactly once, before anything else.
type Hello struct {
	Type         string                         `json:"type"`
	Protocol     string                         `json:"protocol"`
	Token        string                         `json:"token"`
	Adapter      AdapterInfo                    `json:"adapter"`
	Capabilities []Capability                   `json:"capabilities"`
	Probe        *ProbeInfo                     `json:"probe,omitempty"`
	Providers    []EvidenceProviderRegistration `json:"providers,omitempty"`
}

// EvidenceProviderRegistration freezes an application evidence producer in
// the same hello negotiation as the framework adapter.
type EvidenceProviderRegistration struct {
	ID           string   `json:"id"`
	Version      string   `json:"version"`
	Method       string   `json:"method"` // native or declared
	Capabilities []string `json:"capabilities"`
}

// EvidenceProviderRegistry freezes application providers once per client session.
type EvidenceProviderRegistry interface {
	Freeze() (EvidenceProviderLease, error)
}

// EvidenceProviderLease is the immutable provider set owned by one session.
type EvidenceProviderLease interface {
	Registrations() []EvidenceProviderRegistration
	Collect(sessionID string, revision int64, columns, rows int) []ProviderRevisionEvidence
	Close()
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
	Logs      *LogBudget   `json:"logs,omitempty"`
}

// MarkerConfig says whether the adapter should emit render markers.
type MarkerConfig struct {
	Enabled bool `json:"enabled"`
}

// LogBudget is the log-channel allowance, sent only when the adapter
// announced the `logs` capability. Absent means logs are disabled: an adapter
// that receives no budget must not emit log messages at all.
type LogBudget struct {
	Enabled bool `json:"enabled"`
	// MaxRecordsPerSecond is the sustained ceiling on records per second.
	MaxRecordsPerSecond int `json:"maxRecordsPerSecond"`
	// Burst is how many records are allowed on top of the sustained rate.
	Burst int `json:"burst"`
}

// RevisionCommit announces that a render was committed to the terminal.
type RevisionCommit struct {
	Type     string `json:"type"`
	Revision int64  `json:"revision"`
}

// SemanticFullMessage carries a full tree for one revision.
type SemanticFullMessage struct {
	Type     string    `json:"type"`
	Snapshot *Snapshot `json:"snapshot"`
}

// ProtocolErrorMessage is terminal: the sender closes after emitting it.
type ProtocolErrorMessage struct {
	Type    string `json:"type"`
	Code    string `json:"code"`
	Message string `json:"message"`
}

// NewHello builds a handshake message, refusing unknown capabilities locally.
func NewHello(token, name, version string, capabilities []Capability) (*Hello, error) {
	return newHello(token, name, version, capabilities, nil)
}

func newHello(token, name, version string, capabilities []Capability, probe *ProbeInfo) (*Hello, error) {
	for _, capability := range capabilities {
		if !ValidCapability(capability) {
			return nil, violation("marker-argument", "unknown capability %q", capability)
		}
	}
	checkedProbe, err := checkedProbeInfo(probe)
	if err != nil {
		return nil, violation("marker-argument", "invalid probe info: %v", err)
	}
	return &Hello{
		Type:         "hello",
		Protocol:     ProtocolID,
		Token:        token,
		Adapter:      AdapterInfo{Name: name, Version: version},
		Capabilities: capabilities,
		Probe:        checkedProbe,
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
	"bad-token": {}, "bad-version": {}, "malformed": {}, "limit-exceeded": {}, "duplicate-semantic-key": {}, "adapter-guarantee-violation": {}, "internal": {},
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

// requiredKeys checks that every required key is present, tolerating unknown ones.
func requiredKeys(object map[string]any, required []string) *ParseError {
	for _, key := range required {
		if _, ok := object[key]; !ok {
			return malformed("missing field %q", key)
		}
	}
	return nil
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

// checkLogBudget validates the optional log-channel budget in hello-ack.
func checkLogBudget(value any) *ParseError {
	budget, ok := value.(map[string]any)
	if !ok {
		return malformed("logs: expected an object")
	}
	if problem := requiredKeys(budget, []string{"enabled", "maxRecordsPerSecond", "burst"}); problem != nil {
		return problem
	}
	if _, ok := budget["enabled"].(bool); !ok {
		return malformed("logs.enabled: expected a boolean")
	}
	if problem := wholeNumber(budget, "maxRecordsPerSecond", true); problem != nil {
		return problem
	}
	return wholeNumber(budget, "burst", false)
}

func checkErrorMessage(object map[string]any, strict bool) *ParseError {
	keys := []string{"type", "code", "message"}
	problem := requiredKeys(object, keys)
	if strict {
		problem = requireKeys(object, keys, nil)
	}
	if problem != nil {
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
	protocol, ok := object["protocol"].(string)
	if !ok {
		return malformed("protocol: expected a string")
	}
	if protocol != ProtocolID {
		return &ParseError{Code: "bad-version", Detail: "unsupported protocol " + protocol}
	}
	return nil
}

// ParseAdapterMessage validates one adapter → driver message and returns the
// checked generic form. It never panics; failures come back as *ParseError.
//
// Strict: an unknown field from an adapter is a protocol error, not an
// extension. See ParseDriverMessage for the other direction.
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
		if problem := requireKeys(object, []string{"type", "protocol", "token", "adapter", "capabilities"}, []string{"probe"}); problem != nil {
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
		if probe, present := object["probe"]; present {
			if problem := checkProbeInfo(probe); problem != nil {
				return nil, problem
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

	case "semantic-full":
		if problem := requireKeys(object, []string{"type", "snapshot"}, nil); problem != nil {
			return nil, problem
		}
		if problem := checkEmbeddedSnapshot(object["snapshot"], limits); problem != nil {
			return nil, problem
		}
		return object, nil

	case "log":
		if problem := requireKeys(object, []string{"type", "record"}, nil); problem != nil {
			return nil, problem
		}
		if problem := checkLogRecord(object["record"], limits); problem != nil {
			return nil, problem
		}
		return object, nil

	case "error":
		if problem := checkErrorMessage(object, true); problem != nil {
			return nil, problem
		}
		return object, nil
	}
	return nil, malformed("unknown or missing message type")
}

// checkLogRecord maps a record failure onto the wire taxonomy: capacity
// failures are limit-exceeded, the rest are malformed.
func checkLogRecord(value any, limits Limits) *ParseError {
	err := ValidateLogRecord(value, limits)
	if err == nil {
		return nil
	}
	wire := "malformed"
	switch ValidationCode(err) {
	case "bytes", "count", "depth", "string-bytes":
		wire = "limit-exceeded"
	}
	return &ParseError{Code: wire, Detail: "log record " + err.Error()}
}

// ParseDriverMessage validates one driver → adapter message.
//
// Driver traffic is read tolerantly: unknown fields in the envelope and in the
// driver's nested objects (marker, logs, limits) are ignored and passed
// through to the caller, so a newer driver can add a field without breaking an
// adapter published before it existed.
//
// The asymmetry is about who is speaking, not about the message: adapter
// traffic crosses an untrusted boundary, where an unknown field is a signal
// rather than an extension. Tolerance is not leniency either — known fields
// keep their types, and the closed sets (message types, error codes,
// subscribe, roles, actions) stay closed in both directions.
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
		if problem := requiredKeys(object,
			[]string{"type", "protocol", "sessionId", "limits", "subscribe", "marker"}); problem != nil {
			return nil, problem
		}
		if problem := identifier(object, "sessionId", false); problem != nil {
			return nil, problem
		}
		limitsObject, ok := object["limits"].(map[string]any)
		if !ok {
			return nil, malformed("limits: expected an object")
		}
		// Required keys must all be present, but unknown ones are ignored:
		// `limits` is the one object on the wire that grows between versions,
		// and a client that rejected a ceiling it had never heard of would
		// drop the channel every time the protocol gained one.
		if problem := requiredKeys(limitsObject, limitFields); problem != nil {
			return nil, problem
		}
		for _, key := range limitFields {
			if problem := wholeNumber(limitsObject, key, true); problem != nil {
				return nil, problem
			}
		}
		subscribe, _ := object["subscribe"].(string)
		if subscribe != "semantic" {
			return nil, malformed("subscribe: expected 'semantic'")
		}
		marker, ok := object["marker"].(map[string]any)
		if !ok {
			return nil, malformed("marker: expected an object")
		}
		if problem := requiredKeys(marker, []string{"enabled"}); problem != nil {
			return nil, problem
		}
		if _, ok := marker["enabled"].(bool); !ok {
			return nil, malformed("marker.enabled: expected a boolean")
		}
		if logs, present := object["logs"]; present {
			if problem := checkLogBudget(logs); problem != nil {
				return nil, problem
			}
		}
		return object, nil

	case "semantic-resync-request":
		if problem := requiredKeys(object, []string{"type", "sessionId", "expectedBaseRevision", "reason"}); problem != nil {
			return nil, problem
		}
		if problem := identifier(object, "sessionId", false); problem != nil {
			return nil, problem
		}
		if object["expectedBaseRevision"] != nil {
			if problem := wholeNumber(object, "expectedBaseRevision", true); problem != nil {
				return nil, problem
			}
		}
		reason, _ := object["reason"].(string)
		if reason != "base-mismatch" && reason != "missing-base" && reason != "driver-reset" {
			return nil, malformed("reason: unknown semantic resync reason")
		}
		return object, nil

	case "error":
		if problem := checkErrorMessage(object, false); problem != nil {
			return nil, problem
		}
		return object, nil
	}
	return nil, malformed("unknown or missing message type")
}

var limitFields = []string{
	"maxFrameBytes", "maxSnapshotBytes", "maxNodes", "maxDepth", "maxStringBytes",
	"maxRelationTargets", "maxQueuedFrames", "maxPendingWaiters", "maxSessions",
	"maxLogRecordBytes", "maxLogQueue",
}
