/**
 * Where the todos live between runs.
 *
 * The path is relative on purpose: it resolves against the process's working
 * directory, which under the Vitest preset is the private directory of the
 * test that launched the app. That is what lets a test declare the starting
 * state with `launch({ files: { 'todos.json': … } })` and read the result back
 * afterwards, without the app knowing a test exists.
 */

import { readFileSync, writeFileSync } from 'node:fs';

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

/** Writes the todos back. Failures are ignored: a todo list is not worth a crash. */
export function saveTodos(todos: readonly Todo[]): void {
  try {
    writeFileSync(TODOS_FILE, `${JSON.stringify(todos, null, 2)}\n`);
  } catch {
    // A read-only directory should not take the app down.
  }
}
