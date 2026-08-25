import { createRunId, type ObservationStamp } from "@termwright/protocol";
import type { ActionEvent, ActionStartedEvent } from "../api.js";

/** Session facts and event delivery required by the action lifecycle. */
export interface SessionActionSink {
  isOpen(): boolean;
  now(): number;
  checkpoint(): ObservationStamp;
  started(event: ActionStartedEvent): void;
  finished(event: ActionEvent): void;
}

type ActionCompletion = Omit<
  ActionEvent,
  "actionId" | "api" | "ok" | "timeMs" | "observation"
>;

/**
 * Correlates every announced action with exactly one terminal outcome.
 * It owns no PTY and is independently testable with a deterministic sink.
 */
export class SessionActionLifecycle {
  readonly #sink: SessionActionSink;
  readonly #pending = new Map<string, { readonly api: string; readonly selector?: string }>();

  constructor(sink: SessionActionSink) {
    this.#sink = sink;
  }

  begin(api: string, about?: { readonly selector?: string }): string {
    const actionId = createRunId("action");
    if (!this.#sink.isOpen()) return actionId;
    const pending = {
      api,
      ...(about?.selector === undefined ? {} : { selector: about.selector }),
    };
    this.#pending.set(actionId, pending);
    this.#sink.started({
      actionId,
      api,
      ...(pending.selector === undefined ? {} : { selector: pending.selector }),
      timeMs: this.#sink.now(),
    });
    return actionId;
  }

  end(actionId: string, api: string, ok: boolean, about?: ActionCompletion): void {
    if (!this.#sink.isOpen() || !this.#pending.delete(actionId)) return;
    this.#sink.finished({
      actionId,
      api,
      ...(about?.selector !== undefined ? { selector: about.selector } : {}),
      ...(about?.ref !== undefined ? { ref: about.ref } : {}),
      ok,
      ...(about?.error !== undefined ? { error: about.error } : {}),
      ...(about?.actionability !== undefined ? { actionability: about.actionability } : {}),
      ...(about?.receipt !== undefined ? { receipt: about.receipt } : {}),
      observation: this.#sink.checkpoint(),
      timeMs: this.#sink.now(),
    });
  }

  failPending(error: string): void {
    for (const [actionId, pending] of [...this.#pending]) {
      this.end(actionId, pending.api, false, {
        ...(pending.selector === undefined ? {} : { selector: pending.selector }),
        error,
      });
    }
  }
}
