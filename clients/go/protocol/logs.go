package protocol

import (
	"encoding/json"
	"fmt"
	"math"
	"sort"
	"strings"
)

// LogLevel is one rung of the severity ladder. The set is closed: it is the
// intersection of the ladders used by Go slog, Python logging, Rust tracing,
// pino and winston, so every bridge maps onto it without inventing a level.
type LogLevel string

// The severity ladder, least to most severe.
const (
	LevelTrace LogLevel = "trace"
	LevelDebug LogLevel = "debug"
	LevelInfo  LogLevel = "info"
	LevelWarn  LogLevel = "warn"
	LevelError LogLevel = "error"
	LevelFatal LogLevel = "fatal"
)

// LogLevels lists the ladder in order.
var LogLevels = []LogLevel{LevelTrace, LevelDebug, LevelInfo, LevelWarn, LevelError, LevelFatal}

// LogLevelSeverity is the numeric severity of each level; higher is worse.
var LogLevelSeverity = map[LogLevel]int{
	LevelTrace: 10, LevelDebug: 20, LevelInfo: 30,
	LevelWarn: 40, LevelError: 50, LevelFatal: 60,
}

// MaxLogAttrs bounds the number of attribute keys on one record.
const MaxLogAttrs = 64

var logLevelSet = map[string]struct{}{
	"trace": {}, "debug": {}, "info": {}, "warn": {}, "error": {}, "fatal": {},
}

var logRecordFields = []string{"ts", "level", "message", "attrs", "logger", "seq", "revision"}

// ValidLogLevel reports whether level is one of the six.
func ValidLogLevel(level LogLevel) bool {
	_, ok := logLevelSet[string(level)]
	return ok
}

// LogRecord is one application log record.
//
// TS is Unix epoch milliseconds, not session-relative: an adapter has no
// reliable view of when the driver considers the session to have started, so
// the wall clock is the only clock both sides agree on without negotiating.
// The driver rebases it onto the session timeline.
type LogRecord struct {
	TS      int64    `json:"ts"`
	Level   LogLevel `json:"level"`
	Message string   `json:"message"`
	// Attrs is flat structured context: scalars only, because nested values
	// make a record's size unbounded and depth-dependent. Bridges flatten.
	Attrs  map[string]any `json:"attrs,omitempty"`
	Logger string         `json:"logger,omitempty"`
	// Seq is a per-session counter assigned by the adapter. A gap tells the
	// driver records were dropped upstream, not lost in transit.
	Seq      int64 `json:"seq"`
	Revision int64 `json:"revision,omitempty"`
}

// LogMessage carries one record to the driver.
type LogMessage struct {
	Type   string     `json:"type"`
	Record *LogRecord `json:"record"`
}

// NewLogMessage wraps a record in its envelope.
func NewLogMessage(record *LogRecord) LogMessage {
	return LogMessage{Type: "log", Record: record}
}

