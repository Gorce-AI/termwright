import type {
  AppLogEvent,
  CrashInput,
  CrashReport,
  DiagnosticCode,
  ExitStatus,
  SessionDiagnostic,
} from '../api.js';
import type { ArtifactValuePolicy, SemanticSnapshot } from '@termwright/protocol';

const MAX_DIAGNOSTICS = 200;
const MAX_APP_LOGS = 1_000;
const CRASH_INPUTS = 20;
const CRASH_DIAGNOSTICS = 20;
const CRASH_TAIL_LINES = 50;
const CRASH_TAIL_BYTES = 16 * 1024;
const CRASH_INPUT_PREVIEW = 40;

/** Optional facts attached to one diagnostic record. */
export interface SessionDiagnosticContext {
  readonly revision?: number | undefined;
  readonly actionId?: string | undefined;
  readonly observationState?: SessionDiagnostic['observationState'];
  readonly wireCode?: SessionDiagnostic['wireCode'];
  readonly count?: number | undefined;
  readonly mode?: SessionDiagnostic['mode'];
}

/** Observable boundary of the bounded evidence journal. */
export interface SessionEvidenceSink {
  now(): number;
  diagnostic(entry: SessionDiagnostic): void;
  appLog(entry: AppLogEvent): void;
}

/** Inputs required to construct an immutable crash artifact. */
export interface CrashEvidence {
  readonly exit: ExitStatus;
  readonly screenLines: readonly string[];
  readonly lastSemanticTree: SemanticSnapshot | null;
}

/**
 * Owns bounded diagnostic, application-log and crash evidence for one session.
 * It has no PTY or host dependency; the session supplies time and event sinks.
 */
export class SessionEvidenceJournal {
  readonly #sink: SessionEvidenceSink;
  readonly #diagnostics: SessionDiagnostic[] = [];
  readonly #appLogs: AppLogEvent[] = [];
  readonly #recentInputs: CrashInput[] = [];

  constructor(sink: SessionEvidenceSink) {
    this.#sink = sink;
  }

  diagnostic(code: DiagnosticCode, detail: string, about?: SessionDiagnosticContext): void {
    const entry: SessionDiagnostic = Object.freeze({
      code,
      detail,
      ...(about?.revision !== undefined ? { revision: about.revision } : {}),
      ...(about?.actionId !== undefined ? { actionId: about.actionId } : {}),
      ...(about?.observationState !== undefined
        ? { observationState: about.observationState }
        : {}),
      ...(about?.wireCode !== undefined ? { wireCode: about.wireCode } : {}),
      ...(about?.count !== undefined ? { count: about.count } : {}),
      ...(about?.mode !== undefined ? { mode: about.mode } : {}),
      timeMs: this.#sink.now(),
    });
    this.#diagnostics.push(entry);
    if (this.#diagnostics.length > MAX_DIAGNOSTICS) this.#diagnostics.shift();
    this.#sink.diagnostic(entry);
  }

  diagnostics(): readonly SessionDiagnostic[] {
    return Object.freeze([...this.#diagnostics]);
  }

  appLog(event: AppLogEvent): void {
    const retained = Object.freeze(event);
    this.#appLogs.push(retained);
    if (this.#appLogs.length > MAX_APP_LOGS) this.#appLogs.shift();
    this.#sink.appLog(retained);
  }

  appLogs(): readonly AppLogEvent[] {
    return Object.freeze([...this.#appLogs]);
  }

  rememberInput(
    data: Uint8Array,
    kind: CrashInput['kind'],
    timeMs: number,
    artifactValuePolicy: ArtifactValuePolicy,
  ): void {
    const entry: CrashInput = Object.freeze({
      timeMs,
      kind,
      bytes: data.length,
      ...(kind === 'mouse' || artifactValuePolicy === 'raw' ? { preview: previewBytes(data) } : {}),
    });
    this.#recentInputs.push(entry);
    if (this.#recentInputs.length > CRASH_INPUTS) this.#recentInputs.shift();
  }

  crashReport(evidence: CrashEvidence): CrashReport {
    return Object.freeze({
      exit: evidence.exit,
      screenTail: crashTail(evidence.screenLines),
      lastSemanticTree: evidence.lastSemanticTree,
      recentInputs: Object.freeze([...this.#recentInputs]),
      diagnosticsTail: Object.freeze(this.#diagnostics.slice(-CRASH_DIAGNOSTICS)),
      timeMs: this.#sink.now(),
    });
  }
}

function previewBytes(data: Uint8Array): string {
  const text = new TextDecoder().decode(data.subarray(0, CRASH_INPUT_PREVIEW));
  const escaped = JSON.stringify(text).slice(1, -1);
  return data.length > CRASH_INPUT_PREVIEW ? `${escaped}…` : escaped;
}

function crashTail(lines: readonly string[]): readonly string[] {
  let end = lines.length;
  while (end > 0 && (lines[end - 1] ?? '').trim() === '') end -= 1;
  const tail = lines.slice(Math.max(0, end - CRASH_TAIL_LINES), end);
  let bytes = 0;
  const kept: string[] = [];
  for (let index = tail.length - 1; index >= 0; index -= 1) {
    const line = tail[index] ?? '';
    bytes += Buffer.byteLength(line, 'utf8') + 1;
    if (bytes > CRASH_TAIL_BYTES) break;
    kept.push(line);
  }
  return Object.freeze(kept.reverse());
}
