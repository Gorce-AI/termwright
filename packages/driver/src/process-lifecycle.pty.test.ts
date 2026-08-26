import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveDefaultPtyBackend } from './backend-selection.js';
import { NATIVE_PTY_BACKEND_NAME } from './native-pty-backend.js';
import { launchTerminal } from './session.js';
import type { TerminalHarness } from './api.js';

const fixtures = fileURLToPath(new URL('../test-fixtures/', import.meta.url));

// These tests own their terminals directly rather than through the fixture,
// so a failed assertion would leave one alive. The host treats an attempt that
// ends holding a lease as a leaked resource and fails the whole run as
// infrastructure — turning one wrong assertion into a result that says nothing
// about which test was wrong.
const opened: TerminalHarness[] = [];
const emergencyPids = new Set<number>();

async function open(...args: Parameters<typeof launchTerminal>): Promise<TerminalHarness> {
  const terminal = await launchTerminal(...args);
  opened.push(terminal);
  return terminal;
}

afterEach(async () => {
  while (opened.length > 0) await opened.pop()?.close().catch(() => undefined);
  for (const pid of emergencyPids) {
    try { process.kill(pid, 'SIGKILL'); } catch { /* already gone */ }
  }
  emergencyPids.clear();
});

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
    const terminal = await open({
      command: [process.execPath, `${fixtures}/process-tree-natural-exit.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('NATURAL TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);
    emergencyPids.add(grandchildPid);

    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    emergencyPids.delete(grandchildPid);
    await terminal.close();
  });

  it('escalates and removes a child plus grandchild that ignore graceful shutdown', async () => {
    const terminal = await open({
      command: [process.execPath, `${fixtures}/process-tree-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('PROCESS TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);
    emergencyPids.add(grandchildPid);
    expect(alive(parentPid)).toBe(true);
    expect(alive(grandchildPid)).toBe(true);

    await terminal.close();
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    emergencyPids.delete(grandchildPid);
    expect((await terminal.exit).signal).toBe('SIGKILL');
  });
});

describe('PTY output lifecycle', { timeout: 20_000 }, () => {
  it('parses a saturated output stream through its causal terminal acknowledgement', async () => {
    const terminal = await open({
      command: [process.execPath, `${fixtures}/output-flood-exit.mjs`],
      envMode: 'inherit',
      rows: 30,
      columns: 100,
      scrollbackLines: 20_000,
    });
    // Weighed as it arrives. The fixture stays alive through a DSR round trip,
    // so its exit no longer races Linux POLLHUP with unread PTY output.
    let delivered = 0;
    let sentinelDelivered = false;
    terminal.events.on('output', ({ data }) => {
      delivered += data.length;
      if (Buffer.from(data).includes('FINAL OUTPUT SENTINEL')) sentinelDelivered = true;
    });
    await terminal.waitForExit();
    expect(
      terminal.screen().text(),
      `bytes delivered to the driver: ${delivered}, ` +
        `the sentinel among them: ${sentinelDelivered}`,
    ).toContain('FINAL OUTPUT SENTINEL');
    // The Termwright-owned reader drains the native source to EOF on every
    // supported platform.
    const { backend } = await resolveDefaultPtyBackend();
    expect(
      terminal.diagnostics().some((entry) => entry.code === 'degraded-output-drain'),
      `backend in use: ${backend.name}`,
    ).toBe(backend.name !== NATIVE_PTY_BACKEND_NAME);
    await terminal.close();
  });

  it('keeps terminal Ctrl+C distinct from an operating-system signal', async () => {
    const terminal = await open({
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
  if (process.platform === 'win32') {
    it('retains output and exit from a native ConPTY child that finishes during listener attachment', async () => {
      const terminal = await open({
        command: [
          process.execPath,
          '-e',
          'process.stdout.write("NATIVE EARLY OUTPUT\\r\\n"); process.exit(23)',
        ],
        envMode: 'inherit',
      });

      expect(await terminal.waitForExit()).toEqual({ code: 23, signal: null });
      expect(terminal.screen().text()).toContain('NATIVE EARLY OUTPUT');
      await terminal.close();
    });
  }

  it('does not publish natural exit while a console descendant remains alive', async () => {
    const terminal = await open({
      command: [process.execPath, `${fixtures}/process-tree-natural-exit.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('NATURAL TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);
    emergencyPids.add(grandchildPid);

    expect(await terminal.waitForExit()).toEqual({ code: 0, signal: null });
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    emergencyPids.delete(grandchildPid);
    await terminal.close();
  });

  it('uses the ConPTY hard-kill mechanism for the complete console tree', async () => {
    const terminal = await open({
      command: [process.execPath, `${fixtures}/process-tree-app.mjs`],
      envMode: 'inherit',
    });
    await terminal.waitForText('PROCESS TREE READY');
    const match = /parent=(\d+) grandchild=(\d+)/u.exec(terminal.screen().text());
    expect(match).not.toBeNull();
    const parentPid = Number(match?.[1]);
    const grandchildPid = Number(match?.[2]);
    emergencyPids.add(grandchildPid);

    await terminal.close();
    expect(alive(parentPid)).toBe(false);
    expect(alive(grandchildPid)).toBe(false);
    emergencyPids.delete(grandchildPid);
    await terminal.exit;
  });

  it('rejects TERM instead of silently converting it to a hard kill', async () => {
    const terminal = await open({
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
