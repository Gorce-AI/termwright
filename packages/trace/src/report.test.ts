import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FakeSession, node, snapshot } from './__fixtures__/fake-session.js';
import { generateHtmlReport } from './report.js';
import { createTraceWriter } from './writer.js';

const ESC = '\u001b';
const temporaries: string[] = [];

afterEach(async () => {
  await Promise.all(temporaries.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function workspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'twtrace-report-'));
  temporaries.push(dir);
  return dir;
}

/** Records a run whose second step fails after the button becomes disabled. */
async function recordFailingRun(dir: string): Promise<void> {
  const session = new FakeSession('sess-report');
  const writer = createTraceWriter(session, {
    dir,
    command: ['demo'],
    columns: 20,
    rows: 3,
    now: session.now,
  });

  session.semantic(
    snapshot(1, [node({ id: 'n1', role: 'button', name: 'Submit' })], 'sess-report'),
  );
  session.output('ready');
  const setup = writer.addStep('open the form');
  session.tick(100);
  setup.end('passed');

  const submit = writer.addStep('press Submit');
  session.tick(100);
  session.output(`\r\n${ESC}[31mrejected`);
  session.semantic(
    snapshot(
      2,
      [node({ id: 'n1', role: 'button', name: 'Submit', state: { disabled: true } })],
      'sess-report',
    ),
  );
  session.tick(50);
  submit.end('failed', 'still disabled');
  await writer.finalize();
}

describe('generateHtmlReport', () => {
  it('writes a self-contained document with the run summary', async () => {
    const root = await workspace();
    const outFile = join(root, 'report', 'index.html');
    const result = await generateHtmlReport({
      outFile,
      title: 'demo run',
      embedPlayer: false,
      generatedAt: new Date('2026-08-15T10:00:00.000Z'),
      results: [
        { id: 't1', title: 'passing test', status: 'passed', durationMs: 12 },
        { id: 't2', title: 'skipped test', status: 'skipped' },
      ],
    });

    expect(result).toMatchObject({ passed: 1, failed: 0, skipped: 1 });
    const html = await readFile(outFile, 'utf8');
    expect(html).toBe(result.html);
    expect(html).toContain('<title>demo run</title>');
    expect(html).toContain('1 passed');
    expect(html).toContain('2026-08-15T10:00:00.000Z');
    expect(html).not.toMatch(/https?:\/\/[^"]*\.(?:js|css)/);
    expect(html).not.toContain('<script src=');
    expect(html).not.toContain('<link rel="stylesheet"');
  });

  it('derives visual and semantic diffs from the trace of a failing test', async () => {
    const root = await workspace();
    const traceDir = join(root, 'failing.twtrace');
    await recordFailingRun(traceDir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      generatedAt: new Date('2026-08-15T10:00:00.000Z'),
      results: [
        {
          id: 't1',
          title: 'submits the form',
          file: 'form.test.ts',
          status: 'failed',
          error: { message: 'expected button to be enabled' },
          tracePath: traceDir,
        },
      ],
    });

    expect(html).toContain('failing step: <strong>press Submit</strong>');
    expect(html).toContain('button &quot;Submit&quot; state changed to disabled');
    expect(html).toContain('expected button to be enabled');
    expect(html).toContain('before failing step');
    expect(html).toContain('at failure');
    expect(html).toContain('tw-row-changed');
    expect(html).toContain('color:#cd3131');
    expect(html).toContain('<td>open the form</td>');
  });

  it('accepts caller-supplied screens and trees instead of a trace', async () => {
    const root = await workspace();
    const before = snapshot(1, [node({ id: 'n1', role: 'text', name: 'Loading' })]);
    const after = snapshot(2, [node({ id: 'n2', role: 'dialog', name: 'Permission' })]);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'snapshot mismatch',
          status: 'failed',
          visual: {
            expected: 'alpha',
            actual: 'beta',
            expectedLabel: 'stored snapshot',
            actualLabel: 'received',
            columns: 10,
            rows: 1,
          },
          semantic: { before, after },
        },
      ],
    });

    expect(html).toContain('stored snapshot');
    expect(html).toContain('received');
    expect(html).toContain('dialog &quot;Permission&quot; appeared');
    expect(html).toContain('1 row(s) changed');
  });

  it('inlines the asciinema player and the recording', async () => {
    const root = await workspace();
    const traceDir = join(root, 'player.twtrace');
    await recordFailingRun(traceDir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      results: [{ id: 't1', title: 'submits', status: 'failed', tracePath: traceDir }],
    });

    expect(html).toContain('AsciinemaPlayer');
    expect(html).toContain('<script type="application/json" id="cast-t1">');
    expect(html).toContain('data-start="0.1"');
    // The embedded cast JSON must not be able to close the surrounding script.
    expect(html).not.toContain('</script>"');
  });

  it('omits an oversized recording instead of embedding it', async () => {
    const root = await workspace();
    const traceDir = join(root, 'big.twtrace');
    await recordFailingRun(traceDir);

    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      maxEmbeddedCastBytes: 4,
      results: [{ id: 't1', title: 'submits', status: 'failed', tracePath: traceDir }],
    });

    expect(html).toContain('recording omitted');
    expect(html).not.toContain('<script type="application/json"');
  });

  it('inlines caller-supplied screenshots as data URIs', async () => {
    const root = await workspace();
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01, 0x02]);
    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'renders the dialog',
          status: 'failed',
          screenshots: [{ label: 'at failure', image: png }],
        },
      ],
    });

    expect(html).toContain('<h3>Screenshots</h3>');
    expect(html).toContain('<figcaption>at failure</figcaption>');
    expect(html).toContain(`src="data:image/png;base64,${Buffer.from(png).toString('base64')}"`);
  });

  it('honours a screenshot media type other than PNG', async () => {
    const root = await workspace();
    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        {
          id: 't1',
          title: 'svg shot',
          status: 'failed',
          screenshots: [
            {
              label: 'vector',
              image: new TextEncoder().encode('<svg/>'),
              mediaType: 'image/svg+xml',
            },
          ],
        },
      ],
    });
    expect(html).toContain('src="data:image/svg+xml;base64,');
  });

  it('degrades gracefully when the trace is missing', async () => {
    const root = await workspace();
    const { html } = await generateHtmlReport({
      outFile: join(root, 'report.html'),
      embedPlayer: false,
      results: [
        { id: 't1', title: 'gone', status: 'failed', tracePath: join(root, 'nope.twtrace') },
      ],
    });
    expect(html).toContain('trace unavailable');
  });
});
