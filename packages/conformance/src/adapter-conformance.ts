/**
 * The adapter contract suite — the part of this package that is meant to be
 * used from outside it.
 *
 * An adapter is conforming when five things hold, and they are the same five in
 * every language: it stays dormant without an endpoint, it completes the
 * handshake, every snapshot it publishes is valid, it orders each revision as
 * snapshot → commit → marker-after-the-frame, and it survives losing the
 * channel without taking the application with it.
 *
 * The suite drives the adapter as a subprocess and observes only bytes and
 * frames, so a Python, Go or Rust adapter self-certifies exactly like the Ink
 * one — nothing here imports an adapter.
 */
import { ADAPTER_CAPABILITIES, validateSnapshot, DEFAULT_LIMITS } from '@termwright/protocol';
import type { SemanticSnapshot } from '@termwright/protocol';
import { AdapterProbe, MARKER_TEXT_PREFIX, type AdapterCommand, type ProbeObservation } from './support/probe.js';
import { ptyAvailable } from './support/pty.js';

/** How to start, drive and stop the adapter under test. */
export interface AdapterConformanceOptions {
  /** Name of the adapter, used in the test titles. */
  readonly name: string;
  /** Command that starts the instrumented application. */
  spawn(): AdapterCommand;
  /**
   * Optional command rendering the same UI with the adapter compiled out. When
   * given, the dormant run is compared against it byte for byte — the strongest
   * form of the dormant rule. Without it, a dormant run is only checked for
   * silence on the wire.
   */
  baseline?(): AdapterCommand;
  /** Text that proves the first frame reached the terminal. */
  readonly ready: string | RegExp;
  /** An input that changes the screen, and the text that proves it landed. */
  readonly interaction: { readonly input: string; readonly expect: string | RegExp };
  /** An input that makes the application exit, and the status it exits with. */
  readonly quit: { readonly input: string; readonly exitCode?: number };
  readonly columns?: number;
  readonly rows?: number;
  /** Assert that published bounds are viewport-absolute (an `absolute-bounds` claim). */
  readonly expectAbsoluteBounds?: boolean;
  /** How long the handshake may take. Default 10 s. */
  readonly timeoutMs?: number;
}

const snapshotsOf = (observation: ProbeObservation): SemanticSnapshot[] =>
  observation.messages
    .filter((entry) => entry.message.type === 'snapshot')
    .map((entry) => (entry.message as { snapshot: SemanticSnapshot }).snapshot);

/**
 * Registers the adapter contract suite for one adapter.
 *
 * Call it at the top level of a test file; it declares its own `describe`.
 *
 * `vitest` is imported dynamically, so the package stays importable from a
 * plain script that only wants the fixture paths or the probe. That is why the
 * function is async: `await` it at the top level of the test file, which is
 * where vitest collects the suite from.
 *
 * @example
 * ```ts
 * await runAdapterConformance({
 *   name: '@termwright/ink',
 *   spawn: () => ({ command: ['node', 'app.mjs'] }),
 *   ready: 'Ready',
 *   interaction: { input: '\t', expect: '[Save]' },
 *   quit: { input: 'q', exitCode: 0 },
 * });
 * ```
 */
