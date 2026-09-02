/**
 * Generates the cross-language conformance vectors under `clients/test-vectors/`.
 *
 * The TypeScript package `@termwright/protocol` is the normative implementation:
 * every expected value written here is produced by it, never hand-written.
 * The Python, Go and Rust clients assert against these files, so a divergence
 * in any client shows up as a failing test rather than as silent drift.
 *
 * Run from the repository root after building the protocol package:
 *
 *   pnpm --filter @termwright/protocol build
 *   node clients/test-vectors/generate.mjs
 *
 * Regenerating prints a warning for every case that kept its name and changed
 * its verdict, because that is the one failure a regeneration cannot show you
 * on its own: a new rule firing earlier than an old one leaves the old rule's
 * case green while it stops testing the rule it is named for. Read those lines
 * before committing. `--strict` turns the warning into a non-zero exit for a
 * caller that wants a gate rather than a report; CI does not need it, since
 * the vectors job already fails on any uncommitted diff.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';

import {
  ABSOLUTE_LIMITS,
  ADAPTER_CAPABILITIES,
  CAPABILITY_GRAPH,
  CAPABILITY_GRAPH_VERSION,
  CAPABILITY_CONFORMANCE_CLAIMS,
  CAPABILITY_NODE_CATEGORIES,
  CAPABILITY_NODE_LAYERS,
  CONDITION_KINDS,
  EVIDENCE_PROVIDER_CAPABILITIES,
  EVIDENCE_PROVIDER_TYPES,
  LOG_LEVELS,
  LOG_LEVEL_SEVERITY,
  MAX_LOG_ATTRS,
  DEFAULT_LIMITS,
  FRAME_HEADER_BYTES,
  MARKER_MAC_BYTES,
  MARKER_OSC_CODE,
  MARKER_OSC_PREFIX,
  PROBE_CAPABILITIES,
  PROBE_UNOBSERVABLE_FIELDS,
  PROVENANCE_SOURCES,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  RUN_EVENT_CLASSES,
  RUN_EVENT_VERSION,
  RUN_ID_KINDS,
  DEFAULT_RUN_EVENT_LIMITS,
  RUN_STATES,
  TERMINAL_RUN_STATES,
  RUN_STATE_TRANSITIONS,
  RUNTIME_PREREQUISITES,
  SESSION_CAPABILITIES,
  SEMANTIC_ACTIONS,
  SEMANTIC_NODE_KEYS,
  SEMANTIC_ROLES,
  SEMANTIC_STATE_KEYS,
  createFrameDecoder,
  encodeFrame,
  encodeMarker,
  parseAdapterMessage,
  parseDriverMessage,
  validateSnapshot,
  verifyMarkerPayload,
  intersectRects,
  viewportIntersection,
  createRunEvent,
  createRunId,
  validateRunEvent,
  RunEventStreamValidator,
  RunEventProducer,
  RunEventJournal,
} from '../../packages/protocol/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

/**
 * Every named case's verdict, keyed by `group:name`.
 *
 * Keyed by name and not by position: inserting a case shifts every index after
 * it, and a check that reported those as changes would be noise nobody reads.
 */
function verdicts(value) {
  const found = new Map();
  const walk = (node, group) => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, group);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    if (typeof node.name === 'string') {
      const code = node.code ?? node.expect?.code ?? null;
      const ok = node.expect?.ok;
      const verdict = code ?? (ok === undefined ? null : ok ? 'accept' : 'reject');
      if (verdict !== null) found.set(`${group}:${node.name}`, verdict);
    }
    for (const [key, child] of Object.entries(node)) {
      walk(child, Array.isArray(child) ? key : group);
    }
  };
  walk(value, 'root');
  return found;
}

/** Verdicts that changed while the case kept its name — see {@link masking}. */
const shifted = [];

function write(name, value) {
  const path = join(here, name);

  // A vector whose name stayed put while its verdict moved is the one thing a
  // regeneration cannot show you on its own. It usually means a new rule now
  // fires EARLIER than the one the case was written for: the case still passes
  // in every client, while the rule it was named for quietly loses its
  // coverage. That happened to `parent-cycle` when generic nodes began
  // requiring a frameworkType, and the only trace was one line of the diff.
  let before = new Map();
  try {
    before = verdicts(JSON.parse(readFileSync(path, 'utf8')));
  } catch {
    // No previous file, or an unreadable one: nothing to compare against.
  }
  for (const [key, verdict] of verdicts(value)) {
    const was = before.get(key);
    if (was !== undefined && was !== verdict) shifted.push({ file: name, key, was, now: verdict });
  }

  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`wrote ${name}`);
}

/**
 * Reports the verdict shifts collected during this run.
 *
 * A warning and not a failure: a shift is often exactly what the author
 * intended, and the regeneration itself is already gated by the CI job that
 * diffs the committed files. The point is that nobody can regenerate without
 * being told which case now proves something different. `--strict` turns it
 * into an exit code for anyone who wants the harder gate.
 */
function masking() {
  if (shifted.length === 0) return;
  console.log('');
  console.log('  !! these cases kept their name and changed their verdict:');
  for (const { file, key, was, now } of shifted) {
    console.log(`     ${file} ${key}: ${was} -> ${now}`);
  }
  console.log('');
  console.log('  Check each one still proves what its name says. A case that');
  console.log('  now trips an earlier rule leaves its own rule uncovered in');
  console.log('  every client, and stays green while doing it.');
  if (process.argv.includes('--strict')) process.exit(1);
}

// --------------------------------------------------------------------------
// constants.json — the closed sets and numbers every client hard-codes.
// --------------------------------------------------------------------------

