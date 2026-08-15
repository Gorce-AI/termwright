/**
 * Recorder: an interactive session in the browser, written down as a test.
 *
 * The server owns the PTY; the browser is a terminal and an inspector on top of
 * it. Keystrokes arrive as `input` messages, get forwarded to the child and, in
 * parallel, decoded into readable actions. Clicks arrive as node ids from the
 * inspector, where the semantic tree is still available to turn them into the
 * narrowest selector. Assertions are explicit — you press "assert here" when the
 * screen shows what you want to pin down.
 *
 * What makes this workable in a terminal, and awkward in a browser, is that we
 * own the entire input stream: there is no synthetic-versus-trusted-event
 * distinction to work around, and every byte the app sees came through here.
 *
 * @packageDocumentation
 */

import { writeFile } from 'node:fs/promises';
import { launchTerminal, type LaunchOptions, type TerminalHarness } from '@termwright/driver';
import type { SemanticSnapshot } from '@termwright/protocol';
import { generateTestSource, type CodegenOptions, type RecordedEvent } from './codegen.js';
import { coalesceInput, InputDecoder } from './input-decode.js';
import { generateSelector, type GeneratedSelector } from './selector.js';

/** Options for {@link startRecorder}. */
export interface RecorderOptions {
  readonly command: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
  readonly columns?: number;
  readonly rows?: number;
  /** Variable the session binds to in generated code. Default `app`. */
  readonly variable?: string;
  /** Title of the generated test. Default `recorded session`. */
  readonly testName?: string;
  /** Where {@link RecorderSession.save} writes by default. */
  readonly outFile?: string;
  /** Injectable launcher, so tests can record against a fake harness. */
  readonly launch?: (options: LaunchOptions) => Promise<TerminalHarness>;
}

/** A live recording. */
export interface RecorderSession {
  readonly sessionId: string;
  readonly harness: TerminalHarness;
  /** Everything recorded so far, in order. */
  readonly events: readonly RecordedEvent[];
  /** True while the inspector is picking and input is held back. */
  readonly picking: boolean;

  /** Forwards browser input to the child and records it, unless picking. */
  handleInput(bytes: Uint8Array): Promise<void>;
  /** Enters or leaves pick mode. */
  setPickMode(enabled: boolean): void;

  /** Records a click on a node, addressed by the narrowest selector. */
  recordClick(nodeId: string): GeneratedSelector | undefined;
  /** Records a visibility assertion on a node. */
  recordAssertVisible(nodeId: string): GeneratedSelector | undefined;
  /** Records `toMatchSemanticSnapshot()` at this point. */
  recordAssertSnapshot(): void;
  /** Records a text assertion against the whole screen. */
  recordAssertText(text: string): void;
  /** Records a `waitForText` before the next action. */
  recordWaitForText(text: string): void;
  /** Opens a `test.step()` grouping subsequent actions. */
  recordStep(title: string): void;

  /** The generated test source for what has been recorded. */
  source(options?: CodegenOptions): string;
  /** Writes {@link source} to `file` (or the configured `outFile`). */
  save(file?: string): Promise<string>;
  /** Closes the session. Does not signal the child. */
  close(): Promise<void>;
}

/**
 * Launches a session and starts recording it.
 *
 * @example
 * ```ts
 * const recorder = await startRecorder({ command: ['node', 'app.js'] });
 * await recorder.handleInput(new TextEncoder().encode('\r'));
 * recorder.recordAssertSnapshot();
 * await recorder.save('src/recorded.test.ts');
 * ```
 */
export async function startRecorder(options: RecorderOptions): Promise<RecorderSession> {
  const launch = options.launch ?? launchTerminal;
  const harness = await launch({
    command: options.command,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    ...(options.env === undefined ? {} : { env: options.env }),
    ...(options.columns === undefined ? {} : { columns: options.columns }),
    ...(options.rows === undefined ? {} : { rows: options.rows }),
  });
  return new Recorder(harness, options);
}

class Recorder implements RecorderSession {
  readonly harness: TerminalHarness;
  readonly #options: RecorderOptions;
  readonly #events: RecordedEvent[] = [];
  readonly #decoder = new InputDecoder();
  readonly #startedAt = Date.now();
  #picking = false;

