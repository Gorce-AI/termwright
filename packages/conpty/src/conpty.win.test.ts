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

/**
 * Waits for a marker in the stream, giving up after a budget.
 *
 * The budget is a diagnostic deadline, never a verdict: a test that reaches it
 * fails with what it did see, so the report names the missing thing instead of
 * saying only that time ran out. Nothing here treats elapsed time as evidence
 * of a state.
 */
async function waitForMarker(
  handle: ConPtyHandle,
  output: { text(): string },
  pattern: RegExp,
  budgetMs: number,
): Promise<RegExpMatchArray | undefined> {
  const existing = pattern.exec(output.text());
  if (existing !== null) return existing;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      release();
      resolve(undefined);
    }, budgetMs);
    const release = handle.onData(() => {
      const match = pattern.exec(output.text());
      if (match === null) return;
      clearTimeout(timer);
      release();
      resolve(match);
    });
  });
}

/** Whether the operating system still has this process, asked of the OS. */
function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
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
    // ERROR_BROKEN_PIPE is the ordinary end once the last client detaches; 0
    // is a clean zero-byte read. Anything else means the stream ended for a
    // reason, and naming it here is what makes that visible.
    expect([0, 109]).toContain(handle.endReason);
    expect(output.text()).toContain('FINAL_SENTINEL');
    handle.dispose();
  });

  it('keeps the stream open for a descendant that outlives its root', async () => {
    // The root exits immediately; the grandchild holds the pseudoconsole and
    // prints afterwards. A session that finished at root exit would lose it.
    // The root outlives the spawn by a short while on purpose. Exiting in the
    // same tick made every outcome look alike: the descendant's first word,
    // its death and the console's teardown all landed after the last thing the
    // test could observe. Staying alive briefly puts the descendant's start on
    // one side of root exit and its final word on the other, so which of them
    // survives is a fact about this backend rather than about scheduling.
    const script = [
      'const { spawn } = require("node:child_process");',
      'const grandchild = "process.stdout.write(\\"CHILD_UP\\\\r\\\\n\\"); setTimeout(() => process.stdout.write(\\"FINAL_CHILD_MARKER\\\\r\\\\n\\"), 400);";',
      'let report;',
      'try {',
      '  const child = spawn(process.execPath, ["-e", grandchild], { stdio: "inherit", detached: false });',
      '  report = child.pid === undefined ? "SPAWN_PID=none" : "SPAWN_PID=" + child.pid;',
      '  child.on("exit", (code, signal) => process.stdout.write("CHILD_EXIT=" + code + "/" + signal + "\\r\\n"));',
      '  child.on("error", (failure) => process.stdout.write("CHILD_ERROR=" + failure.message.replace(/\\s+/g, "_") + "\\r\\n"));',
      '} catch (error) { report = "SPAWN_ERROR=" + error.message.replace(/\\s+/g, "_"); }',
      'process.stdout.write(report + "\\r\\n");',
      'setTimeout(() => process.exit(0), 200);',
    ].join('');
    const handle = spawnConPty({
      command: node(script),
      env: environment(),
      columns: 100,
      rows: 30,
    });
    const output = collect(handle);
    // Registered before anything is awaited. The root exits within
    // milliseconds, so a listener attached after the first await can miss the
    // event entirely and wait for something that has already happened.
    let rootExited = false;
    const rootExit = new Promise<void>((resolve) => {
      handle.onExit(() => {
        rootExited = true;
        resolve();
      });
    });
    // `CHILD_UP` is the descendant's own voice: it proves the grandchild ran
    // and that its output reaches this pseudoconsole, which is what separates
    // a descendant that was never heard from one that was never delivered.
    const up = await waitForMarker(handle, output, /CHILD_UP|CHILD_(?:EXIT|ERROR)=\S+/u, 10_000);
    expect(
      up?.[0],
      `descendant never announced itself; root exited: ${rootExited}, ` +
        `saw ${JSON.stringify(output.text())}`,
    ).toBe('CHILD_UP');
    const spawned = /SPAWN_(?:PID|ERROR)=(\S+)/u.exec(output.text());
    // Counted while the root is demonstrably still alive and the descendant
    // has just spoken. Two members means the job holds them both and whatever
    // kills the descendant comes later; one means it was never contained, and
    // then the console closing at root exit is this backend killing it.
    const membersWithRootAlive = handle.activeProcesses();
    await rootExit;
    // Asked of the operating system and of the job separately, because the two
    // answers mean different things. A live descendant outside the job is a
    // containment bug in this backend; a dead one this early means it did not
    // survive its parent, and the missing marker follows from that.
    const childPid = Number(spawned?.[1]);
    const alive = Number.isFinite(childPid) ? processAlive(childPid) : false;
    expect(
      handle.activeProcesses(),
      `descendant ${spawned?.[0] ?? 'unreported'}, alive in the OS: ${alive}, ` +
        `job members while the root was alive: ${membersWithRootAlive}, ` +
        `marker already delivered: ${output.text().includes('FINAL_CHILD_MARKER')}`,
    ).toBeGreaterThan(0);
    await handle.outputEnded;
    expect(handle.sawRealEof).toBe(true);
    expect(output.text()).toContain('FINAL_CHILD_MARKER');
    handle.dispose();
  });

  it('drives a child that never writes anything', async () => {
    // No first-output gate: the session is usable from the moment it exists,
    // so input, resize and termination all work before a silent child speaks.
    // The child reports what the console handed it before it waits. A child
    // whose standard input is not a terminal never sees a keystroke no matter
    // what the host writes, and that is a different fault from input failing
    // to travel — one belongs to process creation, the other to the pipe.
    const script = [
      'const tty = require("node:tty");',
      'process.stdout.write("STDIN_TTY=" + tty.isatty(0) + ",STDOUT_TTY=" + tty.isatty(1) + "\\r\\n");',
      'process.stdin.resume();',
      'process.stdin.on("data", () => process.exit(0));',
    ].join('');
    const handle = spawnConPty({ command: node(script), env: environment(), columns: 80, rows: 24 });
    const output = collect(handle);
    expect(handle.resize(120, 40)).toBe(true);
    const spoke = await waitForMarker(handle, output, /STDIN_TTY=(\w+),STDOUT_TTY=(\w+)/u, 10_000);
    const processes = handle.activeProcesses();
    expect(processes, `child never reported its handles; saw ${JSON.stringify(output.text())}`)
      .toBeGreaterThan(0);
    // A whole line, not a bare keystroke. A console that has not been put into
    // raw mode delivers input a line at a time, so a lone `x` sits in the
    // line buffer and the child waits for a carriage return that never comes —
    // which is what a silent child looks like from the outside. Sending the
    // return makes the input complete under either mode.
    // Armed before the write, because the child can be gone before the next
    // line of this test runs and a listener attached afterwards would wait for
    // an event that already happened.
    const exit = new Promise<'exit' | 'budget'>((resolve) => {
      const timer = setTimeout(() => {
        release();
        resolve('budget');
      }, 10_000);
      const release = handle.onExit(() => {
        clearTimeout(timer);
        release();
        resolve('exit');
      });
    });
    handle.write(Buffer.from('x\r'));
    const exited = await exit;
    // Naming which wait ran out is the whole difference between a report that
    // can be acted on and one that says only that something took too long.
    expect(
      exited,
      `child never exited after input; it reported ${spoke?.[0] ?? 'nothing'}, ` +
        `job members before the write: ${processes}, now: ${handle.activeProcesses()}`,
    ).toBe('exit');
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
