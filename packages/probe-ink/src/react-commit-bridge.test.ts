import { describe, expect, it, vi } from "vitest";
import {
  activateInkRendererObservation,
  correlateInkHostProps,
  installReactCommitBridge,
  requireCommittedInkRoot,
  type InkCommitEvent,
} from "./react-commit-bridge.js";
import type { InkDomElement } from "./observe.js";

type Hook = {
  supportsFiber?: boolean;
  inject(renderer: Record<string, unknown>): unknown;
  onCommitFiberRoot(
    rendererId: unknown,
    root: { containerInfo?: unknown },
  ): void;
  onCommitFiberUnmount(rendererId: unknown, fiber: unknown): void;
  custom?: string;
};

function target(existing?: Partial<Hook>): typeof globalThis {
  return {
    __REACT_DEVTOOLS_GLOBAL_HOOK__: existing,
  } as unknown as typeof globalThis;
}

function root(name: InkDomElement["nodeName"] = "ink-root"): InkDomElement {
  return { nodeName: name, childNodes: [], style: {} };
}

describe("ReactCommitBridge", () => {
  it("composes with the existing hook and preserves its renderer id and properties", () => {
    const inject = vi.fn(function (this: { custom?: string }) {
      expect(this.custom).toBe("preserved");
      return 41;
    });
    const commit = vi.fn();
    const unmount = vi.fn();
    const scope = target({
      custom: "preserved",
      inject,
      onCommitFiberRoot: commit,
      onCommitFiberUnmount: unmount,
    });
    const bridge = installReactCommitBridge(scope);
    const hook = (scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const events: InkCommitEvent[] = [];
    bridge.subscribe((event) => events.push(event));

    const id = hook.inject({
      rendererPackageName: "ink",
      rendererVersion: "7.1.1",
    });
    const fiberRoot = { containerInfo: root() };
    hook.onCommitFiberRoot(id, fiberRoot);
    hook.onCommitFiberUnmount(id, { key: "removed" });

    expect(id).toBe(41);
    expect(hook.custom).toBe("preserved");
    expect(inject).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith(41, fiberRoot);
    expect(unmount).toHaveBeenCalledWith(41, { key: "removed" });
    expect(events.map((event) => event.type)).toEqual(["commit", "unmount"]);
  });

  it("ignores foreign renderers and keeps several Ink roots isolated by identity", () => {
    const scope = target();
    const bridge = installReactCommitBridge(scope);
    const hook = (scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const events: InkCommitEvent[] = [];
    bridge.subscribe((event) => events.push(event));
    const foreignId = hook.inject({ rendererPackageName: "react-dom" });
    const inkId = hook.inject({ rendererPackageName: "ink" });
    hook.onCommitFiberRoot(foreignId, {
      containerInfo: { nodeName: "html", childNodes: [] },
    });
    const first = root();
    const second = root();
    hook.onCommitFiberRoot(inkId, { containerInfo: first });
    hook.onCommitFiberRoot(inkId, { containerInfo: second });

    expect(events).toHaveLength(2);
    expect(bridge.roots()).toEqual([first, second]);
  });

  it("isolates multiple Ink renderer registrations without assuming renderer id 1", () => {
    const scope = target({
      inject: vi.fn().mockReturnValueOnce("ink-a").mockReturnValueOnce(73),
    });
    const bridge = installReactCommitBridge(scope);
    const hook = (scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const events: InkCommitEvent[] = [];
    bridge.subscribe((event) => events.push(event));
    const firstId = hook.inject({
      rendererPackageName: "ink",
      rendererVersion: "7.1.1",
    });
    const secondId = hook.inject({
      rendererPackageName: "ink",
      rendererVersion: "8.0.0",
    });
    const first = root();
    const second = root();
    hook.onCommitFiberRoot(secondId, { containerInfo: second });
    hook.onCommitFiberRoot(firstId, { containerInfo: first });

    expect(
      events.map(
        (event) =>
          event.type === "commit" && [event.renderer.rendererId, event.root],
      ),
    ).toEqual([
      [73, second],
      ["ink-a", first],
    ]);
    expect(bridge.roots()).toEqual([second, first]);
  });

  it("reuses one installation but activates the same reconciler for each hook target", () => {
    const first = target();
    const second = target();
    let active = first;
    const reconciler = {
      injectIntoDevTools: vi.fn(() => {
        const hook = (
          active as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook }
        ).__REACT_DEVTOOLS_GLOBAL_HOOK__;
        hook.inject({ rendererPackageName: "ink" });
      }),
    };
    const firstBridge = activateInkRendererObservation(reconciler, first);
    expect(installReactCommitBridge(first)).toBe(firstBridge);
    active = second;
    const secondBridge = activateInkRendererObservation(reconciler, second);

    expect(secondBridge).not.toBe(firstBridge);
    expect(reconciler.injectIntoDevTools).toHaveBeenCalledTimes(2);
    expect(firstBridge.hasInkRenderer()).toBe(true);
    expect(secondBridge.hasInkRenderer()).toBe(true);
  });

  it("preserves inherited properties and observes commits even when a delegated callback throws", () => {
    const prototype = { rendererInterfaces: new Map([["existing", true]]) };
    const existing = Object.assign(Object.create(prototype) as Partial<Hook>, {
      inject: () => 9,
      onCommitFiberRoot: () => {
        throw new Error("existing hook failure");
      },
    });
    const scope = target(existing);
    const bridge = installReactCommitBridge(scope);
    const hook = (
      scope as unknown as {
        __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook & typeof prototype;
      }
    ).__REACT_DEVTOOLS_GLOBAL_HOOK__;
    const events: InkCommitEvent[] = [];
    bridge.subscribe((event) => events.push(event));
    const id = hook.inject({ rendererPackageName: "ink" });
    const committed = root();

    expect(() =>
      hook.onCommitFiberRoot(id, { containerInfo: committed }),
    ).toThrow("existing hook failure");
    expect(hook.rendererInterfaces).toBe(prototype.rendererInterfaces);
    expect(events).toEqual([
      expect.objectContaining({ type: "commit", root: committed }),
    ]);
  });

  it("fails closed when a frozen hook target cannot be composed", () => {
    const scope = target();
    Object.freeze(scope);
    expect(() => installReactCommitBridge(scope)).toThrow(
      "existing React renderer instrumentation hook cannot be composed",
    );
  });

  it("composes a configurable read-only hook property without mutating the old hook", () => {
    const existing = { custom: "read-only", inject: () => 17 };
    const scope = {} as typeof globalThis;
    Object.defineProperty(scope, "__REACT_DEVTOOLS_GLOBAL_HOOK__", {
      value: existing,
      writable: false,
      configurable: true,
    });
    const bridge = installReactCommitBridge(scope);
    const hook = (scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;

    expect(hook).not.toBe(existing);
    expect(hook.custom).toBe("read-only");
    expect(hook.inject({ rendererPackageName: "ink" })).toBe(17);
    expect(bridge.hasInkRenderer()).toBe(true);
    expect(existing).toEqual({ custom: "read-only", inject: expect.any(Function) });
  });

  it("correlates source accessibility props to host stateNode without making Fiber authoritative", () => {
    const box = root("ink-box");
    const text = root("ink-text");
    const fiberRoot = {
      current: {
        child: {
          memoizedProps: {
            "aria-label": "Save changes",
            "aria-hidden": true,
            "aria-role": "button",
          },
          child: {
            memoizedProps: { internal_accessibility: { role: "button" } },
            stateNode: box,
            child: {
              memoizedProps: { children: "visual" },
              child: {
                memoizedProps: { children: "visual" },
                stateNode: text,
              },
            },
          },
        },
      },
    };
    const correlated = correlateInkHostProps(fiberRoot);

    expect(correlated.get(box)).toEqual(
      expect.objectContaining({
        accessibleName: "Save changes",
        ariaHidden: true,
        sourceProps: expect.objectContaining({ "aria-role": "button" }),
      }),
    );
    expect(correlated.get(text)?.accessibleName).toBeUndefined();
  });

  it("bounds the experimental Fiber walk instead of allowing unbounded commit overhead", () => {
    const chain = Array.from({ length: 5 }, () => ({
      memoizedProps: {},
    })) as Array<{
      memoizedProps: Record<string, unknown>;
      sibling?: unknown;
    }>;
    for (let index = 0; index < chain.length - 1; index += 1)
      chain[index]!.sibling = chain[index + 1];
    expect(() =>
      correlateInkHostProps(
        { current: { child: chain[0] as never } },
        { maxFibers: 4 },
      ),
    ).toThrow("bounded traversal limit");
  });

  it("reports an invalid container and the contract check fails closed", () => {
    const scope = target();
    const bridge = installReactCommitBridge(scope);
    const hook = (scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook })
      .__REACT_DEVTOOLS_GLOBAL_HOOK__;
    let observed: InkCommitEvent | undefined;
    bridge.subscribe((event) => {
      observed = event;
    });
    const id = hook.inject({ rendererPackageName: "ink" });
    hook.onCommitFiberRoot(id, { containerInfo: { nodeName: "not-ink" } });

    expect(observed?.type).toBe("invalid-root");
    expect(() => requireCommittedInkRoot(observed as InkCommitEvent)).toThrow(
      "React renderer instrumentation did not expose expected committed Ink root",
    );
    expect(bridge.roots()).toEqual([]);
  });

  it("activates the reconciler without DEV=true and proves registration by injection", () => {
    const scope = target();
    const previousDev = process.env["DEV"];
    delete process.env["DEV"];
    const reconciler = {
      injectIntoDevTools: vi.fn(() => {
        const hook = (
          scope as unknown as { __REACT_DEVTOOLS_GLOBAL_HOOK__: Hook }
        ).__REACT_DEVTOOLS_GLOBAL_HOOK__;
        hook.inject({ rendererPackageName: "ink", rendererVersion: "7.1.1" });
        return false;
      }),
    };
    try {
      expect(
        activateInkRendererObservation(reconciler, scope).hasInkRenderer(),
      ).toBe(true);
      expect(reconciler.injectIntoDevTools).toHaveBeenCalledOnce();
      expect(process.env["DEV"]).toBeUndefined();
    } finally {
      if (previousDev === undefined) delete process.env["DEV"];
      else process.env["DEV"] = previousDev;
    }
  });

  it("fails closed when the reconciler does not register an Ink renderer", () => {
    expect(() =>
      activateInkRendererObservation(
        { injectIntoDevTools: () => false },
        target(),
      ),
    ).toThrow("React renderer instrumentation did not register Ink");
  });
});
