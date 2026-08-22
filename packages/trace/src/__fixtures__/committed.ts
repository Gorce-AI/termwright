import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { TRACE_FILES } from '../types.js';

/** Edit one member while keeping a deliberately authored test archive committed. */
export async function rewriteCommittedMember(dir: string, name: string, body: string): Promise<void> {
  await writeFile(join(dir, name), body, 'utf8');
  const path = join(dir, TRACE_FILES.commit);
  const commit = JSON.parse(await readFile(path, 'utf8')) as {
    v: 1;
    checksums: Record<string, string>;
  };
  commit.checksums[name] = createHash('sha256').update(body).digest('hex');
  await writeFile(path, `${JSON.stringify(commit)}\n`, 'utf8');
}