write('constants.json', {
  protocolId: PROTOCOL_ID,
  protocolVersion: PROTOCOL_VERSION,
  frameHeaderBytes: FRAME_HEADER_BYTES,
  markerOscCode: MARKER_OSC_CODE,
  markerOscPrefix: MARKER_OSC_PREFIX,
  markerMacBytes: MARKER_MAC_BYTES,
  env: {
    endpoint: 'TERMWRIGHT_ENDPOINT',
    token: 'TERMWRIGHT_TOKEN',
  },
  logLevels: [...LOG_LEVELS],
  logLevelSeverity: { ...LOG_LEVEL_SEVERITY },
  maxLogAttrs: MAX_LOG_ATTRS,
  roles: [...SEMANTIC_ROLES],
  actions: [...SEMANTIC_ACTIONS],
  capabilities: [...ADAPTER_CAPABILITIES],
  capabilityGraphVersion: CAPABILITY_GRAPH_VERSION,
  capabilityNodeCategories: [...CAPABILITY_NODE_CATEGORIES],
  capabilityNodeLayers: [...CAPABILITY_NODE_LAYERS],
  sessionCapabilities: [...SESSION_CAPABILITIES],
  evidenceProviderCapabilities: [...EVIDENCE_PROVIDER_CAPABILITIES],
  evidenceProviderTypes: [...EVIDENCE_PROVIDER_TYPES],
  runtimePrerequisites: [...RUNTIME_PREREQUISITES],
  conditionKinds: [...CONDITION_KINDS],
  capabilityConformanceClaims: [...CAPABILITY_CONFORMANCE_CLAIMS],
  provenanceSources: [...PROVENANCE_SOURCES],
  probeCapabilities: [...PROBE_CAPABILITIES],
  probeUnobservableFields: [...PROBE_UNOBSERVABLE_FIELDS],
  probeIdentityKinds: ['stable', 'frame-local'],
  runIdKinds: [...RUN_ID_KINDS],
  runEventClasses: [...RUN_EVENT_CLASSES],
  runEventVersion: RUN_EVENT_VERSION,
  runEventLimits: { ...DEFAULT_RUN_EVENT_LIMITS },
  runStates: [...RUN_STATES],
  terminalRunStates: [...TERMINAL_RUN_STATES],
  runStateTransitions: Object.fromEntries(Object.entries(RUN_STATE_TRANSITIONS).map(([state, next]) => [state, [...next]])),
  // Every field a node and a state may carry. A client asserts its own
  // structures against these, so a field added to the protocol fails three
  // client suites at once instead of waiting to be noticed in production —
  // which is how frameworkType, occlusion, p and px each went missing.
  nodeKeys: [...SEMANTIC_NODE_KEYS],
  stateKeys: [...SEMANTIC_STATE_KEYS],
  defaultLimits: { ...DEFAULT_LIMITS },
  absoluteLimits: { ...ABSOLUTE_LIMITS },
});

// The graph itself is a cross-language executable vector. Clients may project
// it into native enums, but may not maintain a second dependency matrix.
write('capability-graph.json', CAPABILITY_GRAPH);

// --------------------------------------------------------------------------
// observations.json — epistemic tags and half-open geometry across clients.
// --------------------------------------------------------------------------

const geometryCases = [
  { name: 'fully-inside', rect: { row: 1, column: 2, width: 4, height: 2 }, columns: 10, rows: 5 },
  { name: 'partially-clipped', rect: { row: 4, column: 8, width: 4, height: 2 }, columns: 10, rows: 5 },
  { name: 'touching-outside-edge', rect: { row: 5, column: 10, width: 4, height: 2 }, columns: 10, rows: 5 },
].map((entry) => ({ ...entry, expect: viewportIntersection(entry.rect, entry.columns, entry.rows) }));

const evidence = (providerId = 'vector-provider') => ({
  source: 'framework',
  method: 'native',
  strength: 'authoritative',
  providerId,
});

const geometry = (rect) => ({
  displayed: { status: 'known', value: true, evidence: evidence() },
  intendedRect: { status: 'known', value: { ...rect }, evidence: evidence() },
  visibleRect: { status: 'known', value: { ...rect }, evidence: evidence() },
});

const unknownGeometry = () => ({
  displayed: { status: 'unsupported', capability: 'displayed', reason: 'framework-unobservable' },
  intendedRect: { status: 'unsupported', capability: 'intended-geometry', reason: 'framework-unobservable' },
  visibleRect: { status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable' },
});

const qualifiedSnapshot = {
  v: 3,
  sessionId: 'observation-vector',
  revision: 7,
  columns: 12,
  rows: 6,
  rootIds: ['approve', 'cover'],
  nodes: [
    {
      id: 'approve', role: 'button', name: 'Approve',
      geometry: {
        displayed: { status: 'known', value: true, evidence: evidence() },
        intendedRect: { status: 'known', value: { row: 2, column: 2, width: 6, height: 2 }, evidence: evidence() },
        visibleRect: { status: 'known', value: { row: 2, column: 2, width: 6, height: 2 }, evidence: evidence() },
      },
    },
    {
      id: 'cover', role: 'dialog', name: 'Blocking dialog',
      geometry: {
        displayed: { status: 'known', value: true, evidence: evidence() },
        intendedRect: { status: 'known', value: { row: 2, column: 5, width: 4, height: 2 }, evidence: evidence() },
        visibleRect: { status: 'known', value: { row: 2, column: 5, width: 4, height: 2 }, evidence: evidence() },
      },
    },
  ],
  coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence() },
  hitGrid: {
    status: 'known', evidence: evidence('hit-grid'), value: { regions: [
      { rect: { row: 2, column: 2, width: 3, height: 1 }, recipientId: 'approve' },
      { rect: { row: 2, column: 5, width: 4, height: 1 }, recipientId: 'cover' },
      { rect: { row: 3, column: 2, width: 3, height: 1 }, recipientId: 'approve' },
      { rect: { row: 3, column: 5, width: 4, height: 1 }, recipientId: 'cover' },
    ] },
  },
};
if (!validateSnapshot(qualifiedSnapshot, DEFAULT_LIMITS).ok) throw new Error('qualified observation vector must validate');

write('observations.json', {
  statuses: ['known', 'absent', 'unknown', 'unsupported'],
  examples: [
    { status: 'known', value: true, evidence: evidence() },
    { status: 'absent', reason: 'detached', evidence: evidence() },
    { status: 'unknown', reason: 'awaiting-revision-pair' },
    { status: 'unsupported', capability: 'hit-test', reason: 'framework-unobservable' },
  ],
  halfOpenTouch: intersectRects(
    { row: 1, column: 1, width: 3, height: 2 },
    { row: 1, column: 4, width: 2, height: 2 },
  ),
  geometryCases,
  qualifiedSnapshot,
});

// --------------------------------------------------------------------------
// run-events.json — orchestration identity, envelope and stream invariants.
// --------------------------------------------------------------------------

