/**
 * Tracks the causal boundary between terminal input and application-owned
 * semantic evidence.
 *
 * Provider evidence describes one committed revision. Once input reaches a
 * provider-backed application, that evidence cannot be reused until a
 * strictly newer semantic revision is committed. Generic terminal sessions do
 * not have application evidence and therefore never enter the waiting state.
 */
export class SessionInputEvidenceBarrier {
  #invalidAfterRevision: number | null = null;

  get waitingForProviderEvidence(): boolean {
    return this.#invalidAfterRevision !== null;
  }

  noteInput(hasProviders: boolean, currentRevision: number): void {
    if (!hasProviders) return;
    this.#invalidAfterRevision = currentRevision;
  }

  noteSemanticCommit(revision: number): void {
    if (
      this.#invalidAfterRevision !== null &&
      revision > this.#invalidAfterRevision
    ) {
      this.#invalidAfterRevision = null;
    }
  }
}
