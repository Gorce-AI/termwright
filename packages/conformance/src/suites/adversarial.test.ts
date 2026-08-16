/**
 * Adversarial conformance — origin spec §20.3.
 *
 * Every case here is a hostile peer that completed a legitimate handshake and
 * then misbehaved. The contract under test is the same one throughout: the
 * driver fails closed on the offending traffic, tells the peer which wire error
 * it committed, keeps the last tree it *did* accept, and stays a usable session
 * that still exits exactly. Nothing here may take the session down with it.
 *
 * Run under `pnpm test:hostile` to execute the same suite with the worker's old
 * space capped at 128 MB, so exhaustion cases cannot pass on a roomy heap.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS } from '@termwright/protocol';
import type { SessionDiagnostic, TerminalHarness } from '@termwright/driver';
import { TermwrightError } from '@termwright/driver';
import { CONFORMANCE_FIXTURES, createSessionPool, ptyAvailable, rejection } from '../support/pty.js';

const sessions = createSessionPool();

/** The `log-flood` scenario sends this many records in one turn. */
const LOG_FLOOD_RECORDS = 500;

/** Collects the log records a session publishes, in order. */
function collectLogs(terminal: TerminalHarness): number[] {
  const seqs: number[] = [];
  terminal.events.on('app-log', (event) => {
    if (event.record !== undefined) seqs.push(event.record.seq);
  });
  return seqs;
}

/** The `flood` scenario publishes revisions 2..100 without markers. */
const FIRST_FLOOD_REVISION = 2;
const FLOOD_REVISIONS = 99;

/** Launches the peer, lets it publish a valid revision 1, and returns it armed. */
async function arm(scenario: string): Promise<TerminalHarness> {
  const terminal = await sessions.launch(CONFORMANCE_FIXTURES.adversarialPeer(), {
    columns: 70,
    rows: 16,
    semanticNegotiationMs: 3_000,
    args: [scenario],
  });
  await terminal.waitForText(`PEER READY ${scenario}`);
  return terminal;
}

/** Fires the hostile act and waits until its effect can no longer be in flight. */
async function fire(terminal: TerminalHarness): Promise<void> {
  await terminal.press('g');
  await terminal.waitForStable({ frames: 4 }).catch(() => undefined);
}

/** The diagnostic codes the session recorded, oldest first. */
function codes(terminal: TerminalHarness): readonly string[] {
  return terminal.diagnostics().map((entry) => entry.code);
}

/** The entries recorded under one code. */
function entriesFor(terminal: TerminalHarness, code: string): readonly SessionDiagnostic[] {
  return terminal.diagnostics().filter((entry) => entry.code === code);
}

/**
 * The session must still be alive and must still exit on request, exactly.
 *
 * Judged by the exit status alone: it proves the session was still taking input
 * and still owned the child. Asserting on screen content here would instead
 * depend on where the peer's output happened to be — under a flood the banner
 * has scrolled away, and the newest line races the exit it announces.
 */
async function expectSurvives(terminal: TerminalHarness): Promise<void> {
  await terminal.press('q');
  expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
}

afterEach(sessions.closeAll);

/**
 * Wire faults the driver must reject, with the error code it reports back.
 *
 * The split is the taxonomy an adapter author debugs against: a breach of a
 * declared ceiling is `limit-exceeded`, a breach of the structure is
 * `malformed`. Both ceiling cases below are thrown out of the frame decoder
 * rather than the message parser, so they are also the regression test for the
 * driver classifying decoder faults instead of lumping them together.
 */
const REJECTED: readonly { readonly scenario: string; readonly wireError: string }[] = [
  { scenario: 'duplicate-hello', wireError: 'malformed' },
  { scenario: 'oversized-frame', wireError: 'limit-exceeded' },
  { scenario: 'not-json', wireError: 'malformed' },
  { scenario: 'unknown-message', wireError: 'malformed' },
  { scenario: 'cycle', wireError: 'malformed' },
  { scenario: 'missing-parent', wireError: 'malformed' },
  { scenario: 'impossible-bounds', wireError: 'malformed' },
  { scenario: 'hostile-unicode', wireError: 'malformed' },
  { scenario: 'foreign-session', wireError: 'malformed' },
  { scenario: 'deep-nesting', wireError: 'limit-exceeded' },
  { scenario: 'too-many-nodes', wireError: 'limit-exceeded' },
];

