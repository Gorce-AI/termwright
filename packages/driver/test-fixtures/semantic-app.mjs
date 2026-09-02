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
// Publishes a committed snapshot followed only by a marker signed with a
// different key. The trailing receipt is a causal parser barrier for the E2E:
// once visible, the preceding OSC has already been consumed by the emulator.
const forgedMarkerProbe = process.env['TERMWRIGHT_FIXTURE_FORGED_MARKER'] === '1';
const terminalMouseEnabled = process.env['TERMWRIGHT_FIXTURE_MOUSE_MODE'] !== '0';
const firstTreeDelay = Number(process.env['TERMWRIGHT_FIXTURE_FIRST_TREE_DELAY'] ?? '0');
const pendingFocusFrame = process.env['TERMWRIGHT_FIXTURE_PENDING_FOCUS_FRAME'] === '1';
// Holds every semantic signal until after the new PTY frame is visible. This
// reproduces the cross-channel gap where screen-only output and the prefix of
// a future semantic render are deliberately indistinguishable to the driver.
const screenFirstFocusFrame = process.env['TERMWRIGHT_FIXTURE_SCREEN_FIRST_FRAME'] === '1';
const focusControlPort = Number(process.env['TERMWRIGHT_FIXTURE_FOCUS_CONTROL_PORT'] ?? '0');
const unpairedRefreshDelay = Number(
  process.env['TERMWRIGHT_FIXTURE_UNPAIRED_REFRESH_DELAY'] ?? '100',
);
const coverApproveCenter = process.env['TERMWRIGHT_FIXTURE_COVER_APPROVE_CENTER'] === '1';
const conditionStates = process.env['TERMWRIGHT_FIXTURE_CONDITIONS'] === '1';
const duplicateSemanticKey = process.env['TERMWRIGHT_FIXTURE_DUPLICATE_KEY'] === '1';
const hoverTracking = process.env['TERMWRIGHT_FIXTURE_HOVER'] === '1';
// Declares the DEC modes this fixture enables below, the way an instrumented
// application does. An embedding may hide those sequences from the driver, so
// this evidence can become authoritative for what the application decodes.
const providerInputModes = process.env['TERMWRIGHT_FIXTURE_INPUT_MODES'] === '1';
let loaderVisible = process.env['TERMWRIGHT_FIXTURE_LOADER'] === '1';
// Deliberately malicious provider wire frame. Unlike application SDKs (which
// stamp revisions themselves), this proves the driver rejects a stale frame
// received from a real adapter process rather than merely unit-testing the
// composition helper.
const staleProviderEvidence = process.env['TERMWRIGHT_FIXTURE_STALE_PROVIDER'] === '1';
const providerActionRecipes = process.env['TERMWRIGHT_FIXTURE_PROVIDER_ACTION_RECIPES'] === '1';
const providerFocusState = process.env['TERMWRIGHT_FIXTURE_PROVIDER_FOCUS_STATE'] === '1';
const unicodeGeometry = process.env['TERMWRIGHT_FIXTURE_UNICODE_GEOMETRY'];

const approvePrefix =
  unicodeGeometry === 'emoji' ? '  👨‍👩‍👧' : unicodeGeometry === 'devanagari' ? '  किं' : '  ';
// These are terminal cells, deliberately not JS string/code-point lengths.
// The fixture lets the E2E compare the adapter's semantic geometry with the
// independently parsed PTY frame for modern extended grapheme clusters.
const approveColumn = unicodeGeometry === 'emoji' ? 4 : unicodeGeometry === 'devanagari' ? 3 : 2;
const rejectColumn = approveColumn + 12;

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
const focusOrder = ['approve', 'reject', 'name'];

function focusRecipe(target) {
  if (focused === target) return [];
  const key = target === 'approve' ? 'P' : target === 'reject' ? 'J' : 'N';
  return [
    {
      action: 'focus',
      requiresFocus: false,
      steps: [{ kind: 'press', key }],
    },
  ];
}

function render() {
  const approve = focused === 'approve' ? '[Approve]' : ' Approve ';
  const reject = focused === 'reject' ? '[Reject]' : ' Reject ';
  // The status line lives inside the frame so it survives the next repaint.
  return `\x1b[2J\x1b[HPermission required\r\n${approvePrefix}${approve}   ${reject}\r\nname: [${typed}]\r\nlast: ${lastEvent}\r\n`;
}

