import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { instrumentOpenTuiOutput } from './output-instrumentation.js';

const fixture = `
class Renderer {
  constructor(stdin, stdout, width, height, config = {}) {
    this.stdout = stdout;
    this._usesProcessStdout = stdout === process.stdout;
    this.realStdoutWrite = stdout.write;
    const useMemoryBufferedOutput = config.bufferedOutput === "memory";
    const useFeedOutput = !this._usesProcessStdout && !useMemoryBufferedOutput;
    const remoteMode = config.remote ?? (useFeedOutput ? true : undefined);
    consume(useFeedOutput, remoteMode);
    this._detachFeed = feed.onData((bytes) => new Promise((resolve) => {
      this.realStdoutWrite.call(this.stdout, bytes, () => resolve());
    }));
    rendererTracker.streamOwners.get(stdout);
    rendererTracker.streamOwners.set(stdout, this);
    if (this._usesProcessStdout) process.on("SIGWINCH", this.sigwinchHandler);
  }
}`;

describe('OpenTUI local-feed structural instrumentation', () => {
  it('separates feed selection from local terminal identity without forcing remote mode', () => {
    const transformed = instrumentOpenTuiOutput(fixture, '0.5.3', 'test-token');

    expect(transformed).toBeDefined();
    if (transformed === undefined) throw new Error('fixture did not match');
    expect(transformed).toContain('const __termwrightLocalFeed');
    expect(transformed).toContain('globalThis.__termwright_isOpenTuiOutputSink?.(stdout) === true');
    expect(transformed).toContain('__termwrightLocalFeed ? config.remote');
    expect(transformed).toContain('if (__termwrightLocalFeed) this.stdout = stdout[Symbol.for');
    expect(transformed).toContain('this._usesProcessStdout = this.stdout === process.stdout');
    expect(transformed).toContain('__termwrightLocalFeed ? this.stdout.write : stdout.write');
    expect(transformed).toContain('const useFeedOutput = (__termwrightLocalFeed ||');
    expect(transformed.match(/streamOwners\.(?:get|set)\(this\.stdout/gu)).toHaveLength(2);
    expect(transformed).toContain('stdout[Symbol.for("termwright.opentui.marker-sink-feed-write.v1")](bytes');
    expect(transformed).not.toContain('remote: false');
  });

  it('fails closed when the constructor shape is absent or ambiguous', () => {
    expect(instrumentOpenTuiOutput('export const value = 1;', '0.5.3', 'test-token')).toBeUndefined();
    expect(instrumentOpenTuiOutput(`${fixture}\n${fixture}`, '0.5.3', 'test-token')).toBeUndefined();
  });

  it.each([
    ['duplicate feed write', fixture.replace(
      'this.realStdoutWrite.call(this.stdout, bytes, () => resolve());',
      'this.realStdoutWrite.call(this.stdout, bytes, () => resolve()); this.realStdoutWrite.call(this.stdout, bytes, () => resolve());',
    )],
    ['feed write outside onData', fixture.replace('this._detachFeed = feed.onData', 'consume')],
    ['unexpected feed write arity', fixture.replace('bytes, () => resolve()', 'bytes, "utf8", () => resolve()')],
    ['missing stdout lease set', fixture.replace('rendererTracker.streamOwners.set(stdout, this)', 'rendererTracker.streamOwners.get(stdout)')],
    ['nested stdout anchor', fixture.replace('this.stdout = stdout;', '(() => { this.stdout = stdout; })();')],
    ['injected binding collision', fixture.replace('this.stdout = stdout;', 'this.stdout = stdout; const __termwrightLocalFeed = false;')],
    ['feed write hidden in a nested function', fixture.replace(
      'this.realStdoutWrite.call(this.stdout, bytes, () => resolve());',
      'const neverCalled = () => this.realStdoutWrite.call(this.stdout, bytes, () => resolve()); resolve();',
    )],
  ])('fails closed for %s', (_label, source) => {
    expect(instrumentOpenTuiOutput(source, '0.5.3', 'test-token')).toBeUndefined();
  });

  it('structurally matches the installed Node and Bun artifacts without knowing chunk names', async () => {
    const entry = createRequire(import.meta.url).resolve('@opentui/core');
    const files = (await readdir(dirname(entry))).filter((file) => file.endsWith('.js'));
    let matches = 0;
    for (const file of files) {
      const source = await readFile(join(dirname(entry), file), 'utf8');
      if (instrumentOpenTuiOutput(source, '0.5.3', 'test-token') !== undefined) matches += 1;
    }
    expect(matches).toBe(2);
  });
});
