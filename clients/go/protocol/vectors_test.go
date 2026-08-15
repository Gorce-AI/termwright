package protocol

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// vectorDir is clients/test-vectors, generated from the normative TypeScript
// implementation. Every expectation in this file comes from there.
func vectorDir(t *testing.T) string {
	t.Helper()
	return filepath.Join("..", "..", "test-vectors")
}

func loadVectors(t *testing.T, name string, into any) {
	t.Helper()
	body, err := os.ReadFile(filepath.Join(vectorDir(t), name+".json"))
	if err != nil {
		t.Fatalf("reading %s vectors: %v", name, err)
	}
	if err := json.Unmarshal(body, into); err != nil {
		t.Fatalf("parsing %s vectors: %v", name, err)
	}
}

func decodeJSON(t *testing.T, body []byte) any {
	t.Helper()
	var value any
	if err := json.Unmarshal(body, &value); err != nil {
		t.Fatalf("parsing vector payload: %v", err)
	}
	return value
}

// -- constants -------------------------------------------------------------

func TestConstantsMatchTheReference(t *testing.T) {
	var vectors struct {
		ProtocolID       string   `json:"protocolId"`
		ProtocolVersion  int      `json:"protocolVersion"`
		FrameHeaderBytes int      `json:"frameHeaderBytes"`
		MarkerDCSPrefix  string   `json:"markerDcsPrefix"`
		MarkerDCSFinal   string   `json:"markerDcsFinal"`
		MarkerMACBytes   int      `json:"markerMacBytes"`
		Roles            []string `json:"roles"`
		Actions          []string `json:"actions"`
		Capabilities     []string `json:"capabilities"`
		DefaultLimits    Limits   `json:"defaultLimits"`
		AbsoluteLimits   Limits   `json:"absoluteLimits"`
		Env              struct {
			Endpoint string `json:"endpoint"`
			Token    string `json:"token"`
			Protocol string `json:"protocol"`
		} `json:"env"`
	}
	loadVectors(t, "constants", &vectors)

	if vectors.ProtocolID != ProtocolID || vectors.ProtocolVersion != ProtocolVersion {
		t.Errorf("protocol identity drifted: %s/%d", vectors.ProtocolID, vectors.ProtocolVersion)
	}
	if vectors.FrameHeaderBytes != FrameHeaderBytes || vectors.MarkerMACBytes != MarkerMACBytes {
		t.Error("framing or marker sizes drifted")
	}
	if vectors.MarkerDCSPrefix != MarkerDCSPrefix || vectors.MarkerDCSFinal != MarkerDCSFinal {
		t.Error("marker DCS identity drifted")
	}
	if vectors.DefaultLimits != DefaultLimits || vectors.AbsoluteLimits != AbsoluteLimits {
		t.Error("limits drifted from the reference")
	}
	if vectors.Env.Endpoint != EnvEndpoint || vectors.Env.Token != EnvToken || vectors.Env.Protocol != EnvProtocol {
		t.Error("environment variable names drifted")
	}
	for _, role := range vectors.Roles {
		if !ValidRole(Role(role)) {
			t.Errorf("role %q is missing from the Go role set", role)
		}
	}
	if len(vectors.Roles) != len(roleSet) {
		t.Errorf("role set has %d entries, vectors have %d", len(roleSet), len(vectors.Roles))
	}
	for _, action := range vectors.Actions {
		if !ValidAction(Action(action)) {
			t.Errorf("action %q is missing from the Go action set", action)
		}
	}
	for _, capability := range vectors.Capabilities {
		if !ValidCapability(Capability(capability)) {
			t.Errorf("capability %q is missing from the Go capability set", capability)
		}
	}
}

// -- framing ---------------------------------------------------------------

type framingVectors struct {
	MaxFrameBytes int `json:"maxFrameBytes"`
	Encode        []struct {
		Name      string          `json:"name"`
		Value     json.RawMessage `json:"value"`
		BodyJSON  string          `json:"bodyJson"`
		BodyBytes int             `json:"bodyBytes"`
		FrameHex  string          `json:"frameHex"`
	} `json:"encode"`
	Decode []struct {
		Name      string            `json:"name"`
		ChunksHex []string          `json:"chunksHex"`
		Messages  []json.RawMessage `json:"messages"`
	} `json:"decode"`
	Reject []struct {
		Name      string `json:"name"`
		StreamHex string `json:"streamHex"`
		Code      string `json:"code"`
		Optional  bool   `json:"optional"`
	} `json:"reject"`
}

