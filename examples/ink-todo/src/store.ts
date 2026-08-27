/**
 * Where the todos live between runs.
 *
 * The path is relative on purpose: it resolves against the process's working
 * directory, which under the Vitest preset is the private directory of the
 * test that launched the app. That is what lets a test declare the starting
 * state with `launch({ files: { 'todos.json': … } })` and read the result back
 * afterwards, without the app knowing a test exists.
 */

import {
  closeSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';

export interface Todo {
  readonly id: number;
  readonly text: string;
  readonly done: boolean;
}

export const TODOS_FILE = 'todos.json';

/** What a first run starts with. */
export const SEED_TODOS: readonly Todo[] = [
  { id: 1, text: 'write the README', done: true },
  { id: 2, text: 'record a demo', done: false },
  { id: 3, text: 'ship 1.0', done: false },
];

/** Reads the saved todos, falling back to the seed for a first run. */
export function loadTodos(): readonly Todo[] {
  let raw: string;
  try {
    raw = readFileSync(TODOS_FILE, 'utf8');
  } catch {
    return SEED_TODOS;
  }
  // A corrupt file is the user's data: keep the app usable rather than
  // crashing on the first frame, and leave the file alone until they change
  // something.
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as readonly Todo[]) : SEED_TODOS;
  } catch {
    return SEED_TODOS;
  }
}

/**
 * Writes a complete replacement in the same directory before publishing it.
 *
 * The application and an observer (including a test) are separate processes.
 * Writing directly to TODOS_FILE would expose the truncate-before-write window,
 * so even a synchronous writer could briefly make the file invalid JSON.
 */
export function saveTodos(todos: readonly Todo[]): void {
  const temporary = `.${TODOS_FILE}.${process.pid}.tmp`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, 'w', 0o600);
    writeFileSync(descriptor, `${JSON.stringify(todos, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, TODOS_FILE);

    // A directory fsync makes the rename crash-durable where the platform
    // exposes directory descriptors. Windows does not, so atomic visibility
    // still holds there while this durability strengthening is best-effort.
    try {
      const directory = openSync('.', 'r');
      try {
        fsyncSync(directory);
      } finally {
        closeSync(directory);
      }
    } catch {
      // Unsupported for directory handles on this platform.
    }
  } catch {
    // A read-only directory should not take the app down.
    if (descriptor !== undefined) {
      try {
        closeSync(descriptor);
      } catch {
        // Continue with best-effort rollback.
      }
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary may never have been created or may already be renamed.
    }
  }
}
