import { describe, expect, it } from 'vitest';
import { conPtyAvailable, spawnConPty, type ConPtyHandle } from './index.js';

/**
 * The real backend, on the only platform that has one.
 *
 * These are the cases the campaign calls mandatory, and each of them is a
 * property no timer can establish: that the stream ends because the pipe
 * ended, that a descendant outliving its parent still gets its output
 * delivered, and that the tree is empty because the job says so.
 */
const windows = process.platform === 'win32' && conPtyAvailable();

function collect(handle: ConPtyHandle): { text(): string } {
  const chunks: Uint8Array[] = [];
  handle.onData((data) => chunks.push(Uint8Array.from(data)));
  return {
    text(): string {
      return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8');
    },
  };
}

function node(script: string): readonly string[] {
  return [process.execPath, '-e', script];
}

const environment = (): Readonly<Record<string, string>> => {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) env[key] = value;
  }
  env['TERM'] = 'xterm-256color';
  return env;
};

describe.skipIf(!windows)('ConPTY backend', { timeout: 30_000 }, () => {
  it('ends the stream on a real pipe EOF and delivers the last byte first', async () => {
    const handle = spawnConPty({
      command: node('process.stdout.write("A".repeat(4096) + "\\r\\nFINAL_SENTINEL\\r\\n")'),
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    await handle.outputEnded;
    // The stream ended because the pipe ended, and everything written before
    // that is already here — the ordering is the point of the single channel.
    expect(handle.sawRealEof).toBe(true);
    expect(output.text()).toContain('FINAL_SENTINEL');
    handle.dispose();
  });

  it('keeps the stream open for a descendant that outlives its root', async () => {
    // The root exits immediately; the grandchild holds the pseudoconsole and
    // prints afterwards. A session that finished at root exit would lose it.
    const script = [
      'const { spawn } = require("node:child_process");',
      'spawn(process.execPath, ["-e", "setTimeout(() => process.stdout.write(\\"FINAL_CHILD_MARKER\\\\r\\\\n\\"), 400)"], { stdio: "inherit", detached: false });',
      'process.exit(0);',
    ].join('');
    const handle = spawnConPty({
      command: node(script),
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    const rootExit = new Promise<void>((resolve) => { handle.onExit(() => resolve()); });
    await rootExit;
    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    expect(output.text()).toContain('FINAL_CHILD_MARKER');
    handle.dispose();
  });

  it('drives a child that never writes anything', async () => {
    // No first-output gate: the session is usable from the moment it exists,
    // so input, resize and termination all work before a silent child speaks.
    const handle = spawnConPty({
      command: node('process.stdin.resume(); process.stdin.on("data", () => process.exit(0));'),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    expect(handle.resize(120, 40)).toBe(true);
    handle.write(Buffer.from('x'));
    const exited = new Promise<void>((resolve) => { handle.onExit(() => resolve()); });
    await exited;
    await handle.outputEnded;
    handle.dispose();
  });

  it('reassembles a codepoint split across reads', async () => {
    // Emoji byte-by-byte with pauses, so the split lands inside the sequence.
    const script = [
      'const bytes = Buffer.from("é😀家\\r\\n", "utf8");',
      'let index = 0;',
      'const timer = setInterval(() => {',
      '  if (index >= bytes.length) { clearInterval(timer); process.exit(0); }',
      '  else process.stdout.write(bytes.subarray(index, index + 1)); index += 1;',
      '}, 5);',
    ].join('');
    const handle = spawnConPty({ command: node(script), env: environment(), columns: 80, rows: 24 });
    const output = collect(handle);
    await handle.outputEnded;
    const text = output.text();
    expect(text).toContain('é');
    expect(text).toContain('😀');
    expect(text).toContain('家');
    expect(text).not.toContain('�');
    handle.dispose();
  });

  it('reports its tree empty only after the job says so', async () => {
    const handle = spawnConPty({
      command: node('setInterval(() => {}, 1000);'),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    expect(handle.activeProcesses()).toBeGreaterThan(0);
    handle.terminateTree();
    await handle.outputEnded;
    // Queried, not inferred: the job object is the owner, so this is a fact
    // about membership rather than a guess from a process-id snapshot.
    expect(handle.activeProcesses()).toBe(0);
    handle.dispose();
  });

  it('survives a hard kill in the middle of a large burst', async () => {
    const handle = spawnConPty({
      command: node('setInterval(() => process.stdout.write("f".repeat(8192)), 1);'),
      env: environment(),
      columns: 200,
      rows: 50,
    });
    await new Promise<void>((resolve) => { handle.onData(() => resolve()); });
    handle.terminateTree();
    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    handle.dispose();
  });

  it('reports whether this Windows can release its pseudoconsole', () => {
    const handle = spawnConPty({
      command: node('process.exit(0);'),
      env: environment(),
      columns: 80,
      rows: 24,
    });
    // Recorded rather than asserted: which path a machine takes is evidence
    // the certification matrix needs, not something a test should require.
    expect(typeof handle.releaseSupported).toBe('boolean');
    handle.dispose();
  });
});
