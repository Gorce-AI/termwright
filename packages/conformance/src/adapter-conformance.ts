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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ADAPTER_CAPABILITIES, validateSnapshot, DEFAULT_LIMITS } from '@termwright/protocol';
import type { SemanticSnapshot } from '@termwright/protocol';
import { AdapterProbe, MARKER_TEXT_PREFIX, type AdapterCommand, type ProbeObservation } from './support/probe.js';
import { commandAvailable, ptyAvailable } from './support/pty.js';

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
  /**
   * An input that changes the screen, and the text that proves it landed.
   *
   * The suite sends it **more than once** — a dormant run, a run that has to
   * produce a second revision, and a run after the channel was cut all need a
   * render. Pick something whose repetition is harmless.
   */
  readonly interaction: { readonly input: string; readonly expect: string | RegExp };
  /**
   * An input that makes the application exit, and the status it exits with.
   *
   * It must work from **any** state repeated `interaction` can reach. A key
   * that quits only while a particular widget has focus is not a quit input:
   * the tview example's documented `q` types into its text field once focus has
   * cycled that far, so its registration uses Ctrl+C instead.
   */
  readonly quit: { readonly input: string; readonly exitCode?: number };
  readonly columns?: number;
  readonly rows?: number;
  /** Assert that published bounds are viewport-absolute (an `absolute-bounds` claim). */
  readonly expectAbsoluteBounds?: boolean;
  /**
   * Opt out of the "publishes a tree before any input" obligation.
   *
   * By default an adapter must publish a non-empty tree once the handshake
   * completes, with no input sent — an app that is addressable only after the
   * first keystroke is not addressable at all to a driver that has just
   * launched it. Some apps legitimately render nothing until an event arrives;
   * pass a reason, which is printed in the test title so the exemption stays
   * visible rather than becoming folklore.
   */
  readonly treeBeforeInput?: { readonly required: false; readonly reason: string };
  /**
   * How to make the application log, for an adapter that announces the `logs`
   * capability. Without it the log obligations are skipped; with it they are
   * asserted, and an adapter that announces `logs` but never delivers one
   * fails here rather than in a user's test.
   */
  /**
   * How to check the normative adapter conventions (protocol README, "Adapter
   * semantics conventions"). Rules 1, 2 and 4 are largely judgement calls from
   * outside; what is listed here is what a subprocess can actually observe.
   *
   * A rule an adapter cannot follow is a *declared deviation*, not a failure:
   * name it in `deviations` and the matching check is skipped with the reason
   * in the test title, so the exemption stays visible instead of becoming
   * folklore.
   */
  readonly conventions?: {
    /** A test id the fixture sets by author annotation (rule 3). */
    readonly annotatedTestId?: string;
    /** A textbox whose field is empty, to prove `value: ''` (rule 5). */
    readonly emptyTextboxTestId?: string;
    /** A container with no name of its own, wrapping text (rule 2). */
    readonly unnamedContainerTestId?: string;
    /**
     * Test ids whose `value` is author-annotated. The role gate in rule 5
     * bounds *derived* values; an annotation may put one on any role, and only
     * the registration knows which is which.
     */
    readonly annotatedValues?: readonly string[];
    /**
     * The adapter's README. Its `## Deviations` section is the single source of
     * truth for what this adapter cannot do (rule 6), so a declared limitation
     * is read from there rather than repeated in the registration — two copies
     * of the same fact disagree eventually, and the README is the one a user
     * reads.
     */
    readonly readmePath?: string;
  };
  readonly logs?: {
    /**
     * Input that makes the application write a record. Omit it for an app that
     * logs on its own (at startup, say) — the obligation then waits for a
     * record rather than provoking one.
     */
    readonly input?: string;
    /** A substring of the logged message, used to prove it stayed off-screen. */
    readonly expect: string;
  };
  /** How long the handshake may take. Default 10 s. */
  readonly timeoutMs?: number;
  /**
   * A command that must succeed before this adapter can be certified here —
   * its interpreter, or a build step that produces the binary `spawn` runs.
   * When it fails the whole suite skips and the reason is in the block's name,
   * exactly as a missing pseudo-terminal does.
   */
  readonly requires?: {
    readonly probe: readonly string[];
    readonly label: string;
    readonly cwd?: string;
    readonly timeoutMs?: number;
  };
}

