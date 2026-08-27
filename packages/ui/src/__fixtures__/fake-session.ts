/**
 * In-memory stand-ins for a live session, used by this package's tests. Never
 * exported from `src/index.ts`; nothing here ships.
 */

import type {
  DiagnosticCode,
  SessionEventMap,
  SessionEventRecord,
  SessionEvents,
  TerminalHarness,
} from '@termwright/driver';
import {
  SESSION_CAPABILITIES,
  evidence,
  type ActionReceipt,
  type ActionabilityExplanation,
  type EffectiveSessionContract,
  type SemanticNode,
  type SemanticSnapshot,
} from '@termwright/protocol';
import type { UiSessionSource } from '../live.js';

type Listener = (payload: never) => void;

export function frameworkContract(
  sessionId: string,
  name: string,
  version: string,
  profile = 'default',
  supported: readonly (typeof SESSION_CAPABILITIES)[number][] = ['semantic-tree'],
): EffectiveSessionContract {
  const enabled = new Set(supported);
  return Object.freeze({
    contractId: `${sessionId}:contract`,
    sessionId,
    epoch: 1,
    protocol: 'termwright/2',
    framework: {
      name,
      version,
      adapterVersion: version,
      certificationId: `test:${name}@${version}`,
    },
    providers: [{ id: name, kind: 'framework', version }],
    capabilities: Object.fromEntries(
      SESSION_CAPABILITIES.map((capability) => [
        capability,
        enabled.has(capability)
          ? {
              status: 'supported',
              evidence: evidence('framework', 'instrumented', 'authoritative', name),
            }
          : { status: 'unsupported', reason: 'framework-unobservable' },
      ]),
    ) as EffectiveSessionContract['capabilities'],
    terminal: { profile, platform: process.platform, mouseModesObservable: true },
  } satisfies EffectiveSessionContract);
}

/** A session whose event stream the test drives by hand. */
export class FakeSession implements UiSessionSource {
  readonly sessionId: string;
  readonly #listeners = new Map<keyof SessionEventMap, Set<Listener>>();
  readonly #journalListeners = new Set<(record: SessionEventRecord) => void>();
  readonly #journal: SessionEventRecord[] = [];
  #sequence = 0;
  #actionCounter = 0;
  #tree: SemanticSnapshot | null = null;
  clock = 0;
  actionabilityPlanner:
    | ((
        action: 'click' | 'hover' | 'focus' | 'type',
        ref: import('@termwright/protocol').SemanticLocatorRef,
      ) => Promise<ActionabilityExplanation>)
    | undefined;

  constructor(sessionId = 's1') {
    this.sessionId = sessionId;
  }

  readonly events: SessionEvents = {
    on: <E extends keyof SessionEventMap>(
      event: E,
      callback: (payload: SessionEventMap[E]) => void,
    ): (() => void) => {
      const set = this.#listeners.get(event) ?? new Set<Listener>();
      set.add(callback as Listener);
      this.#listeners.set(event, set);
      return () => {
        set.delete(callback as Listener);
      };
    },
    checkpoint: () => this.#sequence,
    subscribe: (options, callback) => {
      for (const record of this.#journal) {
        if (record.sequence >= options.fromSequence) callback(record);
      }
      this.#journalListeners.add(callback);
      return () => this.#journalListeners.delete(callback);
    },
  };

  /** Profile the fake reports; tests override it to check the wiring. */
  terminalProfile = 'default';
  negotiatedContract: EffectiveSessionContract | null = null;

  negotiateFramework(
    name: string,
    version: string,
    supported: readonly (typeof SESSION_CAPABILITIES)[number][] = ['semantic-tree'],
  ): void {
    this.negotiatedContract = frameworkContract(
      this.sessionId,
      name,
      version,
      this.terminalProfile,
      supported,
    );
  }

  contract(): EffectiveSessionContract | null {
    return this.negotiatedContract;
  }

  screen(): { columns: number; rows: number } {
    return { columns: 80, rows: 24 };
  }

  semanticTree(): SemanticSnapshot | null {
    return this.#tree;
  }

  locatorForRef(ref: string): {
    actionability(action: 'click' | 'hover' | 'focus' | 'type'): Promise<ActionabilityExplanation>;
  } {
    if (!/^semantic:[^@\s]+@\d+$/u.test(ref))
      throw new TypeError('fake live inspector requires a semantic locator ref');
    return {
      actionability: (action) => {
        if (this.actionabilityPlanner === undefined)
          return Promise.reject(new Error('fake planner is not configured'));
        return this.actionabilityPlanner(
          action,
          ref as import('@termwright/protocol').SemanticLocatorRef,
        );
      },
    };
  }

  output(text: string): void {
    this.#emit('output', { data: new TextEncoder().encode(text), timeMs: this.clock });
  }

