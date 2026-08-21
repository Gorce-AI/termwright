/**
 * Minimal semantic fixture: a hand-written adapter that performs the real
 * handshake, publishes a two-button dialog and commits each render with a
 * render marker. It exercises the whole semantic path (endpoint, framing, validation,
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
const brokenGeometryGuarantee = process.env['TERMWRIGHT_FIXTURE_BROKEN_GEOMETRY_GUARANTEE'] === '1';
const committedUnknown = process.env['TERMWRIGHT_FIXTURE_COMMITTED_UNKNOWN'] === '1';
// A bounds-only adapter may expose useful relative geometry, but the driver
// must refuse to turn it into physical pointer input.
const withoutAbsoluteBounds = process.env['TERMWRIGHT_FIXTURE_RELATIVE_BOUNDS'] === '1';
// Simulates a child that is slow to reach its handshake — routine on a loaded
// machine running suites in parallel, where node's own startup outruns the
// negotiation window.
const helloDelay = Number(process.env['TERMWRIGHT_FIXTURE_HELLO_DELAY'] ?? '0');
// Prints a plain-text receipt after each render marker. Opt-in, because the
// extra line is visible and other packages snapshot this fixture's screen.
const markProbe = process.env['TERMWRIGHT_FIXTURE_MARK_PROBE'] === '1';
const coverApproveCenter = process.env['TERMWRIGHT_FIXTURE_COVER_APPROVE_CENTER'] === '1';
const conditionStates = process.env['TERMWRIGHT_FIXTURE_CONDITIONS'] === '1';
const duplicateSemanticKey = process.env['TERMWRIGHT_FIXTURE_DUPLICATE_KEY'] === '1';
const hoverTracking = process.env['TERMWRIGHT_FIXTURE_HOVER'] === '1';
// Deliberately malicious provider wire frame. Unlike application SDKs (which
// stamp revisions themselves), this proves the driver rejects a stale frame
// received from a real adapter process rather than merely unit-testing the
// composition helper.
const staleProviderEvidence = process.env['TERMWRIGHT_FIXTURE_STALE_PROVIDER'] === '1';

let sessionId = null;
let revision = 0;
let focused = 'approve';
let socket = null;
let lastEvent = 'none';
let logSeq = 0;
let logBudget = null;
/**
 * Opt-in probe mode: `stable` or `frame-local`. When set, the fixture attaches
 * as a probe rather than a hand-written adapter and publishes one unrecognised
 * widget, so the driver's identity rules and `generic` handling are exercised
 * against a real session. Off by default, so every other test sees the same
 * tree it always did.
 */
const probeMode = process.env['TERMWRIGHT_FIXTURE_PROBE'];
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
        state: {
          focused: focused === 'approve',
          ...(conditionStates ? { checked: true, selected: true, expanded: false } : {}),
        },
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
      ...(probeMode === undefined
        ? []
        : [
            {
              id: 'n5',
              parentId: 'n1',
              role: 'generic',
              name: 'Scroller',
              frameworkType: 'ScrollView',
              bounds: { row: 3, column: 0, width: 30, height: 1 },
              p: 'heuristic',
            },
          ]),
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

