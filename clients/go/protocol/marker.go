package protocol

import (
	"crypto/hmac"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"strconv"
	"strings"
)

// MarkerOSCCode is the private OSC number carrying render-commit markers.
//
// The legacy frame-based inbox ConPTY dropped DCS/APC/OSC 8 while private OSC
// survived. Termwright's pinned passthrough ConPTY now forwards those families,
// but OSC 8487 remains the one encoding certified across every supported host.
// The number is chosen clear of everything in use
// (xterm's allocations, OSC 8, 9, 99, 133, 633, 697, 777+): 84 and 87 are the
// ASCII codes of `T` and `W`, for termwright.
const MarkerOSCCode = 8487

// MarkerOSCPrefix opens a marker payload, immediately after `OSC 8487;`. It is
// a self-identifying guard: if anything ever claims 8487, a marker still says
// what it is rather than being mistaken for that feature's payload.
const MarkerOSCPrefix = "twm;"

// bel is the terminator this implementation emits; receivers also accept ST.
const bel = "\x07"

// st is the terminator a receiver must also accept.
const st = "\x1b\\"

// MarkerMACBytes is how much of the HMAC-SHA256 output the marker retains.
const MarkerMACBytes = 16

// markerMACChars is the length of the unpadded base64url MAC.
const markerMACChars = 22

// maxSafeInteger matches JavaScript's Number.MAX_SAFE_INTEGER: revisions must
// survive a round trip through the reference implementation unchanged.
const maxSafeInteger = 1<<53 - 1

// RenderMarker is a verified marker: the revision it commits, and its MAC.
type RenderMarker struct {
	Revision int64
	MAC      string
}

// ComputeMAC returns base64url(HMAC-SHA256(token, "sessionID:revision"))[:16],
// unpadded. The token is used as opaque UTF-8 key bytes, never decoded.
func ComputeMAC(token, sessionID string, revision int64) string {
	mac := hmac.New(sha256.New, []byte(token))
	fmt.Fprintf(mac, "%s:%d", sessionID, revision)
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil)[:MarkerMACBytes])
}

// EncodeMarker builds the full OSC sequence committing revision.
//
// Write it to stdout immediately after the last byte of the render it commits;
// it is a frame-commit signal, not a data carrier.
func EncodeMarker(token, sessionID string, revision int64) (string, error) {
	if token == "" {
		return "", violation("marker-argument", "token must not be empty")
	}
	if sessionID == "" {
		return "", violation("marker-argument", "sessionId must not be empty")
	}
	if revision <= 0 || revision > maxSafeInteger {
		return "", violation("marker-argument", "revision must be a positive safe integer")
	}
	return "\x1b]" + strconv.Itoa(MarkerOSCCode) + ";" + MarkerOSCPrefix +
		strconv.FormatInt(revision, 10) + ";" + ComputeMAC(token, sessionID, revision) + bel, nil
}

// VerifyMarkerPayload parses and verifies an OSC payload — everything after
// `OSC 8487;`.
//
// Total function: hostile payloads return ok == false, never an error value to
// interpret. Only canonically formatted revisions are accepted, so "1" and
// "01" cannot both authenticate the same commit, and the MAC compare is
// constant time.
//
// A trailing BEL or ST is tolerated: a VT parser consumes the terminator
// before dispatching, so a handler normally passes a payload without one,
// while a caller scanning raw output with a regex keeps it. Both must work.
func VerifyMarkerPayload(payload, token, sessionID string) (RenderMarker, bool) {
	if token == "" || sessionID == "" {
		return RenderMarker{}, false
	}
	text := strings.TrimSuffix(payload, bel)
	if text == payload {
		text = strings.TrimSuffix(payload, st)
	}
	if !strings.HasPrefix(text, MarkerOSCPrefix) {
		return RenderMarker{}, false
	}
	body := text[len(MarkerOSCPrefix):]
	separator := strings.Index(body, ";")
	if separator < 0 {
		return RenderMarker{}, false
	}
	revisionText, mac := body[:separator], body[separator+1:]
	if !canonicalRevision(revisionText) || !canonicalMAC(mac) {
		return RenderMarker{}, false
	}
	revision, err := strconv.ParseInt(revisionText, 10, 64)
	if err != nil || revision <= 0 || revision > maxSafeInteger {
		return RenderMarker{}, false
	}
	expected := ComputeMAC(token, sessionID, revision)
	if subtle.ConstantTimeCompare([]byte(expected), []byte(mac)) != 1 {
		return RenderMarker{}, false
	}
	return RenderMarker{Revision: revision, MAC: mac}, true
}

// canonicalRevision accepts ^[1-9][0-9]{0,15}$ — no sign, no leading zero.
func canonicalRevision(text string) bool {
	if len(text) == 0 || len(text) > 16 || text[0] < '1' || text[0] > '9' {
		return false
	}
	for index := 1; index < len(text); index++ {
		if text[index] < '0' || text[index] > '9' {
			return false
		}
	}
	return true
}

// canonicalMAC accepts exactly markerMACChars base64url characters.
func canonicalMAC(mac string) bool {
	if len(mac) != markerMACChars {
		return false
	}
	for index := 0; index < len(mac); index++ {
		c := mac[index]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9', c == '-', c == '_':
		default:
			return false
		}
	}
	return true
}
