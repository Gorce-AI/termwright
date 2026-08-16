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
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Buffer } from 'node:buffer';

import {
  ABSOLUTE_LIMITS,
  ADAPTER_CAPABILITIES,
  DEFAULT_LIMITS,
  FRAME_HEADER_BYTES,
  MARKER_DCS_FINAL,
  MARKER_DCS_PREFIX,
  MARKER_MAC_BYTES,
  PROTOCOL_ID,
  PROTOCOL_VERSION,
  SEMANTIC_ACTIONS,
  SEMANTIC_ROLES,
  createFrameDecoder,
  encodeFrame,
  encodeMarker,
  parseAdapterMessage,
  parseDriverMessage,
  validateSnapshot,
  verifyMarkerPayload,
} from '../../packages/protocol/dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const hex = (bytes) => Buffer.from(bytes).toString('hex');

function write(name, value) {
  const path = join(here, name);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log(`wrote ${name}`);
}

// --------------------------------------------------------------------------
// constants.json — the closed sets and numbers every client hard-codes.
// --------------------------------------------------------------------------

write('constants.json', {
  protocolId: PROTOCOL_ID,
  protocolVersion: PROTOCOL_VERSION,
  frameHeaderBytes: FRAME_HEADER_BYTES,
  markerDcsPrefix: MARKER_DCS_PREFIX,
  markerDcsFinal: MARKER_DCS_FINAL,
  markerMacBytes: MARKER_MAC_BYTES,
  env: {
    endpoint: 'TERMWRIGHT_ENDPOINT',
    token: 'TERMWRIGHT_TOKEN',
    protocol: 'TERMWRIGHT_PROTOCOL',
  },
  roles: [...SEMANTIC_ROLES],
  actions: [...SEMANTIC_ACTIONS],
  capabilities: [...ADAPTER_CAPABILITIES],
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
  const payload = sequence.slice(2, -2); // strip ESC P … ESC \
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
  { name: 'wrong-mac', payload: `${MARKER_DCS_PREFIX}42;AAAAAAAAAAAAAAAAAAAAAA` },
  { name: 'wrong-session', payload: markerCases[4].payload },
  { name: 'leading-zero-revision', payload: `${MARKER_DCS_PREFIX}042;${markerCases[2].mac}` },
  { name: 'revision-zero', payload: `${MARKER_DCS_PREFIX}0;${markerCases[2].mac}` },
  { name: 'negative-revision', payload: `${MARKER_DCS_PREFIX}-1;${markerCases[2].mac}` },
  { name: 'mac-too-short', payload: `${MARKER_DCS_PREFIX}42;${markerCases[2].mac.slice(0, -1)}` },
  { name: 'mac-not-base64url', payload: `${MARKER_DCS_PREFIX}42;${'+'.repeat(22)}` },
  { name: 'missing-prefix', payload: `xxx;42;${markerCases[2].mac}` },
  { name: 'no-separator', payload: `${MARKER_DCS_PREFIX}42${markerCases[2].mac}` },
  { name: 'empty', payload: '' },
].map(({ name, payload }) => {
  const verified = verifyMarkerPayload(payload, MARKER_TOKEN, MARKER_SESSION);
  if (verified !== null) throw new Error(`marker reject vector ${name} verified`);
  return { name, payload, token: MARKER_TOKEN, sessionId: MARKER_SESSION };
});

write('marker.json', {
  note:
    'mac = base64url(HMAC-SHA256(key = token as UTF-8 bytes, ' +
    'msg = `${sessionId}:${revision}` as UTF-8 bytes))[:16], unpadded. ' +
    'sequence = ESC P + "twm;" + revision + ";" + mac + ESC \\.',
  dcsPrefix: MARKER_DCS_PREFIX,
  dcsFinal: MARKER_DCS_FINAL,
  macBytes: MARKER_MAC_BYTES,
  encode: markerCases,
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
    snapshot: mutate((s) => {
      s.rootIds = [];
      s.nodes = [
        { id: 'a', parentId: 'b', role: 'generic', name: '' },
        { id: 'b', parentId: 'a', role: 'generic', name: '' },
      ];
    }),
  },
  { name: 'unknown-role', snapshot: mutate((s) => { s.nodes[1].role = 'slider'; }) },
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

const adapterAccept = [
  { name: 'hello', message: helloMessage },
  { name: 'revision-commit', message: { type: 'revision-commit', revision: 3 } },
  { name: 'snapshot', message: { type: 'snapshot', snapshot: baseSnapshot } },
  { name: 'get-tree-result-ok', message: { type: 'get-tree-result', requestId: 0, snapshot: baseSnapshot } },
  { name: 'get-tree-result-error', message: { type: 'get-tree-result', requestId: 1, error: 'no such revision' } },
  { name: 'error', message: { type: 'error', code: 'internal', message: 'boom' } },
];

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
