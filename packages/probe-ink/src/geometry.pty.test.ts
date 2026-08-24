import { dirname, join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { launchTerminal } from "@termwright/driver";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = join(packageRoot, "src", "testing", "geometry-app.mjs");
const preload = pathToFileURL(join(packageRoot, "dist", "node-hook.js")).href;

async function launch(mode: string) {
  return launchTerminal({
    command: [process.execPath, "--import", preload, app],
    columns: 20,
    rows: 8,
    env: { TW_INK_GEOMETRY_MODE: mode },
    requiredCapabilities: [
      "semantic-tree",
      "intended-geometry",
      "clipped-geometry",
    ],
    semanticNegotiationMs: 5_000,
  });
}

describe("certified Ink geometry over a real PTY", { timeout: 60_000 }, () => {
  it.each(["main", "alternate"])(
    "binds %s-buffer geometry to the committed viewport",
    async (mode) => {
      const terminal = await launch(mode);
      try {
        const live = terminal.getByRole("text", { name: "LIVE-0" });
        await live.waitFor({ state: "attached" });
        const geometry = await live.geometry();
        expect(geometry.coordinateSpace).toMatchObject({
          status: "known",
          value: "viewport-cells",
        });
        expect(geometry.visibleRect).toMatchObject({
          status: "known",
          value: expect.objectContaining({ row: 0, height: 1 }),
        });
      } finally {
        await terminal.close();
      }
    },
  );

  it("keeps Static above live output while retaining independent geometry", async () => {
    const terminal = await launch("static");
    try {
      const originalHistory = terminal.getByRole("text", {
        name: "HISTORY",
        exact: true,
      });
      const liveLocator = terminal.getByRole("text", { name: "LIVE-0" });
      await originalHistory.waitFor({ state: "attached" });
      await liveLocator.waitFor({ state: "attached" });
      const history = await originalHistory.geometry();
      const live = await liveLocator.geometry();
      expect(history.visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ row: 0, height: 1 }),
      });
      expect(live.visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ row: 1, height: 1 }),
      });
      await terminal.press("n");
      await terminal.waitForText("LIVE-1");
      // This targets the original Static item, not the later HISTORY-1 node.
      expect(
        (await originalHistory.geometry()).visibleRect,
      ).toMatchObject({ status: "known" });
      const nextHistory = terminal.getByRole("text", {
        name: "HISTORY-1",
        exact: true,
      });
      await nextHistory.waitFor({ state: "attached" });
      expect((await nextHistory.geometry()).visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ row: 1, height: 1 }),
      });
      expect(
        (await terminal.getByRole("text", { name: "LIVE-1" }).geometry())
          .visibleRect,
      ).toMatchObject({
        status: "known",
        value: expect.objectContaining({ row: 2, height: 1 }),
      });
    } finally {
      await terminal.close();
    }
  });

  it("publishes exact nested clipping and wrapped wide-cell Yoga geometry", async () => {
    const terminal = await launch("clip");
    try {
      const clipped = terminal.getByRole("text", { name: "CLIPPED-WIDE" });
      await clipped.waitFor({ state: "attached" });
      const geometry = await clipped.geometry();
      expect(geometry.intendedRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ width: 8, height: 1 }),
      });
      expect(geometry.visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ width: 2, height: 1 }),
      });
    } finally {
      await terminal.close();
    }
  });

  it("coalesces rapid rerenders without publishing stale geometry", async () => {
    const terminal = await launch("rapid");
    try {
      await terminal.waitForText("LIVE-2");
      const current = terminal.getByRole("text", { name: "LIVE-2" });
      await current.waitFor({ state: "attached" });
      expect((await current.geometry()).visibleRect).toMatchObject({
        status: "known",
      });
      expect(await terminal.getByRole("text", { name: "LIVE-1" }).count()).toBe(
        0,
      );
    } finally {
      await terminal.close();
    }
  });

  it("recomputes certified Yoga geometry after a PTY resize", async () => {
    const terminal = await launch("resize");
    try {
      const label = terminal.getByRole("button", { name: "RESIZE" });
      await label.waitFor({ state: "attached" });
      expect((await label.geometry()).intendedRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ width: 20 }),
      });
      await terminal.resize({ columns: 12, rows: 6 });
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect((await label.geometry()).intendedRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ width: 12 }),
      });
    } finally {
      await terminal.close();
    }
  });

  it("clips fullscreen output against terminal scrolling without text-derived geometry", async () => {
    const terminal = await launch("scroll");
    try {
      const first = terminal.getByRole("text", { name: "LINE-0" });
      const last = terminal.getByRole("text", { name: "LINE-11" });
      await last.waitFor({ state: "attached" });
      expect((await first.geometry()).visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ height: 0 }),
      });
      expect((await last.geometry()).visibleRect).toMatchObject({
        status: "known",
        value: expect.objectContaining({ row: 7, height: 1 }),
      });
    } finally {
      await terminal.close();
    }
  });

  it("publishes hidden nodes as absent geometry and restores them after display", async () => {
    const terminal = await launch("hidden");
    try {
      const hidden = terminal.getByRole("text", { name: "HIDDEN" });
      await hidden.waitFor({ state: "attached" });
      expect((await hidden.geometry()).visibleRect).toMatchObject({
        status: "absent",
        reason: "not-displayed",
      });
      await terminal.press("n");
      await hidden.waitFor({ state: "visible" });
      expect((await hidden.geometry()).visibleRect).toMatchObject({
        status: "known",
      });
    } finally {
      await terminal.close();
    }
  });
});
