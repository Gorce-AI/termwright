import { describe, expect, it, vi } from "vitest";
import { SessionProcessLifecycle } from "./session-process-lifecycle.js";

describe("SessionProcessLifecycle", () => {
  it("separates backend exit evidence from the public drained exit", async () => {
    const lifecycle = new SessionProcessLifecycle();
    const backend = { code: 1, signal: null } as const;
    lifecycle.observeBackendExit(backend);
    expect(lifecycle.backendStatus).toEqual(backend);
    expect(lifecycle.status).toBeNull();

    const publish = vi.fn();
    expect(lifecycle.complete(backend, publish)).toBe(true);
    expect(publish).toHaveBeenCalledWith(backend, true);
    await expect(lifecycle.exit).resolves.toBe(backend);
    expect(Object.isFrozen(backend)).toBe(true);
    expect(lifecycle.complete({ code: 0, signal: null }, publish)).toBe(false);
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("does not classify an exit requested by teardown as a crash", () => {
    const lifecycle = new SessionProcessLifecycle();
    lifecycle.requestTeardown();
    const publish = vi.fn();
    lifecycle.complete({ code: null, signal: "SIGHUP" }, publish);
    expect(publish).toHaveBeenCalledWith({ code: null, signal: "SIGHUP" }, false);
  });

  it("retains only the first backend observation", () => {
    const lifecycle = new SessionProcessLifecycle();
    lifecycle.observeBackendExit({ code: 2, signal: null });
    lifecycle.observeBackendExit({ code: 3, signal: null });
    expect(lifecycle.backendStatus).toEqual({ code: 2, signal: null });
  });
});
