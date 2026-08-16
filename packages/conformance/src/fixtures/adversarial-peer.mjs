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
/**
 * Delays the hello, so a suite can place the handshake inside or outside the
 * driver's late-attach grace. A child that boots slower than the negotiation
 * window is routine; one that boots slower than the grace is not, and the two
 * must land differently.
 */
const delayArg = process.argv.find((argument) => argument.startsWith('--hello-delay='));
const helloDelayMs = delayArg === undefined ? 0 : Number(delayArg.slice('--hello-delay='.length));
/**
 * Holds every socket write back by a fixed lag, so the pty stream overtakes it.
 *
 * A unix socket hands the driver everything this peer wrote long before the pty
 * has re-encoded a single byte, which hides any test that waits for a line of
 * output and then reads state only a socket frame can carry. Where the socket
 * is slower than the terminal — Windows named pipes, which neither coalesce
 * writes nor deliver them on the pty's schedule — that test asserts on
 * something still in flight. The flag makes the same ordering reproducible on
 * any platform. The lag is constant rather than per-write, so a flood of two
 * hundred revisions still finishes inside the suite's budget.
 */
const lagArg = process.argv.find((argument) => argument.startsWith('--socket-lag='));
const socketLagMs = lagArg === undefined ? 0 : Number(lagArg.slice('--socket-lag='.length));
/**
 * The mirror image: throttles the *terminal* stream instead of the socket.
 *
 * Markers ride stdout and trees ride the socket, so a terminal slower than the
 * socket means a revision's marker can arrive after the driver has given up
 * waiting for it. A ceiling on bytes per second — rather than a fixed delay —
 * is the faithful model of a pty that re-encodes everything: under a flood a
 * backlog builds and markers fall seconds behind their trees, and once the
 * flood stops the backlog drains and ordinary pairing should resume. Whether it
 * does is the whole question.
 */
const bpsArg = process.argv.find((argument) => argument.startsWith('--stdout-bps='));
const stdoutBps = bpsArg === undefined ? 0 : Number(bpsArg.slice('--stdout-bps='.length));
const endpoint = process.env['TERMWRIGHT_ENDPOINT'];
const token = process.env['TERMWRIGHT_TOKEN'];

/** Ceilings from the protocol's DEFAULT_LIMITS, restated rather than imported. */
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_NODES = 5_000;
const MAX_DEPTH = 64;
const MAX_LOG_RECORD_BYTES = 32 * 1024;

/** Scenarios that need the log channel negotiated in the handshake. */
const NEEDS_LOGS = new Set(['log-seq-duplicate', 'log-seq-gap', 'log-oversized', 'log-flood']);

/** Scenarios that announce `tree-diffs` and push deltas instead of whole trees. */
const NEEDS_DELTAS = new Set([
  'delta-sequence',
  'delta-bad-base',
  'delta-cursor-clear',
  'delta-flood',
  'delta-removed-missing',
  'delta-before-snapshot',
]);

let logSeq = 0;
let logBudget = null;

let sessionId = null;
let socket = null;
let published = 0;

if (stdoutBps > 0) {
  const write = process.stdout.write.bind(process.stdout);
  const TICK_MS = 50;
  const perTick = Math.max(1, Math.floor((stdoutBps * TICK_MS) / 1000));
  let pending = '';
  setInterval(() => {
    if (pending.length === 0) return;
    write(pending.slice(0, perTick));
    pending = pending.slice(perTick);
  }, TICK_MS);
  process.stdout.write = (chunk) => {
    pending += chunk;
    return true;
  };
}

const say = (line) => process.stdout.write(`${line}\r\n`);

