import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { seedDirectory } from './seed.js';

const directories: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'tw-seed-'));
  directories.push(dir);
  return dir;
}

afterEach(() => {
  while (directories.length > 0) rmSync(directories.pop() as string, { recursive: true, force: true });
});

describe('seedDirectory', () => {
  it('writes declared files, creating the directories they need', () => {
    const dir = workspace();
    seedDirectory(dir, {
      files: { 'config.json': '{"theme":"dark"}', 'notes/todo.md': '- write tests\n' },
    });
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{"theme":"dark"}');
    expect(readFileSync(join(dir, 'notes/todo.md'), 'utf8')).toBe('- write tests\n');
  });

  it('writes bytes as given', () => {
    const dir = workspace();
    seedDirectory(dir, { files: { 'raw.bin': new Uint8Array([0, 159, 146, 150]) } });
    expect([...readFileSync(join(dir, 'raw.bin'))]).toEqual([0, 159, 146, 150]);
  });

  it('copies a template, then writes the declared files over it', () => {
    const source = workspace();
    mkdirSync(join(source, 'src'), { recursive: true });
    writeFileSync(join(source, 'src/app.ts'), 'export const app = 1;\n');
    writeFileSync(join(source, 'config.json'), '{"theme":"light"}');

    const dir = workspace();
    seedDirectory(dir, { template: source, files: { 'config.json': '{"theme":"dark"}' } });
    // Untouched by the test comes from the template…
    expect(readFileSync(join(dir, 'src/app.ts'), 'utf8')).toBe('export const app = 1;\n');
    // …and the one file the test is about wins.
    expect(readFileSync(join(dir, 'config.json'), 'utf8')).toBe('{"theme":"dark"}');
  });

  it('copies a template into a subdirectory when asked', () => {
    const source = workspace();
    writeFileSync(join(source, 'note.txt'), 'hello');
    const dir = workspace();
    seedDirectory(dir, { template: { from: source, into: 'project' } });
    expect(readFileSync(join(dir, 'project/note.txt'), 'utf8')).toBe('hello');
  });

  it('does nothing when nothing was declared', () => {
    const dir = workspace();
    expect(seedDirectory(dir, {})).toEqual([]);
  });

  it('refuses a path that escapes the test directory', () => {
    const dir = workspace();
    expect(() => seedDirectory(dir, { files: { '../escaped.txt': 'no' } })).toThrow(
      /escapes the test's directory/u,
    );
    expect(() => seedDirectory(dir, { files: { 'a/../../escaped.txt': 'no' } })).toThrow(
      /escapes the test's directory/u,
    );
    expect(() => seedDirectory(dir, { template: { from: '.', into: '../out' } })).toThrow(
      /escapes the test's directory/u,
    );
  });

  it('refuses an absolute path', () => {
    const dir = workspace();
    expect(() => seedDirectory(dir, { files: { '/etc/passwd': 'no' } })).toThrow(
      /must be relative to the test's directory/u,
    );
  });
});
