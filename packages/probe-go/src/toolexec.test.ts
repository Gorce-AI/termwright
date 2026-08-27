import {describe, expect, it} from 'vitest';
import {
  digestGoToolExecSource,
  GoToolExecError,
  quoteGoCommandArgument,
} from './toolexec.js';

describe('Go tool-executor unit contracts', () => {
  it('quotes Windows tool paths with Go toolexec grammar rather than JSON escaping', () => {
    expect(quoteGoCommandArgument('C:\\runner\\tool.exe')).toBe('C:\\runner\\tool.exe');
    expect(quoteGoCommandArgument('C:\\runner name\\tool.exe')).toBe("'C:\\runner name\\tool.exe'");
  });

  it('fails closed when a tool path cannot be represented by Go toolexec grammar', () => {
    expect(() => quoteGoCommandArgument(`path with 'single' and "double" quotes`))
      .toThrow(expect.objectContaining({code: 'go-environment'} satisfies Partial<GoToolExecError>));
  });

  it('gives owned source bytes a deterministic content identity', () => {
    const source = 'package probe\n';
    expect(digestGoToolExecSource(source)).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(digestGoToolExecSource(source)).toBe(digestGoToolExecSource(source));
    expect(digestGoToolExecSource(`${source}\n`)).not.toBe(digestGoToolExecSource(source));
  });

  it('keeps machine-readable failure codes on Go tool-executor errors', () => {
    const error = new GoToolExecError('source-mismatch', 'owned bytes changed');
    expect(error).toMatchObject({
      name: 'GoToolExecError',
      code: 'source-mismatch',
      message: 'owned bytes changed',
    });
  });
});
