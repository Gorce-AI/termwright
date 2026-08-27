import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("Ink DEV decision", () => {
  it("lets real Ink own the DEV injection and delegates to an existing hook exactly once", async () => {
    const inkUrl = import.meta.resolve("ink");
    const reactUrl = import.meta.resolve("react");
    const reconcilerUrl = inkUrl.replace(/index\.js$/u, "reconciler.js");
    const instrumentUrl = new URL("../dist/instrument.js", import.meta.url).href;
    const script = `
      import {PassThrough} from 'node:stream';
      import {createElement} from ${JSON.stringify(reactUrl)};
      let existingInjects = 0;
      globalThis.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        supportsFiber: true,
        inject() { existingInjects += 1; return 91; },
      };
      const ink = await import(${JSON.stringify(inkUrl)});
      const reconciler = (await import(${JSON.stringify(reconcilerUrl)})).default;
      const {wrapInkRender} = await import(${JSON.stringify(instrumentUrl)});
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      for (const stream of [stdout, stderr]) Object.defineProperties(stream, {
        columns: {value: 24}, rows: {value: 8}, isTTY: {value: true},
      });
      const render = wrapInkRender({
        render: ink.render,
        Box: ink.Box,
        measureElement: ink.measureElement,
      }, {
        env: {TERMWRIGHT_ENDPOINT: 'test', TERMWRIGHT_TOKEN: 'test', DEV: 'true'},
        certifiedHarness: true,
        reconciler,
        connect: async () => null,
      });
      const instance = render(createElement(ink.Text, null, 'one injection'), {
        stdout, stderr, patchConsole: false, interactive: true,
      });
      await instance.waitUntilRenderFlush();
      instance.unmount();
      await instance.waitUntilExit();
      process.stdout.write(JSON.stringify({existingInjects}));
    `;
    const environment = { ...process.env, DEV: "true" };
    const result = await execFileAsync(
      process.execPath,
      ["--input-type=module", "--eval", script],
      { env: environment },
    );
    expect(JSON.parse(result.stdout)).toEqual({ existingInjects: 1 });
  });

  it("does not require DEV and Ink 7.1.1 renders identically with DEV disabled or enabled", async () => {
    const inkUrl = import.meta.resolve("ink");
    const reactUrl = import.meta.resolve("react");
    const script = `
      import net from 'node:net';
      import {PassThrough} from 'node:stream';
      import {createElement} from ${JSON.stringify(reactUrl)};
      net.Socket.prototype.connect = function () {
        throw new Error('DEV attempted to open a network socket');
      };
      const {render, Box, Text} = await import(${JSON.stringify(inkUrl)});
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      Object.defineProperties(stdout, {
        columns: {value: 24}, rows: {value: 8}, isTTY: {value: true},
      });
      Object.defineProperties(stderr, {
        columns: {value: 24}, rows: {value: 8}, isTTY: {value: true},
      });
      const chunks = [];
      stdout.on('data', chunk => chunks.push(chunk.toString('utf8')));
      const instance = render(createElement(Box, {
        width: 12, 'aria-role': 'button', 'aria-label': 'Action',
      }, createElement(Text, null, 'visual')), {
        stdout, stderr, patchConsole: false, interactive: true,
      });
      await instance.waitUntilRenderFlush();
      instance.unmount();
      await instance.waitUntilExit();
      process.stdout.write(JSON.stringify(chunks));
    `;
    const run = async (
      dev: boolean,
    ): Promise<{
      readonly output: readonly string[];
      readonly processStderr: string;
    }> => {
      const environment = { ...process.env };
      if (dev) environment["DEV"] = "true";
      else delete environment["DEV"];
      const result = await execFileAsync(
        process.execPath,
        ["--input-type=module", "--eval", script],
        {
          env: environment,
        },
      );
      return {
        output: JSON.parse(result.stdout) as readonly string[],
        processStderr: result.stderr,
      };
    };

    const withoutDev = await run(false);
    const withDev = await run(true);
    expect(withDev).toEqual(withoutDev);
    expect(withDev.output.join("")).toContain("visual");
    // Ink restores the cursor on process stderr at shutdown; this framework
    // behavior is identical in both modes and is unrelated to DevTools.
    expect(withDev.processStderr).toBe("\u001B[?25h");
  });
});
