/**
 * The entry point is an ordinary Ink application. The test launcher attaches
 * the probe; this production source owns only rendering and optional intent.
 *
 *     node dist/cli.js        # just a todo list, saved to ./todos.json
 */

import { render } from 'ink';
import { loadTodos, saveTodos } from './store.js';
import { TodoApp } from './todo-app.js';

// `alternateScreen` is what lets the injected probe publish cell bounds, and
// Qualified geometry and hit ownership are what make pointer actions safe.
const app = render(<TodoApp todos={loadTodos()} onTodosChange={saveTodos} />, {
  alternateScreen: true,
  interactive: true,
  exitOnCtrlC: true,
});

await app.waitUntilExit();
