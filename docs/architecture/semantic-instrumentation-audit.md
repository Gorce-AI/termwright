# Semantic instrumentation — Phase 0 audit (index + decisions)

Campaign #34: zero-config semantic instrumentation. This document indexes the
per-area audits and records the coordinator's Phase 1 decision series. The
per-area files are the evidence; this file is the verdict.

## Audits (evidence, with file:line citations against pinned versions)

| Area | File | Auditor |
|---|---|---|
| Repository (protocol, driver, transport, adapters) | `audit/repo.md` | impl-driver |
| Ink 7.1.1 + Node/Bun interception | `audit/ink.md` | impl-ink |
| OpenTUI 0.5.3 | `audit/opentui.md` | impl-ink |
| Textual 8.2.8 + Python bootstrap | `audit/textual.md` | impl-clients |
| Ratatui 0.30.2 + Cargo patch | `audit/ratatui.md` | impl-clients |
| tview + go.work mechanism | `audit/tview.md` | impl-examples |
| Bubble Tea / Bubbles / Lip Gloss (v1+v2) | `audit/charm.md` | impl-examples |

## Findings that changed the plan (not merely confirmed it)

1. **The OSC 8487 marker stays.** Its unique property is position in the byte
   stream ("screen after byte N corresponds to revision R"); no side channel
   can answer that, and a byte-counting FRAME_END dies on ConPTY re-encoding
   (measured ratio 1.03 on a plain transport). It carries zero metadata
   (revision number + MAC), which is §35 "PTY output sequencing", not the
   forbidden metadata-in-escapes. (repo.md §2)
2. **Inherited socketpair is unavailable through @lydell/node-pty 1.1.0** (no
   stdio/fd options). Path+token rendezvous survives *by necessity*; a
   launcher process or PTY-layer change is a costed Phase 1+ option, not a
   small edit. (repo.md §3.1)
3. **OpenTUI writes frames from a native Zig thread** (`useThread=true`
   default) — stdout interception sees nothing there; the probe needs the
   custom-stdout / addPostProcessFn / NativeSpanFeed route. Bun is the
   *primary* runtime for OpenTUI (bun:ffi), not a fallback. (opentui.md)
4. **`module.registerHooks` is missing on Node 22.9** (present 22.22+/24);
   the async `module.register` works across our range at the cost of an
   ExperimentalWarning on 22.x. Bun `--preload` works with three verified
   traps (argv-only, flag before entry, resolved-path filtering in onLoad).
   (ink.md)
5. **All four current adapters share one defect the spec forbids**: an
   unrecognized widget is *dropped* and its children reparented, instead of
   surviving as a generic node. Fixing this is a correctness win, not
   convenience. (repo.md §1.3)
6. **Current Textual adapter publishes `region` instead of
   `visible_region = clip ∩ region`** — bounds of cells the user cannot see;
   also conflates "scrolled out" with `display=False`. Fix lands with
   Phase 3. (textual.md)
7. **Default limits already contradict each other**: `maxNodes` (5 000) ×
   measured 217.5 B/node = 1 062 KiB > `maxSnapshotBytes` (1 024 KiB), before
   any provenance byte. (driver NOTES, measured)
8. **go.work generation must inherit the user's workspace** (`go work edit
   -json`), or multi-module projects break; Charm v2 lives at
   `charm.land/...`, not `github.com/charmbracelet/.../v2`; tview `afterDraw`
   runs under the application write-lock (publication must be a non-blocking
   channel send); Lip Gloss provenance is real only on v2 via the Compositor
   layer/Hit-test and per-cell link params. (tview.md, charm.md)

## Phase 1 decision series (binding; CHANGELOG-contracts entries follow the code)

D1. **Role vocabulary stays closed and versioned.** The "never drop an
    unknown widget" rule is met by a first-class `generic` role plus a
    required `frameworkType` on such nodes. Exhaustive switches in
    trace/screenshot/ui/mcp/AccessKit keep working; the unknown widget keeps
    its bounds, text and children. The four adapter publication filters are
    replaced accordingly (conformance snapshots will change — planned, not
    accidental).

D2. **Provenance lives in the tree as "one source per node + exceptions"**
    (`p: <source>` + optional `px: {field: source}`), the measured +6..22 B
    variant. Rationale: node facts overwhelmingly share one source; mixed
    nodes pay exactly where someone will ask. Descriptive strings are ruled
    out by arithmetic (+91 %). Deep per-property history stays probe-side,
    read lazily by the inspector (retention contract to be defined in the
    inspector phase). The source enum is closed:
    `annotation | recognizer | framework | correlation | heuristic`.

D3. **Deltas gain explicit field retraction.** A recognizer that loses
    confidence must be able to clear a fact; today's delta format cannot
    express "unset". Applies to `applyTreeDelta` + validation + all client
    implementations, with test vectors.

D4. **Limits rebalance**: `maxSnapshotBytes` default rises to 2 MiB
    (absolute cap 8 MiB unchanged), restoring headroom for D1+D2. The
    additive-limits rule and directional strictness stay.

D5. **Transport**: path+token rendezvous stays for Phase 1 (finding 2). The
    probe lifecycle (HELLO capabilities, FRAME_BEGIN/END, FULL_SNAPSHOT) maps
    onto the existing hello/ack + revisions + get-tree resync — FULL_SNAPSHOT
    under backpressure *is* the existing `get-tree` resync with a new
    trigger. The marker remains the frame/byte correlation mechanism (finding
    1). A launcher-based inherited-FD transport is a costed follow-up, not a
    Phase 1 blocker.

D6. **Probe IR is a new layer in `packages/protocol`** (facts, not
    interpretations): sessions, frames, objects with framework-native type +
    stable-or-frame-local identity (explicitly encoded which), geometry with
    clipping, observable state, render/layout operations, annotations.
    Recognizers consume IR and emit the normalized semantic tree through the
    D2 merge precedence: annotation > recognizer > framework mapping >
    render inference > heuristic — with physical facts (bounds, focus,
    visibility, cells) never casually overridden by annotations.

### Amendments (post-review by impl-protocol, accepted)

- **D3 amended**: wholesale node replacement already expresses retraction
  (field absence in the replacing node — pinned by a #25-era test), so no
  separate retraction mechanism is added; a second road would rot. The one
  real gap was the **cursor**, closed by the rule "producer loses the cursor
  → full snapshot". Partial node patches remain a *costed future option* to
  be revisited only with measurements showing D2's `px` makes full-node
  resends expensive in practice. The protocol README documents that a
  recognizer losing confidence re-sends the full node without the field.
- **FRAME_BEGIN is a capability-gated optional** — no framework audited can
  guarantee a pre-frame hook (tview beforeDraw can veto; OpenTUI's callback
  sits inside loop(); Textual is post-frame only; Charm splits submit from
  flush). The driver treats its absence as "frames unannounced" and keeps
  the quiet-stream barrier as the fallback, never as "no frame exists".
- IR hard rules from the audits: identity is a typed capability
  (`stable` | `frame-local`, never fabricated); geometry distinguishes
  `intendedRect` from `visibleRect` (names `region`/`area` banned — three
  conflicting meanings each across audits); observability is tri-valued
  (observed / absent / unobservable-listed), not `undefined` doing double
  duty.

Phase order stays as specified: 1 IR+transport → 2 OpenTUI slice → 3 Textual
→ 4 Ink → 5 tview → 6 Ratatui → 7 Charm → 8 annotation SDKs → 9
inspector/CI/docs/legacy removal.
