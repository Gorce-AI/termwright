# Artifact Security 2.0

Status: **IMPLEMENTED — EXTERNAL CERTIFICATION PENDING**

## Boundary

`ArtifactSecurityPolicy` replaces the scalar artifact option. The resolved,
secure-default policy is owned by a terminal session and inherited by its trace.
Raw recording requires `{ mode: 'raw' }`; there is no compatibility field.

All Trace v4 strings are projected before the append-only staging spool:
terminal output, input/action records, semantics, logs and attributes, crash
tails, diagnostics, metadata and environment values. Therefore the private
temporary trace and the published trace have the same policy. The writer never
writes raw and rewrites later.

## Terminal stream

The sanitizer is stateful across UTF-8 chunks and separates printable data from
CSI and string controls (OSC, DCS, APC and PM). Exact registered values can span
chunks and SGR controls. Control payloads are sanitized before they are emitted.
Unterminated or over-capacity control data fails secure. Regex rules require an
explicit maximum match length so their streaming look-behind stays bounded.

Masks use the canonical Unicode 15 grapheme provider to preserve terminal cell
width. Inputs and already-committed sensitive semantic values extend the secret
registry; callers can explicitly register credentials in the policy. This does
not claim automatic discovery of arbitrary credentials.

## Screenshots

Known-sensitive semantic rectangles are handed to the screenshot renderer.
Their original glyphs never enter SVG or PNG: exact cell rectangles are painted
before rasterisation. MCP live and trace screenshots both use paired semantics.

## Evidence

- trace canary covers input/paste, split chunks, ANSI-interleaved output, OSC,
  Unicode, semantic values, logs, crash tails and diagnostics, then scans every
  persisted Trace v4 member for the canary;
- sanitizer tests cover bounded patterns, incomplete controls and canonical
  geometry for ZWJ emoji, flags, Devanagari and CJK;
- screenshot test proves the source glyph is absent from SVG and the exact cells
  are covered.

Remaining external evidence: OS/runtime canary matrix and raster-level canary
scan in clean-room consumers.