const runUuid = (suffix) => `00000000-0000-4000-8000-${suffix.toString(16).padStart(12, '0')}`;
const runIdentity = {
  invocationId: createRunId('invocation', () => runUuid(1)),
  runId: createRunId('run', () => runUuid(2)),
  projectId: createRunId('project', () => runUuid(3)),
  specId: createRunId('spec', () => runUuid(4)),
  runnerTaskId: createRunId('runner-task', () => runUuid(5)),
  executionId: createRunId('execution', () => runUuid(6)),
  attemptId: createRunId('attempt', () => runUuid(7)),
};
const runProducer = createRunId('producer', () => runUuid(8));
const runEvent = (seq, overrides = {}) => createRunEvent({
  producerId: runProducer,
  epoch: 0,
  seq,
  eventClass: 'authoritative',
  type: 'attempt.started',
  monotonicTime: seq * 10,
  wallTime: 1_800_000_000_000 + seq,
  identity: runIdentity,
  payload: { retry: 0 },
  randomUUID: () => runUuid(20 + seq),
  ...overrides,
});
const runAcceptInputs = [
  { name: 'attempt-started', value: runEvent(0) },
  { name: 'diagnostic-with-cause', value: runEvent(1, { eventClass: 'diagnostic', type: 'adapter.warning', causedBy: [runEvent(0).eventId], payload: { code: 'slow-frame' } }) },
  { name: 'state-without-wall-clock', value: runEvent(2, { eventClass: 'state', type: 'session.snapshot', wallTime: undefined, payload: { status: 'running' } }) },
];
const self = runEvent(3);
const runRejectInputs = [
  { name: 'obsolete-envelope-version', value: { ...runEvent(0), v: 1 } },
  { name: 'cross-domain-id', value: { ...runEvent(0), identity: { ...runIdentity, attemptId: runIdentity.executionId } } },
  { name: 'detached-attempt-identity', value: { ...runEvent(0), identity: { invocationId: runIdentity.invocationId, runId: runIdentity.runId, attemptId: runIdentity.attemptId } } },
  { name: 'self-cause', value: { ...self, causedBy: [self.eventId] } },
  { name: 'non-finite-time', value: { ...runEvent(0), monotonicTime: null } },
  { name: 'unknown-envelope-field', value: { ...runEvent(0), surprise: true } },
];
const annotateRunEvents = (entries, expected) => entries.map(({ name, value }) => {
  const result = validateRunEvent(value);
  if (result.ok !== expected) throw new Error(`run event vector ${name}: expected ok=${expected}, got ${JSON.stringify(result)}`);
  return expected ? { name, value } : { name, value, code: result.code, detail: result.detail };
});
const streamVerdict = (name, values) => {
  const validator = new RunEventStreamValidator();
  const results = values.map((value) => validator.accept(value));
  return { name, values, verdicts: results.map((result) => result.ok ? 'accept' : result.code) };
};
let gapId = 500;
let gapTime = 1;
const vectorJournal = new RunEventJournal({
  invocationId: runIdentity.invocationId,
  runId: runIdentity.runId,
  gapProducer: new RunEventProducer({
    producerId: createRunId('producer', () => runUuid(499)),
    epoch: 0,
    randomUUID: () => runUuid(gapId++),
    monotonicNow: () => gapTime++,
  }),
  limits: { maxAuthoritativeEvents: 4, maxStateKeys: 4, maxDiagnosticEvents: 1 },
});
vectorJournal.append(runEvent(0, { eventClass: 'diagnostic', type: 'adapter.warning' }));
vectorJournal.append(runEvent(1, { eventClass: 'diagnostic', type: 'adapter.warning' }));
const diagnosticGapBatch = await vectorJournal.flushThrough(vectorJournal.barrier(), () => {});

const stateJournal = new RunEventJournal({
  invocationId: runIdentity.invocationId,
  runId: runIdentity.runId,
  gapProducer: new RunEventProducer({
    producerId: createRunId('producer', () => runUuid(498)),
    epoch: 0,
    randomUUID: () => runUuid(gapId++),
    monotonicNow: () => gapTime++,
  }),
});
stateJournal.append(runEvent(0, { eventClass: 'state', type: 'run.state', payload: { status: 'scheduled' } }), { stateKey: 'run:state' });
stateJournal.append(runEvent(1, { eventClass: 'state', type: 'run.state', payload: { status: 'running' } }), { stateKey: 'run:state' });
const coalescedStateBatch = await stateJournal.flushThrough(stateJournal.barrier(), () => {});

write('run-events.json', {
  version: 2,
  idKinds: [...RUN_ID_KINDS],
  eventClasses: [...RUN_EVENT_CLASSES],
  limits: { ...DEFAULT_RUN_EVENT_LIMITS },
  identity: runIdentity,
  accept: annotateRunEvents(runAcceptInputs, true),
  reject: annotateRunEvents(runRejectInputs, false),
  streams: [
    streamVerdict('monotonic', [runEvent(0), runEvent(1)]),
    streamVerdict('duplicate-sequence-coordinate', [runEvent(0), { ...runEvent(1), seq: 0 }]),
    streamVerdict('monotonic-clock-regression', [runEvent(0, { monotonicTime: 10 }), runEvent(1, { monotonicTime: 9 })]),
    streamVerdict('epoch-regression', [runEvent(0, { epoch: 2 }), runEvent(1, { epoch: 1 })]),
  ],
  journal: {
    diagnosticGap: diagnosticGapBatch,
    coalescedState: coalescedStateBatch,
  },
});

// --------------------------------------------------------------------------
// framing.json
// --------------------------------------------------------------------------

const FRAME_CEILING = DEFAULT_LIMITS.maxFrameBytes;

const encodeCases = [
  { name: 'empty-object', value: {} },
  { name: 'revision-commit', value: { type: 'revision-commit', revision: 1 } },
  {
    name: 'hello',
    value: {
      type: 'hello',
      protocol: PROTOCOL_ID,
      token: 'test-token',
      adapter: { name: 'vectors', version: '0.1.0' },
      capabilities: ['tree', 'intended-geometry', 'states'],
    },
  },
  { name: 'unicode-name', value: { type: 'error', code: 'internal', message: 'zażółć gęślą jaźń — ✓ 🎛' } },
  { name: 'nested', value: { a: { b: { c: [1, 2, 3, null, true, -0.5] } } } },
];

const framingEncode = encodeCases.map(({ name, value }) => {
  const frame = encodeFrame(value, FRAME_CEILING);
  return {
    name,
    value,
    /** Canonical JSON body as produced by `JSON.stringify` (key order matters). */
    bodyJson: JSON.stringify(value),
    bodyBytes: frame.length - FRAME_HEADER_BYTES,
    frameHex: hex(frame),
  };
});

/** Concatenation of two frames, to exercise multi-frame and split-chunk decoding. */
const pairStream = Buffer.concat([
  Buffer.from(encodeFrame({ type: 'revision-commit', revision: 1 }, FRAME_CEILING)),
  Buffer.from(encodeFrame({ type: 'revision-commit', revision: 2 }, FRAME_CEILING)),
]);

const framingDecode = [
  {
    name: 'single-frame-one-chunk',
    chunksHex: [hex(Buffer.from(encodeFrame({ type: 'revision-commit', revision: 7 }, FRAME_CEILING)))],
    messages: [{ type: 'revision-commit', revision: 7 }],
  },
  {
    name: 'two-frames-one-chunk',
    chunksHex: [hex(pairStream)],
    messages: [
      { type: 'revision-commit', revision: 1 },
      { type: 'revision-commit', revision: 2 },
    ],
  },
  {
    name: 'two-frames-byte-by-byte',
    chunksHex: [...pairStream].map((b) => Buffer.from([b]).toString('hex')),
    messages: [
      { type: 'revision-commit', revision: 1 },
      { type: 'revision-commit', revision: 2 },
    ],
  },
  {
    name: 'header-split-from-body',
    chunksHex: [hex(pairStream.subarray(0, 2)), hex(pairStream.subarray(2))],
    messages: [
      { type: 'revision-commit', revision: 1 },
      { type: 'revision-commit', revision: 2 },
    ],
  },
];