func TestFramingEncodeMatchesReferenceBytes(t *testing.T) {
	var vectors framingVectors
	loadVectors(t, "framing", &vectors)

	for _, testCase := range vectors.Encode {
		t.Run(testCase.Name, func(t *testing.T) {
			// The reference body is the canonical encoding: Go's map ordering
			// would differ, so the body is passed through verbatim and it is
			// the framing that is under test.
			frame, err := EncodeFrame(json.RawMessage(testCase.BodyJSON), vectors.MaxFrameBytes)
			if err != nil {
				t.Fatalf("encoding failed: %v", err)
			}
			if got := hexOf(frame); got != testCase.FrameHex {
				t.Errorf("frame bytes differ\n got %s\nwant %s", got, testCase.FrameHex)
			}
		})
	}
}

func TestFramingDecodeYieldsReferenceMessages(t *testing.T) {
	var vectors framingVectors
	loadVectors(t, "framing", &vectors)

	for _, testCase := range vectors.Decode {
		t.Run(testCase.Name, func(t *testing.T) {
			decoder := NewDecoder(vectors.MaxFrameBytes, DefaultLimits.MaxDepth)
			var produced []Frame
			for _, chunk := range testCase.ChunksHex {
				frames, err := decoder.Push(unhex(t, chunk))
				if err != nil {
					t.Fatalf("decoding failed: %v", err)
				}
				produced = append(produced, frames...)
			}
			if len(produced) != len(testCase.Messages) {
				t.Fatalf("decoded %d frames, want %d", len(produced), len(testCase.Messages))
			}
			for index, frame := range produced {
				want := decodeJSON(t, testCase.Messages[index])
				if !jsonEqual(frame.Value, want) {
					t.Errorf("frame %d: got %#v, want %#v", index, frame.Value, want)
				}
			}
			if decoder.Buffered() != 0 {
				t.Errorf("decoder still holds %d bytes", decoder.Buffered())
			}
		})
	}
}

func TestFramingRejectsHostileFrames(t *testing.T) {
	var vectors framingVectors
	loadVectors(t, "framing", &vectors)

	for _, testCase := range vectors.Reject {
		t.Run(testCase.Name, func(t *testing.T) {
			if testCase.Optional {
				// encoding/json replaces unpaired surrogates with U+FFFD before
				// this package can see them, so the case is not detectable here.
				t.Skip("not detectable with encoding/json")
			}
			decoder := NewDecoder(vectors.MaxFrameBytes, DefaultLimits.MaxDepth)
			_, err := decoder.Push(unhex(t, testCase.StreamHex))
			if err == nil {
				t.Fatal("hostile frame was accepted")
			}
			if code := ViolationCode(err); code != testCase.Code {
				t.Errorf("code %q, want %q (%v)", code, testCase.Code, err)
			}
		})
	}
}

func TestDecoderNeverResumesAfterAViolation(t *testing.T) {
	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	if _, err := decoder.Push([]byte{0, 0, 0, 0}); err == nil {
		t.Fatal("zero-length frame was accepted")
	}
	frame, err := EncodeFrame(RevisionCommit{Type: "revision-commit", Revision: 1}, DefaultLimits.MaxFrameBytes)
	if err != nil {
		t.Fatal(err)
	}
	_, err = decoder.Push(frame)
	if ViolationCode(err) != "decoder-poisoned" {
		t.Errorf("poisoned decoder accepted more input: %v", err)
	}
}

