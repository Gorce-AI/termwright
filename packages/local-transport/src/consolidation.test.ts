import { readdir, readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const consumerSources = [
  new URL('../../resource-broker/src/transport.ts', import.meta.url),
  new URL('../../run-journal-transport/src/index.ts', import.meta.url),
] as const;

describe('local transport consolidation', () => {
  it('keeps both consumers on the shared transport implementation', async () => {
    for (const sourceUrl of consumerSources) {
      const source = await readFile(sourceUrl, 'utf8');
      expect(source, sourceUrl.pathname).toContain("from '@termwright/local-transport'");
      for (const primitive of [
        'bindLocalEndpoint',
        'createLocalToken',
        'LocalJsonDecoder',
        'parseRequestEnvelope',
        'parseResponseEnvelope',
        'responseEnvelope',
        'sameLocalSecret',
        'writeLocalFrame',
      ]) {
        expect(source, `${sourceUrl.pathname} must consume ${primitive}`).toContain(primitive);
      }
      expect(source, sourceUrl.pathname).not.toMatch(
        /readUInt32BE|writeUInt32BE|timingSafeEqual|TextDecoder|createFrameDecoder|encodeFrame|\.listen\(|mkdtemp/u,
      );
    }
  });

  it('forbids a second production implementation anywhere in either consumer package', async () => {
    const sourceRoots = [
      new URL('../../resource-broker/src/', import.meta.url),
      new URL('../../run-journal-transport/src/', import.meta.url),
    ] as const;
    const duplicatePrimitive =
      /readUInt32BE|writeUInt32BE|timingSafeEqual|TextDecoder|createFrameDecoder|encodeFrame|\.listen\(|mkdtemp/u;
    for (const sourceRoot of sourceRoots) {
      const entries = await readdir(sourceRoot, { recursive: true, withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
        const sourcePath = `${entry.parentPath}/${entry.name}`;
        expect(await readFile(sourcePath, 'utf8'), sourcePath).not.toMatch(duplicatePrimitive);
      }
    }
  });
});