let outputQueue = Promise.resolve();
let pendingFocusCommit = null;
let focusControl = null;
let pendingFocusMarkerWritten = false;

function writeAndFlush(data) {
  return new Promise((resolve, reject) => {
    process.stdout.write(data, (error) => {
      if (error instanceof Error) reject(error);
      else resolve();
    });
  });
}

function writeSocketAndFlush(target, data) {
  return new Promise((resolve, reject) => {
    if (target === null) {
      reject(new Error('semantic socket is unavailable'));
      return;
    }
    target.write(data, (error) => {
      if (error instanceof Error) reject(error);
      else resolve();
    });
  });
}

function enqueueOutput(task) {
  outputQueue = outputQueue.then(task).catch(() => process.exit(4));
}

function releasePendingFocusMarker() {
  if (pendingFocusCommit === null) process.exit(6);
  if (pendingFocusMarkerWritten) process.exit(6);
  pendingFocusMarkerWritten = true;
  enqueueOutput(async () => {
    const pending = pendingFocusCommit;
    if (pending === null) process.exit(6);
    await writeAndFlush(encodeMarker(token, pending.sessionId, pending.revision));
    await writeSocketAndFlush(focusControl, 'M');
  });
}

function releasePendingFocusCommit() {
  if (pendingFocusCommit === null || !pendingFocusMarkerWritten) process.exit(6);
  const pending = pendingFocusCommit;
  pendingFocusCommit = null;
  enqueueOutput(async () => {
    await writeSocketAndFlush(
      pending.socket,
      encodeFrame({ type: 'revision-commit', revision: pending.revision }, 1024 * 1024),
    );
    await writeSocketAndFlush(focusControl, 'A');
  });
}

function releaseScreenFirstFocusFrame() {
  if (!screenFirstFocusFrame || pendingFocusCommit === null) process.exit(6);
  const pending = pendingFocusCommit;
  pendingFocusCommit = null;
  enqueueOutput(async () => {
    await writeSocketAndFlush(
      pending.socket,
      encodeFrame({ type: 'semantic-full', snapshot: pending.snapshot }, 1024 * 1024),
    );
    await writeSocketAndFlush(
      pending.socket,
      encodeFrame({ type: 'revision-commit', revision: pending.revision }, 1024 * 1024),
    );
    await writeAndFlush(encodeMarker(token, pending.sessionId, pending.revision));
    await writeSocketAndFlush(focusControl, 'S');
  });
}

function confirmScreenFirstFocusHeld() {
  if (!screenFirstFocusFrame || pendingFocusCommit === null) process.exit(6);
  enqueueOutput(() => writeSocketAndFlush(focusControl, 'H'));
}

if (
  (pendingFocusFrame || screenFirstFocusFrame) &&
  Number.isInteger(focusControlPort) &&
  focusControlPort > 0
) {
  focusControl = connect({ host: '127.0.0.1', port: focusControlPort }, () => {
    focusControl.write('R');
  });
  focusControl.on('data', (chunk) => {
    for (const byte of chunk) {
      if (byte === 0x4d) releasePendingFocusMarker();
      else if (byte === 0x43) releasePendingFocusCommit();
      else if (byte === 0x53) releaseScreenFirstFocusFrame();
      else if (byte === 0x48) confirmScreenFirstFocusHeld();
      else process.exit(6);
    }
  });
  focusControl.on('error', () => process.exit(6));
}