export async function runAdapterConformance(options: AdapterConformanceOptions): Promise<void> {
  const { afterAll, beforeAll, describe, expect, it } = await import('vitest');
  const timeout = options.timeoutMs ?? 10_000;
  const probeOptions = {
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
  };

  describe.skipIf(!ptyAvailable())(`adapter conformance: ${options.name}`, { timeout: timeout * 4 }, () => {
    describe('the dormant rule', () => {
      it('opens nothing and emits no marker without an endpoint', async () => {
        const probe = await AdapterProbe.start(options.spawn(), { ...probeOptions, instrument: false });
        try {
          await probe.waitForText(options.ready, timeout);
          await probe.write(options.interaction.input);
          await probe.waitForText(options.interaction.expect, timeout);

          const observation = probe.observe();
          expect(observation.connections).toBe(0);
          expect(observation.messages).toHaveLength(0);
          expect(observation.text).not.toContain(MARKER_TEXT_PREFIX);
        } finally {
          await probe.stop();
        }
      });

      it.skipIf(options.baseline === undefined)(
        'produces the same bytes as a build without the adapter',
        async () => {
          const script = async (command: AdapterCommand): Promise<Uint8Array> => {
            const probe = await AdapterProbe.start(command, { ...probeOptions, instrument: false });
            try {
              await probe.waitForText(options.ready, timeout);
              await probe.write(options.interaction.input);
              await probe.waitForText(options.interaction.expect, timeout);
              await probe.write(options.quit.input);
              await probe.waitForExit(timeout).catch(() => undefined);
              return probe.observe().stdout;
            } finally {
              await probe.stop();
            }
          };

          const instrumented = await script(options.spawn());
          const plain = await script((options.baseline as () => AdapterCommand)());
          // Byte-for-byte: an instrumented build that is one escape sequence
          // different from a plain one is not shippable to production.
          expect(Buffer.from(instrumented).toString('binary')).toBe(Buffer.from(plain).toString('binary'));
        },
      );
    });

    describe('an instrumented session', () => {
      let probe: AdapterProbe;

      beforeAll(async () => {
        probe = await AdapterProbe.start(options.spawn(), probeOptions);
        await probe.waitForText(options.ready, timeout);
        await probe.waitFor((observation) => snapshotsOf(observation).length > 0, timeout);
      });

      afterAll(async () => {
        await probe?.stop();
      });

      it('completes the handshake before anything else', async () => {
        const { messages, connections } = probe.observe();
        const first = messages[0];

        expect(connections).toBe(1);
        expect(first?.message.type).toBe('hello');
        const hello = first?.message as { protocol: string; adapter: { name: string; version: string }; capabilities: readonly string[] };
        expect(hello.protocol).toBe('termwright/1');
        expect(hello.adapter.name.length).toBeGreaterThan(0);
        expect(hello.adapter.version.length).toBeGreaterThan(0);
        expect(hello.capabilities.every((entry) => (ADAPTER_CAPABILITIES as readonly string[]).includes(entry))).toBe(true);
        expect(hello.capabilities).toContain('tree');
        // A second hello, or a hello after other traffic, is a protocol fault.
        expect(messages.filter((entry) => entry.message.type === 'hello')).toHaveLength(1);
      });

      it('publishes only valid snapshots, bound to this session', async () => {
        const observation = probe.observe();
        const snapshots = snapshotsOf(observation);

        expect(observation.faults).toEqual([]);
        expect(snapshots.length).toBeGreaterThan(0);
        for (const snapshot of snapshots) {
          expect(validateSnapshot(snapshot, DEFAULT_LIMITS)).toMatchObject({ ok: true });
          expect(snapshot.sessionId).toBe(probe.sessionId);
          expect(snapshot.v).toBe(1);
          const ids = new Set(snapshot.nodes.map((node) => node.id));
          for (const node of snapshot.nodes) {
            if (node.parentId === undefined) expect(snapshot.rootIds).toContain(node.id);
            else expect(ids.has(node.parentId)).toBe(true);
          }
        }

        const revisions = snapshots.map((snapshot) => snapshot.revision);
        expect([...revisions]).toEqual([...new Set(revisions)].sort((left, right) => left - right));
      });

      it.skipIf(options.expectAbsoluteBounds !== true)('publishes viewport-absolute bounds', () => {
        const snapshots = snapshotsOf(probe.observe());
        const latest = snapshots[snapshots.length - 1];
        expect(latest).toBeDefined();
        const bounded = latest?.nodes.filter((node) => node.bounds !== undefined) ?? [];
        expect(bounded.length).toBeGreaterThan(0);
        for (const node of bounded) {
          const bounds = node.bounds as { row: number; column: number; width: number; height: number };
          expect(bounds.row).toBeGreaterThanOrEqual(0);
          expect(bounds.column).toBeGreaterThanOrEqual(0);
          expect(bounds.row).toBeLessThan(latest?.rows ?? 0);
          expect(bounds.column).toBeLessThan(latest?.columns ?? 0);
        }
      });

      it('orders every revision as snapshot, then commit, then marker', async () => {
        await probe.write(options.interaction.input);
        await probe.waitForText(options.interaction.expect, timeout);
        await probe.waitFor((observation) => observation.markers.length >= 2, timeout);

        const observation = probe.observe();
        const markers = observation.markers;
        expect(markers.length).toBeGreaterThan(0);
        expect(markers.map((marker) => marker.revision)).toEqual(
          [...markers.map((marker) => marker.revision)].sort((left, right) => left - right),
        );

        for (const marker of markers) {
          const snapshot = observation.messages.find(
            (entry) =>
              entry.message.type === 'snapshot' &&
              (entry.message as { snapshot: SemanticSnapshot }).snapshot.revision === marker.revision,
          );
          const commit = observation.messages.find(
            (entry) => entry.message.type === 'revision-commit' && entry.message.revision === marker.revision,
          );
          expect(snapshot, `no snapshot for revision ${marker.revision}`).toBeDefined();
          expect(commit, `no commit for revision ${marker.revision}`).toBeDefined();

          const snapshotIndex = observation.messages.indexOf(snapshot!);
          expect(snapshotIndex).toBeLessThan(observation.messages.indexOf(commit!));
        }

        // Each marker commits a frame, so there must be output between one
        // marker and the next, and the first one cannot open the stream.
        //
        // The socket and the terminal are two independent streams, and the
        // event loop may deliver a later chunk of one before an earlier message
        // of the other. Comparing a marker's byte offset against the stdout
        // position recorded when its frame arrived therefore measures delivery
        // scheduling, not adapter ordering, and is deliberately not asserted.
        let previousEnd = 0;
        for (const marker of markers) {
          expect(marker.offset).toBeGreaterThan(previousEnd);
          previousEnd = marker.offset;
        }
      });

      it('keeps the application alive when the channel is cut', async () => {
        const before = probe.observe();
        probe.cutChannel();

        await probe.write(options.interaction.input);
        // The observed text is cumulative, so `waitForText` would match output
        // the application produced before the cut. Growth is what proves it is
        // still rendering.
        await probe.waitFor((observation) => observation.text.length > before.text.length, timeout);
        const after = probe.observe();

        // The application keeps rendering; the adapter goes quiet and does not
        // reconnect behind the driver's back.
        expect(after.text.length).toBeGreaterThan(before.text.length);
        expect(after.connections).toBe(1);
        expect(probe.exitStatus).toBeNull();

        await probe.write(options.quit.input);
        const status = await probe.waitForExit(timeout);
        if (options.quit.exitCode !== undefined) expect(status.code).toBe(options.quit.exitCode);
      });
    });
  });
}