/**
 * Asserts that what the adapter's deltas say the tree is matches what the
 * adapter itself reports when asked. A producer that also composed would only
 * prove it agrees with itself, so the composition here is the protocol's own
 * `applyTreeDelta` and the comparison is against a `get-tree` answer.
 */
async function assertDeltasCompose(probe: AdapterProbe, timeoutMs: number): Promise<void> {
  const { expect } = await import('vitest');
  const observation = probe.observe();

  expect(observation.compositionError, 'the adapter produced a delta nobody could apply').toBeNull();
  expect(observation.composed).not.toBeNull();
  expect(observation.deltas.length).toBeGreaterThan(0);

  const authoritative = await probe.requestTree(timeoutMs);
  expect(authoritative, 'the adapter answered no get-tree').not.toBeNull();

  const composed = observation.composed as SemanticSnapshot;
  const truth = authoritative as SemanticSnapshot;
  const byId = (nodes: SemanticSnapshot['nodes']): SemanticSnapshot['nodes'] =>
    [...nodes].sort((left, right) => left.id.localeCompare(right.id));

  expect(byId(truth.nodes)).toEqual(byId(composed.nodes));
  expect([...truth.rootIds].sort()).toEqual([...composed.rootIds].sort());
}

/**
 * Directory the convention summaries are written to, and read back by
 * `scripts/conformance.mjs` when it prints the matrix.
 */
export const CONVENTION_SUMMARY_DIR = join(tmpdir(), 'termwright-conformance-conventions');

/**
 * Records what each rule concluded, so the matrix can print a per-adapter
 * roll-up of declared deviations.
 *
 * This exists because a hand-maintained table of per-adapter gaps went stale
 * within one round of being written — a generated one cannot. Nothing here is
 * a gate: the file is a report, and the tests already decided pass or fail.
 */
function writeConventionSummary(
  name: string,
  declared: Map<string, string[]>,
  outcomes: readonly ConventionOutcome[],
): void {
  try {
    mkdirSync(CONVENTION_SUMMARY_DIR, { recursive: true });
    const file = join(CONVENTION_SUMMARY_DIR, `${name.replace(/[^\w.-]+/gu, '_')}.json`);
    writeFileSync(
      file,
      JSON.stringify(
        {
          adapter: name,
          declared: Object.fromEntries(declared),
          outcomes,
          // A rule declared in the README that no check covers: the suite
          // cannot confirm or refute it, and saying so is more honest than
          // letting it read as verified.
          unverified: [...declared.keys()].filter(
            (rule) => !outcomes.some((outcome) => outcome.rule === rule),
          ),
        },
        null,
        2,
      ),
      'utf8',
    );
  } catch {
    // A report that cannot be written must not fail a conformance run.
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    timer.unref?.();
  });
}

/**
 * Waits until the child stops writing, so two captures end at comparable
 * points. A stabilisation, not a deadline: an app that never stops writing
 * makes the comparison fail loudly rather than pass by accident.
 */
async function settle(probe: AdapterProbe, quietMs = 250, budgetMs = 5_000): Promise<void> {
  const deadline = Date.now() + budgetMs;
  let seen = -1;
  for (;;) {
    const length = probe.observe().stdout.length;
    if (length === seen) return;
    seen = length;
    if (Date.now() >= deadline) return;
    await new Promise((resolve) => {
      setTimeout(resolve, quietMs);
    });
  }
}

/**
 * Rule numbers declared in an adapter's `## Deviations` section.
 *
 * Three shapes are in use and all are accepted, because the suite should not
 * dictate anyone's prose: `**Rule 2 — …**` (a heading per entry, Ink),
 * `- **…** (rule 3).` (the number at the end of a bullet, the language
 * clients), and a markdown table whose first column is `2 — …` (OpenTUI).
 *
 * Entries that name no rule are kept under `other`: they are still declared
 * limitations, and dropping them would make the roll-up quietly incomplete.
 */
