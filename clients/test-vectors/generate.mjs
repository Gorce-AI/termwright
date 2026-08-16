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
  SEMANTIC_ACTIONS,
  SEMANTIC_ROLES,
  createFrameDecoder,
  encodeFrame,
  encodeMarker,
  parseAdapterMessage,
  parseDriverMessage,
  applyTreeDelta,
  validateSnapshot,
  validateTreeDelta,
  verifyMarkerPayload,
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
    protocol: 'TERMWRIGHT_PROTOCOL',
  },
  logLevels: [...LOG_LEVELS],
  logLevelSeverity: { ...LOG_LEVEL_SEVERITY },
  maxLogAttrs: MAX_LOG_ATTRS,
  roles: [...SEMANTIC_ROLES],
  actions: [...SEMANTIC_ACTIONS],
  capabilities: [...ADAPTER_CAPABILITIES],
  provenanceSources: [...PROVENANCE_SOURCES],
  probeCapabilities: [...PROBE_CAPABILITIES],
  probeUnobservableFields: [...PROBE_UNOBSERVABLE_FIELDS],
  probeIdentityKinds: ['stable', 'frame-local'],
  occlusionValues: ['known', 'unknown'],
  defaultLimits: { ...DEFAULT_LIMITS },
  absoluteLimits: { ...ABSOLUTE_LIMITS },
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
      capabilities: ['tree', 'bounds', 'states'],
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
  v: 1,
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
      bounds: { row: 0, column: 0, width: 40, height: 2 },
      state: { modal: true },
    },
    {
      id: 'n2',
      parentId: 'n1',
      role: 'button',
      name: 'Approve',
      testId: 'approve',
      bounds: { row: 1, column: 2, width: 9, height: 1 },
      state: { focused: true },
      actions: ['focus', 'activate'],
    },
    {
      id: 'n3',
      parentId: 'n1',
      role: 'button',
      name: 'Reject',
      bounds: { row: 1, column: 14, width: 8, height: 1 },
      state: { focused: false },
      actions: ['focus', 'activate'],
    },
  ],
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
    // What a probe publishes: paint order observed, so the cells are
    // answerable and the driver's pointer gate opens; provenance says the
    // facts came from the framework rather than from an author or a guess.
    name: 'probe-node-with-occlusion-and-provenance',
    snapshot: mutate((s) => {
      s.nodes[1].occlusion = 'known';
      s.nodes[1].p = 'framework';
      s.nodes[1].px = { name: 'annotation', testId: 'annotation' };
      s.nodes[2].occlusion = 'unknown';
    }),
  },
  {
    name: 'minimal-empty-tree',
    snapshot: { v: 1, sessionId: 's', revision: 1, columns: 1, rows: 1, rootIds: [], nodes: [] },
  },
  {
    name: 'hidden-node-outside-viewport',
    snapshot: mutate((s) => {
      s.nodes[2].bounds = { row: 900, column: 900, width: 5, height: 1 };
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
    name: 'two-roots',
    snapshot: mutate((s) => {
      s.rootIds = ['n1', 'n4'];
      s.nodes.push({ id: 'n4', role: 'status', name: 'ready', bounds: { row: 3, column: 0, width: 5, height: 1 } });
    }),
  },
];

const snapshotReject = [
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
        { id: 'a', parentId: 'b', role: 'generic', frameworkType: 'Fixture', name: '' },
        { id: 'b', parentId: 'a', role: 'generic', frameworkType: 'Fixture', name: '' },
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
    name: 'unknown-occlusion',
    snapshot: mutate((s) => { s.nodes[1].occlusion = 'maybe'; }),
  },
  {
    name: 'unknown-provenance',
    snapshot: mutate((s) => { s.nodes[1].p = 'vibes'; }),
  },
  {
    name: 'unknown-provenance-per-field',
    snapshot: mutate((s) => { s.nodes[1].px = { name: 'vibes' }; }),
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
  { name: 'wrong-version', snapshot: mutate((s) => { s.v = 2; }) },
  { name: 'empty-session-id', snapshot: mutate((s) => { s.sessionId = ''; }) },
  { name: 'zero-columns', snapshot: mutate((s) => { s.columns = 0; }) },
  {
    name: 'bounds-outside-viewport',
    snapshot: mutate((s) => { s.nodes[2].bounds = { row: 900, column: 900, width: 5, height: 1 }; }),
  },
  { name: 'cursor-outside-viewport', snapshot: mutate((s) => { s.cursor = { row: 99, column: 0, visible: true }; }) },
  { name: 'unknown-node-field', snapshot: mutate((s) => { s.nodes[1].colour = 'red'; }) },
  { name: 'unknown-state-field', snapshot: mutate((s) => { s.nodes[1].state = { sparkling: true }; }) },
  { name: 'unknown-action', snapshot: mutate((s) => { s.nodes[1].actions = ['detonate']; }) },
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
  capabilities: ['tree', 'bounds', 'absolute-bounds', 'states', 'actions', 'render-revisions'],
};

const helloAckMessage = {
  type: 'hello-ack',
  protocol: PROTOCOL_ID,
  sessionId: 's-0001',
  limits: { ...DEFAULT_LIMITS },
  subscribe: 'snapshots',
  marker: { enabled: true },
};

/** A node as it appears inside a delta's `changed` list. */
const deltaNode = (id, parentId, extra = {}) => ({
  id,
  ...(parentId === undefined ? {} : { parentId }),
  role: 'button',
  name: 'Approve',
  ...extra,
});

/**
 * A delta on the minimal shape. Only the shape is checkable here: a receiver
 * cannot judge parents, depth or whether bounds fall inside the viewport
 * without the base it applies to, because the delta carries no columns/rows.
 * Those are caught when the assembled tree goes through snapshot validation.
 */
const treeDelta = (over = {}) => ({
  type: 'tree-delta',
  baseRevision: 4,
  revision: 5,
  changed: [deltaNode('ok', 'dialog')],
  removed: ['stale'],
  ...over,
});

const adapterAccept = [
  { name: 'hello', message: helloMessage },
  { name: 'revision-commit', message: { type: 'revision-commit', revision: 3 } },
  { name: 'snapshot', message: { type: 'snapshot', snapshot: baseSnapshot } },
  { name: 'get-tree-result-ok', message: { type: 'get-tree-result', requestId: 0, snapshot: baseSnapshot } },
  { name: 'get-tree-result-error', message: { type: 'get-tree-result', requestId: 1, error: 'no such revision' } },
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
  { name: 'tree-delta', message: treeDelta() },
  { name: 'tree-delta-empty', message: treeDelta({ changed: [], removed: [] }) },
  { name: 'tree-delta-with-root-ids', message: treeDelta({ rootIds: ['root', 'aside'] }) },
  { name: 'tree-delta-with-cursor', message: treeDelta({ cursor: { row: 3, column: 9, visible: true } }) },
  { name: 'tree-delta-cursor-hidden', message: treeDelta({ cursor: { row: 0, column: 0, visible: false } }) },
  { name: 'tree-delta-cursor-shape', message: treeDelta({ cursor: { row: 1, column: 1, visible: true, shape: 'bar' } }) },
  { name: 'tree-delta-node-without-bounds', message: treeDelta({ changed: [deltaNode('ok', 'dialog')] }) },
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
  { name: 'hello-wrong-protocol', message: { ...helloMessage, protocol: 'termwright/2' } },
  { name: 'hello-empty-token', message: { ...helloMessage, token: '' } },
  { name: 'hello-unknown-capability', message: { ...helloMessage, capabilities: ['telepathy'] } },
  { name: 'hello-extra-field', message: { ...helloMessage, extra: 1 } },
  { name: 'revision-commit-zero', message: { type: 'revision-commit', revision: 0 } },
  { name: 'revision-commit-float', message: { type: 'revision-commit', revision: 2.5 } },
  { name: 'snapshot-invalid-body', message: { type: 'snapshot', snapshot: { ...baseSnapshot, revision: 0 } } },
  { name: 'get-tree-result-both', message: { type: 'get-tree-result', requestId: 0, snapshot: baseSnapshot, error: 'x' } },
  { name: 'get-tree-result-neither', message: { type: 'get-tree-result', requestId: 0 } },
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
  // A revision must move forward, and never onto or behind its own base.
  { name: 'tree-delta-revision-not-forward', message: treeDelta({ baseRevision: 5, revision: 5 }) },
  { name: 'tree-delta-revision-backwards', message: treeDelta({ baseRevision: 6, revision: 5 }) },
  { name: 'tree-delta-base-revision-zero', message: treeDelta({ baseRevision: 0, revision: 1 }) },
  { name: 'tree-delta-unknown-envelope-field', message: treeDelta({ speculative: true }) },
  { name: 'tree-delta-duplicate-changed-id', message: treeDelta({ changed: [deltaNode('a', 'r'), deltaNode('a', 'r')] }) },
  { name: 'tree-delta-duplicate-removed-id', message: treeDelta({ removed: ['a', 'a'] }) },
  // One id cannot be upserted and cascaded away by the same delta.
  { name: 'tree-delta-changed-and-removed', message: treeDelta({ changed: [deltaNode('a', 'r')], removed: ['a'] }) },
  { name: 'tree-delta-self-parent', message: treeDelta({ changed: [deltaNode('a', 'a')] }) },
  { name: 'tree-delta-unknown-role', message: treeDelta({ changed: [{ id: 'a', role: 'supervillain', name: 'A' }] }) },
  { name: 'tree-delta-unknown-node-field', message: treeDelta({ changed: [{ id: 'a', role: 'button', name: 'A', onClick: 'x' }] }) },
  {
    name: 'tree-delta-bad-rect',
    message: treeDelta({
      changed: [{ id: 'a', role: 'button', name: 'A', bounds: { row: 0.5, column: 0, width: 1, height: 1 } }],
    }),
  },
  { name: 'tree-delta-bad-cursor', message: treeDelta({ cursor: { row: -1, column: 0, visible: true } }) },
  { name: 'tree-delta-cursor-unknown-field', message: treeDelta({ cursor: { row: 0, column: 0, visible: true, blink: true } }) },
  { name: 'tree-delta-duplicate-root-id', message: treeDelta({ rootIds: ['r', 'r'] }) },
  {
    // Projection depth bites before any shape check, which buys
    // `limit-exceeded` coverage for the price of a nested value rather than
    // the 5 001 nodes it would take to cross maxNodes.
    name: 'tree-delta-depth-over-ceiling',
    message: treeDelta({
      nested: Array.from({ length: 70 }).reduce((deep) => ({ deep }), 'leaf'),
    }),
  },
  {
    name: 'tree-delta-missing-removed',
    message: (() => {
      const { removed: _removed, ...rest } = treeDelta();
      return rest;
    })(),
  },
];

const driverAccept = [
  { name: 'hello-ack', message: helloAckMessage },
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
  {
    name: 'get-tree-unknown-envelope-field',
    message: { type: 'get-tree', requestId: 3, priority: 'high' },
  },
  { name: 'hello-ack-subscribe-diffs', message: { ...helloAckMessage, subscribe: 'diffs' } },
  { name: 'hello-ack-subscribe-revisions', message: { ...helloAckMessage, subscribe: 'revisions' } },
  { name: 'get-tree-latest', message: { type: 'get-tree', requestId: 0 } },
  { name: 'get-tree-revision', message: { type: 'get-tree', requestId: 4, revision: 12 } },
  { name: 'error', message: { type: 'error', code: 'bad-token', message: 'nope' } },
];

const driverReject = [
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
  { name: 'get-tree-negative-request-id', message: { type: 'get-tree', requestId: -1 } },
  { name: 'get-tree-revision-zero', message: { type: 'get-tree', requestId: 0, revision: 0 } },
  { name: 'unknown-type', message: { type: 'snapshot', snapshot: baseSnapshot } },
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

// --------------------------------------------------------------------------
// deltas.json — composition: `delta + base → snapshot | error`
//
// Message-shape vectors cannot reach these: the four composition rules, both
// resynchronisation paths and the cursor only show up once a delta meets the
// tree it applies to. Five implementations agreeing on the shape and
// disagreeing here is the failure this file exists to prevent.
//
// NOTE ON ORDER: the order of `nodes` in a composed snapshot is NOT normative.
// The reference composes through a Map and so reports base order with new
// nodes appended; a client backed by a hash map will report another order and
// is equally correct. Compare `nodes` as a set keyed by id.
// --------------------------------------------------------------------------

/** root → dialog → { prompt, approve, cancel }. */
const composeBase = (over = {}) => ({
  v: 1,
  sessionId: 's-0001',
  revision: 4,
  columns: 80,
  rows: 24,
  cursor: { row: 1, column: 2, visible: true },
  rootIds: ['root'],
  nodes: [
    { id: 'root', role: 'region', name: 'main' },
    { id: 'dialog', parentId: 'root', role: 'dialog', name: 'Permission', state: { modal: true } },
    { id: 'prompt', parentId: 'dialog', role: 'text', name: 'Allow bash to run?' },
    { id: 'approve', parentId: 'dialog', role: 'button', name: 'Approve', state: { focused: true } },
    { id: 'cancel', parentId: 'dialog', role: 'button', name: 'Reject' },
  ],
  ...over,
});

const withAside = (over = {}) =>
  composeBase({
    rootIds: ['root', 'aside'],
    nodes: [...composeBase().nodes, { id: 'aside', role: 'region', name: 'Aside' }],
    ...over,
  });

const composeDelta = (over = {}) => ({ baseRevision: 4, revision: 5, changed: [], removed: [], ...over });

/** [name, rule, base, delta, limitsOverride?] */
const composeCases = [
  // Rule (a): `changed` upserts, replacing a node WHOLESALE rather than merging.
  ['upsert-inserts-a-new-node', 'changed-upsert', composeBase(),
    composeDelta({ changed: [{ id: 'note', parentId: 'dialog', role: 'text', name: 'Note' }] })],
  // `approve` carries state.focused in the base and the replacement omits
  // state, so state must be GONE afterwards. An implementation that merges
  // fields passes every other case and fails only this one.
  ['upsert-replaces-node-wholesale', 'changed-upsert', composeBase(),
    composeDelta({ changed: [{ id: 'approve', parentId: 'dialog', role: 'button', name: 'Approve' }] })],
  ['upsert-can-reparent-a-node', 'changed-upsert', composeBase(),
    composeDelta({ changed: [{ id: 'cancel', parentId: 'root', role: 'button', name: 'Reject' }] })],

  // Rule (b): `removed` takes the whole subtree, which is what keeps a delta small.
  ['remove-cascades-to-the-subtree', 'removed-cascade', composeBase(), composeDelta({ removed: ['dialog'] })],
  ['remove-a-leaf', 'removed-cascade', composeBase(), composeDelta({ removed: ['cancel'] })],
  ['remove-unknown-node-resyncs', 'resync-unknown-removal', composeBase(), composeDelta({ removed: ['ghost'] })],

  // Rule (c): rootIds absent inherits the base's minus removals; present replaces.
  ['roots-carry-over-minus-removals', 'rootids', withAside(), composeDelta({ removed: ['aside'] })],
  ['explicit-rootids-replace-the-list', 'rootids', withAside(),
    composeDelta({ rootIds: ['root'], removed: ['aside'] })],
  // A new root without `rootIds` is a parentless node outside the root list,
  // which is exactly what snapshot validation refuses — loudly, by design.
  ['new-root-without-rootids-fails-loudly', 'rootids', composeBase(),
    composeDelta({ changed: [{ id: 'aside', role: 'region', name: 'Aside' }] })],
  ['new-root-with-rootids', 'rootids', composeBase(),
    composeDelta({ changed: [{ id: 'aside', role: 'region', name: 'Aside' }], rootIds: ['root', 'aside'] })],

  // Rule (d): removals apply BEFORE upserts, so one delta can move a node out
  // of a subtree it is deleting.
  ['rescue-a-node-out-of-a-removed-subtree', 'remove-before-insert', composeBase(),
    composeDelta({
      removed: ['dialog'],
      changed: [{ id: 'approve', parentId: 'root', role: 'button', name: 'Approve' }],
    })],

  // Resynchronisation: a disagreeing base is reported, never patched around.
  ['base-revision-mismatch-resyncs', 'resync-bad-base', composeBase(),
    { baseRevision: 3, revision: 5, changed: [], removed: [] }],
  ['base-revision-ahead-resyncs', 'resync-bad-base', composeBase(),
    { baseRevision: 9, revision: 10, changed: [], removed: [] }],

  // Cursor: absent inherits, present replaces, and there is no way to remove
  // one — hiding it is `visible: false`.
  ['cursor-absent-is-inherited', 'cursor', composeBase(), composeDelta()],
  ['cursor-present-replaces', 'cursor', composeBase(),
    composeDelta({ cursor: { row: 9, column: 12, visible: true } })],
  ['cursor-hidden-via-visible-false', 'cursor', composeBase(),
    composeDelta({ cursor: { row: 1, column: 2, visible: false } })],
  ['cursor-outside-viewport-rejected-on-composition', 'cursor', composeBase(),
    composeDelta({ cursor: { row: 900, column: 0, visible: true } })],

  // Invariants only the composed tree can show: the delta carries no viewport
  // and no parents, so these pass shape validation and fail here.
  ['cycle-after-composition', 'composed-invariants', composeBase(),
    composeDelta({
      changed: [
        { id: 'dialog', parentId: 'approve', role: 'dialog', name: 'Permission' },
        { id: 'approve', parentId: 'dialog', role: 'button', name: 'Approve' },
      ],
    })],
  ['unknown-parent-after-composition', 'composed-invariants', composeBase(),
    composeDelta({ changed: [{ id: 'orphan', parentId: 'nowhere', role: 'text', name: 'Orphan' }] })],
  ['bounds-outside-viewport-after-composition', 'composed-invariants', composeBase(),
    composeDelta({
      changed: [{
        id: 'approve', parentId: 'dialog', role: 'button', name: 'Approve',
        bounds: { row: 900, column: 900, width: 4, height: 1 },
      }],
    })],
  ['node-ceiling-crossed-by-composition', 'composed-invariants', composeBase(),
    composeDelta({
      changed: Array.from({ length: 3 }, (_, index) => ({
        id: `n${index}`, parentId: 'root', role: 'text', name: 'x',
      })),
    }),
    { maxNodes: 7 }],
];

const composed = composeCases.map(([name, rule, baseValue, deltaValue, limitsOverride]) => {
  const limits = { ...DEFAULT_LIMITS, ...(limitsOverride ?? {}) };

  const checkedBase = validateSnapshot(baseValue, limits);
  if (!checkedBase.ok) {
    throw new Error(`compose fixture ${name}: base invalid (${checkedBase.code} ${checkedBase.detail})`);
  }
  const checkedDelta = validateTreeDelta(deltaValue, limits);
  if (!checkedDelta.ok) {
    throw new Error(`compose fixture ${name}: delta shape invalid (${checkedDelta.code} ${checkedDelta.detail})`);
  }

  const result = applyTreeDelta(checkedBase.snapshot, checkedDelta.delta, limits);
  return {
    name,
    rule,
    base: baseValue,
    delta: deltaValue,
    ...(limitsOverride === undefined ? {} : { limitsOverride }),
    expect: result.ok
      ? { ok: true, snapshot: result.snapshot }
      : { ok: false, code: result.code, detail: result.detail },
  };
});

write('deltas.json', {
  note:
    'Apply `delta` to `base` and compare. `limits` is DEFAULT_LIMITS merged ' +
    'with the per-case `limitsOverride` when present. `code` is the VALIDATION ' +
    'taxonomy (revision | missing-parent | cycle | depth | count | bad-rect | ' +
    'schema), not the wire taxonomy: composition is an operation on session ' +
    'state, and the transport maps it onto malformed/limit-exceeded later. ' +
    'The order of `nodes` is NOT normative — compare them as a set keyed by id.',
  cases: composed,
});

masking();
