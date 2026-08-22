import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { launchTerminal } from './session.js';

const fixtures = fileURLToPath(new URL('../test-fixtures/', import.meta.url));

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ESRCH') return false;
    throw error;
  }
}

describe.skipIf(process.platform === 'win32')('POSIX process lifecycle', { timeout: 20_000 }, () => {
  it('reaps an owned process group when its root exits naturally first', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/process-tree-natural-exit.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('NATURAL TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);

    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    await terminal.close();
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
  });

  it('escalates and removes a child plus grandchild that ignore graceful shutdown', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/process-tree-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('PROCESS TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);
    expect(alive(parentPid)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    await terminal.close();
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    expect((await terminal.exit).signal).toBe('SIGKILL');
  });
});

describe('PTY output lifecycle', { timeout: 20_000 }, () => {
  it('parses all output through the EOF boundary before publishing exit', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/output-flood-exit.mjs`],
      envMode: 'inherit',
      rows: 30,
      columns: 100,
      scrollbackLines: 20_000,
    });
    await terminal.waitForExit();
    expect(terminal.screen().text()).toContain('FINAL OUTPUT SENTINEL');
    expect(terminal.diagnostics().some((entry) => entry.code === 'degraded-output-drain'))
      .toBe(process.platform === 'win32');
    await terminal.close();
  });

  it('keeps terminal Ctrl+C distinct from an operating-system signal', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/echo-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('READY');
    await terminal.press('Control+C');
    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    expect(terminal.screen().text()).toContain('BYE');
    await terminal.close();
  });
});

describe.skipIf(process.platform !== 'win32')('Windows process lifecycle', { timeout: 20_000 }, () => {
  it('does not publish natural exit while a console descendant remains alive', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/process-tree-natural-exit.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('NATURAL TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);

    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    await terminal.close();
  });

  it('uses the ConPTY hard-kill mechanism for the complete console tree', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/process-tree-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('PROCESS TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);

    await terminal.close();
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    await terminal.exit;
  });

  it('rejects TERM instead of silently converting it to a hard kill', async () => {
    const terminal = await launchTerminal({
      command: [process.execPath, `${fixtures}/echo-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('READY');
    await expect(terminal.signal('TERM')).rejects.toMatchObject({ code: 'unsupported-signal' });
    await terminal.press('q');
    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    await terminal.close();
  });
});
