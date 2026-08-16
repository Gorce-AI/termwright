package protocol

import (
	"context"
	"log/slog"
	"strings"
)

// SlogHandler bridges Go's structured logger onto the semantic channel.
//
// A TUI must not write diagnostics to the screen, so the usual advice is to
// send them to a file. Under the driver they can go somewhere better: install
// this handler and every record the application already emits becomes
// assertable test state, with the application's own logging calls unchanged.
//
//	logs := protocol.NewSlogHandler(client, nil)
//	slog.SetDefault(slog.New(logs))
//
// Dormant by construction: NewSlogHandler on a nil client returns a handler
// that reports it is not enabled, so slog skips the call site entirely.
type SlogHandler struct {
	client *Client
	// minLevel filters before the budget does, so a debug-heavy application
	// does not spend its rate on records the driver would discard.
	minLevel slog.Level
	attrs    []slog.Attr
	group    string
}

// SlogHandlerOptions tunes the bridge. The zero value forwards everything from
// slog.LevelInfo up.
type SlogHandlerOptions struct {
	// Level is the minimum severity to forward. Defaults to slog.LevelDebug,
	// so anything the application's own logger admits is forwarded.
	Level slog.Leveler
}

// NewSlogHandler returns a handler forwarding to client. A nil client yields a
// handler that is never enabled, which is the dormant path.
func NewSlogHandler(client *Client, options *SlogHandlerOptions) *SlogHandler {
	level := slog.Level(slog.LevelDebug)
	if options != nil && options.Level != nil {
		level = options.Level.Level()
	}
	return &SlogHandler{client: client, minLevel: level}
}

// Enabled reports whether records at this level are worth formatting.
func (h *SlogHandler) Enabled(_ context.Context, level slog.Level) bool {
	return h.client != nil && level >= h.minLevel
}

// Handle converts one slog record and hands it to the client, which decides
// whether the budget allows it out.
func (h *SlogHandler) Handle(_ context.Context, record slog.Record) error {
	if h.client == nil {
		return nil
	}

	attrs := make(map[string]any, record.NumAttrs()+len(h.attrs))
	for _, attr := range h.attrs {
		collectAttr(attrs, h.group, attr)
	}
	record.Attrs(func(attr slog.Attr) bool {
		collectAttr(attrs, h.group, attr)
		return true
	})

	out := LogRecord{
		Level:   LevelForSlog(record.Level),
		Message: record.Message,
	}
	if !record.Time.IsZero() {
		out.TS = record.Time.UnixMilli()
	}
	if name, ok := attrs["logger"].(string); ok {
		out.Logger = name
		delete(attrs, "logger")
	}
	if len(attrs) > 0 {
		out.Attrs = attrs
	}

	// A logging call must never fail the application: the client drops what it
	// cannot send and counts it, and the gap in seq reports the loss.
	h.client.LogRecordWith(out)
	return nil
}

// WithAttrs returns a handler that adds attrs to every record.
func (h *SlogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	next := *h
	next.attrs = append(append([]slog.Attr{}, h.attrs...), attrs...)
	return &next
}

// WithGroup returns a handler that prefixes keys with name, using the dotted
// notation the wire format expects.
func (h *SlogHandler) WithGroup(name string) slog.Handler {
	if name == "" {
		return h
	}
	next := *h
	next.group = h.group + name + "."
	return &next
}

// LevelForSlog maps a slog level onto the wire's closed ladder. slog has no
// trace or fatal of its own: anything below Debug is trace, and anything above
// Error is fatal.
func LevelForSlog(level slog.Level) LogLevel {
	switch {
	case level < slog.LevelDebug:
		return LevelTrace
	case level < slog.LevelInfo:
		return LevelDebug
	case level < slog.LevelWarn:
		return LevelInfo
	case level < slog.LevelError:
		return LevelWarn
	case level < slog.LevelError+4:
		return LevelError
	default:
		return LevelFatal
	}
}

// collectAttr flattens one attribute, resolving groups into dotted keys.
func collectAttr(into map[string]any, prefix string, attr slog.Attr) {
	value := attr.Value.Resolve()
	if value.Kind() == slog.KindGroup {
		group := prefix
		if attr.Key != "" {
			group = prefix + attr.Key + "."
		}
		for _, nested := range value.Group() {
			collectAttr(into, group, nested)
		}
		return
	}
	key := prefix + attr.Key
	switch value.Kind() {
	case slog.KindBool:
		into[key] = value.Bool()
	case slog.KindInt64:
		into[key] = value.Int64()
	case slog.KindUint64:
		into[key] = value.Uint64()
	case slog.KindFloat64:
		into[key] = value.Float64()
	case slog.KindString:
		into[key] = value.String()
	case slog.KindTime:
		into[key] = value.Time().UnixMilli()
	case slog.KindDuration:
		into[key] = value.Duration().Milliseconds()
	default:
		// Errors and arbitrary values: keep the text rather than drop the key.
		into[key] = strings.TrimSpace(value.String())
	}
}