func TestPartialFramesAreBuffered(t *testing.T) {
	decoder := NewDecoder(DefaultLimits.MaxFrameBytes, DefaultLimits.MaxDepth)
	frame, err := EncodeFrame(RevisionCommit{Type: "revision-commit", Revision: 1}, DefaultLimits.MaxFrameBytes)
	if err != nil {
		t.Fatal(err)
	}
	frames, err := decoder.Push(frame[:len(frame)-1])
	if err != nil || len(frames) != 0 {
		t.Fatalf("partial frame produced %d messages (%v)", len(frames), err)
	}
	frames, err = decoder.Push(frame[len(frame)-1:])
	if err != nil || len(frames) != 1 {
		t.Fatalf("completed frame produced %d messages (%v)", len(frames), err)
	}
}

// -- marker ----------------------------------------------------------------

func TestMarkerVectors(t *testing.T) {
	var vectors struct {
		Encode []struct {
			Token       string `json:"token"`
			SessionID   string `json:"sessionId"`
			Revision    int64  `json:"revision"`
			MAC         string `json:"mac"`
			Payload     string `json:"payload"`
			Sequence    string `json:"sequence"`
			SequenceHex string `json:"sequenceHex"`
		} `json:"encode"`
		VerifyReject []struct {
			Name      string `json:"name"`
			Payload   string `json:"payload"`
			Token     string `json:"token"`
			SessionID string `json:"sessionId"`
		} `json:"verifyReject"`
	}
	loadVectors(t, "marker", &vectors)

	for _, testCase := range vectors.Encode {
		sequence, err := EncodeMarker(testCase.Token, testCase.SessionID, testCase.Revision)
		if err != nil {
			t.Fatalf("encoding marker for revision %d: %v", testCase.Revision, err)
		}
		if sequence != testCase.Sequence {
			t.Errorf("marker sequence differs\n got %q\nwant %q", sequence, testCase.Sequence)
		}
		if got := hexOf([]byte(sequence)); got != testCase.SequenceHex {
			t.Errorf("marker bytes differ\n got %s\nwant %s", got, testCase.SequenceHex)
		}
		marker, ok := VerifyMarkerPayload(testCase.Payload, testCase.Token, testCase.SessionID)
		if !ok || marker.Revision != testCase.Revision || marker.MAC != testCase.MAC {
			t.Errorf("reference marker did not verify: %+v ok=%v", marker, ok)
		}
	}

	for _, testCase := range vectors.VerifyReject {
		if _, ok := VerifyMarkerPayload(testCase.Payload, testCase.Token, testCase.SessionID); ok {
			t.Errorf("forged marker %q verified", testCase.Name)
		}
	}
}

func TestMarkerRejectsBadArguments(t *testing.T) {
	for _, revision := range []int64{0, -1, 1 << 54} {
		if _, err := EncodeMarker("token", "session", revision); err == nil {
			t.Errorf("revision %d was accepted", revision)
		}
	}
	if _, err := EncodeMarker("", "session", 1); err == nil {
		t.Error("empty token was accepted")
	}
	if _, err := EncodeMarker("token", "", 1); err == nil {
		t.Error("empty session id was accepted")
	}
}

// -- snapshots -------------------------------------------------------------

func TestSnapshotVectors(t *testing.T) {
	var vectors struct {
		Limits Limits `json:"limits"`
		Accept []struct {
			Name     string          `json:"name"`
			Snapshot json.RawMessage `json:"snapshot"`
		} `json:"accept"`
		Reject []struct {
			Name     string          `json:"name"`
			Snapshot json.RawMessage `json:"snapshot"`
			Code     string          `json:"code"`
		} `json:"reject"`
	}
	loadVectors(t, "snapshots", &vectors)

	if vectors.Limits != DefaultLimits {
		t.Fatal("vector limits differ from DefaultLimits")
	}
	for _, testCase := range vectors.Accept {
		t.Run("accept/"+testCase.Name, func(t *testing.T) {
			if err := ValidateSnapshot(decodeJSON(t, testCase.Snapshot), vectors.Limits); err != nil {
				t.Errorf("valid snapshot rejected: %v", err)
			}
		})
	}
	for _, testCase := range vectors.Reject {
		t.Run("reject/"+testCase.Name, func(t *testing.T) {
			err := ValidateSnapshot(decodeJSON(t, testCase.Snapshot), vectors.Limits)
			if err == nil {
				t.Fatal("invalid snapshot accepted")
			}
			if code := ValidationCode(err); code != testCase.Code {
				t.Errorf("code %q, want %q (%v)", code, testCase.Code, err)
			}
		})
	}
}