// Every decode case is replayed through the reference decoder so the recorded
// expectation cannot drift from the implementation that defines it.
for (const testCase of framingDecode) {
  const decoder = createFrameDecoder(FRAME_CEILING);
  const produced = [];
  for (const chunk of testCase.chunksHex) {
    produced.push(...decoder.push(Buffer.from(chunk, 'hex')));
  }
  const expected = JSON.stringify(testCase.messages);
  const actual = JSON.stringify(produced);
  if (expected !== actual) throw new Error(`decode vector ${testCase.name}: ${actual} !== ${expected}`);
}

function rejectFrame(name, bytes, optional = false) {
  const decoder = createFrameDecoder(FRAME_CEILING);
  let code = null;
  try {
    decoder.push(Buffer.from(bytes));
  } catch (error) {
    code = error.code;
  }
  if (code === null) throw new Error(`reject vector ${name} was accepted`);
  return { name, streamHex: hex(Buffer.from(bytes)), code, optional };
}

/** Wrap a raw body in a well-formed header, so the body itself is what fails. */
function framed(bodyText) {
  const body = Buffer.from(bodyText, 'utf8');
  const header = Buffer.alloc(FRAME_HEADER_BYTES);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

const deepNesting = `${'['.repeat(DEFAULT_LIMITS.maxDepth + 2)}1${']'.repeat(DEFAULT_LIMITS.maxDepth + 2)}`;

const framingReject = [
  rejectFrame('zero-length-frame', [0, 0, 0, 0]),
  rejectFrame('declared-length-over-ceiling', [0xff, 0xff, 0xff, 0xff, 0x7b]),
  rejectFrame('body-not-json', [0, 0, 0, 3, 0x7b, 0x7b, 0x7b]),
  rejectFrame('body-not-utf8', [0, 0, 0, 3, 0x22, 0xff, 0x22]),
  // A getter or exotic prototype cannot survive JSON, but reserved keys can:
  rejectFrame('reserved-key', framed('{"__proto__":{"a":1}}')),
  rejectFrame('nesting-over-max-depth', framed(deepNesting)),
  rejectFrame('lone-surrogate-string', framed('{"a":"\\ud800"}'), true),
];

write('framing.json', {
  maxFrameBytes: FRAME_CEILING,
  note:
    'frameHex = 4-byte big-endian body length + UTF-8 JSON body. Cases marked ' +
    '"optional": true depend on a JSON parser that preserves lone surrogates; ' +
    'clients whose parser replaces them (Go) may skip those.',
  encode: framingEncode,
  decode: framingDecode,
  reject: framingReject,
});

// --------------------------------------------------------------------------
// marker.json
// --------------------------------------------------------------------------

const MARKER_TOKEN = 'v6dEXO4t9EfDoMpDPCiRxCsW1PLtN0EQ0GDvUXcAhFA';
const MARKER_SESSION = 's-0001';

const markerCases = [
  { token: MARKER_TOKEN, sessionId: MARKER_SESSION, revision: 1 },
  { token: MARKER_TOKEN, sessionId: MARKER_SESSION, revision: 2 },
  { token: MARKER_TOKEN, sessionId: MARKER_SESSION, revision: 42 },
  { token: MARKER_TOKEN, sessionId: MARKER_SESSION, revision: 9007199254740991 },
  { token: MARKER_TOKEN, sessionId: 'other-session', revision: 42 },
  { token: 'short', sessionId: MARKER_SESSION, revision: 42 },
  { token: 'zażółć-token-🎛', sessionId: 'sesja-ż', revision: 3 },
].map(({ token, sessionId, revision }) => {
  const sequence = encodeMarker(token, sessionId, revision);
  // Everything after `OSC 8487;` and before the terminator, which is what a VT
  // parser hands an OSC handler.
  const payload = sequence.slice(`\x1b]${MARKER_OSC_CODE};`.length, -1);
  const verified = verifyMarkerPayload(payload, token, sessionId);
  if (verified === null || verified.revision !== revision) {
    throw new Error(`marker vector ${sessionId}/${revision} does not round-trip`);
  }
  return {
    token,
    sessionId,
    revision,
    mac: verified.mac,
    payload,
    sequence,
    sequenceHex: hex(Buffer.from(sequence, 'utf8')),
  };
});

const markerReject = [
  { name: 'wrong-mac', payload: `${MARKER_OSC_PREFIX}42;AAAAAAAAAAAAAAAAAAAAAA` },
  { name: 'wrong-session', payload: markerCases[4].payload },
  { name: 'leading-zero-revision', payload: `${MARKER_OSC_PREFIX}042;${markerCases[2].mac}` },
  { name: 'revision-zero', payload: `${MARKER_OSC_PREFIX}0;${markerCases[2].mac}` },
  { name: 'negative-revision', payload: `${MARKER_OSC_PREFIX}-1;${markerCases[2].mac}` },
  { name: 'mac-too-short', payload: `${MARKER_OSC_PREFIX}42;${markerCases[2].mac.slice(0, -1)}` },
  { name: 'mac-not-base64url', payload: `${MARKER_OSC_PREFIX}42;${'+'.repeat(22)}` },
  { name: 'missing-prefix', payload: `xxx;42;${markerCases[2].mac}` },
  { name: 'no-separator', payload: `${MARKER_OSC_PREFIX}42${markerCases[2].mac}` },
  { name: 'empty', payload: '' },
].map(({ name, payload }) => {
  const verified = verifyMarkerPayload(payload, MARKER_TOKEN, MARKER_SESSION);
  if (verified !== null) throw new Error(`marker reject vector ${name} verified`);
  return { name, payload, token: MARKER_TOKEN, sessionId: MARKER_SESSION };
});

/**
 * The receiver tolerates a trailing terminator: a VT parser consumes it before
 * dispatching, so a handler normally sees a bare payload, while a caller
 * scanning raw output with a regex keeps it. Both have to verify, and the
 * normal path never exercises the second — which is exactly why it is here.
 */
const markerTerminators = [
  { name: 'bare-payload', suffix: '' },
  { name: 'trailing-bel', suffix: '\x07' },
  { name: 'trailing-st', suffix: '\x1b\\' },
].map(({ name, suffix }) => {
  const payload = markerCases[2].payload + suffix;
  const verified = verifyMarkerPayload(payload, MARKER_TOKEN, MARKER_SESSION);
  if (verified === null || verified.revision !== markerCases[2].revision) {
    throw new Error(`terminator vector ${name} did not verify`);
  }
  return { name, payload, token: MARKER_TOKEN, sessionId: MARKER_SESSION, revision: verified.revision };
});

write('marker.json', {
  note:
    'mac = base64url(HMAC-SHA256(key = token as UTF-8 bytes, ' +
    'msg = `${sessionId}:${revision}` as UTF-8 bytes))[:16], unpadded. ' +
    'sequence = ESC ] 8487 ";" + "twm;" + revision + ";" + mac + BEL. ' +
    '`payload` is what a VT parser hands an OSC handler: everything after ' +
    '`OSC 8487;`, terminator already consumed. Receivers must also accept a ' +
    'payload that still carries a trailing BEL or ST — see acceptTerminators.',
  oscCode: MARKER_OSC_CODE,
  oscPrefix: MARKER_OSC_PREFIX,
  macBytes: MARKER_MAC_BYTES,
  encode: markerCases,
  acceptTerminators: markerTerminators,
  verifyReject: markerReject,
});

// --------------------------------------------------------------------------
// snapshots.json
// --------------------------------------------------------------------------

const baseSnapshot = {
  v: 3,
  sessionId: 's-0001',
  revision: 1,
  columns: 80,
  rows: 24,
  cursor: { row: 0, column: 0, visible: false },
  rootIds: ['n1'],
  nodes: [
    {
      id: 'n1',
      role: 'dialog',
      name: 'Permission',
      geometry: geometry({ row: 0, column: 0, width: 40, height: 2 }),
      state: { modal: true },
    },
    {
      id: 'n2',
      parentId: 'n1',
      role: 'button',
      name: 'Approve',
      testId: 'approve',
      geometry: geometry({ row: 1, column: 2, width: 9, height: 1 }),
      state: { focused: true },
      actions: ['focus', 'activate'],
    },
    {
      id: 'n3',
      parentId: 'n1',
      role: 'button',
      name: 'Reject',
      geometry: geometry({ row: 1, column: 14, width: 8, height: 1 }),
      state: { focused: false },
      actions: ['focus', 'activate'],
    },
  ],
  coordinateSpace: { status: 'known', value: 'viewport-cells', evidence: evidence() },
  hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
};

const clone = (value) => JSON.parse(JSON.stringify(value));

function mutate(fn) {
  const copy = clone(baseSnapshot);
  fn(copy);
  return copy;
}

const snapshotAccept = [
  { name: 'dialog-with-two-buttons', snapshot: baseSnapshot },
  {
    // A node scrolled entirely out of a viewport: hidden, and specifically
    // hidden because of scrolling rather than because it was never displayed.
    name: 'offscreen-implies-hidden',
    snapshot: mutate((s) => {
      s.nodes[2].state = { hidden: true, offscreen: true };
      s.nodes[2].geometry.displayed = { status: 'known', value: true, evidence: evidence() };
      s.nodes[2].geometry.visibleRect = { status: 'absent', reason: 'not-laid-out', evidence: evidence() };
    }),
  },
  {
    // What a probe publishes: paint order observed, so the cells are
    // answerable and the driver's pointer gate opens; provenance says the
    // facts came from the framework rather than from an author or a guess.
    name: 'node-with-provenance',
    snapshot: mutate((s) => {
      s.nodes[1].p = 'framework';
      s.nodes[1].px = { name: 'annotation', testId: 'annotation' };
    }),
  },
  {
    name: 'minimal-empty-tree',
    snapshot: {
      v: 3,
      sessionId: 's',
      revision: 1,
      columns: 1,
      rows: 1,
      rootIds: [],
      nodes: [],
      coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
      hitGrid: { status: 'unsupported', capability: 'pointer-hit-grid', reason: 'framework-unobservable' },
    },
  },
  {
    name: 'hidden-node-outside-viewport',
    snapshot: mutate((s) => {
      s.nodes[2].geometry.intendedRect = { status: 'known', value: { row: 900, column: 900, width: 5, height: 1 }, evidence: evidence() };
      s.nodes[2].geometry.visibleRect = { status: 'absent', reason: 'not-laid-out', evidence: evidence() };
      s.nodes[2].state = { hidden: true };
    }),
  },
  {
    name: 'relations-and-text-ranges',
    snapshot: mutate((s) => {
      s.nodes[1].labelledBy = ['n1'];
      s.nodes[1].describedBy = ['n3'];
      s.nodes[1].textRanges = [
        { startOffset: 0, endOffset: 7, rect: { row: 1, column: 2, width: 7, height: 1 } },
      ];
    }),
  },
  {
    name: 'extended-domain-state',
    snapshot: mutate((s) => {
      s.nodes[1].extended = {
        deploymentStatus: 'rolling-out',
        retryCount: 2,
        overdue: false,
        rollout: { regions: ['eu', 'us'], progress: 0.5 },
      };
    }),
  },
  {
    name: 'public-semantic-value',
    snapshot: mutate((s) => {
      s.nodes[1].value = { status: 'known', value: '', sensitivity: 'public', evidence: evidence() };
    }),
  },
  {
    name: 'withheld-sensitive-semantic-value',
    snapshot: mutate((s) => {
      s.nodes[1].value = { status: 'withheld', reason: 'sensitive', sensitivity: 'sensitive' };
    }),
  },
  {
    name: 'authoritative-physical-input-recipes',
    snapshot: mutate((s) => {
      s.nodes[1].inputRecipes = [
        { action: 'focus', requiresFocus: false, steps: [{ kind: 'press', key: 'Tab' }] },
        { action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter' }] },
      ];
    }),
  },
  {
    name: 'application-action-strategy-provider',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.keys',
        sessionId: s.sessionId,
        revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.keys',
        },
        pointerRegions: [],
        actionRecipes: [{
          recipientId: 'n2',
          recipes: [{ action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter' }] }],
        }],
      }];
    }),
  },
  {
    name: 'application-focus-provider',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.focus', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.focus',
        },
        pointerRegions: [],
        focusState: { status: 'focused', recipientId: 'n2' },
      }, {
        providerId: 'app.focus.none', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.focus.none',
        },
        pointerRegions: [],
        focusState: { status: 'none' },
      }];
    }),
  },
  {
    name: 'application-scroll-provider',
    snapshot: mutate((s) => {
      s.nodes[1].scroll = {
        status: 'known',
        value: { axis: 'vertical', offset: 3, viewport: 4, extent: 20 },
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.scroll',
        },
      };
      s.providerEvidence = [{
        providerId: 'app.scroll', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.scroll',
        },
        pointerRegions: [],
        scrollStates: [{ recipientId: 'n2', axis: 'vertical', offset: 3, viewport: 4, extent: 20 }],
      }];
    }),
  },
  {
    name: 'application-painted-region-provider',
    snapshot: mutate((s) => {
      const region = {
        regionBounds: { row: 1, column: 2, width: 9, height: 1 },
        spans: [{ row: 1, from: 2, to: 11 }],
      };
      s.nodes[1].paintedRegion = {
        status: 'known', value: region,
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.paint',
        },
      };
      s.providerEvidence = [{
        providerId: 'app.paint', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.paint',
        },
        pointerRegions: [],
        paintedRegions: [{
          recipientId: 'n2',
          regionBounds: { ...region.regionBounds },
          spans: region.spans.map((span) => ({ ...span })),
        }],
      }];
    }),
  },
  {
    name: 'application-terminal-input-mode-provider',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.input', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.input',
        },
        pointerRegions: [],
        inputModes: {
          mouseTracking: 'drag', mouseEncoding: 'sgr', focusReporting: 'on',
        },
      }];
    }),
  },
  {
    name: 'two-roots',
    snapshot: mutate((s) => {
      s.rootIds = ['n1', 'n4'];
      s.nodes.push({ id: 'n4', role: 'status', name: 'ready', geometry: geometry({ row: 3, column: 0, width: 5, height: 1 }) });
    }),
  },
];

