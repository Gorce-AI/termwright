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
        socket.write('DONE\n');
      } else if (command === 'EXIT') {
        socket.destroy();
        server.close(() => process.exit(0));
      } else {
        throw new Error(`unexpected marker control command ${JSON.stringify(command)}`);
      }
    }
  });
  socket.write('READY\n');
});

server.listen(`\\\\.\\pipe\\${controlPipe}`);