export function parseDeclaredDeviations(readme: string): Map<string, string[]> {
  const declared = new Map<string, string[]>();
  const start = readme.indexOf('## Deviations');
  if (start < 0) return declared;
  const rest = readme.slice(start + '## Deviations'.length);
  const end = rest.indexOf('\n## ');
  const section = end < 0 ? rest : rest.slice(0, end);

  for (const line of section.split('\n')) {
    for (const match of line.matchAll(/\*\*Rule (\d+)\s*—\s*([^*]+?)\.?\*\*/gu)) {
      add(declared, match[1] as string, (match[2] as string).trim());
    }
    for (const match of line.matchAll(/\*\*(.+?)\*\*\s*\(rule (\d+)\)/gu)) {
      add(declared, match[2] as string, (match[1] as string).trim());
    }
    const trimmed = line.trim();
    if (trimmed.startsWith('|') && !/^\|[\s:|-]*\|?$/u.test(trimmed) && !/^\|\s*rule\s*\|/iu.test(trimmed)) {
      // A table row. The rule number and its title share the first cell
      // (`2 — name sources`); a row that names no rule carries its text in the
      // second cell instead.
      const cells = trimmed.split('|').slice(1, -1).map((cell) => cell.trim());
      const numbered = /^(\d+)\s*[—-]\s*(.+)$/u.exec(cells[0] ?? '');
      if (numbered !== null) {
        add(declared, numbered[1] as string, (numbered[2] as string).trim());
      } else if ((cells[1] ?? '').length > 0) {
        add(declared, 'other', cells[1] as string);
      }
    }
  }
  return declared;
}

function add(map: Map<string, string[]>, key: string, value: string): void {
  map.set(key, [...(map.get(key) ?? []), value]);
}

/** What a convention check concluded, for the run summary. */
interface ConventionOutcome {
  readonly rule: string;
  readonly what: string;
  readonly status: 'compliant' | 'documented' | 'checked-despite-declaration' | 'violation';
  readonly detail?: string;
}