const snapshotReject = [
  {
    name: 'absent-requires-provenance',
    snapshot: mutate((s) => {
      s.nodes[1].geometry.visibleRect = { status: 'absent', reason: 'not-displayed' };
    }),
  },
  {
    name: 'absent-requires-authoritative-provenance',
    snapshot: mutate((s) => {
      s.nodes[1].geometry.visibleRect = {
        status: 'absent', reason: 'not-displayed',
        evidence: { ...evidence(), strength: 'diagnostic' },
      };
    }),
  },
  {
    name: 'permanent-unknown-reason-rejected',
    snapshot: mutate((s) => {
      s.nodes[1].geometry.visibleRect = { status: 'unknown', reason: 'not-reported' };
    }),
  },
  {
    name: 'extended-must-be-an-object',
    snapshot: mutate((s) => { s.nodes[1].extended = ['not', 'a', 'namespace']; }),
  },
  {
    name: 'extended-container-over-ceiling',
    snapshot: mutate((s) => {
      s.nodes[1].extended = { values: Array.from({ length: DEFAULT_LIMITS.maxRelationTargets + 1 }, () => 1) };
    }),
  },
  { name: 'duplicate-node-id', snapshot: mutate((s) => { s.nodes[2].id = 'n2'; }) },
  { name: 'unknown-parent', snapshot: mutate((s) => { s.nodes[2].parentId = 'nope'; }) },
  { name: 'self-parent', snapshot: mutate((s) => { s.nodes[2].parentId = 'n3'; }) },
  {
    name: 'parent-cycle',
    // frameworkType on both nodes on purpose: a generic node without one is
    // rejected by an earlier rule, which would leave this vector passing for
    // the wrong reason and the cycle check with no cross-language coverage.
    snapshot: mutate((s) => {
      s.rootIds = [];
      s.nodes = [
        { id: 'a', parentId: 'b', role: 'generic', frameworkType: 'Fixture', name: '', geometry: unknownGeometry() },
        { id: 'b', parentId: 'a', role: 'generic', frameworkType: 'Fixture', name: '', geometry: unknownGeometry() },
      ];
    }),
  },
  {
    // The rule that shadowed the cycle above, now covered in its own right.
    name: 'generic-without-framework-type',
    snapshot: mutate((s) => { s.nodes[1].role = 'generic'; }),
  },
  {
    // An empty string carries no more than the field's absence.
    name: 'generic-with-empty-framework-type',
    snapshot: mutate((s) => { s.nodes[1].role = 'generic'; s.nodes[1].frameworkType = ''; }),
  },
  { name: 'unknown-role', snapshot: mutate((s) => { s.nodes[1].role = 'slider'; }) },
  {
    // state.offscreen is a claim about scrolling, not a second way of saying
    // hidden: every cell outside the visible area means the node is not
    // visible, so the pair without `hidden` is a contradiction.
    name: 'offscreen-without-hidden',
    snapshot: mutate((s) => { s.nodes[1].state = { offscreen: true }; }),
  },
  {
    name: 'unknown-provenance',
    snapshot: mutate((s) => { s.nodes[1].p = 'vibes'; }),
  },
  {
    name: 'unknown-provenance-per-field',
    snapshot: mutate((s) => { s.nodes[1].px = { name: 'vibes' }; }),
  },
  {
    name: 'legacy-raw-semantic-value',
    snapshot: mutate((s) => { s.nodes[1].value = 'plaintext'; }),
  },
  { name: 'root-with-parent', snapshot: mutate((s) => { s.nodes[0].parentId = 'n2'; }) },
  {
    name: 'parentless-node-not-in-rootids',
    snapshot: mutate((s) => { delete s.nodes[2].parentId; }),
  },
  { name: 'rootid-references-unknown-node', snapshot: mutate((s) => { s.rootIds = ['zzz']; }) },
  { name: 'duplicate-rootid', snapshot: mutate((s) => { s.rootIds = ['n1', 'n1']; }) },
  { name: 'revision-zero', snapshot: mutate((s) => { s.revision = 0; }) },
  { name: 'revision-not-integer', snapshot: mutate((s) => { s.revision = 1.5; }) },
  { name: 'v1-protocol-rejected', snapshot: mutate((s) => { s.v = 1; }) },
  { name: 'empty-session-id', snapshot: mutate((s) => { s.sessionId = ''; }) },
  { name: 'zero-columns', snapshot: mutate((s) => { s.columns = 0; }) },
  {
    name: 'obsolete-bounds-rejected',
    snapshot: mutate((s) => { s.nodes[2].bounds = { row: 900, column: 900, width: 5, height: 1 }; }),
  },
  { name: 'cursor-outside-viewport', snapshot: mutate((s) => { s.cursor = { row: 99, column: 0, visible: true }; }) },
  { name: 'unknown-node-field', snapshot: mutate((s) => { s.nodes[1].colour = 'red'; }) },
  { name: 'unknown-state-field', snapshot: mutate((s) => { s.nodes[1].state = { sparkling: true }; }) },
  { name: 'unknown-action', snapshot: mutate((s) => { s.nodes[1].actions = ['detonate']; }) },
  {
    name: 'recipe-without-matching-intent',
    snapshot: mutate((s) => {
      s.nodes[1].actions = ['focus'];
      s.nodes[1].inputRecipes = [
        { action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter' }] },
      ];
    }),
  },
  {
    name: 'focus-recipe-cannot-require-focus',
    snapshot: mutate((s) => {
      s.nodes[1].inputRecipes = [
        { action: 'focus', requiresFocus: true, steps: [{ kind: 'press', key: 'Tab' }] },
      ];
    }),
  },
  {
    name: 'setvalue-recipe-requires-exactly-one-action-value',
    snapshot: mutate((s) => {
      s.nodes[1].actions = ['setValue'];
      s.nodes[1].inputRecipes = [
        { action: 'setValue', requiresFocus: true, steps: [{ kind: 'press', key: 'Control+U' }] },
      ];
    }),
  },
  {
    name: 'duplicate-recipe-action',
    snapshot: mutate((s) => {
      s.nodes[1].inputRecipes = [
        { action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter' }] },
        { action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Space' }] },
      ];
    }),
  },
  {
    name: 'recipe-step-is-strict',
    snapshot: mutate((s) => {
      s.nodes[1].inputRecipes = [
        { action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter', callback: 'forbidden' }] },
      ];
    }),
  },
  {
    name: 'provider-action-recipe-unknown-recipient',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.keys', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.keys',
        },
        pointerRegions: [],
        actionRecipes: [{
          recipientId: 'ghost',
          recipes: [{ action: 'activate', requiresFocus: true, steps: [{ kind: 'press', key: 'Enter' }] }],
        }],
      }];
    }),
  },
  {
    name: 'provider-focus-unknown-recipient',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.focus', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.focus',
        },
        pointerRegions: [],
        focusState: { status: 'focused', recipientId: 'ghost' },
      }];
    }),
  },
  {
    name: 'provider-focus-none-is-strict',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.focus', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.focus',
        },
        pointerRegions: [],
        focusState: { status: 'none', recipientId: 'n2' },
      }];
    }),
  },
  {
    name: 'provider-scroll-unknown-recipient',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.scroll', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.scroll',
        },
        pointerRegions: [],
        scrollStates: [{ recipientId: 'ghost', axis: 'vertical', offset: 0, viewport: 4, extent: 20 }],
      }];
    }),
  },
  {
    name: 'provider-scroll-outside-extent',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.scroll', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.scroll',
        },
        pointerRegions: [],
        scrollStates: [{ recipientId: 'n2', axis: 'vertical', offset: 18, viewport: 4, extent: 20 }],
      }];
    }),
  },
  {
    name: 'provider-painted-region-unknown-recipient',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.paint', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.paint',
        },
        pointerRegions: [],
        paintedRegions: [{
          recipientId: 'ghost',
          regionBounds: { row: 1, column: 2, width: 9, height: 1 },
          spans: [{ row: 1, from: 2, to: 11 }],
        }],
      }];
    }),
  },
  {
    name: 'provider-input-mode-invalid-tracking',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.input', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.input',
        },
        pointerRegions: [],
        inputModes: {
          mouseTracking: 'guess-sgr', mouseEncoding: 'sgr', focusReporting: 'on',
        },
      }];
    }),
  },
  {
    name: 'provider-input-mode-is-strict',
    snapshot: mutate((s) => {
      s.providerEvidence = [{
        providerId: 'app.input', sessionId: s.sessionId, revision: s.revision,
        status: 'available',
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.input',
        },
        pointerRegions: [],
        inputModes: {
          mouseTracking: 'drag', mouseEncoding: 'sgr', focusReporting: 'on', guessed: true,
        },
      }];
    }),
  },
  {
    name: 'painted-region-span-outside-bounds',
    snapshot: mutate((s) => {
      s.nodes[1].paintedRegion = {
        status: 'known',
        value: {
          regionBounds: { row: 1, column: 2, width: 4, height: 1 },
          spans: [{ row: 1, from: 2, to: 11 }],
        },
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.paint',
        },
      };
    }),
  },
  {
    name: 'painted-region-span-outside-viewport',
    snapshot: mutate((s) => {
      s.nodes[1].paintedRegion = {
        status: 'known',
        value: {
          regionBounds: { row: 30, column: 2, width: 4, height: 1 },
          spans: [{ row: 30, from: 2, to: 6 }],
        },
        evidence: {
          source: 'application', method: 'native', strength: 'authoritative', providerId: 'app.paint',
        },
      };
    }),
  },
  { name: 'empty-node-id', snapshot: mutate((s) => { s.nodes[2].id = ''; }) },
  { name: 'labelledby-unknown-target', snapshot: mutate((s) => { s.nodes[1].labelledBy = ['ghost']; }) },
  { name: 'text-range-reversed', snapshot: mutate((s) => {
      s.nodes[1].textRanges = [
        { startOffset: 5, endOffset: 2, rect: { row: 1, column: 2, width: 3, height: 1 } },
      ];
    }) },
  { name: 'not-an-object', snapshot: 'nope' },
  { name: 'nodes-not-an-array', snapshot: mutate((s) => { s.nodes = {}; }) },
];

