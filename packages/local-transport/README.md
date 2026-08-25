# @termwright/local-transport

Private Node-only workspace primitives for authenticated local IPC. The
resource broker and run journal bundle this implementation for bounded
length-prefixed JSON framing,
fatal UTF-8 decoding, typed request/response envelopes, constant-time secret
comparison, generated tokens and endpoint allocation/listen/cleanup.

This package is not published or application-facing. Protocol-specific message
validation and domain errors remain in the consuming service.