describe.skipIf(!ptyAvailable())('a hostile semantic peer', () => {
  it.each(REJECTED)('rejects $scenario as $wireError and keeps the session', async ({ scenario, wireError }) => {
    const terminal = await arm(scenario);
    expect(terminal.semanticTree()?.revision).toBe(1);

    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('protocol-violation');

    // The channel is gone, but the tree the driver already accepted is not.
    expect(terminal.semanticTree()?.revision).toBe(1);
    expect(await terminal.getByRole('button').textContent()).toBe('Peer');
    expect(terminal.capabilities().semanticTree).toBe(true);

    // The session says why it closed the channel, in its own log.
    expect(codes(terminal)).toContain('adapter-attached');
    const violation = entriesFor(terminal, 'protocol-violation')[0];
    expect(violation, `no protocol-violation recorded for ${scenario}`).toBeDefined();
    // Both ends of the same contract: the driver logged the wire code it chose,
    // and the adapter received that exact code. The second half was
    // unassertable until the driver stopped destroying the socket in the same
    // turn as the write — a reading peer is now always told why.
    expect(violation?.wireCode).toBe(wireError);
    await terminal.waitForText(`PEER GOT ERROR ${wireError}`);
    expect(violation?.timeMs).toBeGreaterThan(0);
    await expectSurvives(terminal);
  });

  it('refuses a handshake with the wrong token and settles as generic', async () => {
    const terminal = await arm('bad-token');

    expect(terminal.capabilities().semanticTree).toBe(false);
    expect(terminal.semanticTree()).toBeNull();
    await expect.poll(() => entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('bad-token');
    await terminal.waitForText('PEER GOT ERROR bad-token');

    const error = (await rejection(terminal.getByRole('button').resolve({ timeout: 500 }))) as TermwrightError;
    expect(error.code).toBe('protocol-violation');
    expect(entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('bad-token');
    // A refused handshake never attached, so nothing may claim it did.
    expect(codes(terminal)).not.toContain('adapter-attached');
    // Grid locators keep working: a refused adapter is a generic session, not
    // a broken one.
    expect(await terminal.getByText('PEER START').count()).toBe(1);
    await expectSurvives(terminal);
  });

  it('refuses an unsupported protocol version', async () => {
    const terminal = await arm('bad-version');
    await expect.poll(() => entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('bad-version');
    await terminal.waitForText('PEER GOT ERROR bad-version');
    expect(terminal.capabilities().semanticTree).toBe(false);
    await expectSurvives(terminal);
  });

  it('refuses traffic that arrives before the handshake', async () => {
    const terminal = await arm('no-hello');
    await expect.poll(() => entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('malformed');
    await terminal.waitForText('PEER GOT ERROR malformed');
    expect(terminal.capabilities().semanticTree).toBe(false);
    expect(terminal.semanticTree()).toBeNull();
    await expectSurvives(terminal);
  });

  it('buffers a partial frame instead of acting on half a message', async () => {
    const terminal = await arm('partial-frame');
    await fire(terminal);

    expect(terminal.screen().text()).not.toContain('PEER GOT ERROR');
    expect(terminal.screen().text()).not.toContain('PEER SOCKET CLOSED');
    expect(terminal.semanticTree()?.revision).toBe(1);
    // Buffered, not acted on and not complained about: half a frame is neither
    // a violation nor a revision.
    expect(codes(terminal)).not.toContain('protocol-violation');
    await expectSurvives(terminal);
  });

  it('accepts a duplicated frame exactly once', async () => {
    const terminal = await arm('duplicate-frames');
    await fire(terminal);

    await expect.poll(() => terminal.semanticTree()?.revision).toBe(2);
    expect(await terminal.getByRole('button').textContent()).toBe('Twice');
    expect(terminal.screen().text()).not.toContain('PEER GOT ERROR');
    await expectSurvives(terminal);
  });

  it('drops a revision that goes backwards', async () => {
    const terminal = await arm('decreasing-revision');
    await fire(terminal);
    await expect.poll(() => terminal.semanticTree()?.revision).toBe(3);

    // Revision 2 arrived after 3 was published; it must never overwrite it.
    await terminal.waitForStable({ frames: 4 }).catch(() => undefined);
    expect(terminal.semanticTree()?.revision).toBe(3);
    expect(await terminal.getByRole('button').textContent()).toBe('Third');

    // `revision-dropped` covers two different causes — already published, and
    // too many in flight — so the revision number is what identifies this one.
    const dropped = entriesFor(terminal, 'revision-dropped');
    expect(dropped.map((entry) => entry.revision)).toContain(2);
    await expectSurvives(terminal);
  });

  it('publishes nothing for a marker without a tree', async () => {
    const terminal = await arm('marker-without-tree');
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('revision-expired');

    expect(terminal.semanticTree()?.revision).toBe(1);
    // The unpaired half names itself, so a half-published revision cannot be
    // mistaken for one that was never sent.
    expect(entriesFor(terminal, 'revision-expired').map((entry) => entry.revision)).toContain(5);
    await expectSurvives(terminal);
  });

  it('publishes nothing for a tree without a marker', async () => {
    const terminal = await arm('tree-without-marker');
    await fire(terminal);
    // The unpaired half expires; the driver keeps the last complete revision.
    await expect.poll(() => codes(terminal)).toContain('revision-expired');

    expect(terminal.semanticTree()?.revision).toBe(1);
    expect(entriesFor(terminal, 'revision-expired').map((entry) => entry.revision)).toContain(4);

    // `revision-commit` is advisory: the peer announced revision 4 and the
    // driver recorded the announcement, but only a marker commits a render.
    const advisory = entriesFor(terminal, 'revision-commit');
    expect(advisory.map((entry) => entry.revision)).toContain(4);
    expect(terminal.semanticTree()?.revision).not.toBe(4);
    await expectSurvives(terminal);
  });

  it('ignores a marker minted for another session', async () => {
    const terminal = await arm('foreign-marker');
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('marker-unverified');

    expect(terminal.semanticTree()?.revision).toBe(1);
    // Rejected, and invisible: a forged marker is still consumed by the parser
    // rather than printed into the grid.
    expect(terminal.screen().text()).not.toContain('twm;');
    await expectSurvives(terminal);
  });

  it('survives a rerender storm and settles on the last revision', async () => {
    const terminal = await arm('rapid-rerender');
    await fire(terminal);

    // 199 revisions over a pipe ConPTY re-encodes: the chain still arrives, it
    // just takes longer than a default poll allows.
    await expect.poll(() => terminal.semanticTree()?.revision, { timeout: 45_000 }).toBe(200);
    expect(await terminal.getByRole('button').textContent()).toBe('Rev200');
    await expectSurvives(terminal);
  });

  it('survives an output flood with a retained scrollback floor', async () => {
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.adversarialPeer(), {
      columns: 70,
      rows: 16,
      scrollbackLines: 50,
      semanticNegotiationMs: 3_000,
      args: ['flood'],
    });
    await terminal.waitForText('PEER READY flood');
    await terminal.press('g');
    await terminal.waitForIdle({ timeout: 20_000 }).catch(() => undefined);

    // Eviction is bounded and honest: old lines are gone and say so.
    expect(terminal.scrollback.retainedFloor).toBeGreaterThan(0);
    const truncated = await rejection(Promise.resolve().then(() => terminal.scrollback.text({ from: 0 })));
    expect((truncated as TermwrightError).code).toBe('history-truncated');
    // 99 trees with no markers behind them: the pairing ceiling has to evict,
    // and has to say which revisions it evicted rather than leaking them.
    // The peer pushes revisions 2..100 with no markers behind them, so all of
    // them stay pending against a ceiling of `maxQueuedFrames`. Which ones get
    // evicted is not a matter of degree: the oldest go, in order, until the
    // ceiling is met — so the exact set is derivable and worth pinning. A
    // change of ceiling, or an eviction policy that dropped the newest, fails
    // here rather than passing as "something was dropped".
    const evicted = FLOOD_REVISIONS - DEFAULT_LIMITS.maxQueuedFrames;
    const dropped = entriesFor(terminal, 'revision-dropped');
    expect(dropped.map((entry) => entry.revision)).toEqual(
      Array.from({ length: evicted }, (_, index) => index + FIRST_FLOOD_REVISION),
    );

    // A dropped revision names itself; it does not aggregate. `count` belongs
    // to entries that stand for several lost things at once.
    expect(dropped.every((entry) => entry.count === undefined)).toBe(true);
    expect(terminal.diagnostics().length).toBeLessThanOrEqual(200);
    await expectSurvives(terminal);
  });

  it('accepts a handshake that arrives inside the late-attach grace', async () => {
    // A child that boots slower than the negotiation window is routine when
    // suites run in parallel; the grace is the tolerance for exactly that, so
    // this adapter must still get its session.
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.adversarialPeer(), {
      columns: 70,
      rows: 16,
      semanticNegotiationMs: 250,
      args: ['none', '--hello-delay=700'],
    });
    await terminal.waitForText('PEER SENT HELLO');

    await expect.poll(() => terminal.capabilities().semanticTree).toBe(true);
    expect(await terminal.getByRole('button').textContent()).toBe('Peer');
    expect(codes(terminal)).toContain('adapter-attached');
    await expectSurvives(terminal);
  });

  it('refuses a handshake that arrives after the verdict is final', async () => {
    const terminal = await sessions.launch(CONFORMANCE_FIXTURES.adversarialPeer(), {
      columns: 70,
      rows: 16,
      semanticNegotiationMs: 250,
      args: ['none', '--hello-delay=3000'],
    });
    await terminal.waitForText('PEER SENT HELLO');

    // Past the grace the session is generic for good: a late hello cannot flip
    // a mode the caller has already been told about.
    await expect.poll(() => codes(terminal)).toContain('adapter-capability');
    expect(terminal.capabilities().semanticTree).toBe(false);
    expect(terminal.semanticTree()).toBeNull();

    expect(entriesFor(terminal, 'adapter-capability')[0]?.wireCode).toBe('internal');
    await terminal.waitForText('PEER GOT ERROR internal');
    await expectSurvives(terminal);
  });

  it('refuses a second adapter without disturbing the first', async () => {
    const terminal = await arm('second-connection');
    await fire(terminal);
    await expect.poll(() => entriesFor(terminal, 'adapter-capability').at(-1)?.wireCode).toBe('internal');
    await terminal.waitForText('PEER SECOND GOT ERROR internal');

    // The session keeps the adapter it already had: a refused newcomer is not
    // allowed to cost the incumbent its channel.
    expect(terminal.capabilities().semanticTree).toBe(true);
    expect(terminal.semanticTree()?.revision).toBe(1);
    await terminal.press('p');
    await expect.poll(() => terminal.semanticTree()?.revision).toBe(2);
    await expectSurvives(terminal);
  });

  it('refuses log records the handshake never invited', async () => {
    const terminal = await arm('log-no-negotiation');
    const seqs = collectLogs(terminal);
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('protocol-violation');

    // An adapter that never announced `logs` was never granted a budget, so a
    // record is not merely unexpected — it is traffic the driver has no way to
    // bound. The channel closes rather than absorbing it.
    expect(entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('malformed');
    await terminal.waitForText('PEER GOT ERROR malformed');
    expect(seqs).toEqual([]);
    await expectSurvives(terminal);
  });

  it('refuses a repeated seq without closing the channel', async () => {
    const terminal = await arm('log-seq-duplicate');
    const seqs = collectLogs(terminal);
    await fire(terminal);
    await expect.poll(() => seqs).toEqual([1, 2]);

    // A miscounted seq is a bug in the adapter, not hostile input: the record
    // is refused so a consumer counting errors cannot count one twice, and the
    // session keeps its channel — the record after the duplicate still arrives.
    expect(codes(terminal)).toContain('log-dropped');
    expect(codes(terminal)).not.toContain('protocol-violation');
    expect(terminal.capabilities().semanticTree).toBe(true);
    await expectSurvives(terminal);
  });

  it('reports how many records the adapter dropped at the source', async () => {
    const terminal = await arm('log-seq-gap');
    const seqs = collectLogs(terminal);
    await fire(terminal);
    await expect.poll(() => seqs).toEqual([1, 6]);

    // A gap upward means the adapter shed load itself. Only it knows how much,
    // so the count is derived from the gap rather than guessed.
    const gap = entriesFor(terminal, 'log-dropped')[0];
    expect(gap?.count).toBe(4);
    expect(codes(terminal)).not.toContain('protocol-violation');
    await expectSurvives(terminal);
  });

  it('closes the channel on a log record over the byte ceiling', async () => {
    const terminal = await arm('log-oversized');
    const seqs = collectLogs(terminal);
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('protocol-violation');

    expect(entriesFor(terminal, 'protocol-violation')[0]?.wireCode).toBe('limit-exceeded');
    await terminal.waitForText('PEER GOT ERROR limit-exceeded');
    expect(seqs).toEqual([]);
    await expectSurvives(terminal);
  });

  it('holds its own log budget when an adapter ignores the negotiated one', async () => {
    const terminal = await arm('log-flood');
    const seqs = collectLogs(terminal);
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('log-dropped');
    await terminal.waitForStable({ frames: 4 }).catch(() => undefined);

    const refused = entriesFor(terminal, 'log-dropped')
      .map((entry) => entry.count ?? 0)
      .reduce((sum, count) => sum + count, 0);

    // Every record is accounted for: what arrived plus what was refused is
    // what was sent. Asserted without naming the ceiling, so tuning the budget
    // does not turn this into a false failure.
    expect(seqs.length + refused).toBe(LOG_FLOOD_RECORDS);
    expect(seqs.length).toBeGreaterThan(0);
    expect(refused).toBeGreaterThan(0);

    // The budget sheds the tail, not an arbitrary subset: what got through is
    // the first N records, in order.
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, index) => index + 1));

    // A flood of logs must not cost the session its semantic channel.
    expect(terminal.capabilities().semanticTree).toBe(true);
    expect(codes(terminal)).not.toContain('protocol-violation');
    await expectSurvives(terminal);
  });

  it('composes a correct delta chain without ever resynchronising', async () => {
    const terminal = await arm('delta-sequence');
    expect(terminal.semanticTree()?.revision).toBe(1);

    await fire(terminal);
    await expect.poll(() => terminal.semanticTree()?.revision).toBe(4);

    // Composed, not merely counted: the node the deltas rewrote holds the last
    // value, and the locator finds it through the composed tree.
    expect(await terminal.getByRole('button').textContent()).toBe('Fourth');
    expect(await terminal.getByTestId('peer-button').boundingBox()).toEqual({
      row: 1,
      column: 0,
      width: 10,
      height: 1,
    });

    // A chain that composes needs no repair and loses nothing.
    expect(codes(terminal)).not.toContain('delta-resync');
    expect(codes(terminal)).not.toContain('revision-dropped');
    await expectSurvives(terminal);
  });

  it('asks for a full tree when a delta names a base it never held', async () => {
    const terminal = await arm('delta-bad-base');
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('delta-resync');

    // The repair completes end to end: the driver asks, the peer supplies, and
    // the session lands on the tree that answer carried.
    await terminal.waitForText('PEER SENT FULL TREE');
    await expect.poll(async () => terminal.getByRole('button').textContent()).toBe('Resynced');
    expect(terminal.semanticTree()?.revision).toBe(1001);

    // A successful repair is not data loss and must not be reported as any.
    const afterResync = terminal
      .diagnostics()
      .slice(terminal.diagnostics().findIndex((entry) => entry.code === 'delta-resync'));
    expect(afterResync.map((entry) => entry.code)).not.toContain('revision-dropped');
    await expectSurvives(terminal);
  });

  it('lets a delta set the cursor but only a full tree clear it', async () => {
    const terminal = await arm('delta-cursor-clear');
    expect(terminal.semanticTree()?.cursor).toBeUndefined();

    await fire(terminal);
    await expect.poll(() => terminal.semanticTree()?.cursor?.column).toBe(7);
    expect(terminal.semanticTree()?.cursor).toMatchObject({ row: 3, column: 7, visible: true });

    // The asymmetry: absent in a delta means "unchanged", so clearing is
    // something only a whole tree can express.
    await terminal.press('c');
    await expect.poll(() => terminal.semanticTree()?.revision).toBe(3);
    expect(terminal.semanticTree()?.cursor).toBeUndefined();
    expect(codes(terminal)).not.toContain('delta-resync');
    await expectSurvives(terminal);
  });

  it('resynchronises when a delta removes a node that is not there', async () => {
    const terminal = await arm('delta-removed-missing');
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('delta-resync');

    // Removing an unknown id means the producer's base disagrees with ours, so
    // the tree is replaced rather than patched into something plausible.
    await terminal.waitForText('PEER SENT FULL TREE');
    await expect.poll(async () => terminal.getByRole('button').textContent()).toBe('Resynced');
    await expectSurvives(terminal);
  });

  it('resynchronises when a delta arrives before any full tree', async () => {
    const terminal = await arm('delta-before-snapshot');
    // The peer published nothing first, on purpose.
    expect(terminal.semanticTree()).toBeNull();

    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('delta-resync');
    await terminal.waitForText('PEER SENT FULL TREE');
    await expect.poll(async () => terminal.getByRole('button').textContent()).toBe('Resynced');
    await expectSurvives(terminal);
  });

  it('survives a delta flood and lands on the last revision', async () => {
    const terminal = await arm('delta-flood');
    await fire(terminal);

    await expect.poll(() => terminal.semanticTree()?.revision, { timeout: 45_000 }).toBe(200);
    expect(await terminal.getByRole('button').textContent()).toBe('Rev200');

    // A flood is pressure on the pairing, not a reason to give up composing:
    // the chain still ends where it should, and nothing had to be repaired.
    expect(codes(terminal)).not.toContain('delta-resync');
    expect(terminal.capabilities().semanticTree).toBe(true);
    await expectSurvives(terminal);
  });

  it('accepts a marker closed with ST as readily as one closed with BEL', async () => {
    const terminal = await arm('marker-st-terminator');
    expect(terminal.semanticTree()?.revision).toBe(1);

    await fire(terminal);

    // Both terminators are legal. An implementation emits BEL, so ST is the
    // one that rots unnoticed unless something outside the implementation
    // sends it.
    await expect.poll(() => terminal.semanticTree()?.revision).toBe(2);
    expect(await terminal.getByRole('button').textContent()).toBe('Terminated');
    expect(codes(terminal)).not.toContain('marker-unverified');
    await expectSurvives(terminal);
  });

  it('surfaces the code an adapter reports at us, not one of its own', async () => {
    const terminal = await arm('peer-error');
    await fire(terminal);
    await expect.poll(() => codes(terminal)).toContain('protocol-violation');

    // The peer chose 'internal'; the driver must not relabel it.
    const violation = entriesFor(terminal, 'protocol-violation')[0];
    expect(violation?.wireCode).toBe('internal');
    expect(violation?.detail).toContain('the adapter gave up');
    expect(terminal.semanticTree()?.revision).toBe(1);
    await expectSurvives(terminal);
  });

  it('keeps the session usable after the peer disconnects mid-render', async () => {
    const terminal = await arm('disconnect-mid-render');
    await fire(terminal);
    await terminal.waitForText('PEER SOCKET CLOSED');

    expect(terminal.semanticTree()?.revision).toBe(1);
    expect(terminal.capabilities().semanticTree).toBe(true);
    expect(await terminal.getByRole('button').textContent()).toBe('Peer');
    await expect.poll(() => codes(terminal)).toContain('adapter-disconnected');
    await expectSurvives(terminal);
  });

  it('survives the peer crashing outright', async () => {
    const terminal = await arm('cycle');
    await terminal.signal('KILL');

    // How a killed child is *reported* is the platform's business: POSIX gives
    // a signal, ConPTY gives neither a signal nor a non-zero code. What the
    // session owes is the same everywhere — it notices the death and stops
    // pretending the program can still be driven.
    await terminal.waitForExit();
    await expect
      .poll(async () => ((await rejection(terminal.press('a'))) as TermwrightError | null)?.code)
      .toBe('process-exited');
  });
});
