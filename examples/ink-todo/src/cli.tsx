/**
 * The entry point. `semanticRender` is `ink.render` plus semantics: without a
 * driver in the environment it opens no socket, writes no marker and renders
 * byte-for-byte what `render` would have rendered.
 *
 *     node dist/cli.js        # just a todo list
 */

import { semanticRender } from '@termwright/ink';
import { TodoApp } from './todo-app.js';

// `alternateScreen` is what lets the adapter publish cell bounds, and bounds
// are what make clicks and `boundingBox()` work. Tests that click need it.
const app = semanticRender(<TodoApp />, {
  alternateScreen: true,
  interactive: true,
  exitOnCtrlC: true,
});

await app.waitUntilExit();
