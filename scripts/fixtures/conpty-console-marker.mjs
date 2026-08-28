import { createServer } from 'node:net';

const { writeWindowsConsoleMarker } = await import(
  process.env.TW_MARKER_PTY_ENTRY ?? '@termwright/pty'
);
const controlPipe = process.env.TW_MARKER_CONTROL_PIPE;
if (!controlPipe) throw new Error('TW_MARKER_CONTROL_PIPE is required');

const server = createServer((socket) => {
  socket.setEncoding('utf8');
  let pending = '';
  socket.on('data', (chunk) => {
    pending += chunk;
    for (;;) {
      const newline = pending.indexOf('\n');
      if (newline < 0) break;
      const command = pending.slice(0, newline).replace(/\r$/u, '');
      pending = pending.slice(newline + 1);
      if (command === 'GO') {
        writeWindowsConsoleMarker(1, process.env.TW_MARKER_TEXT ?? '');
        // DONE proves that the synchronous native write and mode restoration
        // both returned. Once Node/Bun confirms that DONE was handed to the
        // pipe, close both of our handles ourselves. Process lifetime must not
        // depend on when the PowerShell peer reports its half-close: Node 24
        // can otherwise keep the listening server alive after the child has
        // no more protocol work, which in turn prevents authoritative ConPTY
        // EOF in the parent test.
        socket.end('DONE\n', () => {
          socket.destroy();
          server.close();
        });
      } else {
        throw new Error(`unexpected marker control command ${JSON.stringify(command)}`);
      }
    }
  });
  socket.write('READY\n');
});

server.listen(`\\\\.\\pipe\\${controlPipe}`);
