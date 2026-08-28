import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function isDirectExecution(metaUrl, argvEntry = process.argv[1]) {
  if (argvEntry === undefined) return false;
  const modulePath = realpathSync(fileURLToPath(metaUrl));
  let entryPath;
  try {
    entryPath = realpathSync(resolve(argvEntry));
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return false;
    throw error;
  }
  return modulePath === entryPath;
}
