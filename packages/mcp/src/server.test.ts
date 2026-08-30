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
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { it as resourceAwareIt } from '@termwright/resource-broker/vitest';
import { nativePtyAvailable } from '@termwright/driver/experimental';
import { Client, connectClient } from './sdk-facade.js';
import { ERROR_META_KEY, serveInMemory } from './server.js';
import type { RunningServer } from './server.js';

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'driver',
  'test-fixtures',
);

function ptyAvailable(): boolean {
  return nativePtyAvailable();
}

interface ToolResult {
  readonly isError: boolean;
  readonly text: string;
  readonly content: readonly { type: string; data?: string; mimeType?: string }[];
  readonly data: Record<string, unknown>;
  /** Structured failure payload, carried in `_meta` (see server.ts). */
  readonly error:
    | {
        kind: string;
        suggestion?: string;
        candidates?: string[];
        crash?: { exit: { code: number | null }; screenTail: string[] };
      }
    | undefined;
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
        content?: { type: string; text?: string; data?: string; mimeType?: string }[];
        structuredContent?: Record<string, unknown>;
        _meta?: Record<string, unknown>;
      };
      const text = (result.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n');
      return {
        isError: result.isError === true,
        content: result.content ?? [],
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
  const it = resourceAwareIt.resources({ terminals: 1, traceWriters: 0 });
  it('walks launch -> snapshot -> click -> wait_for -> capture_since -> close', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);

    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const snapshot = await call('terminal.snapshot', { terminal });
    expect(snapshot.isError, snapshot.text).toBe(false);
    expect(snapshot.data['semanticTree']).toBe('available');
    expect(snapshot.text).toMatch(/^Terminal t1 60x10 revision \d+$/mu);
    expect(snapshot.text).toContain('semanticTree: available');
    expect(snapshot.text).toMatch(
      /dialog "Permission" ref=semantic:n1@\d+ bounds=\(0,0,40,2\) modal/u,
    );
    expect(snapshot.text).toMatch(
      / {2}button "Approve" ref=semantic:n2@\d+ bounds=\(1,2,9,1\) focused/u,
    );
    expect(snapshot.text).toContain('visible text:');

    const refs = snapshot.data['refs'] as { ref: string; name: string }[];
    const reject = refs.find((entry) => entry.name === 'Reject');
    expect(reject).toBeDefined();
    const cursor = snapshot.data['revision'] as number;

    const invalidSemanticAction = await call('terminal.fill', {
      terminal,
      ref: `screen:0,0,1,1@${cursor}`,
      text: 'must-not-be-sent',
    });
    expect(invalidSemanticAction.isError).toBe(true);
    expect(invalidSemanticAction.text).toMatch(/requires a semantic target/u);

    const checkpoint = await call('terminal.checkpoint', { terminal });
    expect(checkpoint.isError, checkpoint.text).toBe(false);
    expect(checkpoint.data).toMatchObject({
      terminal,
      contractId: expect.any(String),
      sequence: expect.any(Number),
    });

    const explanation = await call('terminal.actionability', {
      terminal,
      ref: reject?.ref,
      action: 'click',
    });
    expect(explanation.isError, explanation.text).toBe(false);
    expect(explanation.data).toMatchObject({
      actionable: true,
      strategy: 'authoritative-pointer-region',
      contractId: expect.any(String),
      requirements: expect.arrayContaining([
        expect.objectContaining({
          kind: 'pointer-input',
          verdict: 'satisfied',
          observation: 'known',
        }),
        expect.objectContaining({
          kind: 'mouse-input-enabled',
          verdict: 'satisfied',
          observation: 'known',
        }),
        expect.objectContaining({
          kind: 'receives-pointer',
          verdict: 'satisfied',
          observation: 'known',
          evidence: expect.objectContaining({
            strength: 'authoritative',
            providerId: expect.any(String),
          }),
        }),
      ]),
    });

    const clicked = await call('terminal.click', {
      terminal,
      ref: reject?.ref,
      modifiers: ['control', 'shift', 'alt'],
    });
    expect(clicked.isError, clicked.text).toBe(false);
    expect(clicked.data['ok']).toBe(true);
    expect(clicked.data['action']).toMatchObject({
      kind: 'click',
      strategy: 'authoritative-pointer-region',
      contractId: expect.any(String),
      operations: [
        { device: 'mouse', kind: 'down', modifiers: ['shift', 'alt', 'control'] },
        { device: 'mouse', kind: 'up', modifiers: ['shift', 'alt', 'control'] },
      ],
      requirements: expect.any(Array),
      physicalEvidence: expect.objectContaining({
        strength: 'authoritative',
        providerId: expect.any(String),
      }),
    });

    const waited = await call('terminal.wait_for', {
      terminal,
      wait: 'text',
      text: 'CLICKED reject',
    });
    expect(waited.isError, waited.text).toBe(false);

    // PTY text and semantic frames travel over independent channels. The text
    // wait proves the visual result, while this explicit semantic postcondition
    // proves that the paired tree describing the click has committed. Inferring
    // the latter from text would race the semantic socket on fast hosts.
    const focused = await call('terminal.wait_for', {
      terminal,
      wait: 'focused',
      testId: 'reject',
    });
    expect(focused.isError, focused.text).toBe(false);

    // capture_since now compares two causally established observations and
    // must preserve both visual and semantic changes.
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

  it('re-resolves a stable ref after its original revision was superseded', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const snapshot = await call('terminal.snapshot', { terminal });
    const refs = snapshot.data['refs'] as { ref: string; name: string }[];
    const reject = refs.find((entry) => entry.name === 'Reject');
    expect(reject).toBeDefined();
    const mintedAt = snapshot.data['semanticRevision'] as number;
    expect(mintedAt).toBeGreaterThan(0);

    // Tab re-renders the fixture, which publishes a new semantic revision.
    await call('terminal.press', { terminal, keys: 'Tab' });

    // Wait on the target's canonical focused Condition. This is the causal
    // child consequence of Tab and is driven by semantic revisions; polling a
    // snapshot made this test depend on scheduler speed on slow ConPTY hosts.
    const focused = await call('terminal.wait_for', {
      terminal,
      wait: 'focused',
      ref: reject?.ref,
      timeout: 15_000,
    });
    expect(focused.isError, focused.text).toBe(false);
    const now = await call('terminal.snapshot', { terminal });
    expect(now.data['semanticRevision']).toBeGreaterThan(mintedAt);

    // Reject was unfocused when this ref was minted and becomes focused in the
    // next revision. A targeted keyboard action proves stable re-resolution
    // without depending on platform-specific pointer-mode visibility.
    const pressed = await call('terminal.press', { terminal, ref: reject?.ref, keys: 'Enter' });
    expect(pressed.isError, pressed.text).toBe(false);
    expect(pressed.data['ref']).toMatch(/^semantic:n3@\d+$/u);
    expect(pressed.data['ref']).not.toBe(reject?.ref);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'ACTIVATED reject' });
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

  it('attaches a PNG of the live screen when asked, keeping the text intact', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'Permission required' });

    const shot = await call('terminal.snapshot', { terminal, screenshot: true });
    expect(shot.isError, shot.text).toBe(false);
    expect(shot.text).toContain('semanticTree: available');

    const image = shot.content.find((part) => part.type === 'image');
    expect(image?.mimeType).toBe('image/png');
    const bytes = Buffer.from(image?.data ?? '', 'base64');
    expect([...bytes.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);

    const described = shot.data['screenshot'] as { width: number; height: number };
    expect(described.width).toBeGreaterThan(0);
    expect(described.height).toBeGreaterThan(0);

    const plain = await call('terminal.snapshot', { terminal });
    expect(plain.content.every((part) => part.type === 'text')).toBe(true);
  });

  it('reports a crash from capabilities and snapshot instead of a bare closed session', async () => {
    const { call } = await connectSession();
    // A program that prints a panic and dies on its own — nobody asked it to.
    const launched = await call('terminal.launch', {
      command: [
        process.execPath,
        '-e',
        'process.stdout.write("Error: boom\\r\\n  at thing (app.js:3:9)\\r\\n"); process.exit(7)',
      ],
      columns: 60,
      rows: 10,
    });
    const terminal = launched.data['terminal'] as string;
    await call('terminal.wait_for', { terminal, wait: 'exit', timeout: 10_000 });

    const caps = await call('terminal.capabilities', { terminal });
    expect(caps.isError, caps.text).toBe(false);
    const crash = caps.data['crash'] as { exit: { code: number }; screenTail: string[] };
    expect(crash.exit.code).toBe(7);
    expect(crash.screenTail.join('\n')).toContain('Error: boom');
    expect(caps.text).toContain('crash: the program exited on its own');
    expect(caps.text).toContain('screen tail:');

    const shot = await call('terminal.snapshot', { terminal });
    expect((shot.data['crash'] as { exit: { code: number } }).exit.code).toBe(7);
  });

  it('hands an action that failed because the program died the crash behind it', async () => {
    const { call } = await connectSession();
    const launched = await call('terminal.launch', {
      command: [process.execPath, '-e', 'process.stdout.write("dying\\r\\n"); process.exit(4)'],
      columns: 40,
      rows: 6,
    });
    const terminal = launched.data['terminal'] as string;
    await call('terminal.wait_for', { terminal, wait: 'exit', timeout: 10_000 });

    // Without the crash this reads as a plain timeout, which would tell an
    // agent to wait longer for a program that is never coming back.
    const result = await call('terminal.wait_for', {
      terminal,
      wait: 'text',
      text: 'never appears',
      timeout: 500,
    });

    expect(result.isError).toBe(true);
    expect(result.error?.crash).toBeDefined();
    expect(result.error?.crash?.exit.code).toBe(4);
    expect(result.text).toContain('crash: the program exited on its own');
    expect(result.text).toContain('dying');
  });

  it('leaves a healthy session crash-free', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    const caps = await call('terminal.capabilities', { terminal });
    expect(caps.data['crash']).toBeUndefined();
    expect(caps.text).not.toContain('crash:');
  });

  it('follows an application log file and reports it with capture_since', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'termwright-mcp-logs-'));
    const logPath = join(directory, 'app.log');
    await writeFile(logPath, '', 'utf8');

    const { call } = await connectSession();
    // The program writes to its log after the terminal is already up, which is
    // the case that matters: the screen says nothing, the log explains why.
    const launched = await call('terminal.launch', {
      command: [
        process.execPath,
        '-e',
        `const { appendFileSync } = require('node:fs');
         process.stdout.write('working...\\r\\n');
         setTimeout(() => {
           appendFileSync(${JSON.stringify(logPath)}, 'ERROR upstream refused the token\\n');
           process.stdout.write('done\\r\\n');
         }, 150);
         setTimeout(() => process.exit(0), 3000);`,
      ],
      columns: 50,
      rows: 8,
      logs: [{ path: logPath, label: 'app' }],
    });
    expect(launched.isError, launched.text).toBe(false);
    const terminal = launched.data['terminal'] as string;

    const first = await call('terminal.snapshot', { terminal });
    const cursor = first.data['revision'] as number;
    await call('terminal.wait_for', { terminal, wait: 'text', text: 'done', timeout: 10_000 });

    // A followed file is polled, so the line lands a beat after the screen said
    // "done" — measured at roughly one poll interval. Re-asking with the SAME
    // cursor is lossless, because the window is anchored to the baseline's log
    // sequence rather than to when the call happened; this is exactly what an
    // agent polling after an action does.
    let since = await call('terminal.capture_since', { terminal, cursor });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const found = (since.data['logs'] as { message: string }[]).some((entry) =>
        entry.message.includes('upstream refused the token'),
      );
      if (found) break;
      await new Promise((resolve) => setTimeout(resolve, 25));
      since = await call('terminal.capture_since', { terminal, cursor });
    }

    expect(since.isError, since.text).toBe(false);
    const logs = since.data['logs'] as { message: string; label?: string }[];
    expect(logs.some((entry) => entry.message.includes('upstream refused the token'))).toBe(true);
    expect(logs[0]?.label).toBe('app');
    expect(since.data['logsOmitted']).toBe(0);
    expect(since.data['logCursor']).toBeGreaterThan(0);
    expect(since.text).toContain('upstream refused the token');

    await rm(directory, { recursive: true, force: true });
  });

  it('reports no logs for a session that follows none', async () => {
    const { call } = await connectSession();
    const terminal = await launchSemantic(call);
    const snapshot = await call('terminal.snapshot', { terminal });
    const since = await call('terminal.capture_since', {
      terminal,
      cursor: snapshot.data['revision'],
    });

    expect(since.data['logs']).toEqual([]);
    expect(since.data['logsOmitted']).toBe(0);
    expect(since.text).toContain('logs: none');
  });

  resourceAwareIt.resources({ terminals: 2, traceWriters: 0 })(
    'keeps one session’s terminals invisible to another',
    async () => {
      const first = await connectSession();
      const second = await connectSession();
      const terminal = await launchSemantic(first.call);

      const foreign = await second.call('terminal.snapshot', { terminal });
      expect(foreign.isError).toBe(true);
      expect(foreign.error?.kind).toBe('no-session');

      // The second session numbers its own terminals from t1 as well.
      const own = await launchSemantic(second.call);
      expect(own).toBe(terminal);
    },
  );
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
