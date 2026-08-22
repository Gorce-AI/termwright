/**
 * The explicit `TerminalHarness` forwarder both modes are built on.
 *
 * Every member of the driver's interface is named here and delegated to a real
 * session. That is deliberate, and it has now paid for itself three times: when
 * `locatorForRef`/`waitForShellPrompt`/`diagnostics` landed, when `crashReport` did,
 * and it would again for the next addition. A `Proxy` or an `Object.create`
 * over the session would be shorter and would keep compiling — and the second
 * one does not even work, because the driver's session keeps its state in
 * private fields, which are unreachable from an object that merely inherits
 * from it.
 *
 * Subclasses add what their mode can offer and override `close` when they own
 * something the session does not.
 */

import type {
  AppLogEvent,
  CellSnapshot,
  CrashReport,
  ExitStatus,
  LocatorRef,
  SemanticLocator,
  SemanticLocatorRef,
  ScreenLocator,
  ScreenLocatorRef,
  Keyboard,
  Mouse,
  OperationBudget,
  ResizeReceipt,
  RoleLocatorOptions,
  ScreenSnapshot,
  ScreenTextLocatorOptions,
  ShellApi,
  ScrollbackApi,
  SelectionApi,
  SessionDiagnostic,
  SessionEvents,
  TerminalHarness,
  TerminalState,
  TerminalWindow,
  TextLocatorOptions,
  WaitOptions,
} from '@termwright/driver';
import type { EffectiveSessionContract, ObservationStamp, SemanticRole, SemanticSnapshot } from '@termwright/protocol';

/** Forwards the whole of {@link TerminalHarness} to a session. */
export abstract class ForwardingHarness implements TerminalHarness {
  /** The session every member delegates to. */
  protected readonly session: TerminalHarness;

  constructor(session: TerminalHarness) {
    this.session = session;
  }

  get sessionId(): string {
    return this.session.sessionId;
  }

  get terminalProfile(): string {
    return this.session.terminalProfile;
  }

  get shell(): ShellApi {
    return this.session.shell;
  }

  get keyboard(): Keyboard {
    return this.session.keyboard;
  }

  get mouse(): Mouse {
    return this.session.mouse;
  }

  get window(): TerminalWindow {
    return this.session.window;
  }

  get terminalState(): TerminalState {
    return this.session.terminalState;
  }

  get scrollback(): ScrollbackApi {
    return this.session.scrollback;
  }

  get selection(): SelectionApi {
    return this.session.selection;
  }

  get events(): SessionEvents {
    return this.session.events;
  }

  get exit(): Promise<ExitStatus> {
    return this.session.exit;
  }

  contract(): EffectiveSessionContract | null {
    return this.session.contract();
  }

  checkpoint(): ObservationStamp {
    return this.session.checkpoint();
  }

  waitForCheckpointChange(options: { readonly after: ObservationStamp } & WaitOptions): Promise<ObservationStamp> {
    return this.session.waitForCheckpointChange(options);
  }

  waitForCommittedObservation(options?: WaitOptions): Promise<ObservationStamp> {
    return this.session.waitForCommittedObservation(options);
  }

  bindOperationBudget(budget: OperationBudget): void {
    if (this.session.bindOperationBudget === undefined) {
      throw new TypeError('the forwarded Termwright session is not budget-aware');
    }
    this.session.bindOperationBudget(budget);
  }

  screen(): ScreenSnapshot {
    return this.session.screen();
  }

  semanticTree(): SemanticSnapshot | null {
    return this.session.semanticTree();
  }

  cell(pos: { row: number; column: number }): CellSnapshot {
    return this.session.cell(pos);
  }

  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): SemanticLocator {
    return this.session.getByRole(role, opts);
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): SemanticLocator {
    return this.session.getByLabel(text, opts);
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): SemanticLocator {
    return this.session.getByText(text, opts);
  }

  getByScreenText(text: string | RegExp, opts?: ScreenTextLocatorOptions): ScreenLocator {
    return this.session.getByScreenText(text, opts);
  }

  getByTestId(testId: string): SemanticLocator {
    return this.session.getByTestId(testId);
  }

  locator(selector: string): SemanticLocator {
    return this.session.locator(selector);
  }

  locatorForRef(ref: SemanticLocatorRef): SemanticLocator;
  locatorForRef(ref: ScreenLocatorRef): ScreenLocator;
  locatorForRef(ref: LocatorRef): SemanticLocator | ScreenLocator;
  locatorForRef(ref: LocatorRef): SemanticLocator | ScreenLocator {
    return this.session.locatorForRef(ref);
  }

  press(keys: string): Promise<void> {
    return this.session.press(keys);
  }

  type(text: string): Promise<void> {
    return this.session.type(text);
  }

  paste(text: string): Promise<void> {
    return this.session.paste(text);
  }

  write(bytes: Uint8Array | string): Promise<void> {
    return this.session.write(bytes);
  }

  resize(size: { columns: number; rows: number }): Promise<ResizeReceipt> {
    return this.session.resize(size);
  }

  signal(sig: 'INT' | 'TERM' | 'KILL' | 'HUP'): Promise<void> {
    return this.session.signal(sig);
  }

  waitForText(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    return this.session.waitForText(text, opts);
  }

  waitForRender(opts: { after: number } & WaitOptions): Promise<void> {
    return this.session.waitForRender(opts);
  }

  waitForQuiet(opts?: { quietMs?: number } & WaitOptions): Promise<void> {
    return this.session.waitForQuiet(opts);
  }

  settled(opts?: WaitOptions): Promise<EffectiveSessionContract> {
    return this.session.settled(opts);
  }

  waitForShellPrompt(opts?: WaitOptions): Promise<void> {
    return this.session.waitForShellPrompt(opts);
  }

  waitForExit(opts?: WaitOptions): Promise<ExitStatus> {
    return this.session.waitForExit(opts);
  }

  diagnostics(): readonly SessionDiagnostic[] {
    return this.session.diagnostics();
  }

  appLogs(): readonly AppLogEvent[] {
    return this.session.appLogs();
  }

  crashReport(): CrashReport | null {
    return this.session.crashReport();
  }

  title(): string {
    return this.session.title();
  }

  waitForTitle(text: string | RegExp, opts?: WaitOptions): Promise<void> {
    return this.session.waitForTitle(text, opts);
  }

  async close(): Promise<void> {
    await this.session.close();
  }
}