  /** Publishes a tree and announces its revision. */
  semantic(snapshot: SemanticSnapshot): void {
    this.#tree = snapshot;
    this.#emit('semantic-revision', { revision: snapshot.revision, timeMs: this.clock, snapshot });
  }

  /** Emits a finished driver action. */
  action(event: {
    api: string;
    ok: boolean;
    selector?: string;
    ref?: import('@termwright/driver').LocatorRef;
    error?: string;
    receipt?: ActionReceipt;
    actionability?: ActionabilityExplanation;
  }): void {
    this.#emit('action', { actionId: `a${++this.#actionCounter}`, ...event, timeMs: this.clock });
  }

  /** Emits a correlated action lifecycle, returning the id used by both edges. */
  startAction(event: { api: string; selector?: string }): string {
    const actionId = `a${++this.#actionCounter}`;
    this.#emit('action-start', { actionId, ...event, timeMs: this.clock });
    return actionId;
  }

  finishAction(
    actionId: string,
    event: {
      api: string;
      ok: boolean;
      selector?: string;
      ref?: import('@termwright/driver').LocatorRef;
      error?: string;
      receipt?: ActionReceipt;
      actionability?: ActionabilityExplanation;
    },
  ): void {
    this.#emit('action', { actionId, ...event, timeMs: this.clock });
  }

  /** Emits a followed-file log line. */
  logLine(line: string, label = 'server.log'): void {
    this.#emit('app-log', { source: 'file', label, line, timeMs: this.clock });
  }

  /** Emits a structured record from an instrumented adapter. */
  logRecord(record: {
    level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
    message: string;
    logger?: string;
    seq?: number;
    attrs?: Record<string, string | number | boolean | null>;
  }): void {
    this.#emit('app-log', {
      source: 'adapter',
      record: { ts: Date.now(), seq: record.seq ?? 1, ...record },
      timeMs: this.clock,
    });
  }

  /** Emits one adapter/session lifecycle diagnostic. */
  diagnostic(code: DiagnosticCode, detail = code): void {
    this.#emit('diagnostic', { code, detail, timeMs: this.clock });
  }

  #emit<E extends keyof SessionEventMap>(event: E, payload: SessionEventMap[E]): void {
    const record = { sequence: ++this.#sequence, type: event, payload } as SessionEventRecord;
    this.#journal.push(record);
    for (const listener of this.#journalListeners) listener(record);
    for (const listener of this.#listeners.get(event) ?? []) {
      (listener as (value: SessionEventMap[E]) => void)(payload);
    }
  }
}

/**
 * A `TerminalHarness` with only the parts the recorder touches implemented.
 * Everything else throws, so a test that starts depending on more than the
 * recorder's real surface fails loudly instead of silently passing.
 */
export class FakeHarness extends FakeSession {
  /** Every byte the recorder forwarded to the child. */
  readonly written: Uint8Array[] = [];
  closed = false;

  async write(bytes: Uint8Array | string): Promise<void> {
    this.written.push(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  }

  async close(): Promise<void> {
    this.closed = true;
  }

  /** Concatenation of everything written, as text. */
  writtenText(): string {
    return this.written.map((chunk) => new TextDecoder().decode(chunk)).join('');
  }

  /** The harness view the recorder and the server take. */
  asHarness(): TerminalHarness {
    return this as unknown as TerminalHarness;
  }
}

/** Builds a minimal valid snapshot. */
export function snapshot(
  revision: number,
  nodes: readonly SemanticNode[],
  sessionId = 's1',
): SemanticSnapshot {
  return {
    v: 2,
    sessionId,
    revision,
    columns: 80,
    rows: 24,
    rootIds: nodes.filter((item) => item.parentId === undefined).map((item) => item.id),
    nodes,
    coordinateSpace: { status: 'unknown', reason: 'awaiting-revision-pair' },
    hitGrid: {
      status: 'unsupported',
      capability: 'pointer-hit-grid',
      reason: 'framework-unobservable',
    },
  };
}

/** Builds a semantic node with sane defaults. */
export function node(
  partial: Omit<Partial<SemanticNode>, 'value'> &
    Pick<SemanticNode, 'id' | 'role'> & { readonly value?: SemanticNode['value'] | string },
): SemanticNode {
  const { value: rawValue, ...rest } = partial;
  const value =
    typeof rawValue === 'string'
      ? {
          status: 'known' as const,
          value: rawValue,
          sensitivity: 'public' as const,
          evidence: {
            source: 'driver' as const,
            method: 'native' as const,
            strength: 'authoritative' as const,
            providerId: 'ui-fixture',
          },
        }
      : rawValue;
  return {
    name: '',
    geometry: {
      displayed: { status: 'unknown', reason: 'awaiting-revision-pair' },
      intendedRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
      visibleRect: { status: 'unknown', reason: 'awaiting-revision-pair' },
    },
    ...rest,
    ...(value === undefined ? {} : { value }),
  };
}
