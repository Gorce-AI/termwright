import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const project = { name: 'demo', root: '/repo', branch: 'main', version: '0.1.0' };
import { buildCrashedFixtureTrace, buildFixtureTrace } from './__fixtures__/build-trace.js';
import { INLINE_PAYLOAD_KEY, InlineDataSource, type InlinePayload } from './data-source.js';
import { buildInlinePayload, renderInlineHtml, writeInlineReport } from './inline-report.js';

const outDir = async (): Promise<string> => mkdtemp(join(tmpdir(), 'tw-report-'));

/** A minimal built app, so these tests do not depend on `pnpm build`. */
async function fakeApp(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'tw-app-'));
  const { writeFile, mkdir } = await import('node:fs/promises');
  await mkdir(join(directory, 'assets'), { recursive: true });
  await writeFile(join(directory, 'assets', 'app.js'), 'console.log("viewer", "./assets/icon.svg");\n', 'utf8');
  await writeFile(join(directory, 'assets', 'app.css'), '.pane { color: red }\n', 'utf8');
  await writeFile(join(directory, 'assets', 'icon.svg'), '<svg viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>\n', 'utf8');
  await writeFile(
    join(directory, 'index.html'),
    '<!doctype html><html><head><link rel="stylesheet" href="/assets/app.css"></head>' +
      '<body><script type="module" src="/assets/app.js"></script></body></html>',
    'utf8',
  );
  return directory;
}

describe('the payload a report carries', () => {
  it('holds everything the viewer needs to replay without a server', async () => {
    const { payload } = await buildInlinePayload(await buildFixtureTrace());

    expect(payload.state.mode).toBe('post-mortem');
    expect(payload.state.trace?.durationMs).toBeGreaterThan(0);
    expect(payload.frames.frames.length).toBeGreaterThan(0);
    expect(payload.commands.commands.length).toBeGreaterThan(0);
    expect(payload.logs.available).toBe(true);
  });

  it('answers the viewer’s questions from memory', async () => {
    const { payload } = await buildInlinePayload(await buildFixtureTrace());
    const source = new InlineDataSource(payload);

    // The same three calls `loadArchive` makes against the server.
    expect((await source.traceCommands()).commands.length).toBeGreaterThan(0);
    expect((await source.traceFrames()).frames.length).toBeGreaterThan(0);
    expect((await source.traceLogs({ after: 0 })).records.length).toBeGreaterThan(0);
  });

  it('cuts to a budget and says what it cut', async () => {
    const full = await buildInlinePayload(await buildFixtureTrace());
    const tight = await buildInlinePayload(await buildFixtureTrace(), { budgetBytes: 900 });

    expect(tight.cut.frames + tight.cut.logs).toBeGreaterThan(0);
    expect(tight.payload.frames.frames.length).toBeLessThan(full.payload.frames.frames.length);
    // A cut recording must say so: a replay that stops early otherwise reads as
    // a program that stopped early.
    expect(tight.payload.frames.truncated).toBe(true);
  });

  it('keeps the start of the recording and the end of the log', async () => {
    const { payload } = await buildInlinePayload(await buildFixtureTrace(), { budgetBytes: 2_000 });
    const frames = payload.frames.frames;
    const logs = payload.logs.records;
    // Frames replay in order, so only a cut at the end leaves a working screen;
    // logs are read to find out how something ended.
    if (frames.length > 0) expect(frames[0]?.t).toBe(0);
    if (logs.length > 1) expect(logs.at(-1)?.t).toBeGreaterThan(logs[0]?.t ?? 0);
    expect(payload.logs.hasMoreBefore).toBe(false); // nothing older is fetchable
  });

  it('carries the crash, warning included, because the panel renders it', async () => {
    const { payload } = await buildInlinePayload(await buildCrashedFixtureTrace());
    expect(payload.state.trace?.crash).not.toBeNull();
    expect(payload.state.trace?.crash?.screenTail.length).toBeGreaterThan(0);
  });
});

describe('the emitted file', () => {
  it('is one document with nothing left to fetch', async () => {
    const path = join(await outDir(), 'report.html');
    const result = await writeInlineReport(await buildFixtureTrace(), path, { appDir: await fakeApp() });

    const html = await readFile(result.path, 'utf8');
    expect(html).toContain('console.log("viewer"'); // the bundle, inlined
    expect(html).toContain('.pane { color: red }'); // the stylesheet, inlined
    expect(html).toContain(INLINE_PAYLOAD_KEY);
    expect(html).not.toMatch(/<script[^>]+src=/);
    expect(html).not.toMatch(/<link[^>]+stylesheet/);
    expect(html).toContain('data:image/svg+xml;base64,');
    expect(html).not.toContain('./assets/icon.svg');
    expect(result.bytes).toBeGreaterThan(0);
  });

  it('cannot be truncated by what a program logged', async () => {
    // A log line containing `</script>` would end the payload block early and
    // leave a page that renders half an archive.
    const payload: InlinePayload = {
      v: 1,
      state: { mode: 'post-mortem', project, sessions: [], trace: null, record: null },
      frames: { frames: [], truncated: false, durationMs: 0, revisions: [] },
      commands: { commands: [], incomplete: false },
      traceState: { timeMs: 0, castPrefixB64: '', columns: 80, rows: 24, revision: null, snapshot: null, step: null },
      logs: {
        records: [{ t: 0, source: 'adapter', level: 'error', message: 'oops </script><script>alert(1)</script>' }],
        hasMoreBefore: false,
        hasMoreAfter: false,
        total: 1,
        truncated: false,
        dropped: 0,
        available: true,
        sources: [],
        levels: {},
      },
    };

    const html = await renderInlineHtml(payload, await fakeApp());
    expect(html).not.toContain('</script><script>alert(1)');
    expect(html.match(/<script/g)).toHaveLength(2); // the payload and the bundle
  });

  it('says where to build the app rather than emitting a blank page', async () => {
    await expect(renderInlineHtml({} as InlinePayload, '/nowhere')).rejects.toThrow(/no built app/);
  });
});