/** Roles that are containers: never named from what they contain (rule 2). */
const CONTAINER_ROLES: ReadonlySet<string> = new Set([
  'region',
  'dialog',
  'list',
  'table',
  'application',
  'menu',
]);

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
 *   name: 'my-framework-probe',
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
  const toolchain =
    options.requires === undefined ||
    commandAvailable(options.requires.probe, {
      ...(options.requires.cwd === undefined ? {} : { cwd: options.requires.cwd }),
      ...(options.requires.timeoutMs === undefined ? {} : { timeoutMs: options.requires.timeoutMs }),
    });
  const probeOptions = {
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
  };

  const title = !ptyAvailable()
    ? `adapter conformance: ${options.name} (skipped: no pseudo-terminal here)`
    : toolchain
      ? `adapter conformance: ${options.name}`
      : `adapter conformance: ${options.name} (skipped: ${options.requires?.label ?? 'toolchain'} unavailable)`;

  describe.skipIf(!ptyAvailable() || !toolchain)(title, { timeout: timeout * 4 }, () => {
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
          // Nothing is written to the child during this comparison. A
          // pseudo-terminal echoes the suite's own keystrokes, and whether an
          // echoed byte lands between two frames depends on when the app took
          // raw mode — so a stream containing our input compares the tty's
          // timing, not the adapter's output. Measured on the Ink fixture: 3
          // mismatches in 30 pairs with input (always a stray 0x09, the tab the
          // suite itself sent), 0 in 40 pairs without.
          const startup = async (
            command: AdapterCommand,
          ): Promise<{ readonly stdout: Uint8Array; readonly screen: string }> => {
            const probe = await AdapterProbe.start(command, { ...probeOptions, instrument: false });
            try {
              await probe.waitForText(options.ready, timeout);
              await settle(probe);
              const observation = probe.observe();
              return { stdout: observation.stdout, screen: observation.screen };
            } finally {
              await probe.stop();
            }
          };

          const instrumented = await startup(options.spawn());
          const plain = await startup((options.baseline as () => AdapterCommand)());
          if (process.platform === 'win32') {
            // ConPTY itself emits process-lifecycle control sequences. Their
            // chunking/order can differ between two identical child binaries,
            // so the raw host stream is not an application-byte oracle on
            // Windows. Feed both streams through the same terminal emulator
            // and require the complete visible grids to be identical. The
            // adjacent dormant test separately proves zero connections,
            // messages and Termwright markers.
            expect(instrumented.screen).toBe(plain.screen);
          } else {
            // POSIX PTYs expose the child stream directly: one extra escape
            // sequence from instrumentation is a real dormant-rule failure.
            expect(Buffer.from(instrumented.stdout).toString('binary')).toBe(
              Buffer.from(plain.stdout).toString('binary'),
            );
          }
        },
      );
    });

    describe('an instrumented session', () => {
      let probe: AdapterProbe;
      /** Everything observed before a single byte was written to the child. */
      let beforeInput: ProbeObservation;

      beforeAll(
        async () => {
          probe = await AdapterProbe.start(options.spawn(), probeOptions);
          await probe.waitForText(options.ready, timeout);
          await probe.waitFor(
            (observation) => snapshotsOf(observation).length > 0,
            timeout,
            'a first snapshot from the adapter',
          );
          beforeInput = probe.observe();
        },
        // Starting the process, waiting for its first frame, and completing the
        // adapter handshake are separate bounded operations. Vitest otherwise
        // applies its 10-second hook default even though the suite has a larger
        // timeout, which makes real adapters flaky under a parallel root run.
        timeout * 4,
      );

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

        // Nothing may precede the handshake, log records least of all: their
        // budget is granted *in* the reply to this message.
        const firstLog = messages.findIndex((entry) => entry.message.type === 'log');
        expect(firstLog === -1 || firstLog > 0).toBe(true);
      });

      it(
        options.treeBeforeInput === undefined
          ? 'publishes a usable tree before any input'
          : `publishes a usable tree before any input (exempt: ${options.treeBeforeInput.reason})`,
        { skip: options.treeBeforeInput !== undefined },
        () => {
          const latest = snapshotsOf(beforeInput).at(-1);

          // A driver launches an app and addresses it. An adapter that only
          // publishes once a key has been pressed is not addressable at that
          // moment, and a suite that sends input before looking would never
          // notice — which is exactly how this class of bug reached a shipped
          // adapter.
          expect(latest, 'no snapshot arrived before any input was sent').toBeDefined();
          expect(latest?.nodes.length ?? 0).toBeGreaterThan(0);
          expect(latest?.rootIds.length ?? 0).toBeGreaterThan(0);

          // A tree of one anonymous root is empty in every sense that matters:
          // nothing in it can be located by role and name.
          const addressable = (latest?.nodes ?? []).filter(
            (node) => node.name.length > 0 || node.testId !== undefined,
          );
          expect(addressable.length, 'the tree has no node that a locator could address').toBeGreaterThan(0);
        },
      );

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
        await probe.waitFor(
          (observation) => observation.markers.length >= 2,
          timeout,
          'a second render marker',
        );

        // The socket and the terminal are independent streams, so a marker can
        // be read before the frame describing the same revision has been
        // parsed. The contract is that each revision *eventually* has all
        // three parts; waiting for that is not leniency, it is the difference
        // between asserting the contract and asserting arrival order.
        const complete = (observation: ProbeObservation): boolean =>
          observation.markers.every(
            (marker) =>
              observation.messages.some(
                (entry) =>
                  entry.message.type === 'snapshot' &&
                  (entry.message as { snapshot: SemanticSnapshot }).snapshot.revision === marker.revision,
              ) &&
              observation.messages.some(
                (entry) => entry.message.type === 'revision-commit' && entry.message.revision === marker.revision,
              ),
          );
        await probe.waitFor(complete, timeout, 'every marker paired with a snapshot and a commit');

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

      const conventions = options.conventions ?? {};
      const readme =
        conventions.readmePath !== undefined && existsSync(conventions.readmePath)
          ? readFileSync(conventions.readmePath, 'utf8')
          : '';
      const declared = parseDeclaredDeviations(readme);
      const outcomes: ConventionOutcome[] = [];

      it('reads the deviations its README declares', () => {
        if (conventions.readmePath === undefined) return;
        if (!readme.includes('## Deviations')) return;

        // A section the parser cannot read is worse than a missing one: the
        // three-state logic silently collapses to two, and every documented
        // limitation starts reporting as an error against the adapter that
        // took the trouble to declare it.
        //
        // Detectable without understanding any shape: a section that *has
        // structure* — bullets, table rows, bold lead-ins — but yields no
        // entries is a parser gap. A section that is plain prose saying there
        // is nothing to declare is not, and must not be failed for it.
        const start = readme.indexOf('## Deviations');
        const rest = readme.slice(start + '## Deviations'.length);
        const end = rest.indexOf('\n## ');
        const section = end < 0 ? rest : rest.slice(0, end);
        const structured = /^\s*[-*|]/mu.test(section) || section.includes('**');
        if (!structured) return;

        expect(
          declared.size,
          `${options.name} has a "## Deviations" section with entries this suite could not ` +
            'read; its declarations would be invisible and its documented limitations would ' +
            'report as errors. Teach `parseDeclaredDeviations` the shape it uses.',
        ).toBeGreaterThan(0);
      });

      /**
       * Runs one rule and decides what its result means.
       *
       * Three states, not two. A rule an adapter cannot follow and *says* it
       * cannot follow is a documented limitation, not a failure — failing it
       * would give the first author who honestly describes their framework a
       * red run for doing exactly what rule 6 asks, which is the shortest path
       * to people hiding deviations instead of declaring them.
       *
       * A check that passes while a declaration exists is deliberately *not*
       * called stale. One rule has more aspects than a subprocess can observe:
       * Ink declares a rule 3 limitation about native identifiers while
       * satisfying the annotation half of the same rule, and both are true.
       * The summary records the coincidence so a reader can re-read the
       * README; calling it a defect would be a false signal, and a suite that
       * cries wolf gets ignored.
       */
      const convention = (rule: string, what: string, check: () => string | null): void => {
        const failure = check();
        const titles = declared.get(rule) ?? [];
        if (failure === null) {
          outcomes.push(
            titles.length === 0
              ? { rule, what, status: 'compliant' }
              : { rule, what, status: 'checked-despite-declaration', detail: titles.join('; ') },
          );
          return;
        }
        if (titles.length > 0) {
          outcomes.push({ rule, what, status: 'documented', detail: `${titles.join('; ')} — ${failure}` });
          return;
        }
        outcomes.push({ rule, what, status: 'violation', detail: failure });
        expect.fail(`convention ${rule} (${what}): ${failure}`);
      };

      afterAll(() => {
        writeConventionSummary(options.name, declared, outcomes);
      });

      it('convention 3: an author-annotated test id reaches the wire', () => {
        if (conventions.annotatedTestId === undefined) return;
        const wanted = conventions.annotatedTestId;
        convention('3', 'an annotated test id reaches the wire', () => {
          const latest = snapshotsOf(beforeInput).at(-1);
          const node = latest?.nodes.find((entry) => entry.testId === wanted);
          return node === undefined ? `no node carries the test id ${JSON.stringify(wanted)}` : null;
        });
      });

      it('convention 5: an empty textbox publishes an empty value', () => {
        if (conventions.emptyTextboxTestId === undefined) return;
        const wanted = conventions.emptyTextboxTestId;
        convention('5', 'an empty textbox publishes an empty value', () => {
          const latest = snapshotsOf(beforeInput).at(-1);
          const node = latest?.nodes.find((entry) => entry.testId === wanted);
          if (node === undefined) return `no node carries the test id ${JSON.stringify(wanted)}`;
          // `''` means the field is empty; absent means "not a value-bearing
          // widget". A wire format that drops empty strings turns the first
          // into the second and makes `toHaveValue('')` unassertable.
          return node.value === '' ? null : `the value is ${JSON.stringify(node.value)}, not an empty string`;
        });
      });

      it('convention 5: value is derived only for value-bearing roles', () => {
        convention('5', 'value is derived only for value-bearing roles', () => {
          const annotated = new Set(conventions.annotatedValues ?? []);
          const nodes = snapshotsOf(beforeInput).at(-1)?.nodes ?? [];
          const offenders = nodes.filter(
            (node) =>
              node.value !== undefined &&
              node.role !== 'textbox' &&
              node.role !== 'progressbar' &&
              !(node.testId !== undefined && annotated.has(node.testId)),
          );
          if (offenders.length > 0) {
            return `derived a value outside {textbox, progressbar}: ${offenders
              .map((node) => `${node.role} ${JSON.stringify(node.name)}`)
              .join(', ')}`;
          }
          // A boolean is a state, not contents: publishing `value: "true"`
          // makes a checkbox look like a textbox containing that word.
          const booleans = nodes.filter((node) => node.value === 'true' || node.value === 'false');
          return booleans.length === 0
            ? null
            : `published a boolean as a value on ${booleans.map((node) => node.role).join(', ')}`;
        });
      });

      it('convention 2: no container is named from the text it contains', () => {
        convention('2', 'no container is named from the text it contains', () => {
          const nodes = snapshotsOf(beforeInput).at(-1)?.nodes ?? [];
          const children = new Map<string, string[]>();
          for (const node of nodes) {
            if (node.parentId === undefined) continue;
            children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
          }
          const descendantText = (id: string): string[] => {
            const out: string[] = [];
            const pending = [...(children.get(id) ?? [])];
            while (pending.length > 0) {
              const next = nodes.find((node) => node.id === pending.pop());
              if (next === undefined) continue;
              if (next.name.length > 0) out.push(next.name);
              pending.push(...(children.get(next.id) ?? []));
            }
            return out;
          };

          // Naming containers from content is what makes
          // getByRole('region', {name: 'Approve'}) match the dialog *around*
          // the button, so every ancestor of a label becomes a plausible match
          // for it. Both failure shapes are visible from the tree alone.
          const offenders = nodes
            .filter((node) => CONTAINER_ROLES.has(node.role) && node.name.length > 0)
            .filter((node) => {
              const texts = descendantText(node.id);
              const joined = texts.join(' ').replace(/\s+/gu, ' ').trim();
              return texts.includes(node.name) || (joined.length > 0 && joined === node.name);
            });
          return offenders.length === 0
            ? null
            : `named from content: ${offenders.map((node) => `${node.role} ${JSON.stringify(node.name)}`).join(', ')}`;
        });
      });

      it('convention 2: a container with no label of its own has an empty name', () => {
        if (conventions.unnamedContainerTestId === undefined) return;
        const wanted = conventions.unnamedContainerTestId;
        convention('2', 'an unlabelled container has an empty name', () => {
          const node = snapshotsOf(beforeInput)
            .at(-1)
            ?.nodes.find((entry) => entry.testId === wanted);
          if (node === undefined) return `no node carries the test id ${JSON.stringify(wanted)}`;
          return node.name === '' ? null : `the container is named ${JSON.stringify(node.name)}`;
        });
      });

      it.skipIf(conventions.readmePath === undefined)(
        'declares its deviations in its README (advisory)',
        () => {
          // Rules 1, 2 and 4 cannot be judged from outside a subprocess, so the
          // README is the only evidence that a difference was considered rather
          // than overlooked. Advisory on purpose: a missing heading is a
          // documentation gap, not a broken adapter, and failing here would
          // make a conformance run red for something no user can observe.
          const path = conventions.readmePath as string;
          const text = existsSync(path) ? readFileSync(path, 'utf8') : '';
          if (!text.includes('## Deviations')) {
            // Rule 6 follows the adapter, not the package: something that
            // publishes no tree has nothing to declare. Anything reaching this
            // suite does publish one, so the heading is expected here.
            process.stderr.write(
              `conformance: ${options.name} has no "## Deviations" section in ${path}; ` +
                'rules 1, 2 and 4 are unverifiable from outside, so an undeclared difference is invisible\n',
            );
          }
          expect(true).toBe(true);
        },
      );

      it('sends log records only if it negotiated the channel', async () => {
        const hello = beforeInput.messages[0]?.message as { capabilities: readonly string[] };
        if (hello.capabilities.includes('logs')) return;

        // An adapter is free not to support logs. What it is not free to do is
        // send records anyway: the budget granted in the handshake is what
        // bounds them, and one that was never granted cannot bound anything.
        // The driver closes the channel over this, so an adapter that does it
        // is broken in production rather than merely untidy.
        await probe.write(options.interaction.input);
        await probe.waitForText(options.interaction.expect, timeout);
        expect(
          probe.observe().logs,
          'the adapter sent log records without announcing the logs capability',
        ).toEqual([]);
      });

      it.skipIf(options.logs === undefined)('carries a log record without printing it', async () => {
        const logs = options.logs as NonNullable<AdapterConformanceOptions['logs']>;
        const hello = probe.observe().messages[0]?.message as { capabilities: readonly string[] };
        expect(
          hello.capabilities.includes('logs'),
          'the registration declares logs, but the adapter never announced the capability',
        ).toBe(true);

        const before = probe.observe().logs.length;
        if (logs.input !== undefined) await probe.write(logs.input);
        // An app that logs on its own may already have; one that logs on demand
        // has just been asked to. Either way the wait is for a record.
        await probe.waitFor(
          (observation) => observation.logs.length > (logs.input === undefined ? 0 : before),
          timeout,
          'a log record over the negotiated channel',
        );

        const observation = probe.observe();
        const record = observation.logs.find((entry) => entry.message.includes(logs.expect));
        expect(record, `no log record matched ${JSON.stringify(logs.expect)}`).toBeDefined();
        // `seq` is a non-negative counter, so the first record of a session is
        // legitimately 0; what matters is the relation between records.
        expect(record?.seq).toBeGreaterThanOrEqual(0);

        // Strictly increasing within a session: a consumer counting errors must
        // not be able to count one twice, and a gap must mean a real loss.
        const seqs = observation.logs.map((entry) => entry.seq);
        expect(seqs).toEqual([...seqs].sort((left, right) => left - right));
        expect(new Set(seqs).size).toBe(seqs.length);

        // The whole point of the capability: the record reaches the driver and
        // never the terminal. A TUI that printed it would corrupt its render.
        expect(observation.screen).not.toContain(logs.expect);
        expect(observation.text).not.toContain(logs.expect);
      });

      it('produces deltas that compose to the tree it would have sent', async () => {
        const announced = (beforeInput.messages[0]?.message as { capabilities: readonly string[] })
          .capabilities;
        if (!announced.includes('tree-diffs')) return;

        // Its own session: deltas are only sent to a driver that subscribed to
        // them, and the shared session deliberately subscribes to whole trees
        // so the other obligations exercise that path.
        const diffs = await AdapterProbe.start(options.spawn(), { ...probeOptions, subscribe: 'diffs' });
        try {
          await diffs.waitForText(options.ready, timeout);
          await diffs.waitFor((observation) => observation.composed !== null, timeout);

          // Drive a few renders so there is something to diff.
          for (let press = 0; press < 3; press += 1) {
            await diffs.write(options.interaction.input);
            await delay(150);
          }
          await diffs.waitFor((observation) => observation.deltas.length > 0, timeout);
          await assertDeltasCompose(diffs, timeout);
        } finally {
          await diffs.stop();
        }
      });

      it('keeps the application alive when the channel is cut', async () => {
        const before = probe.observe();
        probe.cutChannel();

        await probe.write(options.interaction.input);
        // The observed text is cumulative, so `waitForText` would match output
        // the application produced before the cut. Growth is what proves it is
        // still rendering.
        await probe.waitFor(
          (observation) => observation.text.length > before.text.length,
          timeout,
          'any further output from the child',
        );
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