// ValidateLogRecord checks an untrusted record against limits, mirroring
// ValidateSnapshot: measured against maxLogRecordBytes first, then checked
// field by field. Returns nil when the record is acceptable.
func ValidateLogRecord(value any, limits Limits) error {
	projected, err := ProjectDTO(value, limits.MaxDepth)
	if err != nil {
		code := "schema"
		if ViolationCode(err) == "dto-depth" {
			code = "depth"
		}
		return invalid(code, "%s", err.Error())
	}

	serialised, err := marshalCanonical(projected)
	if err != nil {
		return invalid("schema", "log record is not JSON-serialisable")
	}
	if len(serialised) > limits.MaxLogRecordBytes {
		return invalid("bytes", "log record is %d bytes, ceiling is %d", len(serialised), limits.MaxLogRecordBytes)
	}

	record, ok := projected.(map[string]any)
	if !ok {
		return invalid("schema", "log record must be an object")
	}

	for key := range record {
		known := false
		for _, field := range logRecordFields {
			if key == field {
				known = true
				break
			}
		}
		if !known {
			return invalid("schema", "unknown log record property %q", key)
		}
	}

	if ts, ok := safeNonNegative(record["ts"]); !ok || ts == 0 {
		return invalid("schema", "ts must be a positive safe integer (epoch milliseconds)")
	}
	level, _ := record["level"].(string)
	if _, known := logLevelSet[level]; !known {
		names := make([]string, 0, len(LogLevels))
		for _, item := range LogLevels {
			names = append(names, string(item))
		}
		return invalid("schema", "level must be one of %s", strings.Join(names, ", "))
	}
	message, ok := record["message"].(string)
	if !ok {
		return invalid("schema", "message must be a string")
	}
	if len(message) > limits.MaxStringBytes {
		return invalid("string-bytes", "message exceeds %d UTF-8 bytes", limits.MaxStringBytes)
	}
	if _, ok := safeNonNegative(record["seq"]); !ok {
		return invalid("schema", "seq must be a non-negative safe integer")
	}

	if logger, present := record["logger"]; present {
		text, ok := logger.(string)
		if !ok {
			return invalid("schema", "logger must be a string")
		}
		if len(text) > limits.MaxStringBytes {
			return invalid("string-bytes", "logger exceeds %d UTF-8 bytes", limits.MaxStringBytes)
		}
	}

	if revision, present := record["revision"]; present {
		if value, ok := safeNonNegative(revision); !ok || value == 0 {
			return invalid("revision", "revision must be a positive safe integer")
		}
	}

	if attrsValue, present := record["attrs"]; present {
		attrs, ok := attrsValue.(map[string]any)
		if !ok {
			return invalid("schema", "attrs must be a flat object")
		}
		if len(attrs) > MaxLogAttrs {
			return invalid("count", "attrs carries %d keys, ceiling is %d", len(attrs), MaxLogAttrs)
		}
		// Sorted so a rejection names the same key run to run.
		keys := make([]string, 0, len(attrs))
		for key := range attrs {
			keys = append(keys, key)
		}
		sort.Strings(keys)
		for _, key := range keys {
			if len(key) > limits.MaxStringBytes {
				return invalid("string-bytes", "attribute key %q exceeds the string ceiling", key)
			}
			switch attr := attrs[key].(type) {
			case nil, bool:
			case string:
				if len(attr) > limits.MaxStringBytes {
					return invalid("string-bytes", "attribute %q exceeds the string ceiling", key)
				}
			case float64:
				if math.IsNaN(attr) || math.IsInf(attr, 0) {
					return invalid("schema", "attribute %q must be a finite number", key)
				}
			default:
				return invalid("schema", "attribute %q must be a string, number, boolean or null", key)
			}
		}
	}
	return nil
}

func safeNonNegative(value any) (float64, bool) {
	number, ok := value.(float64)
	if !ok || number != math.Trunc(number) || number < 0 || number > maxSafeInteger {
		return 0, false
	}
	return number, true
}

// Validate marshals the record and runs it through ValidateLogRecord, so an
// adapter checks exactly the bytes the driver will see.
func (r *LogRecord) Validate(limits Limits) error {
	body, err := marshalCanonical(r)
	if err != nil {
		return invalid("schema", "log record is not JSON-serialisable")
	}
	var parsed any
	if err := json.Unmarshal(body, &parsed); err != nil {
		return invalid("schema", "log record is not JSON-serialisable")
	}
	return ValidateLogRecord(parsed, limits)
}

// FlattenAttrs turns nested context into dotted keys, as the wire requires:
// {"db": {"host": "x"}} becomes {"db.host": "x"}. Values that are still not
// scalars afterwards are rendered as text, because losing a value's shape
// beats dropping the record that carries it.
func FlattenAttrs(value map[string]any) map[string]any {
	flat := make(map[string]any, len(value))
	flattenInto(flat, "", value, 0)
	return flat
}

func flattenInto(into map[string]any, prefix string, value map[string]any, depth int) {
	for key, item := range value {
		name := prefix + key
		switch typed := item.(type) {
		case map[string]any:
			if depth < 4 {
				flattenInto(into, name+".", typed, depth+1)
				continue
			}
			into[name] = fmt.Sprint(typed)
		case nil, bool, string:
			into[name] = typed
		case int, int8, int16, int32, int64, uint, uint8, uint16, uint32, uint64:
			into[name] = typed
		case float32, float64:
			into[name] = typed
		default:
			into[name] = fmt.Sprint(typed)
		}
	}
}
