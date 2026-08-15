/**
 * End-to-end tests: a real MCP client over `InMemoryTransport`, a real driver,
 * and the real fixtures from `packages/driver/test-fixtures`. Nothing here is
 * mocked — a click in this suite is a mouse report that the fixture parses.
 *
 * They skip themselves where no pseudo-terminal can be opened (sandboxed CI,
 * missing prebuild); set `TERMWRIGHT_SKIP_PTY=1` to skip them explicitly.
 */
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createNodePtyBackend } from '@termwright/driver';
import { Client, connectClient } from './sdk-facade.js';
import { ERROR_META_KEY, serveInMemory } from './server.js';
import type { RunningServer } from './server.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'driver', 'test-fixtures');

function ptyAvailable(): boolean {
  if (process.env['TERMWRIGHT_SKIP_PTY'] === '1') return false;
  try {
    const pty = createNodePtyBackend().spawn({
      command: [process.execPath, '-e', 'process.exit(0)'],
      env: {},
      columns: 20,
      rows: 4,
    });
    pty.dispose();
    return true;
  } catch {
    return false;
  }
}

interface ToolResult {
  readonly isError: boolean;
  readonly text: string;
  readonly data: Record<string, unknown>;
  /** Structured failure payload, carried in `_meta` (see server.ts). */
  readonly error: { kind: string; suggestion?: string; candidates?: string[] } | undefined;
}

const running: RunningServer[] = [];