/** 4-byte big-endian length prefix + UTF-8 JSON. */
function frame(value) {
  const body = Buffer.from(JSON.stringify(value), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(body.length, 0);
  return Buffer.concat([header, body]);
}

/**
 * `OSC 8487 ; twm;{revision};{mac}` closed by BEL, or by ST when asked.
 *
 * MAC = base64url(HMAC-SHA256(token, `${sessionId}:${revision}`))[0..16). Both
 * terminators are legal, so the peer can emit either: a receiver that only
 * accepted the one an implementation happens to write would reject a
 * conforming adapter, and that is a rule worth exercising from the outside.
 */
function marker(revision, forSession = sessionId, terminator = '\x07') {
  const mac = createHmac('sha256', token)
    .update(`${forSession}:${revision}`, 'utf8')
    .digest()
    .subarray(0, 16)
    .toString('base64url');
  return `\x1b]8487;twm;${revision};${mac}${terminator}`;
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
  'second-connection': () => {
    // One adapter per session. A second channel from the same process is the
    // benign shape of that mistake; the driver must refuse it and say so
    // without disturbing the adapter that is already attached.
    const second = connect(endpoint, () => {
      second.write(frame(hello()));
    });
    second.on('error', () => say('PEER SECOND SOCKET ERROR'));
    second.on('close', () => say('PEER SECOND SOCKET CLOSED'));
    // Buffered and length-decoded, not regexed out of one chunk: the reply and
    // the socket's own destruction race, and a split read would silently lose
    // the error this scenario exists to observe.
    let rest = Buffer.alloc(0);
    second.on('data', (chunk) => {
      rest = Buffer.concat([rest, chunk]);
      for (;;) {
        if (rest.length < 4) break;
        const length = rest.readUInt32BE(0);
        if (rest.length < 4 + length) break;
        const message = JSON.parse(rest.subarray(4, 4 + length).toString('utf8'));
        rest = rest.subarray(4 + length);
        if (message.type === 'error') say(`PEER SECOND GOT ERROR ${message.code}`);
      }
    });
  },
  'log-no-negotiation': () => {
    // The handshake never announced `logs`, so the budget was never granted.
    socket.write(frame({ type: 'log', record: logRecord(1, 'uninvited') }));
  },
  'log-seq-duplicate': () => {
    sendLog(1, 'first');
    sendLog(1, 'same seq again');
    sendLog(2, 'after the duplicate');
  },
  'log-seq-gap': () => {
    sendLog(1, 'before the gap');
    // Four records the adapter dropped at the source; the gap is how it says so.
    sendLog(6, 'after the gap');
  },
  'log-oversized': () => {
    socket.write(
      frame({ type: 'log', record: logRecord(1, 'x'.repeat(MAX_LOG_RECORD_BYTES + 1024)) }),
    );
  },
  'log-flood': () => {
    // Far past any sane per-second budget, sent in one turn.
    for (let seq = 1; seq <= 500; seq += 1) sendLog(seq, `flood ${seq}`);
  },
  'delta-sequence': () => {
    sendDelta(renameDelta(1, 2, 'Second'));
    sendDelta(renameDelta(2, 3, 'Third'));
    sendDelta(renameDelta(3, 4, 'Fourth'));
  },
  'delta-bad-base': () => {
    // Base 999 was never held, so this cannot be patched onto anything.
    sendDelta(renameDelta(999, 1000, 'Impossible'));
  },
  'delta-cursor-clear': () => {
    // A delta can set a cursor but never clear it. `c` sends the full tree that
    // clears it, so the two halves are separate steps rather than a race.
    sendDelta(renameDelta(1, 2, 'Cursor', { cursor: { row: 3, column: 7, visible: true } }));
  },
  'delta-flood': () => {
    for (let revision = 2; revision <= 200; revision += 1) {
      sendDelta(renameDelta(revision - 1, revision, `Rev${revision}`));
    }
  },
  'delta-removed-missing': () => {
    sendDelta({ baseRevision: 1, revision: 2, changed: [], removed: ['ghost'] });
  },
  'delta-before-snapshot': () => {
    // Handled specially at handshake time: nothing was published first.
    sendDelta(renameDelta(1, 2, 'Premature'));
  },
  'marker-st-terminator': () => {
    // ST rather than BEL. The tree must pair exactly as it does with BEL.
    socket.write(frame({ type: 'snapshot', snapshot: tree(2, validNodes('Terminated')) }));
    process.stdout.write(marker(2, sessionId, '\x1b\\'));
    published = 2;
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
  const capabilities = ['tree', 'bounds', 'states', 'actions', 'render-revisions'];
  // `log-no-negotiation` deliberately does NOT announce it: the point of that
  // scenario is sending records the driver never invited.
  if (NEEDS_LOGS.has(scenario)) capabilities.push('logs');
  if (NEEDS_DELTAS.has(scenario)) capabilities.push('tree-diffs');
  return {
    type: 'hello',
    protocol: 'termwright/1',
    token,
    adapter: { name: 'adversarial-peer', version: '0.1.0' },
    capabilities,
    ...overrides,
  };
}

/** One well-formed record, with the seq the caller asks for. */
function logRecord(seq, message = `record ${seq}`) {
  return { ts: Date.now(), level: 'info', message, logger: 'peer', seq };
}

function sendLog(seq, message) {
  socket.write(frame({ type: 'log', record: logRecord(seq, message) }));
  logSeq = Math.max(logSeq, seq);
}

/**
 * Sends a delta and its marker. The peer keeps no model of its own beyond the
 * revision counter: composing is the receiver's job, and a producer that also
 * composed would only prove it agrees with itself.
 */
function sendDelta(delta) {
  // The delta is the message: the body sits beside the discriminator rather
  // than nested under it.
  socket.write(frame({ type: 'tree-delta', ...delta }));
  process.stdout.write(marker(delta.revision));
  published = Math.max(published, delta.revision);
}

/** A delta that renames the button, so a composed tree is observable on screen. */
function renameDelta(baseRevision, revision, label, overrides = {}) {
  return {
    baseRevision,
    revision,
    changed: [
      {
        id: 'n2',
        parentId: 'n1',
        role: 'button',
        name: label,
        testId: 'peer-button',
        bounds: { row: 1, column: 0, width: 10, height: 1 },
        actions: ['activate', 'focus'],
      },
    ],
    removed: [],
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
  // The cursor-clearing half of `delta-cursor-clear`: only a full tree can do
  // it, and `tree()` builds one without a cursor.
  if (text.includes('c')) publish(published + 1, 'NoCursor');
});

say(`PEER START ${scenario}`);

if (endpoint === undefined || token === undefined) {
  say('PEER DORMANT');
} else {
  socket = connect(endpoint, () => {
    if (socketLagMs > 0) {
      const write = socket.write.bind(socket);
      const held = [];
      let scheduled = false;
      socket.write = (chunk) => {
        held.push(chunk);
        if (!scheduled) {
          scheduled = true;
          setTimeout(() => {
            scheduled = false;
            while (held.length > 0) write(held.shift());
          }, socketLagMs);
        }
        return true;
      };
    }
    if (ATTACKS_HANDSHAKE.has(scenario)) {
      fire();
      say(`PEER READY ${scenario}`);
      return;
    }
    if (helloDelayMs > 0) {
      say(`PEER DELAYING HELLO ${helloDelayMs}`);
      setTimeout(() => {
        socket.write(frame(hello()));
        say('PEER SENT HELLO');
      }, helloDelayMs);
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
        logBudget = message.logs ?? null;
        say(`PEER LOGS ${logBudget === null ? 'denied' : `enabled ${logBudget.maxRecordsPerSecond}/s`}`);
        // `delta-before-snapshot` deliberately skips the opening tree: its
        // whole point is a delta with nothing to compose onto.
        if (scenario !== 'delta-before-snapshot') publish(1);
        say(`PEER READY ${scenario}`);
      }
      if (message.type === 'get-tree') {
        // Answering is what makes a resync observable end to end: the driver
        // asks, the peer supplies, the session returns to a known tree.
        const revision = published + 1;
        socket.write(
          frame({
            type: 'get-tree-result',
            requestId: message.requestId,
            snapshot: tree(revision, validNodes('Resynced')),
          }),
        );
        published = revision;
        process.stdout.write(marker(revision));
        say(`PEER SENT FULL TREE ${revision}`);
      }
      if (message.type === 'error') say(`PEER GOT ERROR ${message.code}`);
    }
  });
}
