import { describe, expect, it } from "vitest";
import { SessionInputEvidenceBarrier } from "./session-input-plane.js";

describe("SessionInputEvidenceBarrier", () => {
  it("never barriers a session without application providers", () => {
    const barrier = new SessionInputEvidenceBarrier();
    barrier.noteInput(false, 4);
    expect(barrier.waitingForProviderEvidence).toBe(false);
  });

  it("requires a strictly newer semantic commit after provider-backed input", () => {
    const barrier = new SessionInputEvidenceBarrier();
    barrier.noteInput(true, 4);
    expect(barrier.waitingForProviderEvidence).toBe(true);
    barrier.noteSemanticCommit(4);
    expect(barrier.waitingForProviderEvidence).toBe(true);
    barrier.noteSemanticCommit(5);
    expect(barrier.waitingForProviderEvidence).toBe(false);
  });

  it("moves the causal boundary when later input is sent", () => {
    const barrier = new SessionInputEvidenceBarrier();
    barrier.noteInput(true, 4);
    barrier.noteInput(true, 7);
    barrier.noteSemanticCommit(5);
    expect(barrier.waitingForProviderEvidence).toBe(true);
    barrier.noteSemanticCommit(8);
    expect(barrier.waitingForProviderEvidence).toBe(false);
  });
});
