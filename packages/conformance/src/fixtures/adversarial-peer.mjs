/**
 * Adversarial peer — origin spec §20.3.
 *
 * A raw socket client that speaks the wire protocol by hand: it imports
 * `node:net` and `node:crypto` and **nothing from termwright**. That is the
 * point. If this fixture used `encodeFrame`/`encodeMarker` it could only ever
 * produce traffic the implementation already believes in; re-deriving the
 * framing and the marker MAC from the specification is what makes a mismatch
 * between spec and implementation visible.
 *
 * Protocol of the fixture itself, so suites stay deterministic:
 *
 *   1. it connects, completes a normal handshake and publishes a valid
 *      revision 1 (tree + marker), then prints `PEER READY <scenario>`;
 *   2. on the key `g` it performs the hostile act and prints `PEER FIRED`;
 *   3. on `q` it exits 0.
 *
 * Scenarios that attack the handshake itself (`bad-token`, `bad-version`,
 * `no-hello`) skip step 1 and fire on connect.
 *
 * Usage: `node adversarial-peer.mjs <scenario>`.
 */

import { connect } from 'node:net';
import { createHmac } from 'node:crypto';

const scenario = process.argv[2] ?? 'none';
const endpoint = process.env['TERMWRIGHT_ENDPOINT'];
const token = process.env['TERMWRIGHT_TOKEN'];

/** Ceilings from the protocol's DEFAULT_LIMITS, restated rather than imported. */
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_NODES = 5_000;
const MAX_DEPTH = 64;

let sessionId = null;
let socket = null;
let published = 0;

const say = (line) => process.stdout.write(`${line}\r\n`);

