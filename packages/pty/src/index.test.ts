import { describe, expect, it } from "vitest";
import { candidatePaths, spawnPty } from "./index.js";

const environment = (): Record<string, string> => Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
);

function node(source: string): readonly string[] {
  return [process.execPath, "-e", source];
}

function collect(command: readonly string[]) {
  const handle = spawnPty({ command, env: environment(), columns: 80, rows: 24 });
  const chunks: Buffer[] = [];
  handle.onData((data) => chunks.push(Buffer.from(data)));
  const exit = new Promise<{ code: number | null; signal: string | null }>((resolve) => {
    handle.onExit(resolve);
  });
  return {
    handle,
    chunks,
    exit,
    text: (): string => Buffer.concat(chunks).toString("utf8"),
  };
}

function waitForText(
  handle: ReturnType<typeof spawnPty>,
  chunks: Buffer[],
  marker: string,
): Promise<void> {
  if (Buffer.concat(chunks).includes(marker)) return Promise.resolve();
  return new Promise((resolve) => {
    const release = handle.onData(() => {
      if (!Buffer.concat(chunks).includes(marker)) return;
      release();
      resolve();
    });
  });
}

describe.skipIf(process.platform === "win32")("the Termwright-owned POSIX PTY", () => {
  it("loads the local addon before the platform prebuild", () => {
    expect(candidatePaths("darwin", "arm64")).toEqual([
      "../build/Release/termwright_pty.node",
      "@termwright/pty-darwin-arm64/termwright_pty.node",
    ]);
  });

  it("resolves a bare executable from PATH without invoking a shell", async () => {
    const session = collect(["node", "-e", "process.stdout.write('BARE_EXECUTABLE')"]);
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain("BARE_EXECUTABLE");
    expect(session.handle.sawRealEof).toBe(true);
    session.handle.dispose();
  });

  it("fails before forking when a bare executable is absent from PATH", () => {
    expect(() => spawnPty({
      command: ["termwright-command-that-does-not-exist"],
      env: { PATH: "/usr/bin:/bin" },
      columns: 80,
      rows: 24,
    })).toThrow(/executable not found on PATH/u);
  });

  it("delivers a megabyte tail and its sentinel before authoritative EOF", async () => {
    const payloadBytes = 1024 * 1024;
    const session = collect(node([
      "const fs = require('node:fs');",
      `const block = Buffer.alloc(${payloadBytes}, 0x78);`,
      "let offset = 0;",
      "while (offset < block.length) offset += fs.writeSync(1, block, offset);",
      "fs.writeSync(1, Buffer.from('FINAL_SENTINEL'));",
    ].join("")));

    const [status] = await Promise.all([session.exit, session.handle.outputEnded]);
    const output = Buffer.concat(session.chunks);
    expect(status).toEqual({ code: 0, signal: null });
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.endReason).toBe(0);
    expect(output.subarray(0, payloadBytes)).toEqual(Buffer.alloc(payloadBytes, 0x78));
    expect(output.subarray(payloadBytes).toString("utf8")).toBe("FINAL_SENTINEL");
    session.handle.dispose();
  });

  it("writes exact bytes through the owned master", async () => {
    const session = collect(node([
      "process.stdin.setRawMode(true);",
      "process.stdin.resume();",
      "process.stdout.write('READY');",
      "process.stdin.once('data', data => {",
      "process.stdout.write('HEX=' + Buffer.from(data).toString('hex'));",
      "process.exit(0);",
      "});",
    ].join("")));
    await waitForText(session.handle, session.chunks, "READY");
    session.handle.write(Uint8Array.from([0, 0xff, 0x1b, 0x5b, 0x4d]));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain("HEX=00ff1b5b4d");
    expect(session.handle.sawRealEof).toBe(true);
    session.handle.dispose();
  });

});

