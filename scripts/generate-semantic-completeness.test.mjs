import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { renderSemanticCompletenessReport } from './generate-semantic-completeness.mjs';

describe('framework semantic completeness generation', () => {
  it('renders the checked-in report byte-for-byte from the compatibility registry', async () => {
    const registry = JSON.parse(await readFile(
      new URL('../compatibility/registry.json', import.meta.url),
      'utf8',
    ));
    const report = await readFile(
      new URL('../compatibility/framework-semantic-completeness.json', import.meta.url),
      'utf8',
    );

    expect(renderSemanticCompletenessReport(registry)).toBe(report);
  });
});
