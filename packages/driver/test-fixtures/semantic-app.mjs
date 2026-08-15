/**
 * Minimal semantic fixture: a hand-written adapter that performs the real
 * handshake, publishes a two-button dialog and commits each render with a DCS
 * marker. It exercises the whole semantic path (endpoint, framing, validation,
 * pairing, locators, actions) without depending on any UI framework.
 *
 * Dormant rule: without `TERMWRIGHT_ENDPOINT` it opens nothing and prints the
 * exact same screen.
 */
import { connect } from 'node:net';
import { encodeFrame, encodeMarker } from '@termwright/protocol';

const endpoint = process.env['TERMWRIGHT_ENDPOINT'];
const token = process.env['TERMWRIGHT_TOKEN'];
// Class-B/C adapters — and Ink itself when a <Static> region is present —
// publish role+name nodes without trustworthy coordinates. Legal, not an error.
const withoutBounds = process.env['TERMWRIGHT_FIXTURE_NO_BOUNDS'] === '1';
// Simulates a child that is slow to reach its handshake — routine on a loaded
// machine running suites in parallel, where node's own startup outruns the
// negotiation window.
const helloDelay = Number(process.env['TERMWRIGHT_FIXTURE_HELLO_DELAY'] ?? '0');

let sessionId = null;
let revision = 0;
let focused = 'approve';
let socket = null;
let lastEvent = 'none';
let typed = '';

function draw() {
  process.stdout.write('\x1b[2J\x1b[H');
  process.stdout.write('Permission required\r\n');
  const approve = focused === 'approve' ? '[Approve]' : ' Approve ';
  const reject = focused === 'reject' ? '[Reject]' : ' Reject ';
  process.stdout.write(`  ${approve}   ${reject}\r\n`);
  process.stdout.write(`name: [${typed}]\r\n`);
  // The status line lives inside the frame so it survives the next repaint.
  process.stdout.write(`last: ${lastEvent}\r\n`);
}

function tree() {
  return {
    v: 1,
    sessionId,
    revision,
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
        state: { focused: focused === 'approve' },
        actions: ['focus', 'activate'],
      },
      {
        id: 'n4',
        parentId: 'n1',
        role: 'textbox',
        name: 'Your name',
        testId: 'name-input',
        value: typed,
        bounds: { row: 2, column: 6, width: 20, height: 1 },
        state: { focused: false },
        actions: ['focus', 'setValue'],
      },
      {
        id: 'n3',
        parentId: 'n1',
        role: 'button',
        name: 'Reject',
        testId: 'reject',
        bounds: { row: 1, column: 14, width: 8, height: 1 },
        state: { focused: focused === 'reject' },
        actions: ['focus', 'activate'],
      },
    ],
  };
}

function stripBounds(snapshot) {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(({ bounds, ...node }) => node),
  };
}

function publish() {
  revision += 1;
  draw();
  if (socket === null || sessionId === null) return;
  const snapshot = withoutBounds ? stripBounds(tree()) : tree();
  socket.write(encodeFrame({ type: 'snapshot', snapshot }, 1024 * 1024));
  socket.write(encodeFrame({ type: 'revision-commit', revision }, 1024 * 1024));
  // The marker commits the render: it must follow the last byte of the frame.
  process.stdout.write(encodeMarker(token, sessionId, revision));
}

function decodeFrames(buffer, onMessage) {
  let rest = buffer;
  for (;;) {
    if (rest.length < 4) return rest;
    const length = rest.readUInt32BE(0);
    if (rest.length < 4 + length) return rest;
    onMessage(JSON.parse(rest.subarray(4, 4 + length).toString('utf8')));
    rest = rest.subarray(4 + length);
  }
}

process.stdout.write('\x1b[?1000h\x1b[?1006h');
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === '\x03' || text === 'q') {
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  if (text === 'X') {
    // Dies on its own, with a semantic tree already published.
    setTimeout(() => {
      throw new Error('boom from the semantic fixture');
    }, 0);
    return;
  }
  if (text === '\t') {
    focused = focused === 'approve' ? 'reject' : 'approve';
    publish();
    return;
  }
  if (text === '\r' || text === ' ') {
    lastEvent = `ACTIVATED ${focused}`;
    publish();
    return;
  }
  if (/^[a-z]$/u.test(text) && text !== 'q') {
    typed += text;
    publish();
    return;
  }
  const click = /\x1b\[<0;(\d+);(\d+)M/u.exec(text);
  if (click !== null) {
    const column = Number(click[1]) - 1;
    focused = column >= 13 ? 'reject' : 'approve';
    lastEvent = `CLICKED ${focused}`;
    publish();
  }
});

if (endpoint === undefined || token === undefined) {
  // Dormant: identical screen, no channel, no marker.
  draw();
} else {
  socket = connect(endpoint, () => {
    const sendHello = () =>
      socket.write(
      encodeFrame(
        {
          type: 'hello',
          protocol: 'termwright/1',
          token,
          adapter: { name: 'fixture', version: '0.1.0' },
          capabilities: ['tree', 'bounds', 'states', 'actions', 'render-revisions'],
        },
        1024 * 1024,
      ),
    );
    if (helloDelay > 0) setTimeout(sendHello, helloDelay);
    else sendHello();
  });
  let pending = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    pending = decodeFrames(Buffer.concat([pending, chunk]), (message) => {
      if (message.type === 'hello-ack') {
        sessionId = message.sessionId;
        publish();
      }
    });
  });
  socket.on('error', () => process.exit(3));
}