function qualifiedSnapshot(snapshot) {
  const evidenceFor = (kind) => ({
    adapter: { source: 'application', method: 'declared', strength: 'authoritative', providerId: 'fixture-adapter' },
    'viewport-clip': { source: 'driver', method: 'derived', strength: 'authoritative', providerId: 'fixture-clip' },
    'hit-grid': { source: 'application', method: 'native', strength: 'authoritative', providerId: 'fixture-hit-grid' },
  })[kind];
  const known = (value, kind) => ({ status: 'known', value, evidence: evidenceFor(kind) });
  const unsupportedGeometry = {
    status: 'unsupported', capability: 'intended-geometry', reason: 'framework-unobservable',
  };
  const unsupportedClip = {
    status: 'unsupported', capability: 'clipped-geometry', reason: 'framework-unobservable',
  };
  const unsupportedHitGrid = {
    status: 'unsupported',
    capability: 'pointer-hit-grid',
    reason: 'framework-unobservable',
  };
  const nodes = snapshot.nodes.map(({ bounds, ...node }) => ({
    ...node,
    geometry: {
      displayed: known(true, 'adapter'),
      intendedRect: bounds === undefined
        ? committedUnknown ? { status: 'unknown', reason: 'awaiting-revision-pair' } : unsupportedGeometry
        : known(bounds, 'adapter'),
      visibleRect: bounds === undefined
        ? committedUnknown ? { status: 'unknown', reason: 'awaiting-revision-pair' } : unsupportedClip
        : known(bounds, 'viewport-clip'),
    },
  }));
  const hitGrid = withoutBounds || withoutAbsoluteBounds || probeMode !== undefined
    ? unsupportedHitGrid
    : known({
        regions: snapshot.nodes
          .filter((node) => node.id !== 'n1' && node.bounds !== undefined)
          .flatMap((node) => {
            if (coverApproveCenter && node.id === 'n2') {
              return [
                { rect: { row: node.bounds.row, column: node.bounds.column, width: 4, height: 1 }, recipientId: node.id },
                { rect: { row: node.bounds.row, column: node.bounds.column + 5, width: node.bounds.width - 5, height: 1 }, recipientId: node.id },
                { rect: { row: node.bounds.row, column: node.bounds.column + 4, width: 1, height: 1 }, recipientId: 'n3' },
              ];
            }
            return Array.from({ length: node.bounds.height }, (_, offset) => ({
              rect: { ...node.bounds, row: node.bounds.row + offset, height: 1 },
              recipientId: node.id,
            }));
          })
          .sort((left, right) => left.rect.row - right.rect.row || left.rect.column - right.rect.column),
      }, 'hit-grid');
  return {
    ...snapshot,
    v: 2,
    nodes,
    coordinateSpace: withoutBounds
      ? { status: 'unsupported', capability: 'coordinate-space', reason: 'framework-unobservable' }
      : known(withoutAbsoluteBounds ? 'framework-local-cells' : 'viewport-cells', 'adapter'),
    hitGrid,
    ...(staleProviderEvidence
      ? {
          providerEvidence: [{
            providerId: 'fixture-production-router',
            sessionId,
            // Revision 1 is valid so negotiation can freeze normally; the
            // next application render deliberately replays revision 1.
            revision: revision === 1 ? 1 : revision - 1,
            status: 'available',
            evidence: {
              source: 'application',
              method: 'native',
              strength: 'authoritative',
              providerId: 'fixture-production-router',
            },
            pointerRegions: [{
              recipientId: 'n2',
              regionBounds: {row: 1, column: 2, width: 9, height: 1},
              spans: [{row: 1, from: 2, to: 11}],
            }],
            // Match the framework's complete production ownership map on the
            // valid first frame. Only the next frame's revision is corrupt.
            hitGrid: hitGrid.status === 'known' ? hitGrid.value : {regions: []},
          }],
        }
      : {}),
  };
}

function sendLog(level, message, extra = {}, reuseSeq = false) {
  if (socket === null || logBudget === null) return;
  if (!reuseSeq) logSeq += 1;
  socket.write(
    encodeFrame(
      {
        type: 'log',
        record: { ts: Date.now(), level, message, seq: logSeq, logger: 'fixture', ...extra },
      },
      1024 * 1024,
    ),
  );
}

function fullSnapshot() {
  const layout = withoutBounds ? stripBounds(tree()) : tree();
  return qualifiedSnapshot(layout);
}

