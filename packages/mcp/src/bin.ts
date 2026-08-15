#!/usr/bin/env node
/** The `termwright-mcp` executable. All logic lives in `cli.ts`. */
import { main } from './cli.js';

// `termwright-mcp agent-context | head` closes the pipe early; that is a normal
// end of output for a CLI, not a crash.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

await main();
