/**
 * The explicit `TerminalHarness` forwarder both modes are built on.
 *
 * Every member of the driver's interface is named here and delegated to a real
 * session. That is deliberate, and it has now paid for itself three times: when
 * `locatorForRef`/`waitForReady`/`diagnostics` landed, when `crashReport` did,
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
  CellSnapshot,
  CrashReport,
  ExitStatus,
  Locator,
  RoleLocatorOptions,
  ScreenSnapshot,
  ScrollbackApi,
  SelectionApi,
  SessionCapabilities,
  SessionDiagnostic,
  SessionEvents,
  TerminalHarness,
  TextLocatorOptions,
  WaitOptions,
} from '@termwright/driver';
import type { SemanticRole, SemanticSnapshot } from '@termwright/protocol';

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

  capabilities(): SessionCapabilities {
    return this.session.capabilities();
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

  getByRole(role: SemanticRole, opts?: RoleLocatorOptions): Locator {
    return this.session.getByRole(role, opts);
  }

  getByLabel(text: string | RegExp, opts?: { exact?: boolean }): Locator {
    return this.session.getByLabel(text, opts);
  }

  getByText(text: string | RegExp, opts?: TextLocatorOptions): Locator {
    return this.session.getByText(text, opts);
  }

  getByTestId(testId: string): Locator {
    return this.session.getByTestId(testId);
  }

  locator(selector: string): Locator {
    return this.session.locator(selector);
  }

  locatorForRef(ref: string): Locator {
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

  resize(size: { columns: number; rows: number }): Promise<void> {
    return this.session.resize(size);
  }

  focus(): Promise<void> {
    return this.session.focus();
  }

  blur(): Promise<void> {
    return this.session.blur();
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

  waitForStable(opts?: { frames?: number } & WaitOptions): Promise<void> {
    return this.session.waitForStable(opts);
  }

  waitForIdle(opts?: WaitOptions): Promise<void> {
    return this.session.waitForIdle(opts);
  }

  waitForReady(opts?: WaitOptions): Promise<void> {
    return this.session.waitForReady(opts);
  }

  waitForExit(opts?: WaitOptions): Promise<ExitStatus> {
    return this.session.waitForExit(opts);
  }

  diagnostics(): readonly SessionDiagnostic[] {
    return this.session.diagnostics();
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