  constructor(harness: TerminalHarness, options: RecorderOptions) {
    this.harness = harness;
    this.#options = options;
    this.#events.push({
      kind: 'launch',
      command: options.command,
      ...(options.columns === undefined ? {} : { columns: options.columns }),
      ...(options.rows === undefined ? {} : { rows: options.rows }),
      t: 0,
    });
  }

  get sessionId(): string {
    return this.harness.sessionId;
  }

  get events(): readonly RecordedEvent[] {
    return this.#events;
  }

  get picking(): boolean {
    return this.#picking;
  }

  setPickMode(enabled: boolean): void {
    this.#picking = enabled;
  }

  async handleInput(bytes: Uint8Array): Promise<void> {
    // Picking is a UI gesture, not an interaction with the app: neither the
    // child nor the recording should see it.
    if (this.#picking) return;
    await this.harness.write(bytes);
    const t = this.#now();
    for (const input of coalesceInput(this.#decoder.push(bytes))) {
      switch (input.kind) {
        case 'press':
          this.#push({ kind: 'press', keys: input.keys, t });
          break;
        case 'type':
          this.#pushTyped(input.text, t);
          break;
        case 'paste':
          this.#push({ kind: 'paste', text: input.text, t });
          break;
        case 'raw':
          this.#push({ kind: 'raw', dataB64: Buffer.from(input.bytes).toString('base64'), t });
          break;
      }
    }
  }

  recordClick(nodeId: string): GeneratedSelector | undefined {
    const selector = this.#selectorFor(nodeId);
    if (selector === undefined) return undefined;
    this.#push({ kind: 'click', selector, t: this.#now() });
    return selector;
  }

  recordAssertVisible(nodeId: string): GeneratedSelector | undefined {
    const selector = this.#selectorFor(nodeId);
    if (selector === undefined) return undefined;
    this.#push({ kind: 'assert-visible', selector, t: this.#now() });
    return selector;
  }

  recordAssertSnapshot(): void {
    this.#push({ kind: 'assert-snapshot', t: this.#now() });
  }

  recordAssertText(text: string): void {
    this.#push({ kind: 'assert-text', text, t: this.#now() });
  }

  recordWaitForText(text: string): void {
    this.#push({ kind: 'wait-text', text, t: this.#now() });
  }

  recordStep(title: string): void {
    this.#push({ kind: 'step', title, t: this.#now() });
  }

  source(options: CodegenOptions = {}): string {
    return generateTestSource(this.#events, {
      variable: this.#options.variable ?? 'app',
      ...(this.#options.testName === undefined ? {} : { testName: this.#options.testName }),
      ...options,
    });
  }

  async save(file?: string): Promise<string> {
    const target = file ?? this.#options.outFile;
    if (target === undefined) {
      throw new Error('no output file: pass one to save(), or set outFile on the recorder');
    }
    await writeFile(target, this.source(), 'utf8');
    return target;
  }

  async close(): Promise<void> {
    for (const input of this.#decoder.flush()) {
      if (input.kind === 'raw') {
        this.#push({ kind: 'raw', dataB64: Buffer.from(input.bytes).toString('base64'), t: this.#now() });
      }
    }
    await this.harness.close();
  }

  #selectorFor(nodeId: string): GeneratedSelector | undefined {
    const snapshot: SemanticSnapshot | null = this.harness.semanticTree();
    if (snapshot === null) return undefined;
    return generateSelector(snapshot, nodeId, { root: this.#options.variable ?? 'app' });
  }

  #now(): number {
    return Date.now() - this.#startedAt;
  }

  #push(event: RecordedEvent): void {
    this.#events.push(event);
  }

  /** Consecutive typing collapses into one `type()` call. */
  #pushTyped(text: string, t: number): void {
    const last = this.#events[this.#events.length - 1];
    if (last?.kind === 'type') {
      this.#events[this.#events.length - 1] = { kind: 'type', text: last.text + text, t: last.t };
      return;
    }
    this.#push({ kind: 'type', text, t });
  }
}