function publish() {
  revision += 1;
  draw();
  if (socket === null || sessionId === null) return;
  const snapshot = fullSnapshot();
  socket.write(encodeFrame({ type: 'snapshot', snapshot }, 1024 * 1024));
  socket.write(encodeFrame({ type: 'revision-commit', revision }, 1024 * 1024));
  // The marker commits the render: it must follow the last byte of the frame.
  process.stdout.write(encodeMarker(token, sessionId, revision));
  // A plain-text receipt for the marker, printed only when a test asks for it:
  // an extra line changes the screen, and other packages hold cell snapshots of
  // this fixture.
  if (markProbe) process.stdout.write(`MARKED ${revision}\r\n`);
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

process.stdout.write(`${hoverTracking ? '\x1b[?1003h' : '\x1b[?1000h'}\x1b[?1006h`);
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  if (text === '\x03' || text === 'q') {
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  if (text === 'g') {
    sendLog('info', 'a single record');
    return;
  }
  if (text === 'G') {
    // Far over the granted budget, on purpose.
    for (let index = 0; index < 400; index += 1) sendLog('debug', `flood ${index}`);
    return;
  }
  if (text === 'D') {
    // Repeats the previous seq: an adapter that lost track of its counter.
    sendLog('error', 'a repeated seq', {}, true);
    return;
  }
  if (text === 'S') {
    // A gap in seq is how an adapter reports what it dropped at the source.
    logSeq += 5;
    sendLog('warn', 'after a local drop');
    return;
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
  if (text === 'P') {
    lastEvent = 'PROVIDER DISCONNECTED';
    draw();
    socket?.destroy();
    return;
  }
  if (text === 'U') {
    // Put the VT one revision ahead of the last semantic/render pair, then
    // publish a fresh pair shortly afterwards. Locator keyboard actions must
    // re-plan without emitting input during this ordinary render race.
    process.stdout.write('UNPAIRED SCREEN UPDATE\r\n');
    setTimeout(publish, 100);
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
  const click = /\x1b\[<(\d+);(\d+);(\d+)M/u.exec(text);
  if (click !== null) {
    const buttonCode = Number(click[1]);
    const column = Number(click[2]) - 1;
    focused = column >= 13 ? 'reject' : 'approve';
    lastEvent = `${(buttonCode & 32) !== 0 ? 'HOVER' : 'CLICKED'} ${focused} modifiers=${buttonCode & 28}`;
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
          protocol: 'termwright/2',
          token,
          adapter: { name: 'fixture', version: '0.1.0' },
          capabilities: [
            'tree',
            ...((!withoutBounds || brokenGeometryGuarantee) && !withoutAbsoluteBounds ? ['intended-geometry'] : []),
            ...(!withoutBounds && !withoutAbsoluteBounds ? ['clipped-geometry'] : []),
            'states',
            'actions',
            'render-revisions',
            'logs',
            ...(!withoutBounds && !withoutAbsoluteBounds && probeMode === undefined
              ? ['pointer-hit-grid']
              : []),
          ],
          ...(staleProviderEvidence
            ? {
                providers: [{
                  id: 'fixture-production-router',
                  version: '1.0.0',
                  method: 'native',
                  capabilities: ['pointer-regions', 'hit-test'],
                }],
              }
            : {}),
          ...(probeMode === undefined
            ? {}
            : {
                probe: {
                  framework: 'fixture-fw',
                  frameworkVersion: '1.0.0',
                  probeVersion: '0.1.0',
                  identityKind: probeMode,
                  // 'stable-identity' would contradict a frame-local kind, and
                  // the protocol refuses that pair on the wire.
                  capabilities: probeMode === 'stable' ? ['stable-identity'] : [],
                },
              }),
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
        if (duplicateSemanticKey) {
          socket.write(encodeFrame({
            type: 'error',
            code: 'duplicate-semantic-key',
            message: 'duplicate SemanticKey: save',
          }, 1024 * 1024), () => socket.end());
          return;
        }
        // Absent 'logs' means the channel was not granted: stay quiet.
        logBudget = message.logs?.enabled === true ? message.logs : null;
        publish();
      }
    });
  });
  socket.on('error', () => process.exit(3));
}
