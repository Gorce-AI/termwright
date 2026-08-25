import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { verifyPeMachine } from './check-prebuild.mjs';

const execute = promisify(execFile);

function peFixture(machine) {
  const bytes = Buffer.alloc(0x80);
  bytes.write('MZ', 0, 'latin1');
  bytes.writeUInt32LE(0x40, 0x3c);
  bytes.write('PE\0\0', 0x40, 'latin1');
  bytes.writeUInt16LE(machine, 0x44);
  return bytes;
}

describe('Windows prebuild architecture guard', () => {
  it('accepts the exact AMD64 and ARM64 PE Machine values', () => {
    expect(() => verifyPeMachine(peFixture(0x8664), 'x64')).not.toThrow();
    expect(() => verifyPeMachine(peFixture(0xaa64), 'arm64')).not.toThrow();
  });

  it('rejects a valid PE image packaged for the wrong architecture', () => {
    expect(() => verifyPeMachine(peFixture(0x8664), 'arm64')).toThrow(
      /arm64 prebuild has PE Machine 0x8664, expected 0xaa64/u,
    );
    expect(() => verifyPeMachine(peFixture(0xaa64), 'x64')).toThrow(
      /x64 prebuild has PE Machine 0xaa64, expected 0x8664/u,
    );
  });

  it('rejects truncated and non-PE files', () => {
    expect(() => verifyPeMachine(Buffer.alloc(8), 'x64')).toThrow(/missing DOS header/u);
    const missingSignature = peFixture(0x8664);
    missingSignature.fill(0, 0x40, 0x44);
    expect(() => verifyPeMachine(missingSignature, 'x64')).toThrow(/missing PE signature/u);
  });

  it('keeps an absent development prebuild optional only with --allow-missing', async () => {
    const script = new URL('./check-prebuild.mjs', import.meta.url);
    const missing = 'deliberately-missing-test-architecture';
    await expect(execute(process.execPath, [fileURLToPath(script), missing, '--allow-missing'])).resolves.toMatchObject({
      stdout: expect.stringContaining('is absent (not built in this tree)'),
    });
    await expect(execute(process.execPath, [fileURLToPath(script), missing])).rejects.toMatchObject({ code: 1 });
  });
});