/** 4-byte big-endian length prefix + UTF-8 JSON. */
function frame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/** `\x1bPtwm;{revision};{mac}\x1b\\`, MAC = base64url(HMAC-SHA256)[0..16). */
function marker(revision, forSession = sessionId) {
  const mac = createHmac('sha256', token)
    .update(`${forSession}:${revision}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  return `\x1bPtwm;${revision};${mac}\x1b\\`;
}

function tree(revision, nodes, overrides = {}) {
  return {
    v: 1,
    sessionId,
    revision,
    columns: 80,
    rows: 24,
    rootIds: ['n1'],
    nodes,
    ...overrides,
  };
}

function validNodes(label) {
  return [
    { id: 'n1', role: 'region', name: 'Peer', bounds: { row: 0, column: 0, width: 20, height: 2 } },
    {
      id: 'n2',
      parentId: 'n1',
      role: 'button',
      name: label,
      testId: 'peer-button',
      bounds: { row: 1, column: 0, width: 10, height: 1 },
      actions: ['activate', 'focus'],
    },
  ];
}

/** Publishes a well-formed revision: snapshot, commit, then the render marker. */
function publish(revision, label = 'Peer') {
  socket.write(frame({ type: 'snapshot', snapshot: tree(revision, validNodes(label)) }));
  socket.write(frame({ type: 'revision-commit', revision }));
  process.stdout.write(marker(revision));
  published = revision;
}

const SCENARIOS = {
  'bad-token': () => {
    socket.write(frame(hello({ token: 'not-the-token' })));
  },
  'bad-version': () => {
    socket.write(frame(hello({ protocol: 'termwright/2' })));
  },
  'no-hello': () => {
    socket.write(frame({ type: 'snapshot', snapshot: tree(1, validNodes('Peer')) }));
  },

  'duplicate-hello': () => {
    socket.write(frame(hello()));
  },
  'oversized-frame': () => {
    // A header claiming eight megabytes, with no body behind it: the ceiling
    // must be enforced on the declared length, before a byte is buffered.
    const header = Buffer.alloc(4);
    header.writeUInt32BE(MAX_FRAME_BYTES * 8, 0);
    socket.write(header);
  },
  'partial-frame': () => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(4096, 0);
    socket.write(Buffer.concat([header, Buffer.from('{"type":"sna', 'utf8')]));
  },
  'duplicate-frames': () => {
    const message = frame({ type: 'snapshot', snapshot: tree(2, validNodes('Twice')) });
    socket.write(message);
    socket.write(message);
    process.stdout.write(marker(2));
  },
  cycle: () => {
    send(
      tree(2, [
        { id: 'n1', role: 'region', name: 'Peer' },
        { id: 'n2', parentId: 'n3', role: 'button', name: 'A' },
        { id: 'n3', parentId: 'n2', role: 'button', name: 'B' },
      ]),
    );
  },
  'missing-parent': () => {
    send(
      tree(2, [
        { id: 'n1', role: 'region', name: 'Peer' },
        { id: 'n2', parentId: 'ghost', role: 'button', name: 'Orphan' },
      ]),
    );
  },
  'impossible-bounds': () => {
    send(
      tree(2, [
        {
          id: 'n1',
          role: 'region',
          name: 'Peer',
          bounds: { row: 9_000, column: 9_000, width: 5, height: 5 },
        },
      ]),
    );
  },
  'decreasing-revision': () => {
    publish(3, 'Third');
    setTimeout(() => publish(2, 'Second'), 50);
  },
  'marker-without-tree': () => {
    process.stdout.write(marker(5));
  },
  'tree-without-marker': () => {
    socket.write(frame({ type: 'snapshot', snapshot: tree(4, validNodes('Unpaired')) }));
    socket.write(frame({ type: 'revision-commit', revision: 4 }));
  },
  'rapid-rerender': () => {
    for (let revision = 2; revision <= 200; revision += 1) publish(revision, `Rev${revision}`);
  },
  flood: () => {
    const noise = `${'x'.repeat(4096)}\r\n`;
    for (let chunk = 0; chunk < 512; chunk += 1) process.stdout.write(noise);
    for (let revision = 2; revision <= 100; revision += 1) {
      socket.write(frame({ type: 'snapshot', snapshot: tree(revision, validNodes(`Flood${revision}`)) }));
    }
  },
  'disconnect-mid-render': () => {
    socket.write(frame({ type: 'snapshot', snapshot: tree(2, validNodes('Torn')) }));
    socket.destroy();
  },
  'hostile-unicode': () => {
    // A lone high surrogate survives JSON.stringify as an escape, so the bytes
    // on the wire are ASCII and the receiver is the one that has to fail closed.
    send(tree(2, [{ id: 'n1', role: 'region', name: 'lone \ud800 surrogate' }]));
  },
  'foreign-session': () => {
    send(tree(2, validNodes('Foreign'), { sessionId: 'someone-elses-session' }));
  },
  'unknown-message': () => {
    socket.write(frame({ type: 'take-over-the-terminal', payload: 'please' }));
  },
  'not-json': () => {
    const body = Buffer.from('this is not json at all', 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(body.length, 0);
    socket.write(Buffer.concat([header, body]));
  },
  'deep-nesting': () => {
    let value = 'leaf';
    for (let depth = 0; depth < MAX_DEPTH * 2; depth += 1) value = { nested: value };
    socket.write(frame({ type: 'snapshot', snapshot: value }));
  },
  'too-many-nodes': () => {
    const nodes = [{ id: 'n1', role: 'region', name: 'Peer' }];
    for (let index = 2; index <= MAX_NODES + 1_000; index += 1) {
      nodes.push({ id: `n${index}`, parentId: 'n1', role: 'text', name: `t${index}` });
    }
    send(tree(2, nodes));
  },
  'peer-error': () => {
    // The other direction: the adapter reports a protocol error at us. The
    // driver must surface the code the peer chose, not one of its own.
    socket.write(frame({ type: 'error', code: 'internal', message: 'the adapter gave up' }));
  },
  'foreign-marker': () => {
    // A marker MAC bound to a different session must not commit anything here.
    socket.write(frame({ type: 'snapshot', snapshot: tree(2, validNodes('Forged')) }));
    process.stdout.write(marker(2, 'another-session'));
  },
};

function hello(overrides = {}) {
  return {
    type: 'hello',
    protocol: 'termwright/1',
    token,
    adapter: { name: 'adversarial-peer', version: '0.1.0' },
    capabilities: ['tree', 'bounds', 'states', 'actions', 'render-revisions'],
    ...overrides,
  };
}

/** Sends a snapshot together with its marker, so only the tree can be at fault. */
function send(snapshot) {
  socket.write(frame({ type: 'snapshot', snapshot }));
  process.stdout.write(marker(snapshot.revision));
}

const ATTACKS_HANDSHAKE = new Set(['bad-token', 'bad-version', 'no-hello']);

function fire() {
  const attack = SCENARIOS[scenario];
  if (attack === undefined) {
    say(`PEER UNKNOWN SCENARIO ${scenario}`);
    return;
  }
  try {
    attack();
    say('PEER FIRED');
  } catch (error) {
    // A peer that cannot even build its attack must say so rather than die
    // silently and leave the suite waiting on a timeout.
    say(`PEER FAILED ${String(error && error.message ? error.message : error)}`);
  }
}

process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text.includes('q')) {
    say('BYE');
    process.exit(0);
  }
  if (text.includes('g')) fire();
  if (text.includes('p')) publish(published + 1, `Manual${published + 1}`);
});

say(`PEER START ${scenario}`);

if (endpoint === undefined || token === undefined) {
  say('PEER DORMANT');
} else {
  socket = connect(endpoint, () => {
    if (ATTACKS_HANDSHAKE.has(scenario)) {
      fire();
      say(`PEER READY ${scenario}`);
      return;
    }
    socket.write(frame(hello()));
  });
  socket.on('error', () => say('PEER SOCKET ERROR'));
  socket.on('close', () => say('PEER SOCKET CLOSED'));

  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    for (;;) {
      if (pending.length < 4) break;
      const length = pending.readUInt32BE(0);
      if (pending.length < 4 + length) break;
      const message = JSON.parse(pending.subarray(4, 4 + length).toString('utf8'));
      pending = pending.subarray(4 + length);
      if (message.type === 'hello-ack') {
        sessionId = message.sessionId;
        publish(1);
        say(`PEER READY ${scenario}`);
      }
      if (message.type === 'error') say(`PEER GOT ERROR ${message.code}`);
    }
  });
}