func TestSnapshotBuiltFromStructsValidates(t *testing.T) {
	snapshot := NewSnapshot("s-1", 1, 80, 24)
	snapshot.RootIDs = []string{"root"}
	snapshot.Nodes = []Node{
		{ID: "root", Role: RoleApplication, Name: "app"},
		{
			ID:       "ok",
			ParentID: "root",
			Role:     RoleButton,
			Name:     "OK",
			Bounds:   &Rect{Row: 1, Column: 1, Width: 4, Height: 1},
			State:    &State{Focused: Bool(true)},
			Actions:  []Action{ActionFocus, ActionActivate},
		},
	}
	if err := snapshot.Validate(DefaultLimits); err != nil {
		t.Fatalf("struct-built snapshot rejected: %v", err)
	}
}

// -- messages --------------------------------------------------------------

type messageCase struct {
	Name    string          `json:"name"`
	Message json.RawMessage `json:"message"`
	Code    string          `json:"code"`
}

func TestMessageVectors(t *testing.T) {
	var vectors struct {
		AdapterToDriver struct {
			Accept []messageCase `json:"accept"`
			Reject []messageCase `json:"reject"`
		} `json:"adapterToDriver"`
		DriverToAdapter struct {
			Accept []messageCase `json:"accept"`
			Reject []messageCase `json:"reject"`
		} `json:"driverToAdapter"`
	}
	loadVectors(t, "messages", &vectors)

	directions := []struct {
		name   string
		parse  func(any, Limits) (map[string]any, error)
		accept []messageCase
		reject []messageCase
	}{
		{"adapter", ParseAdapterMessage, vectors.AdapterToDriver.Accept, vectors.AdapterToDriver.Reject},
		{"driver", ParseDriverMessage, vectors.DriverToAdapter.Accept, vectors.DriverToAdapter.Reject},
	}

	for _, direction := range directions {
		for _, testCase := range direction.accept {
			t.Run(direction.name+"/accept/"+testCase.Name, func(t *testing.T) {
				if _, err := direction.parse(decodeJSON(t, testCase.Message), DefaultLimits); err != nil {
					t.Errorf("valid message rejected: %v", err)
				}
			})
		}
		for _, testCase := range direction.reject {
			t.Run(direction.name+"/reject/"+testCase.Name, func(t *testing.T) {
				_, err := direction.parse(decodeJSON(t, testCase.Message), DefaultLimits)
				if err == nil {
					t.Fatal("invalid message accepted")
				}
				if code := ParseCode(err); code != testCase.Code {
					t.Errorf("code %q, want %q (%v)", code, testCase.Code, err)
				}
			})
		}
	}
}

// -- helpers ---------------------------------------------------------------

const hexDigits = "0123456789abcdef"

func hexOf(data []byte) string {
	out := make([]byte, 0, len(data)*2)
	for _, b := range data {
		out = append(out, hexDigits[b>>4], hexDigits[b&0x0f])
	}
	return string(out)
}

func unhex(t *testing.T, text string) []byte {
	t.Helper()
	if len(text)%2 != 0 {
		t.Fatalf("odd-length hex string %q", text)
	}
	out := make([]byte, len(text)/2)
	for index := 0; index < len(out); index++ {
		high, low := hexValue(t, text[index*2]), hexValue(t, text[index*2+1])
		out[index] = high<<4 | low
	}
	return out
}

func hexValue(t *testing.T, c byte) byte {
	t.Helper()
	switch {
	case c >= '0' && c <= '9':
		return c - '0'
	case c >= 'a' && c <= 'f':
		return c - 'a' + 10
	case c >= 'A' && c <= 'F':
		return c - 'A' + 10
	}
	t.Fatalf("invalid hex digit %q", c)
	return 0
}

// jsonEqual compares two decoded JSON values structurally.
func jsonEqual(a, b any) bool {
	left, err := json.Marshal(a)
	if err != nil {
		return false
	}
	right, err := json.Marshal(b)
	if err != nil {
		return false
	}
	return string(left) == string(right)
}