for (const entry of snapshotAccept) {
  const result = validateSnapshot(entry.snapshot, DEFAULT_LIMITS);
  if (!result.ok) throw new Error(`snapshot accept vector ${entry.name}: ${result.code} ${result.detail}`);
}

const snapshotRejectWithCodes = snapshotReject.map((entry) => {
  const result = validateSnapshot(entry.snapshot, DEFAULT_LIMITS);
  if (result.ok) throw new Error(`snapshot reject vector ${entry.name} was accepted`);
  return { ...entry, code: result.code, detail: result.detail };
});

write('snapshots.json', {
  note:
    'Validated against DEFAULT_LIMITS. `code` is the reference implementation\'s ' +
    'ValidationErrorCode; clients must reject the same snapshots, and should map ' +
    'to the same code where their validator distinguishes the case.',
  limits: { ...DEFAULT_LIMITS },
  accept: snapshotAccept,
  reject: snapshotRejectWithCodes,
});

// --------------------------------------------------------------------------
// messages.json
// --------------------------------------------------------------------------

const helloMessage = {
  type: 'hello',
  protocol: PROTOCOL_ID,
  token: 'test-token',
  adapter: { name: 'vectors', version: '0.1.0' },
  capabilities: ['tree', 'states', 'actions', 'render-revisions'],
};