describe("the Termwright-owned native PTY flow control", () => {

  it("bounds input admitted while the child does not consume it", async () => {
    const session = collect(node([
      "require('node:net').createServer().listen(0);",
      "process.stdout.write('READY');",
    ].join("")));
    await waitForText(session.handle, session.chunks, "READY");
    const block = Buffer.alloc(1024 * 1024, 0x61);
    expect(() => {
      for (let index = 0; index < 32; index += 1) session.handle.write(block);
    }).toThrow(/input queue capacity exceeded/u);
    session.handle.dispose();
  });

  it("publishes drain only after every admitted input byte is written", async () => {
    const bytes = 256 * 1024;
    const session = collect(node([
      "process.stdin.setRawMode(true);",
      "process.stdin.resume();",
      "let received = 0;",
      "process.stdout.write('READY');",
      "process.stdin.on('data', chunk => {",
      "received += chunk.length;",
      `if (received >= ${bytes}) { process.stdout.write('INPUT_DRAINED'); process.exit(0); }`,
      "});",
    ].join("")));
    await waitForText(session.handle, session.chunks, "READY");
    let drained = false;
    const drain = new Promise<void>((resolve) => {
      const release = session.handle.onDrain(() => {
        drained = true;
        release();
        resolve();
      });
    });
    session.handle.write(Buffer.alloc(bytes, 0x62));
    expect(drained).toBe(false);
    await drain;
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain("INPUT_DRAINED");
    session.handle.dispose();
  });

  it("rejects input after the authoritative output end", async () => {
    const session = collect(node("process.stdout.write('DONE')"));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(() => session.handle.write(Buffer.from("late"))).toThrow(/input is closed/u);
    session.handle.dispose();
  });

  it("delivers the final tail after a pressure burst through the bounded native-to-JS channel", async () => {
    const bytes = 16 * 1024 * 1024;
    const session = collect(node([
      "const fs = require('node:fs');",
      `const block = Buffer.alloc(${bytes}, 0x70);`,
      "let offset = 0;",
      "while (offset < block.length) offset += fs.writeSync(1, block, offset);",
      "fs.writeSync(1, Buffer.from('PRESSURE_SENTINEL'));",
    ].join("")));
    await Promise.all([session.exit, session.handle.outputEnded]);
    const output = Buffer.concat(session.chunks);
    const sentinel = Buffer.from("PRESSURE_SENTINEL");
    expect(output.length).toBe(bytes + sentinel.length);
    expect(output.subarray(0, bytes).every((byte) => byte === 0x70)).toBe(true);
    expect(output.subarray(bytes).equals(sentinel)).toBe(true);
    expect(session.handle.sawRealEof).toBe(true);
    session.handle.dispose();
  });

  it("can dispose from an output callback while the bounded channel is under pressure", async () => {
    const handle = spawnPty({
      command: node([
        "const fs = require('node:fs');",
        "const block = Buffer.alloc(64 * 1024, 0x71);",
        "for (;;) fs.writeSync(1, block);",
      ].join("")),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    await new Promise<void>((resolve) => {
      handle.onData(() => {
        handle.dispose();
        resolve();
      });
    });
    expect(handle.sawRealEof).toBe(false);
  });

});

describe.skipIf(process.platform === "win32")("the Termwright-owned POSIX PTY", () => {

  it("changes the kernel PTY size without a scheduling delay", async () => {
    const session = collect(node([
      "process.stdin.setRawMode(true);",
      "process.stdin.resume();",
      "process.stdout.write('READY');",
      "process.stdin.once('data', () => {",
      "const { spawnSync } = require('node:child_process');",
      "const size = spawnSync('stty', ['size'], { encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] }).stdout.trim();",
      "process.stdout.write('SIZE=' + size);",
      "process.exit(0);",
      "});",
    ].join("")));
    await waitForText(session.handle, session.chunks, "READY");
    expect(session.handle.resize(132, 43)).toBe(true);
    session.handle.write(Buffer.from("?"));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toContain("SIZE=43 132");
    session.handle.dispose();
  });

  it("reports a delivered signal and drains the terminal to EOF", async () => {
    const session = collect(node([
      "process.stdout.write('READY');",
      "process.stdin.resume();",
    ].join("")));
    await waitForText(session.handle, session.chunks, "READY");
    expect(session.handle.signal("TERM")).toBe(true);
    const [status] = await Promise.all([session.exit, session.handle.outputEnded]);
    expect(status).toEqual({ code: null, signal: "SIGTERM" });
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.treeState()).toBe("gone");
    session.handle.dispose();
  });

  it("cancels a silent live session through owned wake descriptors", async () => {
    const session = collect(node("process.stdin.resume();"));
    session.handle.dispose();
    await session.handle.outputEnded;
    expect(session.handle.sawRealEof).toBe(false);
    expect(session.handle.endReason).toBeUndefined();
    expect(session.handle.treeState()).toBe("unsupported");
  });

  it("kills descendants at the unreaped root boundary so they cannot hold the PTY open", async () => {
    const session = collect(node([
      "const { spawn } = require('node:child_process');",
      "const child = spawn(process.execPath, ['-e', 'process.stdin.resume()'], { stdio: 'inherit' });",
      "process.stdout.write('CHILD=' + child.pid);",
      "child.unref();",
    ].join("")));
    await Promise.all([session.exit, session.handle.outputEnded]);
    expect(session.text()).toMatch(/CHILD=\d+/u);
    expect(session.handle.sawRealEof).toBe(true);
    expect(session.handle.treeState()).toBe("gone");
    session.handle.dispose();
  });
});
