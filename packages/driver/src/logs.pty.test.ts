/**
 * Log tailing over a real PTY: a program writing to its own log file while the
 * session follows it. Skipped where no pseudo-terminal can be opened.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppLogEvent, SessionDiagnostic, TerminalHarness } from './api.js';
import { createNodePtyBackend } from './pty.js';
import { launchTerminal } from './session.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'test-fixtures');

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: { PATH: process.env['PATH'] ?? '' },
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

interface Harness {
  terminal: TerminalHarness;
  lines: AppLogEvent[];
  logDiagnostics: SessionDiagnostic[];
}

const open: TerminalHarness[] = [];
const directories: string[] = [];

afterEach(async () => {
  while (open.length > 0) await open.pop()?.close();
  while (directories.length > 0) {
    rmSync(directories.pop() ?? '', { recursive: true, force: true });
  }
});

async function launchWithLog(options: Record<string, unknown> = {}): Promise<Harness & { path: string }> {
  const directory = mkdtempSync(join(tmpdir(), 'termwright-logs-'));
  directories.push(directory);
  const path = join(directory, 'app.log');
  if (options['seed'] === true) writeFileSync(path, 'from a previous run\n');

  const terminal = await launchTerminal({
    command: [process.execPath, join(FIXTURES, 'log-app.mjs'), path],
    columns: 60,
    rows: 8,
    logs: [{ path, label: 'app' }],
    ...options,
  });
  open.push(terminal);

  const lines: AppLogEvent[] = [];
  const logDiagnostics: SessionDiagnostic[] = [];
  terminal.events.on('app-log', (entry) => lines.push(entry));
  terminal.events.on('diagnostic', (entry) => {
    if (entry.code === 'log-dropped' || entry.code === 'log-source') logDiagnostics.push(entry);
  });

  await terminal.waitForText('LOG APP READY');
  return { terminal, lines, logDiagnostics, path };
}

describe.skipIf(!ptyAvailable())('following a log file', { timeout: 20_000 }, () => {
  it('picks up a file the program creates after it started', async () => {
    const { terminal, lines } = await launchWithLog();

    await terminal.press('w');
    await terminal.press('w');

    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(2);
    expect(lines.map((entry) => entry.line)).toEqual(['hello 1', 'hello 2']);
    expect(lines[0]?.source).toBe('file');
    expect(lines[0]?.label).toBe('app');
    expect(lines[0]?.record).toBeUndefined();
    // Same clock as every other event on the session timeline.
    expect(lines[0]?.timeMs).toBeGreaterThan(0);
    expect(lines[1]?.timeMs).toBeGreaterThanOrEqual(lines[0]?.timeMs ?? 0);
  });

  it('does not replay a log that was already there', async () => {
    const { terminal, lines } = await launchWithLog({ seed: true });

    await terminal.press('w');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);
    expect(lines[0]?.line).toBe('hello 1');
    expect(lines.map((entry) => entry.line)).not.toContain('from a previous run');
  });

  it('starts over when the file is rotated, without failing', async () => {
    const { terminal, lines, logDiagnostics } = await launchWithLog();
    await terminal.press('w');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);

    await terminal.press('r');
    await terminal.waitForText('ROTATED');
    await terminal.press('w');

    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(2);
    expect(lines[1]?.line).toBe('hello 2');
    // A rotation reaches the tail as a rename, a momentary gap or a rewritten
    // head, depending on when the poll lands between the two syscalls. All three
    // restart the tail, and that — not the wording — is the promise.
    expect(logDiagnostics.map((entry) => entry.detail).join('\n')).toContain('restarting the tail');
  });

  it('starts over when the file is truncated', async () => {
    const { terminal, lines, logDiagnostics } = await launchWithLog();
    await terminal.press('w');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);

    await terminal.press('t');
    await terminal.waitForText('TRUNCATED');
    await terminal.press('w');

    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(2);
    expect(logDiagnostics.map((entry) => entry.detail).join('\n')).toContain('restarting the tail');
  });

  it('drops a flood instead of drowning the session, and says how much', async () => {
    const { terminal, lines, logDiagnostics } = await launchWithLog();

    await terminal.press('f');
    await expect
      .poll(() => logDiagnostics.some((entry) => entry.code === 'log-dropped'), { timeout: 8_000 })
      .toBe(true);

    const dropped = logDiagnostics.find((entry) => entry.code === 'log-dropped');
    expect(dropped?.detail).toMatch(/dropped \d+ lines/u);
    // Bounded, not unbounded: far fewer than the 2000 lines written.
    expect(lines.length).toBeLessThan(2_000);
    expect(lines.length).toBeGreaterThan(0);

    // The session itself is unaffected.
    await terminal.press('w');
    await terminal.waitForText('LOG APP READY');
    expect(terminal.crashReport()).toBeNull();
  });

  it('truncates a monstrous line instead of publishing it whole', async () => {
    const { terminal, lines } = await launchWithLog();

    await terminal.press('l');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBeGreaterThan(0);

    const line = lines[0]?.line ?? '';
    expect(line.startsWith('long xxx')).toBe(true);
    expect(line.length).toBeLessThanOrEqual(4 * 1024 + 1);
    expect(line.endsWith('…')).toBe(true);
  });

  it('narrates log lines under TERMWRIGHT_DEBUG', async () => {
    const captured: string[] = [];
    const restore = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array): boolean => {
      captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stderr.write;

    try {
      const { terminal, lines } = await launchWithLog({ debug: true });
      await terminal.press('w');
      await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);
    } finally {
      process.stderr.write = restore;
    }

    expect(captured.join('')).toContain('tw:app');
    expect(captured.join('')).toContain('app | hello 1');
  });

  it('stops following once the harness is closed', async () => {
    const { terminal, lines } = await launchWithLog();
    await terminal.press('w');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);

    await terminal.close();
    const afterClose = lines.length;
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(lines.length).toBe(afterClose);
  });
});

describe.skipIf(!ptyAvailable())('logs from an instrumented adapter', { timeout: 20_000 }, () => {
  async function launchSemantic(options: Record<string, unknown> = {}): Promise<Harness> {
    const terminal = await launchTerminal({
      command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
      columns: 60,
      rows: 10,
      semanticNegotiationMs: 5_000,
      ...options,
    });
    open.push(terminal);

    const lines: AppLogEvent[] = [];
    const logDiagnostics: SessionDiagnostic[] = [];
    terminal.events.on('app-log', (entry) => lines.push(entry));
    terminal.events.on('diagnostic', (entry) => {
      if (entry.code === 'log-dropped' || entry.code === 'log-source') logDiagnostics.push(entry);
    });
    await terminal.getByTestId('approve').resolve();
    return { terminal, lines, logDiagnostics };
  }

  it('negotiates the channel and publishes records on the session timeline', async () => {
    const { terminal, lines } = await launchSemantic();
    expect(terminal.capabilities().capabilities).toContain('logs');

    await terminal.press('g');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);

    const entry = lines[0];
    expect(entry?.source).toBe('adapter');
    expect(entry?.line).toBeUndefined();
    expect(entry?.record?.message).toBe('a single record');
    expect(entry?.record?.level).toBe('info');
    // The logger name becomes the label, so both sources read the same way.
    expect(entry?.label).toBe('fixture');

    // The record's own clock is epoch milliseconds; the event is rebased onto
    // the session timeline and can never land in the future or before the start.
    expect(entry?.record?.ts).toBeGreaterThan(1_600_000_000_000);
    expect(entry?.timeMs).toBeGreaterThan(0);
    expect(entry?.timeMs).toBeLessThan(60_000);
  });

  it('reports what the adapter dropped at the source, from the seq gap', async () => {
    const { terminal, lines, logDiagnostics } = await launchSemantic();
    await terminal.press('g');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(1);

    await terminal.press('S');
    await expect.poll(() => lines.length, { timeout: 5_000 }).toBe(2);

    const dropped = logDiagnostics.find((entry) => entry.code === 'log-dropped');
    expect(dropped?.detail).toContain('the adapter dropped 5 log records');
    expect(lines[1]?.record?.message).toBe('after a local drop');
  });

  it('enforces the budget again on arrival, and says so', async () => {
    const { terminal, lines, logDiagnostics } = await launchSemantic();

    await terminal.press('G');
    await expect
      .poll(() => logDiagnostics.some((entry) => entry.detail.includes('refused')), { timeout: 8_000 })
      .toBe(true);

    // Far fewer than the 400 records the fixture sent, and the session lives on.
    expect(lines.length).toBeLessThan(400);
    expect(lines.length).toBeGreaterThan(0);
    expect(await terminal.getByTestId('approve').textContent()).toBe('Approve');
  });
});
