import { describe, expect, it } from "vitest";
import type { AppLogEvent, SessionDiagnostic } from "../api.js";
import { SessionEvidenceJournal } from "./session-evidence.js";

function journal() {
  let now = 10;
  const diagnostics: SessionDiagnostic[] = [];
  const logs: AppLogEvent[] = [];
  return {
    diagnostics,
    logs,
    tick: () => { now += 1; },
    value: new SessionEvidenceJournal({
      now: () => now,
      diagnostic: (entry) => diagnostics.push(entry),
      appLog: (entry) => logs.push(entry),
    }),
  };
}

describe("SessionEvidenceJournal", () => {
  it("bounds diagnostics and application logs while preserving event delivery", () => {
    const found = journal();
    for (let index = 0; index < 205; index += 1) {
      found.value.diagnostic("endpoint-error", `d${index}`);
    }
    for (let index = 0; index < 1_005; index += 1) {
      found.value.appLog({ source: "file", path: "/tmp/app.log", line: `l${index}`, timeMs: index });
    }
    expect(found.value.diagnostics()).toHaveLength(200);
    expect(found.value.diagnostics()[0]?.detail).toBe("d5");
    expect(found.diagnostics).toHaveLength(205);
    expect(found.value.appLogs()).toHaveLength(1_000);
    expect(found.value.appLogs()[0]).toMatchObject({ line: "l5" });
    expect(found.logs).toHaveLength(1_005);
  });

  it("redacts typed input by default but retains bounded mouse evidence", () => {
    const found = journal();
    found.value.rememberInput(new TextEncoder().encode("secret"), "paste", 1, "redacted");
    for (let index = 0; index < 21; index += 1) {
      found.value.rememberInput(new Uint8Array([index]), "mouse", index + 2, "redacted");
    }
    const report = found.value.crashReport({
      exit: { code: 1, signal: null },
      screenLines: ["failure", ""],
      lastSemanticTree: null,
    });
    expect(report.recentInputs).toHaveLength(20);
    expect(report.recentInputs[0]).toMatchObject({ kind: "mouse", timeMs: 3 });
    expect(report.recentInputs.at(-1)?.preview).toBe("\\u0014");
    expect(report.screenTail).toEqual(["failure"]);
  });

  it("takes immutable snapshots instead of exposing mutable journal storage", () => {
    const found = journal();
    found.value.diagnostic("endpoint-error", "first");
    const snapshot = found.value.diagnostics();
    found.tick();
    found.value.diagnostic("endpoint-error", "second");
    expect(snapshot).toHaveLength(1);
    expect(found.value.diagnostics()).toHaveLength(2);
  });

  it("preserves structured action observation wait correlation", () => {
    const found = journal();
    found.value.diagnostic(
      "action-observation-wait",
      "action action:one is waiting for semantic-frame-open",
      {
        actionId: "action:one",
        observationState: "semantic-frame-open",
      },
    );

    expect(found.value.diagnostics()).toEqual([
      {
        code: "action-observation-wait",
        detail: "action action:one is waiting for semantic-frame-open",
        actionId: "action:one",
        observationState: "semantic-frame-open",
        timeMs: 10,
      },
    ]);
    expect(found.diagnostics).toEqual(found.value.diagnostics());
  });
});