const helloAckMessage = {
  type: 'hello-ack',
  protocol: PROTOCOL_ID,
  sessionId: 's-0001',
  limits: { ...DEFAULT_LIMITS },
  subscribe: 'semantic',
  marker: { enabled: true },
};
const adapterAccept = [
  { name: 'hello', message: helloMessage },
  { name: 'revision-commit', message: { type: 'revision-commit', revision: 3 } },
  { name: 'snapshot', message: { type: 'semantic-full', snapshot: baseSnapshot } },
  { name: 'error', message: { type: 'error', code: 'internal', message: 'boom' } },
  ...LOG_LEVELS.map((level) => ({
    name: `log-${level}`,
    message: { type: 'log', record: { ts: 1_755_300_000_000, level, message: `a ${level} line`, seq: 0 } },
  })),
  {
    name: 'log-with-attrs',
    message: {
      type: 'log',
      record: {
        ts: 1_755_300_000_001,
        level: 'error',
        message: 'connection refused',
        // Flat scalars only: every bridge flattens before it sends.
        attrs: { 'db.host': 'localhost', 'db.port': 5432, retrying: true, cause: null },
        logger: 'db.pool',
        seq: 7,
        revision: 3,
      },
    },
  },
  {
    name: 'log-attrs-at-the-ceiling',
    message: {
      type: 'log',
      record: {
        ts: 1_755_300_000_002,
        level: 'debug',
        message: 'wide record',
        attrs: Object.fromEntries(Array.from({ length: 64 }, (_, i) => [`k${i}`, i])),
        seq: 8,
      },
    },
  },
];

