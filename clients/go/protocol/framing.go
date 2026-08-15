package protocol

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"math"
	"unicode/utf8"
)

// FrameHeaderBytes is the size of the big-endian length prefix on every frame.
const FrameHeaderBytes = 4

// Frame is one decoded wire frame: the raw body plus its projected value.
//
// Raw is kept so a caller can unmarshal into a concrete type without paying
// for a second parse; Value is the plain, checked representation used by the
// validators.
type Frame struct {
	Raw   json.RawMessage
	Value any
}

var reservedKeys = map[string]struct{}{
	"__proto__": {}, "constructor": {}, "prototype": {},
}

// EncodeFrame serialises v into one length-prefixed frame.
//
// A json.RawMessage passes through byte for byte, which is how callers send a
// body whose exact encoding matters. Returns a *Violation if v is not
// JSON-encodable or the body exceeds maxFrameBytes.
func EncodeFrame(v any, maxFrameBytes int) ([]byte, error) {
	if maxFrameBytes <= 0 {
		return nil, violation("frame-malformed", "maxFrameBytes must be positive")
	}
	body, err := marshalCanonical(v)
	if err != nil {
		return nil, violation("frame-malformed", "message is not JSON-serialisable")
	}
	if len(body) > maxFrameBytes {
		return nil, violation("frame-oversized", "encoded frame is %d bytes, ceiling is %d", len(body), maxFrameBytes)
	}
	frame := make([]byte, FrameHeaderBytes+len(body))
	binary.BigEndian.PutUint32(frame[:FrameHeaderBytes], uint32(len(body)))
	copy(frame[FrameHeaderBytes:], body)
	return frame, nil
}

// marshalCanonical encodes without Go's HTML escaping, which would otherwise
// turn <, > and & into <-style escapes the reference encoder does not emit.
func marshalCanonical(v any) ([]byte, error) {
	var buffer bytes.Buffer
	encoder := json.NewEncoder(&buffer)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimSuffix(buffer.Bytes(), []byte("\n")), nil
}

// Decoder reassembles length-prefixed JSON frames from a byte stream.
//
// The declared length is checked against the ceiling before any body is read.
// The first violation poisons the decoder permanently: resynchronising on an
// attacker-chosen offset is worse than dropping the connection.
type Decoder struct {
	maxFrameBytes int
	maxDepth      int
	buffer        []byte
	failure       *Violation
}

// NewDecoder returns a decoder bounded by maxFrameBytes and maxDepth.
func NewDecoder(maxFrameBytes, maxDepth int) *Decoder {
	return &Decoder{maxFrameBytes: maxFrameBytes, maxDepth: maxDepth}
}

// Buffered reports the bytes held back waiting for the rest of a frame.
func (d *Decoder) Buffered() int { return len(d.buffer) }

// Push feeds raw bytes and returns the frames that completed, in order.
func (d *Decoder) Push(chunk []byte) ([]Frame, error) {
	if d.failure != nil {
		return nil, violation("decoder-poisoned",
			"decoder failed earlier (%s) and accepts no further input", d.failure.Code)
	}
	frames, err := d.push(chunk)
	if err != nil {
		if v, ok := err.(*Violation); ok {
			d.failure = v
		} else {
			d.failure = violation("frame-malformed", "frame decoding failed")
		}
		d.buffer = nil
		return nil, d.failure
	}
	return frames, nil
}

func (d *Decoder) push(chunk []byte) ([]Frame, error) {
	d.buffer = append(d.buffer, chunk...)
	var frames []Frame
	offset := 0

	for len(d.buffer)-offset >= FrameHeaderBytes {
		length := int(binary.BigEndian.Uint32(d.buffer[offset : offset+FrameHeaderBytes]))
		if length == 0 {
			return nil, violation("frame-malformed", "frame length must be non-zero")
		}
		if length > d.maxFrameBytes {
			return nil, violation("frame-oversized", "frame declares %d bytes, ceiling is %d", length, d.maxFrameBytes)
		}
		end := offset + FrameHeaderBytes + length
		if len(d.buffer) < end {
			break
		}
		body := d.buffer[offset+FrameHeaderBytes : end]
		value, err := DecodeBody(body, d.maxDepth)
		if err != nil {
			return nil, err
		}
		raw := make(json.RawMessage, len(body))
		copy(raw, body)
		frames = append(frames, Frame{Raw: raw, Value: value})
		offset = end
	}

	if offset > 0 {
		d.buffer = append(d.buffer[:0], d.buffer[offset:]...)
	}
	if len(d.buffer) > d.maxFrameBytes+FrameHeaderBytes {
		return nil, violation("frame-oversized", "buffered %d bytes without a complete frame", len(d.buffer))
	}
	return frames, nil
}

// DecodeBody parses and projects one frame body.
func DecodeBody(body []byte, maxDepth int) (any, error) {
	if !utf8.Valid(body) {
		return nil, violation("frame-encoding", "frame body is not valid UTF-8")
	}
	var parsed any
	decoder := json.NewDecoder(bytes.NewReader(body))
	if err := decoder.Decode(&parsed); err != nil {
		return nil, violation("frame-malformed", "frame body is not valid JSON")
	}
	if decoder.More() {
		return nil, violation("frame-malformed", "frame body carries trailing data")
	}
	return ProjectDTO(parsed, maxDepth)
}

// ProjectDTO checks an untrusted parsed value against the DTO rules and
// returns it. Rejects reserved property names, non-finite numbers, and
// nesting beyond maxDepth.
//
// Unlike the reference implementation this cannot reject unpaired surrogates:
// encoding/json replaces them with U+FFFD before we ever see the string. The
// shared vectors mark those cases optional for that reason.
func ProjectDTO(value any, maxDepth int) (any, error) {
	return projectNode(value, 0, maxDepth, "$")
}

func projectNode(value any, depth, maxDepth int, path string) (any, error) {
	switch typed := value.(type) {
	case nil, bool, string:
		return value, nil
	case float64:
		if math.IsNaN(typed) || math.IsInf(typed, 0) {
			return nil, violation("dto-scalar", "non-finite number at %s", path)
		}
		return value, nil
	case []any:
		if depth > maxDepth {
			return nil, violation("dto-depth", "nesting exceeds %d at %s", maxDepth, path)
		}
		for index, item := range typed {
			if _, err := projectNode(item, depth+1, maxDepth, path+"[]"); err != nil {
				return nil, err
			}
			_ = index
		}
		return value, nil
	case map[string]any:
		if depth > maxDepth {
			return nil, violation("dto-depth", "nesting exceeds %d at %s", maxDepth, path)
		}
		for key, item := range typed {
			if _, reserved := reservedKeys[key]; reserved {
				return nil, violation("dto-key", "reserved property name %q at %s", key, path)
			}
			if _, err := projectNode(item, depth+1, maxDepth, path+"."+key); err != nil {
				return nil, err
			}
		}
		return value, nil
	default:
		return nil, violation("dto-scalar", "value at %s is not JSON-representable", path)
	}
}