function draw() {
  const frame = render();
  enqueueOutput(() => writeAndFlush(frame));
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
        bounds: { row: 1, column: approveColumn, width: 9, height: 1 },
        state: {
          ...(!providerFocusState ? { focused: focused === 'approve' } : {}),
          ...(conditionStates ? { checked: true, selected: true, expanded: false } : {}),
        },
        actions: ['focus', 'activate'],
        ...(!providerActionRecipes
          ? {
              inputRecipes: [
                ...focusRecipe('approve'),
                {
                  action: 'activate',
                  requiresFocus: true,
                  steps: [{ kind: 'press', key: 'Enter' }],
                },
              ],
            }
          : {}),
      },
      {
        id: 'n4',
        parentId: 'n1',
        role: 'textbox',
        name: 'Your name',
        testId: 'name-input',
        value: {
          status: 'known',
          value: typed,
          sensitivity: 'public',
          evidence: {
            source: 'application',
            method: 'native',
            strength: 'authoritative',
            providerId: 'fixture',
          },
        },
        bounds: { row: 2, column: 6, width: 20, height: 1 },
        state: !providerFocusState ? { focused: focused === 'name' } : undefined,
        actions: ['focus', 'setValue'],
        ...(!providerActionRecipes
          ? {
              inputRecipes: [
                ...focusRecipe('name'),
                {
                  action: 'setValue',
                  requiresFocus: true,
                  steps: [{ kind: 'press', key: 'K' }, { kind: 'insert-action-value' }],
                },
              ],
            }
          : {}),
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
        bounds: { row: 1, column: rejectColumn, width: 8, height: 1 },
        state: !providerFocusState ? { focused: focused === 'reject' } : undefined,
        actions: ['focus', 'activate'],
        ...(!providerActionRecipes
          ? {
              inputRecipes: [
                ...focusRecipe('reject'),
                {
                  action: 'activate',
                  requiresFocus: true,
                  steps: [{ kind: 'press', key: 'Enter' }],
                },
              ],
            }
          : {}),
      },
      ...(loaderVisible
        ? [
            {
              id: 'loader',
              parentId: 'n1',
              role: 'progressbar',
              name: 'Saving',
              bounds: { row: 4, column: 0, width: 10, height: 1 },
              state: {},
            },
          ]
        : []),
    ],
  };
}

function stripBounds(snapshot) {
  return {
    ...snapshot,
    nodes: snapshot.nodes.map(({ bounds: _bounds, ...node }) => node),
  };
}