/** A record built on the minimal shape, mutated for one specific defect. */
const logRecord = (overrides) => ({
  ts: 1_755_300_000_000,
  level: 'info',
  message: 'hello',
  seq: 1,
  ...overrides,
});

const adapterReject = [
  { name: 'unknown-type', message: { type: 'nope' } },
  { name: 'missing-type', message: { revision: 1 } },
  { name: 'hello-wrong-protocol', message: { ...helloMessage, protocol: 'termwright/99' } },
  { name: 'hello-empty-token', message: { ...helloMessage, token: '' } },
  { name: 'hello-unknown-capability', message: { ...helloMessage, capabilities: ['telepathy'] } },
  { name: 'hello-v1-rejected', message: { ...helloMessage, protocol: 'termwright/1' } },
  { name: 'hello-extra-field', message: { ...helloMessage, extra: 1 } },
  { name: 'revision-commit-zero', message: { type: 'revision-commit', revision: 0 } },
  { name: 'revision-commit-float', message: { type: 'revision-commit', revision: 2.5 } },
  { name: 'snapshot-invalid-body', message: { type: 'semantic-full', snapshot: { ...baseSnapshot, revision: 0 } } },
  { name: 'error-unknown-code', message: { type: 'error', code: 'meltdown', message: 'x' } },
  { name: 'log-unknown-level', message: { type: 'log', record: logRecord({ level: 'verbose' }) } },
  { name: 'log-missing-seq', message: { type: 'log', record: logRecord({ seq: undefined }) } },
  { name: 'log-negative-seq', message: { type: 'log', record: logRecord({ seq: -1 }) } },
  { name: 'log-zero-ts', message: { type: 'log', record: logRecord({ ts: 0 }) } },
  { name: 'log-float-ts', message: { type: 'log', record: logRecord({ ts: 1.5 }) } },
  { name: 'log-zero-revision', message: { type: 'log', record: logRecord({ revision: 0 }) } },
  {
    // Nested attrs are what makes a record's size unbounded and
    // depth-dependent, so the bridge flattens before it sends, never here.
    name: 'log-nested-attrs',
    message: { type: 'log', record: logRecord({ attrs: { db: { host: 'localhost' } } }) },
  },
  {
    name: 'log-array-attrs',
    message: { type: 'log', record: logRecord({ attrs: { tags: ['a', 'b'] } }) },
  },
  {
    name: 'log-attrs-over-the-ceiling',
    message: {
      type: 'log',
      record: logRecord({
        attrs: Object.fromEntries(Array.from({ length: 65 }, (_, i) => [`k${i}`, i])),
      }),
    },
  },
  {
    name: 'log-oversized-record',
    message: {
      type: 'log',
      record: logRecord({ message: 'x'.repeat(DEFAULT_LIMITS.maxLogRecordBytes + 1) }),
    },
  },
  {
    name: 'log-unknown-record-property',
    message: { type: 'log', record: logRecord({ hostname: 'laptop' }) },
  },
  {
    name: 'log-unknown-envelope-field',
    message: { type: 'log', record: logRecord({}), priority: 'high' },
  },
  { name: 'log-record-not-an-object', message: { type: 'log', record: 'oops' } },
  { name: 'obsolete-tree-delta', message: { type: 'tree-delta', baseRevision: 1, revision: 2, changed: [], removed: [] } },
];

const driverAccept = [
  { name: 'hello-ack', message: helloAckMessage },
  {
    name: 'semantic-resync-request',
    message: {
      type: 'semantic-resync-request',
      sessionId: 's-0001',
      expectedBaseRevision: 3,
      reason: 'base-mismatch',
    },
  },
  {
    // Driver traffic is read tolerantly throughout: `limits` is the object
    // that grows most often, but the rule is the same everywhere — a receiver
    // that rejected a field it had never heard of would drop the channel every
    // time the protocol gained one.
    name: 'hello-ack-unknown-limit-key',
    message: {
      ...helloAckMessage,
      limits: { ...DEFAULT_LIMITS, maxQuantumFlux: 7, maxTeaPots: 1 },
    },
  },
  {
    // An unknown field on the envelope itself.
    name: 'hello-ack-unknown-envelope-field',
    message: { ...helloAckMessage, surprise: 1 },
  },
  {
    // And one nested inside a driver-sent object, which is the less obvious
    // half of the same rule.
    name: 'hello-ack-unknown-nested-field',
    message: { ...helloAckMessage, marker: { enabled: true, style: 'dcs' } },
  },
  { name: 'error', message: { type: 'error', code: 'bad-token', message: 'nope' } },
];

const driverReject = [
  { name: 'hello-ack-subscribe-revisions', message: { ...helloAckMessage, subscribe: 'revisions' } },
  {
    name: 'hello-ack-missing-limit-key',
    message: {
      ...helloAckMessage,
      limits: Object.fromEntries(
        Object.entries(DEFAULT_LIMITS).filter(([key]) => key !== 'maxNodes'),
      ),
    },
  },
  { name: 'hello-ack-wrong-protocol', message: { ...helloAckMessage, protocol: 'termwright/0' } },
  { name: 'hello-ack-empty-session', message: { ...helloAckMessage, sessionId: '' } },
  { name: 'hello-ack-bad-subscribe', message: { ...helloAckMessage, subscribe: 'everything' } },
  { name: 'hello-ack-missing-limits', message: { ...helloAckMessage, limits: undefined } },
  { name: 'obsolete-get-tree', message: { type: 'get-tree', requestId: 0 } },
  { name: 'unknown-type', message: { type: 'semantic-full', snapshot: baseSnapshot } },
];

function annotate(entries, parse, expectOk) {
  return entries.map(({ name, message }) => {
    // Round-tripping through JSON drops `undefined` fields exactly as the wire does.
    const wire = JSON.parse(JSON.stringify(message));
    const result = parse(wire, DEFAULT_LIMITS);
    if (result.ok !== expectOk) {
      throw new Error(`message vector ${name}: expected ok=${expectOk}, got ${JSON.stringify(result)}`);
    }
    return expectOk
      ? { name, message: wire }
      : { name, message: wire, code: result.code, detail: result.detail };
  });
}

write('messages.json', {
  note: 'Parsed with DEFAULT_LIMITS. `code` is the wire error taxonomy: bad-version | malformed | limit-exceeded.',
  adapterToDriver: {
    accept: annotate(adapterAccept, parseAdapterMessage, true),
    reject: annotate(adapterReject, parseAdapterMessage, false),
  },
  driverToAdapter: {
    accept: annotate(driverAccept, parseDriverMessage, true),
    reject: annotate(driverReject, parseDriverMessage, false),
  },
});
masking();