/** A connected client talking to a fresh server, with its own session store. */
async function connectSession(storageDir?: string): Promise<{
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>;
}> {
  const server = await serveInMemory(storageDir === undefined ? {} : { storageDir });
  running.push(server);
  const client = new Client({ name: 'termwright-tests', version: '0.0.0' });
  await connectClient(client, server.clientTransport);

  return {
    call: async (name, args = {}): Promise<ToolResult> => {
      const result = (await client.callTool({ name, arguments: args })) as {
        isError?: boolean;
        content?: { type: string; text?: string }[];
        structuredContent?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      };
      const text = (result.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n');
      return {
        isError: result.isError === true,
        text,
        data: result.structuredContent ?? {},
        error: result._meta?.[ERROR_META_KEY] as ToolResult['error'],
      };
    },
  };
}

async function launchSemantic(
  call: (name: string, args?: Record<string, unknown>) => Promise<ToolResult>,
): Promise<string> {
  const launched = await call('terminal.launch', {
    command: [process.execPath, join(FIXTURES, 'semantic-app.mjs')],
    columns: 60,
    rows: 10,
  });
  expect(launched.isError, launched.text).toBe(false);
  return launched.data['terminal'] as string;
}

afterEach(async () => {
  while (running.length > 0) await running.pop()?.close();
});

describe.skipIf(!ptyAvailable())('the MCP server over a real driver', { timeout: 30_000 }, () => {
  it('walks launch -> snapshot -> click -> wait_for -> capture_since -> close', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);

    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const snapshot = await call('terminal.snapshot', { terminal });
    expect(snapshot.isError, snapshot.text).toBe(false);
    expect(snapshot.data['semanticTree']).toBe('available');
    expect(snapshot.text).toMatch(/^Terminal t1 60x10 revision \d+$/mu);
    expect(snapshot.text).toContain('semanticTree: available');
    expect(snapshot.text).toMatch(/dialog "Permission" ref=n1@\d+ bounds=\(0,0,40,2\) modal/u);
    expect(snapshot.text).toMatch(/ {2}button "Approve" ref=n2@\d+ bounds=\(1,2,9,1\) focused/u);
    expect(snapshot.text).toContain('visible text:');

    const refs = snapshot.data['refs'] as { ref: string; name: string }[];
    const reject = refs.find((entry) => entry.name === 'Reject');
    expect(reject).toBeDefined();
    const cursor = snapshot.data['revision'] as number;

    const clicked = await call('terminal.click', { terminal, ref: reject?.ref });
    expect(clicked.isError, clicked.text).toBe(false);
    expect(clicked.data['ok']).toBe(true);

    const waited = await call('terminal.wait_for', {
      terminal,
      wait: 'text',
      text: 'CLICKED reject',
    });
    expect(waited.isError, waited.text).toBe(false);

    const since = await call('terminal.capture_since', { terminal, cursor });
    expect(since.isError, since.text).toBe(false);
    const changedRows = since.data['changedRows'] as { row: number; text: string }[];
    expect(changedRows.some((row) => row.text.includes('CLICKED reject'))).toBe(true);
    const changed = since.data['changedSubtrees'] as { change: string; compact: string }[];
    expect(changed.length).toBeGreaterThan(0);
    expect(changed.some((entry) => entry.compact.includes('focused'))).toBe(true);

    const closed = await call('terminal.close', { terminal });
    expect(closed.isError, closed.text).toBe(false);
    expect(closed.data['ok']).toBe(true);
  });

  it('targets by role and by testId, and reports candidates when a locator is ambiguous', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const byRole = await call('terminal.query', { terminal, role: 'button', name: 'Approve' });
    expect(byRole.isError, byRole.text).toBe(false);
    expect(byRole.data['count']).toBe(1);

    const byTestId = await call('terminal.query', { terminal, testId: 'reject' });
    expect(byTestId.data['count']).toBe(1);

    const ambiguous = await call('terminal.click', { terminal, role: 'button', timeout: 1_000 });
    expect(ambiguous.isError).toBe(true);
    expect(ambiguous.error?.kind).toBe('ambiguous-locator');
    expect(ambiguous.error?.candidates?.length).toBeGreaterThan(1);
    expect(ambiguous.text).toContain('candidates:');
  });

  it('refuses a ref from a superseded revision with stale-snapshot', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const snapshot = await call('terminal.snapshot', { terminal });
    const refs = snapshot.data['refs'] as { ref: string; name: string }[];
    const approve = refs.find((entry) => entry.name === 'Approve');
    expect(approve).toBeDefined();

    // Tab re-renders the fixture, which publishes a new semantic revision.
    await call('terminal.press', { terminal, keys: 'Tab' });
    await call('terminal.wait_for', { terminal, wait: 'stable', timeout: 3_000 });

    const stale = await call('terminal.click', { terminal, ref: approve?.ref });
    expect(stale.isError).toBe(true);
    expect(stale.error?.kind).toBe('stale-snapshot');
    // The driver's own suggestion passes through verbatim; per-kind advice for
    // agents lives in the server instructions and in SKILL.md.
    expect(stale.error?.suggestion).toBeDefined();
    expect(stale.text.startsWith('error stale-snapshot:')).toBe(true);
  });

  it('writes the full dump to disk and returns only refs plus the path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-mcp-test-'));
    const { call } = await connectSession(directory);
    const terminal = await launchSemantic(call);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const full = await call('terminal.snapshot', { terminal, variant: 'full' });
    expect(full.isError, full.text).toBe(false);
    const dumpPath = full.data['dumpPath'] as string;
    expect(dumpPath.startsWith(directory)).toBe(true);
    expect(full.text).not.toContain('visible text:');

    const dump = JSON.parse(await readFile(dumpPath, 'utf8')) as {
      text: string;
      html: string;
      semantic: { nodes: readonly unknown[] } | null;
    };
    expect(dump.text).toContain('Permission required');
    expect(dump.html).toContain('<');
    const names = (dump.semantic?.nodes ?? []).map((node) => (node as { name?: string }).name);
    expect(names).toEqual(expect.arrayContaining(['Permission', 'Approve', 'Reject']));
  });

  it('keeps one session’s terminals invisible to another', async () => {
    const first = await connectSession();
    const second = await connectSession();
    const terminal = await launchSemantic(first.call);

    const foreign = await second.call('terminal.snapshot', { terminal });
    expect(foreign.isError).toBe(true);
    expect(foreign.error?.kind).toBe('no-session');

    // The second session numbers its own terminals from t1 as well.
    const own = await launchSemantic(second.call);
    expect(own).toBe(terminal);
  });
});

describe('argument validation', () => {
  it('rejects unknown terminals before touching the driver', async () => {
    const { call } = await connectSession();
    const result = await call('terminal.snapshot', { terminal: 'nope' });
    expect(result.isError).toBe(true);
    expect(result.error?.kind).toBe('no-session');
    expect(result.error?.suggestion).toContain('terminal.launch');
  });

  it('rejects a malformed ref as a usage error', async () => {
    const { call } = await connectSession();
    const result = await call('terminal.click', { terminal: 'nope', ref: 'not-a-ref' });
    expect(result.isError).toBe(true);
    expect(result.error?.kind).toBe('no-session');
  });

  it('rejects arguments zod cannot parse', async () => {
    const { call } = await connectSession();
    const result = await call('terminal.launch', { command: [] });
    expect(result.isError).toBe(true);
  });

  it('rejects a capture_since cursor the server never handed out', async () => {
    const { call } = await connectSession();
    const result = await call('terminal.capture_since', { terminal: 't1', cursor: 999 });
    expect(result.isError).toBe(true);
  });
});