function qualifiedSnapshot(snapshot) {
  const evidenceFor = (kind) =>
    ({
      adapter: {
        source: 'application',
        method: 'declared',
        strength: 'authoritative',
        providerId: 'fixture-adapter',
      },
      'viewport-clip': {
        source: 'driver',
        method: 'derived',
        strength: 'authoritative',
        providerId: 'fixture-clip',
      },
      'hit-grid': {
        source: 'application',
        method: 'native',
        strength: 'authoritative',
        providerId: 'fixture-hit-grid',
      },
    })[kind];
  const known = (value, kind) => ({ status: 'known', value, evidence: evidenceFor(kind) });
  const unsupportedGeometry = {
    status: 'unsupported',
    capability: 'intended-geometry',
    reason: 'framework-unobservable',
  };
  const unsupportedClip = {
    status: 'unsupported',
    capability: 'clipped-geometry',
    reason: 'framework-unobservable',
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
      intendedRect:
        bounds === undefined
          ? committedUnknown
            ? { status: 'unknown', reason: 'awaiting-revision-pair' }
            : unsupportedGeometry
          : known(bounds, 'adapter'),
      visibleRect:
        bounds === undefined
          ? committedUnknown
            ? { status: 'unknown', reason: 'awaiting-revision-pair' }
            : unsupportedClip
          : known(bounds, 'viewport-clip'),
    },
  }));
  const hitGrid =
    withoutBounds || withoutAbsoluteBounds || probeMode !== undefined
      ? unsupportedHitGrid
      : known(
          {
            regions: snapshot.nodes
              .filter((node) => node.id !== 'n1' && node.bounds !== undefined)
              .flatMap((node) => {
                if (coverApproveCenter && node.id === 'n2') {
                  return [
                    {
                      rect: {
                        row: node.bounds.row,
                        column: node.bounds.column,
                        width: 4,
                        height: 1,
                      },
                      recipientId: node.id,
                    },
                    {
                      rect: {
                        row: node.bounds.row,
                        column: node.bounds.column + 5,
                        width: node.bounds.width - 5,
                        height: 1,
                      },
                      recipientId: node.id,
                    },
                    {
                      rect: {
                        row: node.bounds.row,
                        column: node.bounds.column + 4,
                        width: 1,
                        height: 1,
                      },
                      recipientId: 'n3',
                    },
                  ];
                }
                return Array.from({ length: node.bounds.height }, (_, offset) => ({
                  rect: { ...node.bounds, row: node.bounds.row + offset, height: 1 },
                  recipientId: node.id,
                }));
              })
              .sort(
                (left, right) =>
                  left.rect.row - right.rect.row || left.rect.column - right.rect.column,
              ),
          },
          'hit-grid',
        );
  return {
    ...snapshot,
    v: 3,
    nodes,
    coordinateSpace: withoutBounds
      ? { status: 'unsupported', capability: 'coordinate-space', reason: 'framework-unobservable' }
      : known(withoutAbsoluteBounds ? 'framework-local-cells' : 'viewport-cells', 'adapter'),
    hitGrid,
    ...(staleProviderEvidence || providerActionRecipes || providerFocusState || providerInputModes
      ? {
          providerEvidence: [
            ...(providerInputModes
              ? [
                  {
                    providerId: 'fixture-production-input',
                    sessionId,
                    revision,
                    status: 'available',
                    evidence: {
                      source: 'application',
                      method: 'native',
                      strength: 'authoritative',
                      providerId: 'fixture-production-input',
                    },
                    pointerRegions: [],
                    inputModes: {
                      // Must match what this fixture actually writes below, or the
                      // driver's VT cross-check rejects the evidence as a conflict on
                      // platforms where the modes are observable.
                      mouseTracking: !terminalMouseEnabled
                        ? 'none'
                        : hoverTracking
                          ? 'any'
                          : 'vt200',
                      mouseEncoding: terminalMouseEnabled ? 'sgr' : 'default',
                      focusReporting: 'off',
                    },
                  },
                ]
              : []),
            ...(staleProviderEvidence
              ? [
                  {
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
                    pointerRegions: [
                      {
                        recipientId: 'n2',
                        regionBounds: { row: 1, column: 2, width: 9, height: 1 },
                        spans: [{ row: 1, from: 2, to: 11 }],
                      },
                    ],
                    // Match the framework's complete production ownership map on the
                    // valid first frame. Only the next frame's revision is corrupt.
                    hitGrid: hitGrid.status === 'known' ? hitGrid.value : { regions: [] },
                  },
                ]
              : []),
            ...(providerActionRecipes
              ? [
                  {
                    providerId: 'fixture-production-keys',
                    sessionId,
                    revision,
                    status: 'available',
                    evidence: {
                      source: 'application',
                      method: 'native',
                      strength: 'authoritative',
                      providerId: 'fixture-production-keys',
                    },
                    pointerRegions: [],
                    actionRecipes: [
                      {
                        recipientId: 'n2',
                        recipes: [
                          ...focusRecipe('approve'),
                          {
                            action: 'activate',
                            requiresFocus: true,
                            steps: [{ kind: 'press', key: 'Enter' }],
                          },
                        ],
                      },
                      {
                        recipientId: 'n3',
                        recipes: [
                          ...focusRecipe('reject'),
                          {
                            action: 'activate',
                            requiresFocus: true,
                            steps: [{ kind: 'press', key: 'Enter' }],
                          },
                        ],
                      },
                      {
                        recipientId: 'n4',
                        recipes: [
                          ...focusRecipe('name'),
                          {
                            action: 'setValue',
                            requiresFocus: true,
                            steps: [{ kind: 'press', key: 'K' }, { kind: 'insert-action-value' }],
                          },
                        ],
                      },
                    ],
                  },
                ]
              : []),
            ...(providerFocusState
              ? [
                  {
                    providerId: 'fixture-production-focus',
                    sessionId,
                    revision,
                    status: 'available',
                    evidence: {
                      source: 'application',
                      method: 'native',
                      strength: 'authoritative',
                      providerId: 'fixture-production-focus',
                    },
                    pointerRegions: [],
                    focusState: {
                      status: 'focused',
                      recipientId:
                        focused === 'approve' ? 'n2' : focused === 'reject' ? 'n3' : 'n4',
                    },
                  },
                ]
              : []),
          ],
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
  const publishedRevision = revision;
  const frame = render();
  if (socket === null || sessionId === null) {
    enqueueOutput(() => writeAndFlush(frame));
    return;
  }
  const snapshot = fullSnapshot();
  const publicationSocket = socket;
  const publicationSessionId = sessionId;
  enqueueOutput(async () => {
    // Wait for the complete frame write before the marker write, exactly as
    // production adapters are required to do. Serializing this task also
    // prevents frame N+1 from entering between frame N and marker N.
    await writeAndFlush(frame);
    publicationSocket.write(encodeFrame({ type: 'semantic-full', snapshot }, 1024 * 1024));
    publicationSocket.write(
      encodeFrame({ type: 'revision-commit', revision: publishedRevision }, 1024 * 1024),
    );
    const marker = encodeMarker(
      forgedMarkerProbe ? `${token}-forged` : token,
      publicationSessionId,
      publishedRevision,
    );
    // A plain-text receipt for the marker, printed only when a test asks for
    // it. It follows the marker and therefore belongs to a later observation.
    await writeAndFlush(
      `${marker}${
        forgedMarkerProbe
          ? `FORGED ${publishedRevision}\r\n`
          : markProbe
            ? `MARKED ${publishedRevision}\r\n`
            : ''
      }`,
    );
  });
}

// A real TUI repaints after its PTY changes size. Keep the fixture honest:
// resize() must observe the frame caused by resize itself, never a late frame
// from whichever input happened to precede it in the test.
process.stdout.on('resize', publish);

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

if (terminalMouseEnabled) {
  process.stdout.write(`${hoverTracking ? '\x1b[?1003h' : '\x1b[?1000h'}\x1b[?1006h`);
}
process.stdin.setRawMode?.(true);
process.stdin.resume();
process.stdin.on('data', (chunk) => {
  const text = chunk.toString('utf8');
  // PTYs are byte streams, not message transports. The clear recipe and the
  // immediately following typed payload may arrive as one chunk (`Kada`) or
  // as two; the production parser must assign identical meaning to both.
  const combinedReplace = /^K([a-z]+)$/u.exec(text);
  if (combinedReplace !== null) {
    typed = combinedReplace[1];
    publish();
    return;
  }
  if (text === '\x03' || text === 'q') {
    process.stdout.write('BYE\r\n');
    process.exit(0);
  }
  if (pendingFocusCommit !== null) {
    // The paired action barrier must emit no recipe input while the fixture
    // holds this revision open. The release travels over a separate acknowledged
    // control channel, so any PTY byte proves the driver crossed the boundary.
    process.exit(5);
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
    // Put unrelated terminal output ahead of the last semantic/render pair,
    // then publish a fresh pair shortly afterwards. A focused keyboard action
    // does not depend on the changed cells and may proceed against the current
    // semantic revision without waiting for whole-screen quiet.
    process.stdout.write('UNPAIRED SCREEN UPDATE\r\n');
    setTimeout(publish, unpairedRefreshDelay);
    return;
  }
  if (text === 'F' && pendingFocusFrame) {
    // Publish the new focus tree before its render marker. The old committed
    // tree must not authorize a keyboard action while this related semantic
    // change is explicitly in flight.
    revision += 1;
    const pendingRevision = revision;
    focused = 'reject';
    const pendingFrame = render();
    const pendingSnapshot = fullSnapshot();
    pendingFocusCommit = {
      revision: pendingRevision,
      sessionId,
      socket,
    };
    pendingFocusMarkerWritten = false;
    socket?.write(encodeFrame({ type: 'frame-begin', revision: pendingRevision }, 1024 * 1024));
    socket?.write(encodeFrame({ type: 'semantic-full', snapshot: pendingSnapshot }, 1024 * 1024));
    // The test releases marker and commit as two acknowledged phases only after
    // an action starts. That forces marker observation while FRAME_END remains
    // withheld; runner speed cannot decide which branch the test covers.
    enqueueOutput(() => writeAndFlush(pendingFrame));
    return;
  }
  if (text === 'F' && screenFirstFocusFrame) {
    revision += 1;
    focused = 'reject';
    pendingFocusCommit = {
      revision,
      sessionId,
      socket,
      snapshot: fullSnapshot(),
    };
    // No frame-begin, snapshot, commit or marker is emitted yet. Seeing this
    // frame therefore cannot tell the driver whether semantics will follow.
    enqueueOutput(() => writeAndFlush(render()));
    return;
  }
  if (text === 'R') {
    // An independently animated status row outside every semantic target.
    // Deliberately no semantic snapshot or marker: pointer planning must prove
    // the chosen target cells survived rather than demanding global idleness.
    process.stdout.write('\x1b[10;1HSPINNER 1');
    return;
  }
  if (text === 'O') {
    // A physical overwrite inside Approve's pointer region, again without a
    // semantic commit. Safe locator input must fail closed and emit no bytes.
    process.stdout.write('\x1b[2;3HOVERLAY!!');
    return;
  }
  if (text === 'L') {
    loaderVisible = false;
    publish();
    return;
  }
  if (text === 'P' || text === 'J' || text === 'N') {
    focused = text === 'P' ? 'approve' : text === 'J' ? 'reject' : 'name';
    lastEvent = `FOCUS ${focused}`;
    publish();
    return;
  }
  if (text === 'K') {
    typed = '';
    publish();
    return;
  }
  if (text === '\r' || text === ' ') {
    lastEvent = `ACTIVATED ${focused}`;
    publish();
    return;
  }
  if (/^\t+$/u.test(text)) {
    for (const _tab of text)
      focused = focusOrder[(focusOrder.indexOf(focused) + 1) % focusOrder.length];
    lastEvent = `FOCUS ${focused}`;
    publish();
    return;
  }
  if (text.startsWith('\x15')) {
    typed = '';
    const inserted = text.slice(1);
    if (/^[a-z]+$/u.test(inserted)) typed += inserted;
    publish();
    return;
  }
  if (/^[a-z]+$/u.test(text) && text !== 'q') {
    typed += text;
    publish();
    return;
  }
  const click = /\x1b\[<(\d+);(\d+);(\d+)M/u.exec(text);
  if (click !== null) {
    const buttonCode = Number(click[1]);
    const column = Number(click[2]) - 1;
    focused = column >= rejectColumn - 1 ? 'reject' : 'approve';
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
            protocol: 'termwright/3',
            token,
            adapter: { name: 'fixture', version: '0.1.0' },
            capabilities: [
              'tree',
              ...((!withoutBounds || brokenGeometryGuarantee) && !withoutAbsoluteBounds
                ? ['intended-geometry']
                : []),
              ...(!withoutBounds && !withoutAbsoluteBounds ? ['clipped-geometry'] : []),
              'states',
              ...(!providerFocusState ? ['focus-state'] : []),
              'actions',
              ...(!providerActionRecipes ? ['action-recipes'] : []),
              'render-revisions',
              'logs',
              ...(!withoutBounds && !withoutAbsoluteBounds && probeMode === undefined
                ? ['pointer-hit-grid']
                : []),
            ],
            ...(staleProviderEvidence ||
            providerActionRecipes ||
            providerFocusState ||
            providerInputModes
              ? {
                  providers: [
                    ...(providerInputModes
                      ? [
                          {
                            id: 'fixture-production-input',
                            version: '1.0.0',
                            method: 'native',
                            capabilities: ['terminal-input-modes'],
                          },
                        ]
                      : []),
                    ...(staleProviderEvidence
                      ? [
                          {
                            id: 'fixture-production-router',
                            version: '1.0.0',
                            method: 'native',
                            capabilities: ['pointer-regions', 'hit-test'],
                          },
                        ]
                      : []),
                    ...(providerActionRecipes
                      ? [
                          {
                            id: 'fixture-production-keys',
                            version: '1.0.0',
                            method: 'native',
                            capabilities: ['action-recipes'],
                          },
                        ]
                      : []),
                    ...(providerFocusState
                      ? [
                          {
                            id: 'fixture-production-focus',
                            version: '1.0.0',
                            method: 'native',
                            capabilities: ['focus-state'],
                          },
                        ]
                      : []),
                  ],
                }
              : {}),
            ...(probeMode === undefined && !pendingFocusFrame
              ? {}
              : {
                  probe: {
                    framework: 'fixture-fw',
                    frameworkVersion: '1.0.0',
                    probeVersion: '0.1.0',
                    identityKind: probeMode ?? 'stable',
                    // 'stable-identity' would contradict a frame-local kind, and
                    // the protocol refuses that pair on the wire.
                    capabilities: [
                      ...(probeMode === 'stable' || pendingFocusFrame ? ['stable-identity'] : []),
                      ...(pendingFocusFrame ? ['frame-begin'] : []),
                    ],
                    instrumentation:
                      probeMode === 'frame-local'
                        ? {
                            highestTier: 'T2',
                            semanticClass: 'B',
                            degradedCapabilities: ['intended-geometry', 'clipped-geometry'],
                          }
                        : {
                            highestTier: 'T3',
                            semanticClass: 'A',
                            degradedCapabilities: [],
                          },
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
          socket.write(
            encodeFrame(
              {
                type: 'error',
                code: 'duplicate-semantic-key',
                message: 'duplicate SemanticKey: save',
              },
              1024 * 1024,
            ),
            () => socket.end(),
          );
          return;
        }
        // Absent 'logs' means the channel was not granted: stay quiet.
        logBudget = message.logs?.enabled === true ? message.logs : null;
        if (firstTreeDelay > 0) setTimeout(publish, firstTreeDelay);
        else publish();
      }
    });
  });
  socket.on('error', () => process.exit(3));
}
