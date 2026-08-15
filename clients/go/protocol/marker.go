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

// MarkerDCSPrefix starts the marker payload inside the DCS sequence.
const MarkerDCSPrefix = "twm;"

// MarkerDCSFinal is the DCS final byte a VT parser dispatches on.
const MarkerDCSFinal = "t"

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

// EncodeMarker builds the full DCS sequence committing revision.
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
	return "\x1bP" + MarkerDCSPrefix + strconv.FormatInt(revision, 10) + ";" +
		ComputeMAC(token, sessionID, revision) + "\x1b\\", nil
}

// VerifyMarkerPayload parses and verifies the bytes between ESC P and ESC \.
//
// Total function: hostile payloads return ok == false, never an error value to
// interpret. Only canonically formatted revisions are accepted, so "1" and
// "01" cannot both authenticate the same commit, and the MAC compare is
// constant time.
func VerifyMarkerPayload(payload, token, sessionID string) (RenderMarker, bool) {
	if token == "" || sessionID == "" {
		return RenderMarker{}, false
	}
	if !strings.HasPrefix(payload, MarkerDCSPrefix) {
		return RenderMarker{}, false
	}
	body := payload[len(MarkerDCSPrefix):]
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
